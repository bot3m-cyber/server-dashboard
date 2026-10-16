'use strict';
// Server-Presets: fertige Zusammenstellungen aus Server-Typ, Plugins/Mods und Einstellungen.
const serverTypes = require('./servertypes');
const modrinth = require('./modrinth');

const PRESETS = [
  {
    id: 'crossplay', icon: '', name: 'Crossplay (Java + Bedrock)', type: 'paper', ramGb: 6, bedrockDefault: true,
    desc: 'Für gemischte Runden: Java- und Bedrock-Spieler (Handy, Windows-App, Switch, Xbox, PlayStation) spielen zusammen. Geyser und Floodgate sind dabei, dazu ViaVersion und Leistungs-Einstellungen.',
    content: [['viaversion', 'ViaVersion'], ['viabackwards', 'ViaBackwards'], ['luckperms', 'LuckPerms'], ['essentialsx', 'EssentialsX'], ['chunky', 'Chunky']],
    props: { motd: '§b§lCrossplay Server', difficulty: 'normal', gamemode: 'survival', 'view-distance': '8', 'simulation-distance': '6', 'max-players': '30', 'network-compression-threshold': '256' },
  },
  {
    id: 'survival', icon: '🌲', name: 'Survival', type: 'paper', ramGb: 6,
    desc: 'Klassisches Überleben mit Freunden: Grundstücksschutz, Rechte, nützliche Befehle und Schutz vor Griefing.',
    content: [['luckperms', 'LuckPerms'], ['essentialsx', 'EssentialsX'], ['griefprevention', 'GriefPrevention'], ['coreprotect', 'CoreProtect'], ['chunky', 'Chunky']],
    props: { motd: '§a§lSurvival Server', difficulty: 'normal', gamemode: 'survival', 'view-distance': '10', 'simulation-distance': '8', 'max-players': '20' },
  },
  {
    id: 'performance', icon: '⚡', name: 'Performance', type: 'paper', ramGb: 6,
    desc: 'Möglichst flüssig, auch mit vielen Spielern: kleinere Sicht- und Simulationsweite, optimierte Java-Startparameter und Welt-Vorladen.',
    content: [['chunky', 'Chunky'], ['luckperms', 'LuckPerms']],
    props: { motd: '§e§lSchneller Server', difficulty: 'normal', 'view-distance': '7', 'simulation-distance': '5', 'max-players': '30', 'network-compression-threshold': '256' },
  },
  {
    id: 'creative', icon: '🎨', name: 'Creative', type: 'paper', ramGb: 6,
    desc: 'Frei bauen: Kreativmodus, friedlich, ohne Monster. Mit WorldEdit zum schnellen Bauen.',
    content: [['worldedit', 'WorldEdit'], ['essentialsx', 'EssentialsX'], ['luckperms', 'LuckPerms'], ['chunky', 'Chunky']],
    props: { motd: '§d§lCreative Server', gamemode: 'creative', 'force-gamemode': 'true', difficulty: 'peaceful', 'spawn-monsters': 'false', 'allow-flight': 'true', 'view-distance': '12', 'max-players': '20' },
  },
  {
    id: 'friends', icon: '👥', name: 'Freunde (Vanilla-Feeling)', type: 'paper', ramGb: 4,
    desc: 'Wie normales Minecraft, aber mit Sprachchat und für Spieler mit anderen Minecraft-Versionen.',
    content: [['viaversion', 'ViaVersion'], ['viabackwards', 'ViaBackwards'], ['simple-voice-chat', 'Simple Voice Chat'], ['luckperms', 'LuckPerms']],
    props: { motd: '§b§lServer für Freunde', difficulty: 'normal', 'view-distance': '10', 'max-players': '10' },
  },
  {
    id: 'fabric', icon: '🧵', name: 'Fabric Performance (Mods)', type: 'fabric', ramGb: 6,
    desc: 'Schlanker Mod-Server mit den wichtigsten Leistungs-Mods (Lithium, FerriteCore). Dazu kannst du eigene Mods installieren.',
    content: [['fabric-api', 'Fabric API'], ['lithium', 'Lithium'], ['ferrite-core', 'FerriteCore'], ['chunky', 'Chunky'], ['spark', 'spark']],
    props: { motd: '§6§lFabric Server', difficulty: 'normal', 'view-distance': '10', 'simulation-distance': '8' },
  },
  {
    id: 'neoforge', icon: '🦊', name: 'NeoForge Basis (Mods)', type: 'neoforge', ramGb: 8,
    desc: 'Leerer NeoForge-Server mit Leistungs-Mods, bereit für deine eigenen Mods (z. B. Create).',
    content: [['lithium', 'Lithium'], ['ferrite-core', 'FerriteCore'], ['chunky', 'Chunky'], ['spark', 'spark']],
    props: { motd: '§c§lNeoForge Server', difficulty: 'normal', 'view-distance': '10', 'simulation-distance': '8' },
  },
];

const byId = (id) => PRESETS.find((p) => p.id === id) || null;

function publicInfo(p) {
  const t = serverTypes.TYPES[p.type];
  return {
    id: p.id, icon: p.icon, bedrockDefault: !!p.bedrockDefault, name: p.name, desc: p.desc, type: p.type, typeLabel: t.label, kind: t.kind, ramGb: p.ramGb,
    content: p.content.map(([slug, title]) => ({ slug, title })), props: p.props,
  };
}

const cache = new Map();

/**
 * Sucht die neueste stabile Minecraft-Version, für die alle Plugins/Mods des Presets
 * (und auf Wunsch Geyser) bei Modrinth zu haben sind.
 */
async function suggest(preset, withBedrock) {
  const key = `${preset.id}:${withBedrock ? 1 : 0}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < 10 * 60e3) return c.value;
  const t = serverTypes.TYPES[preset.type];
  const versions = (await serverTypes.listVersions(preset.type, false)).slice(0, 8);
  const slugs = preset.content.map(([s]) => s);
  if (withBedrock && t.loaders.length) slugs.push('geyser');
  let best = null;
  for (const v of versions) {
    const missing = [];
    await Promise.all(slugs.map(async (s) => {
      try { if (!(await modrinth.bestVersion(s, v.id, t.loaders))) missing.push(s); } catch { missing.push(s); }
    }));
    if (!missing.length) { best = { version: v.id, missing: [] }; break; }
    if (!best || missing.length < best.missing.length) best = { version: v.id, missing };
  }
  const value = { ...(best || { version: versions[0]?.id || null, missing: [] }), versions: versions.map((v) => v.id) };
  cache.set(key, { at: Date.now(), value });
  return value;
}

module.exports = { PRESETS, byId, publicInfo, suggest };
