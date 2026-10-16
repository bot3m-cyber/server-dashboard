'use strict';
// Crash-Hilfe: neuesten Crash-Report finden und auf Mod-Probleme untersuchen.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');
const mods = require('./mods');

async function latestReport(sinceMs = 0) {
  let dir;
  try { dir = config.serverPath('crash-reports'); } catch { return null; }
  let names;
  try { names = await fsp.readdir(dir); } catch { return null; }
  const files = [];
  for (const n of names) {
    if (!/\.txt$/i.test(n)) continue;
    const st = await fsp.stat(path.join(dir, n)).catch(() => null);
    if (st && st.isFile()) files.push({ n, t: st.mtimeMs, size: st.size });
  }
  files.sort((a, b) => b.t - a.t);
  const f = files[0];
  if (!f || f.t < sinceMs - 5000) return null;
  let text = await fsp.readFile(path.join(dir, f.n), 'utf8');
  if (text.length > 400000) text = `${text.slice(0, 400000)}\n\n[… gekürzt …]`;
  return { name: f.n, time: f.t, text };
}

function fileFromPath(p) {
  let s = String(p).trim();
  try { s = decodeURIComponent(s); } catch { /* egal */ }
  s = s.replace(/^jar:/, '').replace(/^file:/, '').replace(/!.*$/, '');
  return s.split(/[\\/]/).filter(Boolean).pop() || null;
}

/** Sucht "Mod loading issue for: <modid>" und "Mod file: <pfad>" im Text. */
function parseIssues(text) {
  const issues = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    const a = line.match(/Mod loading issue for:\s*([A-Za-z0-9_.-]+)/);
    if (a) {
      current = { modId: a[1], modFile: null };
      issues.push(current);
      continue;
    }
    const b = line.match(/Mod file:\s*(.+?)\s*$/);
    if (b) {
      const file = fileFromPath(b[1]);
      if (current && !current.modFile) current.modFile = file;
      else issues.push({ modId: null, modFile: file });
      current = null;
    }
  }
  const seen = new Set();
  return issues.filter((i) => {
    const k = `${i.modId}|${i.modFile}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Fehlende Abhängigkeiten aus dem Log: "Mod ID: 'x', Requested by: 'y'". */
function parseMissingDeps(lines) {
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const m = line.match(/Mod ID: '([^']+)', Requested by: '([^']+)'/);
    if (m && !seen.has(m[0])) {
      seen.add(m[0]);
      out.push({ missing: m[1], requestedBy: m[2] });
    }
  }
  return out;
}

async function attachJars(issues) {
  for (const i of issues) {
    let m = i.modFile ? await mods.findByFile(i.modFile) : null;
    if (!m && i.modId) m = await mods.findByModId(i.modId);
    i.jar = m ? m.file : null;
    i.enabled = m ? m.enabled : null;
  }
  return issues;
}

async function analyze({ sinceMs = 0, logLines = [] } = {}) {
  const report = await latestReport(sinceMs);
  const issues = report ? await attachJars(parseIssues(report.text)) : [];
  const logIssues = await attachJars(parseIssues(logLines.join('\n')));
  for (const li of logIssues) {
    if (!issues.some((i) => i.modId === li.modId && i.modFile === li.modFile)) issues.push(li);
  }
  const missing = parseMissingDeps(logLines);
  for (const d of missing) {
    const m = await mods.findByModId(d.requestedBy);
    d.jar = m ? m.file : null;
    d.enabled = m ? m.enabled : null;
  }
  return { report, issues, missingDeps: missing, logTail: report ? null : logLines.slice(-150).join('\n') };
}

module.exports = { analyze, latestReport };
