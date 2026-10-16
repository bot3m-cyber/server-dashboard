'use strict';
// Steuerung der Minecraft-Server-Prozesse: Start, Stopp, Konsole, Spieler, Absturz-Erkennung.
// Pro Server gibt es eine eigene Instanz (McServer). Lokal ist das nur der aktive Server,
// im Mehrbenutzer-Modus laufen viele gleichzeitig.
const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const config = require('./config');
const ctx = require('./context');
const setup = require('./setup');
const java = require('./java');
const crash = require('./crash');
const hosted = require('./hosted');
const serverTypes = require('./servertypes');
const { UserError } = require('./util');

const MAX_LINES = 3000;
const IS_WIN = process.platform === 'win32';

// Wie die Server-Geschwindigkeit je Server-Typ abgefragt und erkannt wird
const num = (x) => Number(String(x).replace(',', '.'));
const TPS_PROBES = {
  neoforge: {
    cmd: 'neoforge tps', re: /Overall: ([\d.,]+) TPS \(([\d.,]+) ms\/tick\)/, hide: /: [\d.,]+ TPS \([\d.,]+ ms\/tick\)/,
    parse: (m) => ({ tps: Math.min(20, num(m[1])), mspt: num(m[2]) }),
  },
  paper: {
    cmd: 'tps', re: /TPS from last 1m, 5m, 15m: \*?(\d+(?:[.,]\d+)?)/, hide: /TPS from last 1m/,
    parse: (m) => ({ tps: Math.min(20, num(m[1])), mspt: null }),
  },
  vanilla: {
    cmd: 'tick query', re: /Average time per tick: ([\d.,]+)ms/,
    hide: /\]: (The game is running|Target tick rate|Average time per tick|Percentiles)/,
    parse: (m) => ({ tps: Math.min(20, Math.round(10000 / Math.max(num(m[1]), 50)) / 10), mspt: num(m[1]) }),
  },
};
const tpsProbe = (type) => (type === 'modpack' || type === 'neoforge' ? TPS_PROBES.neoforge : type === 'paper' || type === 'purpur' ? TPS_PROBES.paper : TPS_PROBES.vanilla);

/** Startparameter für Java je nach Server-Typ. */
function launchArgs(cfg) {
  const mem = [`-Xms${cfg.xmsGb}G`, `-Xmx${cfg.xmxGb}G`];
  const enc = ['-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8'];
  if (cfg.type === 'modpack' || cfg.type === 'neoforge') return [...mem, ...enc, `@${setup.argsFileRel(setup.neoVersion(cfg))}`, 'nogui'];
  return [...mem, ...(cfg.aikar ? serverTypes.AIKAR_FLAGS : []), ...enc, '-jar', cfg.jar || 'server.jar', 'nogui'];
}
// Farbcodes (ANSI), die manche Mods in die Ausgabe schreiben
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

