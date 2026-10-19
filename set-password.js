#!/usr/bin/env node
'use strict';
// Zugangspasswort für das Dashboard setzen oder entfernen, ohne den Browser zu brauchen
// (z. B. auf einem Linux-Server ohne Oberfläche).
//   node set-password.js            fragt nach dem neuen Passwort (die Eingabe bleibt unsichtbar)
//   node set-password.js --remove   entfernt das Passwort
// Gilt sofort, das Dashboard muss dafür nicht neu gestartet werden.
const readline = require('readline');
const access = require('./lib/access');
const netconf = require('./lib/netconf');

// Eingabe aus einem Terminal (unsichtbar) oder aus einer Pipe (zeilenweise, z. B. für Skripte)
const piped = [];
let pipedWaiting = null;
let pipedEnded = false;
if (!process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (l) => { if (pipedWaiting) { const w = pipedWaiting; pipedWaiting = null; w(l); } else piped.push(l); });
  rl.on('close', () => { pipedEnded = true; if (pipedWaiting) pipedWaiting(''); });
}

function ask(prompt) {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      if (piped.length) return resolve(piped.shift());
      if (pipedEnded) return resolve('');
      pipedWaiting = resolve;
      return undefined;
    });
  }
  return new Promise((resolve) => {
    let buf = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (c === String.fromCharCode(3)) process.exit(130); // Strg+C
        if (c === String.fromCharCode(127) || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
      return undefined;
    };
    stdin.on('data', onData);
  });
}

(async () => {
  if (process.argv.includes('--remove')) {
    await access.setPassword(null);
    console.log('Das Zugangspasswort wurde entfernt. Ab jetzt kann jeder, der das Dashboard im Netzwerk erreicht, alles steuern.');
    return;
  }
  const p1 = await ask('Neues Zugangspasswort (mindestens 10 Zeichen): ');
  const p2 = await ask('Noch einmal: ');
  if (p1 !== p2) { console.error('Die beiden Eingaben sind nicht gleich. Nichts wurde geändert.'); process.exit(1); }
  await access.setPassword(p1);
  console.log(`Zugangspasswort gesetzt (gespeichert in ${netconf.FILE}).`);
  console.log('Andere Geräte müssen sich damit anmelden. Auf diesem Rechner (localhost) brauchst du es nie.');
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
