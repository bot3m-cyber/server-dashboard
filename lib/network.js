'use strict';
const os = require('os');
const { UserError, netError } = require('./util');

const VIRTUAL_RE = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Tailscale|ZeroTier|Hamachi|TAP|Bluetooth|Radmin|playit/i;

function isPrivate(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

function isTailscale(ip) {
  const m = ip.match(/^100\.(\d+)\./);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

function localIps() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({
        adapter: name, address: a.address, tailscale: isTailscale(a.address),
        likelyLan: isPrivate(a.address) && !VIRTUAL_RE.test(name),
      });
    }
  }
  return out.sort((x, y) => Number(y.likelyLan) - Number(x.likelyLan));
}

async function publicIp() {
  let res;
  try {
    res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw netError(e, 'dem IP-Dienst');
  }
  if (!res.ok) throw new UserError('Die öffentliche IP konnte nicht ermittelt werden.', 502);
  return (await res.json()).ip;
}

module.exports = { localIps, publicIp };
