'use strict';
/* Sprachen: übersetzt die Oberfläche anhand einer Sprachdatei (public/lang/<code>.json oder data/lang/<code>.json).
   Der Schlüssel ist der deutsche Satz, der Wert die Übersetzung. Fehlende Sätze bleiben deutsch.
   Sätze mit Platzhaltern ({0}, {1}) passen auf jeden Wert, z. B. „Port {0} ist belegt“. */
(function i18nEngine() {
  const KEY = 'srvdash-lang';
  const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* ohne Speicher */ } },
  };

  let lang = new URLSearchParams(location.search).get('lang');
  if (lang && CODE_RE.test(lang)) store.set(lang); else lang = store.get();
  if (!lang || !CODE_RE.test(lang)) lang = 'de';

  const dict = new Map();
  const patterns = [];
  const misses = new Set(); // Sätze, die auf dieser Seite vorkamen, aber keine Übersetzung haben (für Übersetzer)
  const miss = new Map();   // Zwischenspeicher für Nicht-Treffer
  let locale = 'de-DE';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const outputs = new Set(); // bereits übersetzte Texte (damit sie nicht als fehlend gelten)

  const api = {
    lang,
    get locale() { return locale; },
    get dec() { return (1.5).toLocaleString(locale).charAt(1) || ','; }, // Dezimalzeichen der Sprache
    ready: Promise.resolve(),
    misses,
    languages: () => fetch('/api/languages', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.languages || []).catch(() => [{ code: 'de', name: 'Deutsch' }]),
    setLang(code) {
      store.set(code);
      const u = new URL(location.href);
      if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); location.replace(u.toString()); } else location.reload();
    },
    // Für Übersetzer: alle auf dieser Seite gesehenen, noch nicht übersetzten Sätze als Vorlage
    exportMissing() {
      const strings = {};
      for (const s of [...misses].sort()) strings[s] = '';
      return JSON.stringify({ _meta: { code: lang, name: lang, locale: lang }, strings }, null, 2);
    },
    t(s) { return typeof s === 'string' ? tr(s) : s; },
  };
  window.I18N = api;

  function compile(strings) {
    for (const [k, v] of Object.entries(strings)) {
      if (/\{\d+\}/.test(k)) {
        const re = new RegExp(`^${k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\d+\}/g, '(.+?)')}$`);
        patterns.push({ re, to: v, order: (k.match(/\{\d+\}/g) || []).map((x) => Number(x.slice(1, -1))) });
      } else {
        dict.set(k, v);
      }
    }
    patterns.sort((a, b) => b.re.source.length - a.re.source.length); // spezifischere zuerst
  }

  function lookup(core) {
    if (dict.has(core)) { const o = dict.get(core); outputs.add(o); return o; }
    if (miss.has(core) || outputs.has(core)) return null;
    for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      const res = p.to.replace(/\{(\d+)\}/g, (_, i) => {
        const pos = p.order.indexOf(Number(i));
        const cap = m[pos + 1] ?? '';
        const sub = dict.get(cap.trim());
        return sub != null ? sub : cap;
      });
      if (outputs.size > 4000) outputs.clear();
      outputs.add(res);
      return res;
    }
    if (miss.size > 4000) miss.clear();
    miss.set(core, 1);
    misses.add(core);
    return null;
  }

  function tr(s) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    const core = m[2].replace(/\s+/g, ' ');
    if (!core || !/[A-Za-zÄÖÜäöüß]/.test(core)) return s;
    const out = lookup(core);
    return out == null ? s : m[1] + out + m[3];
  }

  function skipped(node) {
    for (let e = node.nodeType === 1 ? node : node.parentElement; e; e = e.parentElement) {
      if (SKIP_TAGS.has(e.tagName) || e.hasAttribute('data-no-i18n')) return true;
    }
    return false;
  }

  function doText(node) {
    const v = node.nodeValue;
    if (!v || !v.trim() || skipped(node)) return;
    const out = tr(v);
    if (out !== v) node.nodeValue = out;
  }

  function doAttrs(el) {
    if (el.nodeType !== 1 || skipped(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const out = tr(v); if (out !== v) el.setAttribute(a, out); }
    }
  }

  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || skipped(root)) return undefined;
    doAttrs(root);
    for (const el of root.querySelectorAll('[title],[placeholder],[aria-label],[alt]')) doAttrs(el);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) doText(n);
    return undefined;
  }

  function observe() {
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'childList') r.addedNodes.forEach((n) => walk(n));
        else if (r.type === 'characterData') doText(r.target);
        else if (r.type === 'attributes') doAttrs(r.target);
      }
      if (document.title) { const t = tr(document.title); if (t !== document.title) document.title = t; }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function patchBrowser() {
    // Fenster des Browsers (Abfragen) und Zahlen-/Datumsformate
    for (const name of ['confirm', 'alert', 'prompt']) {
      const orig = window[name].bind(window);
      window[name] = (msg, ...rest) => orig(typeof msg === 'string' ? msg.split('\n').map((l) => tr(l)).join('\n') : msg, ...rest);
    }
    const fixLocale = (l) => (l === 'de-DE' || l === undefined ? locale : l);
    for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
      const orig = Date.prototype[name];
      Date.prototype[name] = function patched(l, o) { return orig.call(this, fixLocale(l), o); };
    }
    const NF = Intl.NumberFormat;
    Intl.NumberFormat = function patchedNF(l, o) { return new NF(fixLocale(l), o); };
    Intl.NumberFormat.prototype = NF.prototype;
    Intl.NumberFormat.supportedLocalesOf = NF.supportedLocalesOf;
  }

  document.documentElement.lang = lang;
  if (lang === 'de') return;

  // Bis die Sprachdatei da ist, die Seite nicht halb deutsch zeigen (höchstens 2,5 Sekunden)
  document.documentElement.classList.add('i18n-loading');
  const reveal = () => document.documentElement.classList.remove('i18n-loading');
  const timer = setTimeout(reveal, 2500);
  api.ready = fetch(`/lang/${lang}.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((j) => {
      if (j && j.strings) {
        locale = j._meta?.locale || lang;
        compile(j.strings);
        patchBrowser();
        const apply = () => { walk(document.documentElement); if (document.title) document.title = tr(document.title); observe(); reveal(); clearTimeout(timer); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true }); else apply();
      } else {
        reveal();
      }
    });
}());
