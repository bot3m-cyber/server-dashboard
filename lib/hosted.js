'use strict';
// Einstellungen für den Mehrbenutzer-Modus ("hosted"): Anmeldung, Adresse, Grenzen.
// Umgebungsvariablen haben Vorrang. Änderungen im Admin-Bereich landen in data/hosted.json.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');
const { readJson, writeJsonAtomic } = require('./util');

const FILE = path.join(DATA_DIR, 'hosted.json');
const EDITABLE = ['registration', 'defaultQuota', 'totalRamGb', 'reserveRamGb', 'adminEmails'];

function defaults() {
  return {
    enabled: false,
    publicUrl: 'http://localhost:3000',
    publicHost: null, // Adresse, die Spieler eintippen (Standard: Host aus publicUrl)
    trustProxy: false,
    registration: 'open', // open | closed
    adminEmails: [],
    totalRamGb: null, // Arbeitsspeicher, der für alle Server zusammen zur Verfügung steht
    reserveRamGb: 2,
    portRange: [25565, 25664],
    bedrockPortRange: [19132, 19231],
    defaultQuota: { maxServers: 2, maxRamGb: 8, maxDiskGb: 20 },
    google: { clientId: null, clientSecret: null },
  };
}

let cache = null;

function load() {
  const d = defaults();
  const f = readJson(FILE, {});
  const s = { ...d, ...f, defaultQuota: { ...d.defaultQuota, ...(f.defaultQuota || {}) }, google: { ...d.google, ...(f.google || {}) } };
  const e = process.env;
  if (e.HOSTED === '1' || e.HOSTED === 'true') s.enabled = true;
  if (e.HOSTED_PUBLIC_URL) s.publicUrl = e.HOSTED_PUBLIC_URL;
  if (e.HOSTED_PUBLIC_HOST) s.publicHost = e.HOSTED_PUBLIC_HOST;
  if (e.TRUST_PROXY === '1') s.trustProxy = true;
  if (e.GOOGLE_CLIENT_ID) s.google.clientId = e.GOOGLE_CLIENT_ID;
  if (e.GOOGLE_CLIENT_SECRET) s.google.clientSecret = e.GOOGLE_CLIENT_SECRET;
  if (e.HOSTED_ADMIN_EMAILS) s.adminEmails = [...new Set([...s.adminEmails, ...e.HOSTED_ADMIN_EMAILS.split(',').map((x) => x.trim()).filter(Boolean)])];
  if (e.HOSTED_TOTAL_RAM_GB) s.totalRamGb = Number(e.HOSTED_TOTAL_RAM_GB) || s.totalRamGb;
  s.adminEmails = s.adminEmails.map((x) => String(x).toLowerCase());
  cache = s;
  return s;
}

const get = () => cache || load();
const enabled = () => !!get().enabled;

function publicHost() {
  const s = get();
  if (s.publicHost) return s.publicHost;
  try { return new URL(s.publicUrl).hostname; } catch { return 'localhost'; }
}

const isHttps = () => /^https:/i.test(get().publicUrl);

/** Speichert die im Admin-Bereich änderbaren Werte. */
function save(patch) {
  const f = readJson(FILE, {});
  for (const k of EDITABLE) if (k in patch) f[k] = patch[k];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  writeJsonAtomic(FILE, f);
  load();
  return get();
}

/** Für die Oberfläche: ohne Geheimnisse. */
function publicView() {
  const s = get();
  return {
    registration: s.registration, defaultQuota: s.defaultQuota, totalRamGb: s.totalRamGb, reserveRamGb: s.reserveRamGb,
    adminEmails: s.adminEmails, publicUrl: s.publicUrl, publicHost: publicHost(), google: !!(s.google.clientId && s.google.clientSecret),
    portRange: s.portRange, bedrockPortRange: s.bedrockPortRange,
  };
}

module.exports = { get, enabled, load, save, publicHost, publicView, isHttps };
