'use strict';
// Benachrichtigungen per Discord-Webhook (Start, Stopp, Absturz, Spieler-Beitritt).
// Die Webhook-Adresse stammt vom Nutzer und wird nur lokal gespeichert.
const config = require('./config');
const { UserError, netError } = require('./util');
const { UA } = require('./download');

const COLORS = { start: 0x57b36b, stop: 0x8b96a5, crash: 0xe05a5a, join: 0x4f8fd6, leave: 0x8b96a5, test: 0xe0a83a };

function validate(url) {
  let u;
  try { u = new URL(String(url)); } catch { throw new UserError('Das ist keine gültige Adresse.'); }
  const ok = u.protocol === 'https:' && /^(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)$/.test(u.hostname)
    && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname);
  if (!ok) throw new UserError('Das ist keine Discord-Webhook-Adresse. Sie sieht aus wie https://discord.com/api/webhooks/123…/abc…');
  return u.toString();
}

async function post(url, title, text, color) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ username: 'Server-Dashboard', embeds: [{ title, description: String(text).slice(0, 1800), color, timestamp: new Date().toISOString() }] }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw netError(e, 'Discord');
  }
  if (res.status === 404) throw new UserError('Discord kennt diesen Webhook nicht (mehr). Bitte einen neuen erstellen.', 502);
  if (!res.ok) throw new UserError(`Discord antwortet mit Fehler ${res.status}.`, 502);
}

/** Sendet ein Ereignis, falls ein Webhook eingerichtet ist und das Ereignis aktiv ist. Fehler werden nur protokolliert. */
async function event(type, title, text) {
  const cfg = config.get();
  if (!cfg.webhookUrl || !cfg.webhookEvents?.[type === 'leave' ? 'join' : type]) return;
  try {
    await post(cfg.webhookUrl, `${cfg.name}: ${title}`, text, COLORS[type] || 0x4f8fd6);
  } catch (e) {
    console.error('Discord-Benachrichtigung:', e.message);
  }
}

async function test() {
  const cfg = config.get();
  if (!cfg.webhookUrl) throw new UserError('Es ist noch kein Webhook gespeichert.');
  await post(cfg.webhookUrl, `${cfg.name}: Test`, 'Wenn du das liest, funktioniert die Verbindung vom Server-Dashboard zu Discord. 🎉', COLORS.test);
}

module.exports = { validate, event, test };
