'use strict';
/* Suche auf der Seite (Strg+F): markiert Treffer im sichtbaren Bereich, Enter = nächster, Umschalt+Enter = vorheriger. */

const FIND = { open: false, ranges: [], index: 0, timer: null };
const FIND_OK = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

function findCollect(query) {
  const out = [];
  const q = query.toLowerCase();
  if (!q) return out;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (p.closest('script,style,textarea,input,select,#findbar,#toasts,[hidden]')) return NodeFilter.FILTER_REJECT;
      if (!p.getClientRects().length) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n && out.length < 2000; n = walker.nextNode()) {
    const text = n.nodeValue.toLowerCase();
    for (let i = text.indexOf(q); i !== -1 && out.length < 2000; i = text.indexOf(q, i + q.length)) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + q.length);
      out.push(r);
    }
  }
  return out;
}

function findPaint(scroll) {
  CSS.highlights.delete('find-all');
  CSS.highlights.delete('find-current');
  const total = FIND.ranges.length;
  $('#findCount').textContent = $('#findInput').value ? (total ? `${FIND.index + 1} / ${total}` : 'Keine Treffer') : '';
  $('#findbar').classList.toggle('nomatch', !!$('#findInput').value && !total);
  if (!total) return;
  CSS.highlights.set('find-all', new Highlight(...FIND.ranges));
  const cur = FIND.ranges[FIND.index];
  CSS.highlights.set('find-current', new Highlight(cur));
  if (scroll) cur.startContainer.parentElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function findRun(keepIndex) {
  FIND.ranges = findCollect($('#findInput').value.trim());
  FIND.index = keepIndex ? Math.min(FIND.index, Math.max(0, FIND.ranges.length - 1)) : 0;
  findPaint(!keepIndex);
}

function findStep(dir) {
  if (!FIND.ranges.length) return;
  FIND.index = (FIND.index + dir + FIND.ranges.length) % FIND.ranges.length;
  findPaint(true);
}

function findOpen() {
  FIND.open = true;
  $('#findbar').hidden = false;
  const sel = String(window.getSelection() || '').trim();
  if (sel && sel.length < 80) $('#findInput').value = sel;
  $('#findInput').focus();
  $('#findInput').select();
  findRun(false);
}

function findClose() {
  FIND.open = false;
  $('#findbar').hidden = true;
  CSS.highlights.delete('find-all');
  CSS.highlights.delete('find-current');
  FIND.ranges = [];
}

if (FIND_OK) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      findOpen();
    } else if (e.key === 'F3' && FIND.open) {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape' && FIND.open && !palette?.open) {
      findClose();
    }
  });
  $('#findInput').addEventListener('input', () => findRun(false));
  $('#findInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); }
  });
  $('#findPrev').addEventListener('click', () => findStep(-1));
  $('#findNext').addEventListener('click', () => findStep(1));
  $('#findClose').addEventListener('click', findClose);
  // Inhalte ändern sich (Konsole, Listen): Treffer nach kurzer Pause neu suchen
  new MutationObserver(() => {
    if (!FIND.open) return;
    clearTimeout(FIND.timer);
    FIND.timer = setTimeout(() => findRun(true), 400);
  }).observe($('main'), { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  $('#tabs').addEventListener('click', () => { if (FIND.open) setTimeout(() => findRun(false), 300); });
}
