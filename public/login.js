'use strict';
const $ = (id) => document.getElementById(id);
let mode = 'login';
let cfg = { google: false, registration: true, firstUser: false };

function show(msg, ok) {
  const el = $('loginMsg');
  el.textContent = msg || '';
  el.hidden = !msg;
  el.classList.toggle('ok', !!ok);
}

function setMode(m) {
  mode = m;
  const reg = m === 'register';
  $('tabLogin').setAttribute('aria-selected', String(!reg));
  $('tabRegister').setAttribute('aria-selected', String(reg));
  $('nameRow').hidden = !reg;
  $('passHint').hidden = !reg;
  $('fPass').autocomplete = reg ? 'new-password' : 'current-password';
  $('submitBtn').textContent = reg ? 'Konto erstellen' : 'Anmelden';
  $('closedNote').hidden = !(reg && !cfg.registration);
  $('submitBtn').disabled = reg && !cfg.registration;
  show('');
}

async function init() {
  try {
    cfg = await (await fetch('/auth/config')).json();
  } catch { /* Standardwerte */ }
  $('googleBtn').hidden = !cfg.google;
  $('orLine').hidden = !cfg.google;
  $('tabRegister').hidden = !cfg.registration;
  const err = new URLSearchParams(location.search).get('error');
  if (err) show(err);
  setMode(cfg.firstUser ? 'register' : 'login');
  if (cfg.firstUser) show('Willkommen! Das erste Konto wird automatisch Administrator.', true);
}

$('tabLogin').addEventListener('click', () => setMode('login'));
$('tabRegister').addEventListener('click', () => setMode('register'));

$('authForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = $('fEmail').value.trim();
  const password = $('fPass').value;
  if (!email || !password) return show('Bitte E-Mail-Adresse und Passwort eingeben.');
  $('submitBtn').disabled = true;
  try {
    const r = await fetch(mode === 'register' ? '/auth/register' : '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name: $('fName').value.trim() }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Fehler ${r.status}`);
    location.href = '/';
  } catch (e) {
    show(e.message);
    $('submitBtn').disabled = false;
  }
});

init();
