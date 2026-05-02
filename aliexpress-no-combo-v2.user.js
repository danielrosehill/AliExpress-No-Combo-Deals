// ==UserScript==
// @name         AliExpress — Hide Combo Deals (with Toggle)
// @namespace    https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @version      2.1.0
// @description  Hide combo / bundle / "Max Combo" listings from AliExpress. Adds a floating counter and a Show/Hide toggle.
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

  // State: are combo cards currently visible? Default: hidden.
  let showing = false;
  // Track every cell we've ever flagged as combo, so the toggle can affect them all.
  const flagged = new Set();

  const norm = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const isCombo = card => COMBO_MARKERS.some(m => norm(card.textContent).includes(m));

  function applyVisibility(cell) {
    cell.style.display = showing ? '' : 'none';
  }

  function scan(root) {
    const cards = (root || document).querySelectorAll(CARD_SELECTOR);
    cards.forEach(card => {
      const cell = card.closest(CELL_SELECTOR) || card;
      if (cell.dataset.comboProcessed === '1') return;
      cell.dataset.comboProcessed = '1';
      if (isCombo(card)) {
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
    countEl.textContent = '0 Max Combo deals excluded';

    toggleBtn = document.createElement('button');
    Object.assign(toggleBtn.style, {
      background: '#ff4747',
      color: '#fff',
      border: 'none',
      padding: '5px 10px',
      borderRadius: '6px',
      font: 'inherit',
      fontWeight: '600',
      cursor: 'pointer',
    });
    toggleBtn.textContent = 'Show';
    toggleBtn.addEventListener('click', () => {
      showing = !showing;
      flagged.forEach(applyVisibility);
      toggleBtn.textContent = showing ? 'Hide' : 'Show';
      toggleBtn.style.background = showing ? '#4a90e2' : '#ff4747';
    });

    badge.appendChild(countEl);
    badge.appendChild(toggleBtn);
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
    countEl.textContent = `${n} Max Combo deal${n === 1 ? '' : 's'} ${showing ? 'shown' : 'excluded'}`;
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
