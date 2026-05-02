// ==UserScript==
// @name         AliExpress — Hide Combo Deals
// @namespace    https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @version      1.0.0
// @description  Hide combo / bundle / "Max Combo" listings from AliExpress search and listing pages.
// @author       Daniel Rosehill
// @match        https://*.aliexpress.com/*
// @match        https://aliexpress.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @updateURL    https://raw.githubusercontent.com/danielrosehill/AliExpress-No-Combo-Deals/main/aliexpress-no-combo.user.js
// @downloadURL  https://raw.githubusercontent.com/danielrosehill/AliExpress-No-Combo-Deals/main/aliexpress-no-combo.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Phrases that mark a listing as a combo / bundle promotion.
  // Matched as case-insensitive substrings against the card's normalised text.
  const COMBO_MARKERS = [
    'max combo',
    'combo deal',
    'bundle deal',
    'buy more save more',
    'more to love',
  ];

  // Card selector — stable, non-hashed.
  const CARD_SELECTOR = '.search-card-item';
  // Outer grid cell to remove (so the layout collapses cleanly).
  const CELL_SELECTOR = '.search-item-card-wrapper-gallery';

  // Mode: 'hide' = display:none (collapses cell); 'mark' = red outline only (debug).
  const MODE = 'hide';

  let totalHidden = 0;

  function normalise(s) {
    // Collapse non-breaking spaces and runs of whitespace so phrase-matching is robust.
    return (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').toLowerCase();
  }

  function isCombo(card) {
    const t = normalise(card.textContent);
    return COMBO_MARKERS.some(m => t.includes(m));
  }

  function purge(root) {
    const cards = (root || document).querySelectorAll(CARD_SELECTOR);
    let hidden = 0;
    cards.forEach(card => {
      const cell = card.closest(CELL_SELECTOR) || card;
      if (cell.dataset.comboProcessed === '1') return;
      if (isCombo(card)) {
        if (MODE === 'mark') {
          cell.style.outline = '3px solid red';
        } else {
          cell.style.display = 'none';
        }
        hidden++;
      }
      cell.dataset.comboProcessed = '1';
    });
    if (hidden) {
      totalHidden += hidden;
      console.log(`[no-combo] hid ${hidden} combo card(s) — total ${totalHidden}`);
    }
  }

  // Initial pass.
  purge(document);

  // Watch for infinite-scroll / SPA re-renders.
  const obs = new MutationObserver(muts => {
    let touched = false;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) { touched = true; break; }
      }
      if (touched) break;
    }
    if (touched) {
      // Debounce: coalesce bursts of mutations.
      clearTimeout(obs._t);
      obs._t = setTimeout(() => purge(document), 150);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
