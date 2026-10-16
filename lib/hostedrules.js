'use strict';
// Regeln, die im Mehrbenutzer-Modus vor jedem Serverstart gelten: Arbeitsspeicher, Speicherplatz, eigene Ports.
const net = require('net');
const quota = require('./quota');
const users = require('./users');
const bedrock = require('./bedrock');
const properties = require('./properties');
const hosted = require('./hosted');
const { UserError } = require('./util');

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '0.0.0.0');
  });
}

async function beforeStart(cfg, inst) {
  const owner = cfg.ownerId ? users.byId(cfg.ownerId) : null;
  if (owner?.disabled) throw new UserError('Das Konto des Besitzers ist gesperrt.', 403);

  // Arbeitsspeicher: gemeinsames Budget des Servers und Grenze des Besitzers
  const budget = quota.budgetGb();
  const running = quota.runningRamGb({ exceptId: inst.id });
  if (running + cfg.xmxGb > budget) {
    throw new UserError(`Gerade ist nicht genug Arbeitsspeicher frei (${Math.max(0, budget - running)} GB frei, dein Server braucht ${cfg.xmxGb} GB). Bitte stelle den RAM kleiner oder versuche es später.`, 503);
  }
  if (owner) {
    const q = users.effectiveQuota(owner);
    const mine = quota.runningRamGb({ exceptId: inst.id, userId: owner.id });
    if (mine + cfg.xmxGb > q.maxRamGb) {
      throw new UserError(`Du darfst insgesamt ${q.maxRamGb} GB RAM gleichzeitig nutzen (${mine} GB sind schon durch laufende Server belegt).`, 403);
    }
    await quota.assertDisk(owner);
  }

  // Eigener Port pro Server
  if (!cfg.port) throw new UserError('Diesem Server ist noch kein Port zugewiesen.', 500);
  if (!(await portFree(cfg.port))) throw new UserError(`Der Port ${cfg.port} ist auf diesem Rechner schon belegt. Bitte wende dich an den Betreiber.`, 409);
  properties.set({ 'server-port': String(cfg.port), 'query.port': String(cfg.port) });
  if (cfg.bedrockPort) bedrock.setPort(cfg.bedrockPort); // nur, wenn Geyser seine Einstellungen schon angelegt hat
  if (!hosted.enabled()) return;
}

module.exports = { beforeStart, portFree };
