'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const archiver = require('archiver');
const { UserError } = require('./util');

/**
 * Entpackt ein ZIP. `mapEntry(name, isDir)` liefert den absoluten Zielpfad oder null (überspringen).
 * Der Zielpfad muss von mapEntry mit safeResolve geprüft werden (Schutz gegen "Zip Slip").
 */
function extractZip(zipFile, mapEntry, onProgress) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(new UserError('Die Datei ist kein gültiges ZIP-/.mrpack-Archiv oder sie ist beschädigt.'));
      let count = 0;
      let failed = false;
      const fail = (e) => {
        if (failed) return;
        failed = true;
        try { zip.close(); } catch { /* egal */ }
        reject(e);
      };
      zip.on('error', (e) => fail(new UserError(`Das Archiv ist beschädigt: ${e.message}`)));
      zip.on('end', () => { if (!failed) resolve(count); });
      zip.on('entry', (entry) => {
        count++;
        if (onProgress) onProgress(count, zip.entryCount, entry.fileName);
        const isDir = entry.fileName.endsWith('/');
        let dest;
        try {
          dest = mapEntry(entry.fileName, isDir);
        } catch (e) {
          return fail(e);
        }
        if (!dest) return zip.readEntry();
        if (isDir) {
          fs.mkdirSync(dest, { recursive: true });
          return zip.readEntry();
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        zip.openReadStream(entry, (err2, rs) => {
          if (err2) return fail(err2);
          pipeline(rs, fs.createWriteStream(dest)).then(() => zip.readEntry(), fail);
        });
      });
      zip.readEntry();
    });
  });
}

/** Liest eine einzelne Textdatei (erste gefundene aus `names`) aus einem ZIP/JAR. */
function readZipEntryText(zipFile, names) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        try { zip.close(); } catch { /* egal */ }
        resolve(v);
      };
      zip.on('error', (e) => { if (!done) { done = true; reject(e); } });
      zip.on('end', () => finish(null));
      zip.on('entry', (entry) => {
        if (!names.includes(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (err2, rs) => {
          if (err2) return finish(null);
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('error', () => finish(null));
          rs.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
        });
      });
      zip.readEntry();
    });
  });
}

/** Packt `srcDir` als `rootName/...` in `outFile`. session.lock wird ausgelassen (ist gesperrt). */
function createZip(sources, outFile, onProgress) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outFile);
    const archive = archiver('zip', { zlib: { level: 6 } });
    let failed = false;
    const fail = (e) => {
      if (failed) return;
      failed = true;
      archive.abort();
      out.destroy();
      fs.rm(outFile, { force: true }, () => reject(e));
    };
    out.on('close', () => { if (!failed) resolve(archive.pointer()); });
    out.on('error', fail);
    archive.on('warning', (e) => { if (e.code !== 'ENOENT') fail(e); });
    archive.on('error', fail);
    archive.on('progress', (p) => onProgress && onProgress(p.fs.processedBytes, p.fs.totalBytes));
    archive.pipe(out);
    for (const { dir, root } of sources) archive.glob('**/*', { cwd: dir, dot: true, ignore: ['session.lock'] }, { prefix: root });
    archive.finalize();
  });
}

module.exports = { extractZip, readZipEntryText, createZip };
