'use strict';
// Kontext einer Anfrage: Welcher Server ist gerade gemeint, und wer fragt?
// Dadurch kann config.get() im Mehrbenutzer-Modus pro Anfrage den richtigen Server liefern.
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

/** Führt fn mit diesem Kontext aus. store = { id: Server-ID|null, user: Benutzer|null } */
function run(store, fn) {
  return als.run(store, fn);
}

const store = () => als.getStore() || null;
const id = () => als.getStore()?.id ?? null;
const user = () => als.getStore()?.user ?? null;

module.exports = { run, store, id, user };
