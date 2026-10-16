'use strict';
// Server-Sent Events: schiebt Konsole, Status und Fortschritt live in den Browser.
// Im Mehrbenutzer-Modus bekommt jeder Browser nur die Ereignisse "seines" Servers.

const clients = new Set();

/** match(target) entscheidet, ob dieser Client ein Ereignis mit dem Ziel { pid, userId } bekommt. */
function addClient(res, match = () => true) {
  const c = { res, match };
  clients.add(c);
  res.on('close', () => clients.delete(c));
  return c;
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data, target = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (c.match(target)) c.res.write(msg);
}

setInterval(() => {
  for (const c of clients) c.res.write(': ping\n\n');
}, 25000).unref();

module.exports = { addClient, send, broadcast };
