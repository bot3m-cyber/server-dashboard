'use strict';
// Zeitplan (täglich oder alle X Minuten) und Automatik (Auto-Stopp bei leerem Server, Neustart nach Absturz).
// Läuft für jeden Server einzeln.
const config = require('./config');
const ctx = require('./context');
const backup = require('./backup');
const jobs = require('./jobs');
const registry = require('./mc');
const { UserError } = require('./util');

const TYPES = ['backup', 'restart', 'stop', 'start', 'command', 'say'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const emptySince = new Map(); // Server-ID -> Zeitpunkt
const crashTimes = new Map(); // Server-ID -> [Zeitpunkte]
const appStart = Date.now();

const mcNow = () => registry.get(ctx.id() || config.activeId());

function clean(input) {
  const s = input || {};
  const name = String(s.name || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
  if (!name) throw new UserError('Bitte einen Namen für die Aufgabe angeben.');
  if (!TYPES.includes(s.type)) throw new UserError('Unbekannte Aktion.');
  const mode = s.mode === 'interval' ? 'interval' : 'daily';
  const out = { id: s.id || Math.random().toString(36).slice(2, 10), name, type: s.type, mode, enabled: s.enabled !== false, lastRun: s.lastRun || 0 };
  if (mode === 'daily') {
    if (!TIME_RE.test(s.time || '')) throw new UserError('Bitte eine Uhrzeit wie 04:30 angeben.');
    out.time = s.time;
    out.days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  } else {
    const n = Number(s.everyMin);
    if (!Number.isInteger(n) || n < 5 || n > 10080) throw new UserError('Das Intervall muss zwischen 5 Minuten und 7 Tagen liegen.');
    out.everyMin = n;
  }
  if (s.type === 'command' || s.type === 'say') {
    const c = String(s.command || '').replace(/[\r\n]+/g, ' ').trim().replace(/^\//, '');
    if (!c || c.length > 200) throw new UserError('Bitte einen Befehl oder Text (höchstens 200 Zeichen) angeben.');
    out.command = c;
  }
  if (s.type === 'restart') {
    const w = Number(s.warnSeconds ?? 60);
    out.warnSeconds = Number.isInteger(w) && w >= 0 && w <= 600 ? w : 60;
  }
  return out;
}

function save(item) {
  const list = config.get().schedules;
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  if (list.length > 40) throw new UserError('Es sind höchstens 40 Aufgaben möglich.');
  config.update({ schedules: list });
  return item;
}

function remove(id) {
  config.update({ schedules: config.get().schedules.filter((x) => x.id !== id) });
}

async function run(s) {
  const mc = mcNow();
  const cfgItem = config.get().schedules.find((x) => x.id === s.id);
  if (cfgItem) { cfgItem.lastRun = Date.now(); config.update({}); }
  const running = mc.state === 'läuft';
  const label = `Zeitplan „${s.name}“`;
  try {
    if (s.type === 'backup') {
      if (jobs.busy()) return;
      jobs.run('backup', 'Geplantes Backup', async (jctx) => {
        const r = await backup.create(jctx, mc, 'auto');
        await backup.pruneAuto(config.get().autoBackupKeep);
        return r;
      });
    } else if (s.type === 'command' && running) {
      mc.command(s.command);
    } else if (s.type === 'say' && running) {
      mc.command(`say ${s.command}`);
    } else if (s.type === 'stop' && running) {
      mc.stop();
    } else if (s.type === 'start' && mc.state === 'aus') {
      await mc.start();
    } else if (s.type === 'restart' && running) {
      const w = s.warnSeconds ?? 60;
      if (w > 0) {
        mc.command(`say Der Server startet in ${w} Sekunden neu.`);
        setTimeout(() => { if (mc.state === 'läuft') mc.restart().catch(() => {}); }, w * 1000);
      } else {
        await mc.restart();
      }
    }
    mc.sys(`${label} ausgeführt.`);
  } catch (e) {
    mc.sys(`${label} fehlgeschlagen: ${e.message}`);
  }
}

function due(s, now, mc) {
  if (!s.enabled) return false;
  if (s.mode === 'interval') {
    const ref = s.lastRun || mc.readyAt || appStart;
    return now.getTime() - ref >= s.everyMin * 60000;
  }
  const [h, m] = s.time.split(':').map(Number);
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0).getTime();
  if (s.days?.length && !s.days.includes(now.getDay())) return false;
  return now.getTime() >= slot && now.getTime() - slot < 10 * 60000 && (s.lastRun || 0) < slot;
}

/** Ein Durchlauf für einen Server (läuft im Kontext dieses Servers). */
function tickOne(p) {
  const mc = registry.get(p.id);
  const now = new Date();
  for (const s of p.schedules || []) if (due(s, now, mc)) run(s);
  // Auto-Stopp: Server ist eine Weile leer
  if (p.autoStopMinutes > 0 && mc.state === 'läuft' && mc.readyAt) {
    if (mc.players.size === 0) {
      const since = emptySince.get(p.id) || Date.now();
      emptySince.set(p.id, since);
      if (Date.now() - since >= p.autoStopMinutes * 60000) {
        emptySince.delete(p.id);
        mc.sys(`Auto-Stopp: Seit ${p.autoStopMinutes} Minuten ist niemand online.`);
        try { mc.stop(); } catch { /* läuft nicht mehr */ }
      }
    } else {
      emptySince.delete(p.id);
    }
  } else {
    emptySince.delete(p.id);
  }
}

function tick() {
  for (const p of [...config.list()]) {
    ctx.run({ id: p.id, user: null }, () => { try { tickOne(p); } catch (e) { console.error('Zeitplan:', e.message); } });
  }
}

/** Nach einem Absturz neu starten (höchstens 3 Versuche innerhalb von 15 Minuten). */
function onCrash(mc) {
  const p = config.get(mc.id);
  if (!p.autoRestartOnCrash) return false;
  const now = Date.now();
  const times = (crashTimes.get(mc.id) || []).filter((t) => now - t <= 15 * 60000);
  times.push(now);
  crashTimes.set(mc.id, times);
  if (times.length > 3) {
    mc.sys('Auto-Neustart: Der Server ist zu oft abgestürzt, der Neustart wird nicht weiter versucht.');
    return false;
  }
  mc.sys(`Auto-Neustart in 10 Sekunden (Versuch ${times.length} von 3) …`);
  setTimeout(() => { if (mc.state === 'aus') mc.start().catch((e) => mc.sys(`Auto-Neustart fehlgeschlagen: ${e.message}`)); }, 10000);
  return true;
}

function init() {
  setInterval(tick, 20000).unref();
}

module.exports = { init, clean, save, remove, run, onCrash, TYPES };
