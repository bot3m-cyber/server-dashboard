'use strict';
// Lang laufende Aufgaben (Entpacken, Downloads, Installation, Backups) mit Fortschritt.
// Pro Server läuft höchstens eine Aufgabe gleichzeitig. Verschiedene Server arbeiten unabhängig.
const events = require('./events');
const ctx = require('./context');
const { UserError } = require('./util');

const slots = new Map(); // Server-ID (oder '_' lokal) -> { current, last, throttle }

function slot() {
  const key = ctx.id() || '_';
  if (!slots.has(key)) slots.set(key, { key, current: null, last: null, throttle: null });
  return slots.get(key);
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id, type: job.type, label: job.label, running: job.running, progress: job.progress,
    error: job.error, result: job.result, log: job.log.slice(-300), startedAt: job.startedAt,
  };
}

const target = (s) => (s.key === '_' ? {} : { pid: s.key });

function emit(s, job, immediate = false) {
  if (immediate) {
    clearTimeout(s.throttle);
    s.throttle = null;
    events.broadcast('job', publicJob(job), target(s));
    return;
  }
  if (s.throttle) return;
  s.throttle = setTimeout(() => {
    s.throttle = null;
    events.broadcast('job', publicJob(job), target(s));
  }, 200);
}

function busy() {
  return slot().current;
}

function assertIdle() {
  const s = slot();
  if (s.current) throw new UserError(`Bitte warten: „${s.current.label}“ läuft noch.`, 409);
}

function run(type, label, fn) {
  const s = slot();
  assertIdle();
  const job = {
    id: Date.now(), type, label, running: true, progress: null, log: [], error: null, result: null,
    startedAt: Date.now(),
  };
  s.current = job;
  const jctx = {
    progress(done, total, text) {
      job.progress = { done, total, text };
      emit(s, job);
    },
    log(line) {
      job.log.push(line);
      if (job.log.length > 2000) job.log.shift();
      events.broadcast('joblog', { id: job.id, line }, target(s));
    },
  };
  emit(s, job, true);
  Promise.resolve()
    .then(() => fn(jctx))
    .then((r) => { job.result = r ?? true; })
    .catch((e) => {
      if (!e.userFacing) console.error(e);
      job.error = e.userFacing ? e.message : `Unerwarteter Fehler: ${e.message}`;
      jctx.log(`FEHLER: ${job.error}`);
    })
    .finally(() => {
      job.running = false;
      s.current = null;
      s.last = job;
      emit(s, job, true);
    });
  return publicJob(job);
}

function snapshot() {
  const s = slot();
  return publicJob(s.current || s.last);
}

module.exports = { run, busy, assertIdle, snapshot };
