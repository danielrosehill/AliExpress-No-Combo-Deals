// ==UserScript==
// @name         AliExpress — Hide Combo Deals (with Toggle)
// @namespace    https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @version      2.2.0
// @description  Hide combo / bundle / "Max Combo" listings from AliExpress. Adds a counter and a Hide bundle deals switch that remembers its setting.
// @author       Daniel Rosehill
// @match        https://*.aliexpress.com/*
// @match        https://aliexpress.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @updateURL    https://raw.githubusercontent.com/danielrosehill/AliExpress-No-Combo-Deals/main/aliexpress-no-combo-v2.user.js
// @downloadURL  https://raw.githubusercontent.com/danielrosehill/AliExpress-No-Combo-Deals/main/aliexpress-no-combo-v2.user.js
// ==/UserScript==

(function () {
  'use strict';

  const COMBO_MARKERS = [
    'max combo',
    'combo deal',
    'bundle deal',
    'buy more save more',
    'more to love',
  ];

  const CARD_SELECTOR = '.search-card-item';
  const CELL_SELECTOR = '.search-item-card-wrapper-gallery';
  // Bundle cards link to /ssr/300000512/BundleDeals2?productIds=<id>:<sku> instead of
  // /item/<id>.html (verified 2026-10-26). Locale-independent, unlike the text markers.
  const BUNDLE_LINK = 'a[href*="BundleDeals"]';
  const STORE_KEY = 'no-combo:showing';

  // Version stamp, read by the update-userscripts skill in aliexpress-israel-skills.
  if (typeof GM_info !== 'undefined') {
    document.documentElement.setAttribute('data-us-no-combo', GM_info.script.version);
  }

  // State: are combo cards currently visible? Default: hidden. Remembered across pages.
  let showing = localStorage.getItem(STORE_KEY) === '1';
  // Track every cell we've ever flagged as combo, so the toggle can affect them all.
  const flagged = new Set();

  const norm = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const isCombo = card =>
    !!card.querySelector(BUNDLE_LINK) || COMBO_MARKERS.some(m => norm(card.textContent).includes(m));

  function applyVisibility(cell) {
    cell.style.display = showing ? '' : 'none';
  }

  function scan(root) {
    // Cells first: a bundle cell may not carry the .search-card-item class.
    const doc = root || document;
    const cells = doc.querySelectorAll(CELL_SELECTOR);
    (cells.length ? cells : doc.querySelectorAll(CARD_SELECTOR)).forEach(card => {
      const cell = card.closest(CELL_SELECTOR) || card;
      // Re-check unflagged cells on every scan: a cell can render before its
      // BundleDeals link hydrates, so a one-shot check misses it.
      if (flagged.has(cell)) return;
      if (isCombo(cell)) {
        flagged.add(cell);
        applyVisibility(cell);
      }
    });
    updateBadge();
  }

  // ---------- Floating badge ----------

  let badge, countEl, toggleBtn;

  function buildBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.id = 'no-combo-badge';
    Object.assign(badge.style, {
      background: 'rgba(20,20,20,0.92)',
      color: '#fff',
      font: '13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '10px 14px',
      borderRadius: '10px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      userSelect: 'none',
      cursor: 'default',
      margin: '12px 0',
      width: 'fit-content',
    });

    countEl = document.createElement('span');
    countEl.textContent = '';

    // "Hide bundle deals" switch: checked = hidden.
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '600', cursor: 'pointer' });
    toggleBtn = document.createElement('input');
    toggleBtn.type = 'checkbox';
    toggleBtn.style.cursor = 'pointer';
    label.appendChild(toggleBtn);
    label.appendChild(document.createTextNode('Hide bundle deals'));
    toggleBtn.addEventListener('change', () => {
      showing = !toggleBtn.checked;
      localStorage.setItem(STORE_KEY, showing ? '1' : '0');
      flagged.forEach(applyVisibility);
      updateBadge();
    });

    badge.appendChild(label);
    badge.appendChild(countEl);
    mountBadge();
  }

  function mountBadge() {
    // Sit just above the results grid so it scrolls with the page.
    const grid = document.querySelector('#card-list');
    if (grid && grid.parentElement) {
      grid.parentElement.insertBefore(badge, grid);
    } else {
      document.body.insertBefore(badge, document.body.firstChild);
    }
  }

  function updateBadge() {
    if (!badge) buildBadge();
    const n = flagged.size;
    countEl.textContent = `(${n} ${showing ? 'shown' : 'hidden'})`;
    toggleBtn.checked = !showing;
    badge.style.display = n === 0 ? 'none' : 'flex';
  }

  // ---------- Boot + observer ----------

  buildBadge();
  scan(document);

  const obs = new MutationObserver(muts => {
    let touched = false;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) { touched = true; break; }
      }
      if (touched) break;
    }
    if (touched) {
      clearTimeout(obs._t);
      obs._t = setTimeout(() => scan(document), 150);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
