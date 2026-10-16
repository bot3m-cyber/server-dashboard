'use strict';
/* Navigation: am PC eine feste Seitenleiste, bei schmalen Fenstern ein Menü-Knopf statt seitlichem Scrollen. */

const nav = $('#tabs');
const navToggle = $('#navToggle');

function navCurrentLabel() {
  const b = nav.querySelector('button.active');
  return b ? b.textContent.trim() : 'Menü';
}

function setNav(open) {
  nav.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', String(open));
}

navToggle.addEventListener('click', () => setNav(!nav.classList.contains('open')));
nav.addEventListener('click', (e) => { if (e.target.closest('button')) { setNav(false); setTimeout(() => { $('#navCurrent').textContent = navCurrentLabel(); }, 0); } });
document.addEventListener('click', (e) => { if (nav.classList.contains('open') && !e.target.closest('#tabs, #navToggle')) setNav(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('open')) setNav(false); });
window.addEventListener('hashchange', () => { $('#navCurrent').textContent = navCurrentLabel(); });

// Höhe der Kopfzeile für die mitlaufende Seitenleiste
const topbar = $('.topbar');
const setTopbarHeight = () => document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
new ResizeObserver(setTopbarHeight).observe(topbar);
setTopbarHeight();
setTimeout(() => { $('#navCurrent').textContent = navCurrentLabel(); }, 600);
