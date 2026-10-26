// ==UserScript==
// @name         AliExpress — Hide Combo Deals (with Toggle)
// @namespace    https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @version      2.5.1
// @description  Hide combo / bundle / "Max Combo" listings from AliExpress search, plus a max-price slider (up to $72) and a one-click "Choice All In" (Choice + Free shipping) search filter. A labelled bar above the results holds them all.
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

  // Max-price slider. Stops in USD; null = any price. The top stop is $72, which leaves
  // headroom under Israel's $75 customs de-minimis. The card price is the first price
  // on the card (the sale price; verified 2026-10-26). On the ILS channel it is
  // converted at ILS_PER_USD, an approximate rate: edit it if the shekel moves much.
  const PRICE_STOPS = [null, 10, 20, 30, 40, 50, 60, 70, 72];
  const ILS_PER_USD = 3.7;
  const PRICE_RE = /(US ?\$|₪|\$) ?([\d,]+(?:\.\d+)?)/;

  // Server-side search filters applied together in one navigation. Comma-joined
  // selectedSwitches is honoured: both chips read aria-checked=true and the result
  // set changes (verified 2026-10-26, usb c cable). Navigating is deliberate: a chip
  // click can update the URL without re-rendering the grid.
  const COMBO_SWITCHES = ['filterCode:choice_atm', 'filterCode:freeshipping'];

  const KEY_SHOW_BUNDLES = 'no-combo:showing';
  const KEY_MAX_PRICE = 'no-combo:max-price';

  // Version stamp, read by the update-userscripts skill in aliexpress-israel-skills.
  if (typeof GM_info !== 'undefined') {
    document.documentElement.setAttribute('data-us-no-combo', GM_info.script.version);
  }

  // Switch state, remembered across pages. Bundles hidden by default; price filter off.
  let showBundles = localStorage.getItem(KEY_SHOW_BUNDLES) === '1';
  let maxPrice = PRICE_STOPS.includes(+localStorage.getItem(KEY_MAX_PRICE)) ? +localStorage.getItem(KEY_MAX_PRICE) : null;

  // Every cell we've seen, with what we learned about it.
  const cells = new Map(); // cell -> { bundle, usd, priceHidden }

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
    const bundleHidden = info.bundle && !showBundles;
    // Counted only when price is the sole reason, so the two counts add up to what's hidden.
    info.priceHidden = !bundleHidden && maxPrice != null && info.usd != null && info.usd > maxPrice;
    cell.style.display = bundleHidden || info.priceHidden ? 'none' : '';
  }

  function scan(root) {
    // Cells first: a bundle cell may not carry the .search-card-item class.
    const doc = root || document;
    const found = doc.querySelectorAll(CELL_SELECTOR);
    (found.length ? found : doc.querySelectorAll(CARD_SELECTOR)).forEach(card => {
      const cell = card.closest(CELL_SELECTOR) || card;
      // Re-read every cell on every scan. A cell can render before its BundleDeals
      // link or price hydrates, and paging (same document) reuses the cell nodes for
      // other products: a cached verdict hid normal items on page 2 (2026-10-26).
      cells.set(cell, { bundle: isCombo(cell), usd: priceUsd(cell), priceHidden: false });
      applyVisibility(cell);
    });
    for (const cell of cells.keys()) if (!cell.isConnected) cells.delete(cell);
    updateBar();
  }

  // ---------- The bar ----------
  // Labelled as a userscript and styled unlike AliExpress's own UI, so it's
  // obviously an add-on.

  let bar, bundleBox, bundleCount, priceSlider, priceLabel, priceCount, comboBtn;

  function currentSwitches() {
    const v = new URL(location.href).searchParams.get('selectedSwitches');
    return v ? v.split(',').filter(Boolean) : [];
  }

  const comboOn = () => COMBO_SWITCHES.every(sw => currentSwitches().includes(sw));

  // State is read from the URL on every bar update, not once at load: paging and
  // AliExpress's own filter chips change the URL without reloading the page.
  function syncComboButton() {
    const on = comboOn();
    comboBtn.textContent = on ? '✓ Choice All In' : 'Choice All In';
    comboBtn.title = on ? 'Remove Choice + Free shipping' : 'Apply AliExpress\'s Choice and Free shipping filters at once';
    comboBtn.style.background = on ? '#16a34a' : 'transparent';
  }

  function makeComboButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    Object.assign(btn.style, {
      color: '#fff', border: '1px solid #a78bfa',
      borderRadius: '6px', padding: '4px 10px', font: 'inherit', fontWeight: '600', cursor: 'pointer',
    });
    btn.addEventListener('click', () => {
      const on = comboOn();
      const url = new URL(location.href);
      let sw = currentSwitches().filter(x => !COMBO_SWITCHES.includes(x));
      if (!on) sw = sw.concat(COMBO_SWITCHES);
      if (sw.length) url.searchParams.set('selectedSwitches', sw.join(','));
      else url.searchParams.delete('selectedSwitches');
      url.searchParams.delete('page');
      location.assign(url.toString());
    });
    return btn;
  }

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

    // Max-price slider: leftmost = any price.
    const p = document.createElement('label');
    Object.assign(p.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: '600' });
    priceSlider = document.createElement('input');
    priceSlider.type = 'range';
    priceSlider.min = '0';
    priceSlider.max = String(PRICE_STOPS.length - 1);
    priceSlider.step = '1';
    priceSlider.value = String(PRICE_STOPS.indexOf(maxPrice));
    priceSlider.style.width = '120px';
    priceSlider.style.cursor = 'pointer';
    priceSlider.addEventListener('input', () => {
      maxPrice = PRICE_STOPS[+priceSlider.value];
      if (maxPrice == null) localStorage.removeItem(KEY_MAX_PRICE);
      else localStorage.setItem(KEY_MAX_PRICE, String(maxPrice));
      cells.forEach((_, cell) => applyVisibility(cell));
      updateBar();
    });
    priceLabel = document.createElement('span');
    priceLabel.style.minWidth = '88px';
    priceCount = document.createElement('span');
    Object.assign(priceCount.style, { fontWeight: '400', opacity: '0.8' });
    p.append(priceLabel, priceSlider, priceCount);

    comboBtn = makeComboButton();
    bar.append(tag, b.label, p, comboBtn);
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
    // Remount if a re-render dropped the bar, or if it booted before the grid existed.
    const grid = document.querySelector('#card-list');
    if (!bar.isConnected || (grid && bar.nextElementSibling !== grid)) mountBar();
    let bundles = 0, pricey = 0;
    cells.forEach(info => {
      if (info.bundle) bundles++;
      if (info.priceHidden) pricey++;
    });
    syncComboButton();
    bundleBox.checked = showBundles;
    bundleCount.textContent = `(${bundles} ${showBundles ? 'shown' : 'hidden'})`;
    priceLabel.textContent = maxPrice == null ? 'Any price' : `Max $${maxPrice}`;
    priceCount.textContent = maxPrice == null ? '' : `(${pricey} hidden)`;
    // Only on search/category pages, where there are result cells.
    bar.style.display = cells.size === 0 ? 'none' : 'flex';
  }

  // ---------- Boot + observer ----------

  buildBar();
  scan(document);

  // Text and href changes count too: a reused cell can change product in place.
  // The bar's own updates are ignored, or every scan would schedule another.
  const obs = new MutationObserver(muts => {
    const touched = muts.some(m =>
      !(bar && bar.contains(m.target)) &&
      (m.type !== 'childList' || [...m.addedNodes].some(n => n !== bar)));
    if (touched) {
      clearTimeout(obs._t);
      obs._t = setTimeout(() => scan(document), 150);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
})();
