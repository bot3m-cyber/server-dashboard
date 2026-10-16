'use strict';
// Welt zurücksetzen: sichert die alte Welt und lässt beim nächsten Start eine neue erzeugen.
const fs = require('fs');
const fsp = fs.promises;
const config = require('./config');
const backup = require('./backup');
const properties = require('./properties');
const { UserError } = require('./util');

async function reset(ctx, mc, seed) {
  if (mc.isRunning()) throw new UserError('Bitte zuerst den Server stoppen.', 409);
  const s = String(seed ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (s.length > 40) throw new UserError('Der Seed darf höchstens 40 Zeichen lang sein.');
  const dirs = [backup.worldName(), `${backup.worldName()}_nether`, `${backup.worldName()}_the_end`].filter((d) => fs.existsSync(config.serverPath(d)));
  if (dirs.length) {
    ctx.log('Sichere die alte Welt …');
    await backup.create(ctx, mc, 'vor-reset');
    for (const d of dirs) {
      ctx.log(`Lösche „${d}“ …`);
      try {
        await fsp.rm(config.serverPath(d), { recursive: true, force: true });
      } catch (e) {
        if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new UserError('Die Welt ist gerade in Benutzung. Bitte zuerst den Server stoppen.', 409);
        throw e;
      }
    }
  } else {
    ctx.log('Es gibt noch keine Welt.');
  }
  properties.set({ 'level-seed': s });
  ctx.log(s ? `Neue Welt mit Seed „${s}“ wird beim nächsten Start erzeugt.` : 'Eine neue zufällige Welt wird beim nächsten Start erzeugt.');
  return { seed: s };
}

module.exports = { reset };
