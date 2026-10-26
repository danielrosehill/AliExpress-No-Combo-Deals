// ==UserScript==
// @name         AliExpress — Hide Combo Deals (with Toggle)
// @namespace    https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @version      2.4.0
// @description  Hide combo / bundle / "Max Combo" listings from AliExpress search, plus an optional "Hide over $72" price filter. A labelled bar above the results holds both switches and remembers them.
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

  // Price filter. $72 leaves headroom under Israel's $75 customs de-minimis. The card
  // price is the first price on the card (the sale price; verified 2026-10-26). On the
  // ILS channel it is converted at ILS_PER_USD, an approximate rate: edit it if the
  // shekel moves much.
  const PRICE_LIMIT_USD = 72;
  const ILS_PER_USD = 3.7;
  const PRICE_RE = /(US ?\$|₪|\$) ?([\d,]+(?:\.\d+)?)/;

  const KEY_SHOW_BUNDLES = 'no-combo:showing';
  const KEY_HIDE_PRICEY = 'no-combo:hide-over-limit';

  // Version stamp, read by the update-userscripts skill in aliexpress-israel-skills.
  if (typeof GM_info !== 'undefined') {
    document.documentElement.setAttribute('data-us-no-combo', GM_info.script.version);
  }

  // Switch state, remembered across pages. Bundles hidden by default; price filter off.
  let showBundles = localStorage.getItem(KEY_SHOW_BUNDLES) === '1';
  let hidePricey = localStorage.getItem(KEY_HIDE_PRICEY) === '1';

  // Every cell we've seen, with what we learned about it.
  const cells = new Map(); // cell -> { bundle, usd }

  const norm = s => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const isCombo = cell =>
    !!cell.querySelector(BUNDLE_LINK) || COMBO_MARKERS.some(m => norm(cell.textContent).includes(m));

  function priceUsd(cell) {
    const m = (cell.textContent || '').replace(/\s+/g, ' ').match(PRICE_RE);
    if (!m) return null;
    const n = parseFloat(m[2].replace(/,/g, ''));
    return m[1] === '₪' ? n / ILS_PER_USD : n;
  }

  function applyVisibility(cell) {
    const info = cells.get(cell);
    const hide = (info.bundle && !showBundles) || (hidePricey && info.usd != null && info.usd > PRICE_LIMIT_USD);
    cell.style.display = hide ? 'none' : '';
  }

  function scan(root) {
    // Cells first: a bundle cell may not carry the .search-card-item class.
    const doc = root || document;
    const found = doc.querySelectorAll(CELL_SELECTOR);
    (found.length ? found : doc.querySelectorAll(CARD_SELECTOR)).forEach(card => {
      const cell = card.closest(CELL_SELECTOR) || card;
      // Re-check cells on every scan until both facts are known: a cell can render
      // before its BundleDeals link or its price hydrates.
      const info = cells.get(cell) || { bundle: false, usd: null };
      if (!info.bundle) info.bundle = isCombo(cell);
      if (info.usd == null) info.usd = priceUsd(cell);
      cells.set(cell, info);
      applyVisibility(cell);
    });
    for (const cell of cells.keys()) if (!cell.isConnected) cells.delete(cell);
    updateBar();
  }

  // ---------- The bar ----------
  // Labelled as a userscript and styled unlike AliExpress's own UI, so it's
  // obviously an add-on.

  let bar, bundleBox, bundleCount, priceBox, priceCount;

  function makeSwitch(text, checked, onChange) {
    const label = document.createElement('label');
    Object.assign(label.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '600', cursor: 'pointer' });
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.style.cursor = 'pointer';
    box.addEventListener('change', () => onChange(box.checked));
    const count = document.createElement('span');
    Object.assign(count.style, { fontWeight: '400', opacity: '0.8' });
    label.append(box, document.createTextNode(text), count);
    return { label, box, count };
  }

  function buildBar() {
    if (bar) return;
    bar = document.createElement('div');
    bar.id = 'no-combo-badge';
    Object.assign(bar.style, {
      background: '#1f2937',
      color: '#fff',
      font: '13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: '8px 14px',
      border: '2px dashed #a78bfa',
      borderRadius: '10px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      userSelect: 'none',
      margin: '12px 0',
      width: 'fit-content',
    });

    const tag = document.createElement('span');
    tag.textContent = 'Userscript';
    tag.title = 'Added by the "AliExpress — Hide Combo Deals" userscript, not by AliExpress';
    Object.assign(tag.style, {
      background: '#a78bfa', color: '#1f2937', fontWeight: '700', fontSize: '11px',
      padding: '2px 6px', borderRadius: '4px', letterSpacing: '0.03em', textTransform: 'uppercase',
    });

    const b = makeSwitch('Show bundle deals', showBundles, on => {
      showBundles = on;
      localStorage.setItem(KEY_SHOW_BUNDLES, on ? '1' : '0');
      cells.forEach((_, cell) => applyVisibility(cell));
      updateBar();
    });
    bundleBox = b.box; bundleCount = b.count;

    const p = makeSwitch(`Hide over $${PRICE_LIMIT_USD}`, hidePricey, on => {
      hidePricey = on;
      localStorage.setItem(KEY_HIDE_PRICEY, on ? '1' : '0');
      cells.forEach((_, cell) => applyVisibility(cell));
      updateBar();
    });
    priceBox = p.box; priceCount = p.count;

    bar.append(tag, b.label, p.label);
    mountBar();
  }

  function mountBar() {
    // Sit just above the results grid so it scrolls with the page.
    const grid = document.querySelector('#card-list');
    if (grid && grid.parentElement) {
      grid.parentElement.insertBefore(bar, grid);
    } else {
      document.body.insertBefore(bar, document.body.firstChild);
    }
  }

  function updateBar() {
    if (!bar) buildBar();
    let bundles = 0, pricey = 0;
    cells.forEach(info => {
      if (info.bundle) bundles++;
      if (info.usd != null && info.usd > PRICE_LIMIT_USD) pricey++;
    });
    bundleBox.checked = showBundles;
    priceBox.checked = hidePricey;
    bundleCount.textContent = `(${bundles} ${showBundles ? 'shown' : 'hidden'})`;
    priceCount.textContent = `(${pricey} ${hidePricey ? 'hidden' : 'over'})`;
    // Only on search/category pages, where there are result cells.
    bar.style.display = cells.size === 0 ? 'none' : 'flex';
  }

  // ---------- Boot + observer ----------

  buildBar();
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