class McServer extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.state = 'aus'; // aus | startet | läuft | stoppt
    this.proc = null;
    this.lines = [];
    this.pending = [];
    this.flushTimer = null;
    this.players = new Set();
    this.maxPlayers = null;
    this.startedAt = 0;
    this.readyAt = 0;
    this.stopRequested = false;
    this.restartAfterStop = false;
    this.killTimer = null;
    this.lastCrash = null;
    this.waiters = new Set();
    this.activity = [];
    this.tps = null;
    this.swallowUntil = 0;
    setInterval(() => this.pollTps(), 30000).unref();
  }

  /** Führt fn im Kontext dieses Servers aus (damit config.get() den richtigen Server liefert). */
  _in(fn) {
    return ctx.run({ id: this.id, user: ctx.user() }, fn);
  }

  isRunning() {
    return !!this.proc;
  }

  /** Beim Wechsel auf einen anderen Server: Ausgabe, Aktivität und Absturz-Status zurücksetzen. */
  reset() {
    this.lines = [];
    this.pending = [];
    this.activity = [];
    this.lastCrash = null;
    this.players.clear();
    this.maxPlayers = null;
    this.tps = null;
    this.startedAt = 0;
    this.readyAt = 0;
    this.emit('status', this.info());
  }

  info() {
    return {
      id: this.id, state: this.state, startedAt: this.startedAt || null, readyAt: this.readyAt || null, pid: this.proc?.pid || null,
      crashed: !!this.lastCrash, players: [...this.players], maxPlayers: this.maxPlayers, tps: this.tps,
    };
  }

  setState(s) {
    this.state = s;
    this.emit('status', this.info());
  }

  pushLine(line) {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    this.pending.push(line);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const batch = this.pending;
        this.pending = [];
        this.emit('lines', batch);
      }, 100);
    }
  }

  sys(text) {
    this.pushLine(`[Dashboard] ${text}`);
  }

  async start() {
    return this._in(async () => {
      if (this.proc) throw new UserError('Der Server läuft bereits.', 409);
      const cfg = config.get(this.id);
      const st = setup.status();
      const installed = cfg.type === 'modpack' ? st.steps.pack && st.steps.neoforge : st.steps.install;
      if (!installed) throw new UserError('Die Einrichtung ist noch nicht fertig. Bitte zuerst die Schritte unter „Einrichtung“ erledigen.');
      if (!st.steps.eula) throw new UserError('Bitte zuerst der Minecraft-EULA zustimmen (Einrichtung).');
      const j = await java.requireFor(cfg.javaMajor);
      if (hosted.enabled()) await require('./hostedrules').beforeStart(cfg, this);
      if (this.proc) throw new UserError('Der Server läuft bereits.', 409);

      const args = launchArgs(cfg);
      this.stopRequested = false;
      this.lastCrash = null;
      this.players.clear();
      this.startedAt = Date.now();
      this.readyAt = 0;
      this.sys(`Starte Server mit Java ${j.version}, RAM ${cfg.xmsGb}–${cfg.xmxGb} GB …`);
      let proc;
      try {
        proc = spawn(j.path, args, { cwd: cfg.serverDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        throw new UserError(`Java konnte nicht gestartet werden: ${e.message}`);
      }
      this.proc = proc;
      this.setState('startet');
      proc.stdin.on('error', () => {});
      readline.createInterface({ input: proc.stdout }).on('line', (l) => this.onLine(l));
      readline.createInterface({ input: proc.stderr }).on('line', (l) => this.onLine(l));
      proc.on('error', (e) => {
        this.sys(`Fehler beim Starten von Java: ${e.message}`);
      });
      proc.on('exit', (code) => this.onExit(code, proc));
    });
  }

  onLine(raw) {
    const line = raw.replace(ANSI_RE, '');
    // Die regelmäßige TPS-Abfrage soll die Konsole nicht zumüllen
    const hidden = Date.now() < this.swallowUntil && tpsProbe(config.get(this.id).type).hide.test(line);
    if (!hidden) this.pushLine(line);
    if (this.state === 'startet' && /\]: Done \([\d.,]+s\)!/.test(line)) {
      this.readyAt = Date.now();
      this.tps = null;
      this.setState('läuft');
      setTimeout(() => this.pollTps(), 5000);
      this.sys('Der Server ist bereit. Spieler können sich jetzt verbinden.');
      setTimeout(() => { if (this.state === 'läuft') this.command('list', true); }, 500);
    }
    let m = line.match(/]: ([.A-Za-z0-9_]{1,17}) joined the game$/);
    if (m) { this.players.add(m[1]); this.emitPlayers(); this.addActivity('join', m[1]); }
    m = line.match(/]: ([.A-Za-z0-9_]{1,17}) left the game$/);
    if (m) { this.players.delete(m[1]); this.emitPlayers(); this.addActivity('leave', m[1]); }
    m = line.match(/]: <([.A-Za-z0-9_]{1,17})> (.+)$/);
    if (m) this.addActivity('chat', m[1], m[2].slice(0, 200));
    m = line.match(/]: ([.A-Za-z0-9_]{1,17}) has (?:made the advancement|completed the challenge|reached the goal) \[(.+)\]$/);
    if (m) this.addActivity('advancement', m[1], m[2]);
    m = line.match(/There are (\d+) of a max of (\d+) players online:\s?(.*)$/);
    if (m) {
      this.maxPlayers = Number(m[2]);
      this.players = new Set(m[3].split(',').map((s) => s.trim()).filter(Boolean));
      this.emitPlayers();
    }
    for (const w of this.waiters) {
      if (w.re.test(line)) { this.waiters.delete(w); clearTimeout(w.timer); w.resolve(line); }
    }
  }

  addActivity(type, name, text = '') {
    const a = { t: Date.now(), type, name, text };
    this.activity.push(a);
    if (this.activity.length > 80) this.activity.shift();
    this.emit('activity', a);
  }

  /** Fragt TPS/Tick-Zeit über den NeoForge-Befehl ab (still, ohne Konsolenausgabe). */
  async pollTps() {
    if (this.state !== 'läuft' || !this.proc) return;
    this.swallowUntil = Date.now() + 4000;
    try {
      const probe = tpsProbe(config.get(this.id).type);
      const wait = this.waitForLine(probe.re, 3500);
      this.command(probe.cmd, true);
      const m = (await wait).match(probe.re);
      this.tps = { ...probe.parse(m), at: Date.now() };
      this.emit('status', this.info());
    } catch { /* Befehl nicht verfügbar oder keine Antwort */ }
  }

  emitPlayers() {
    this.emit('players', { players: [...this.players], maxPlayers: this.maxPlayers });
  }

  waitForLine(re, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { re, resolve };
      w.timer = setTimeout(() => { this.waiters.delete(w); reject(new Error('timeout')); }, timeoutMs);
      this.waiters.add(w);
    });
  }

  command(cmd, quiet = false) {
    if (!this.proc) throw new UserError('Der Server läuft nicht.', 409);
    const c = String(cmd).replace(/[\r\n]+/g, ' ').trim().replace(/^\//, '');
    if (!c) return;
    if (c.length > 1000) throw new UserError('Der Befehl ist zu lang.');
    if (/^stop$/i.test(c)) {
      this.stopRequested = true;
      this.setState('stoppt');
    }
    if (!quiet) this.pushLine(`> ${c}`);
    this.proc.stdin.write(`${c}\n`);
  }

  stop() {
    if (!this.proc) throw new UserError('Der Server läuft nicht.', 409);
    if (this.stopRequested) return;
    this.sys('Server wird sauber beendet (Befehl „stop“) …');
    this.command('stop', true);
    clearTimeout(this.killTimer);
    this.killTimer = setTimeout(() => {
      if (this.proc) {
        this.sys('Der Server reagiert nicht. Er wird jetzt hart beendet.');
        this.proc.kill();
      }
    }, 120000);
  }

  async restart() {
    if (!this.proc) return this.start();
    this.restartAfterStop = true;
    this.stop();
  }

  async onExit(code, proc) {
    if (this.proc !== proc) return;
    this.proc = null;
    clearTimeout(this.killTimer);
    const requested = this.stopRequested;
    const wasStarting = this.state === 'startet';
    this.players.clear();
    this.emitPlayers();
    this.sys(`Server beendet (Code ${code}).`);
    let crashed = !requested && code !== 0;
    let analysis = null;
    if (!requested) {
      analysis = await this._in(() => crash.analyze({ sinceMs: this.startedAt, logLines: this.lines.slice(-800) })).catch(() => null);
      if (analysis?.report || analysis?.issues?.length || analysis?.missingDeps?.length) crashed = true;
      if (wasStarting && code !== 0) crashed = true;
    }
    if (crashed) {
      this.lastCrash = { at: Date.now(), code, ...(analysis || {}) };
      this.sys('Der Server ist abgestürzt. Unter „Server & Konsole“ steht die Crash-Hilfe.');
      this.restartAfterStop = false;
    }
    this.setState('aus');
    if (crashed) this.emit('crash', this.lastCrash);
    if (this.restartAfterStop) {
      this.restartAfterStop = false;
      this.start().catch((e) => this.sys(`Neustart fehlgeschlagen: ${e.message}`));
    }
  }

  /** Arbeitsspeicher des Java-Prozesses in MB (oder null). */
  stats() {
    return new Promise((resolve) => {
      const pid = this.proc?.pid;
      if (!pid) return resolve(null);
      if (IS_WIN) {
        execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 }, (err, out) => {
          if (err) return resolve(null);
          const cols = String(out).trim().split('","');
          const kb = parseInt((cols[4] || '').replace(/\D/g, ''), 10);
          resolve(Number.isFinite(kb) ? Math.round(kb / 1024) : null);
        });
      } else {
        // Linux/macOS: belegter physischer Speicher (RSS) in KB
        execFile('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 5000 }, (err, out) => {
          const kb = parseInt(String(out).trim(), 10);
          resolve(!err && Number.isFinite(kb) ? Math.round(kb / 1024) : null);
        });
      }
    });
  }

  /** Beim Beenden des Dashboards: Server sauber stoppen, notfalls hart beenden. */
  async shutdown(maxWaitMs) {
    if (!this.proc) return;
    const proc = this.proc;
    try { this.stop(); } catch { /* egal */ }
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { proc.kill(); } catch { /* egal */ } resolve(); }, maxWaitMs);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}

// ---------------------------------------------------------------- Verzeichnis aller Instanzen

const instances = new Map();
const hooks = [];

function get(id) {
  if (!id) throw new UserError('Es ist kein Server ausgewählt.', 400);
  let inst = instances.get(id);
  if (!inst) {
    inst = new McServer(id);
    instances.set(id, inst);
    for (const h of hooks) h(inst);
  }
  return inst;
}

/** Instanz des Servers dieser Anfrage (Mehrbenutzer) bzw. des aktiven Servers (lokal). */
function current() {
  return get(ctx.id() || (hosted.enabled() ? null : config.activeId()));
}

/** Registriert einen Handler, der für jede (auch künftige) Instanz aufgerufen wird. */
function onCreate(fn) {
  hooks.push(fn);
  for (const inst of instances.values()) fn(inst);
}

const all = () => [...instances.values()];
const runningCount = () => all().filter((i) => i.isRunning()).length;

async function shutdownAll(maxWaitMs) {
  await Promise.all(all().map((i) => i.shutdown(maxWaitMs)));
}

module.exports = { McServer, get, current, onCreate, all, runningCount, shutdownAll };
