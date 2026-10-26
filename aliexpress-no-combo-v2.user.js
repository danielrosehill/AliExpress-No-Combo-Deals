// ==UserScript==
// @name         AliExpress — Hide Combo Deals (with Toggle)
// @namespace    https://github.com/danielrosehill/AliExpress-No-Combo-Deals
// @version      2.6.1
// @description  Cleaner AliExpress search results: hide combo / bundle deals and ads, a price range (max up to $72), rating / sales / title-word filters, duplicate collapsing, client-side sort, deep search (load up to 20 pages into one filtered grid), and one-click Choice + Free shipping. Basics sit in a bar above the results; the rest is one click away in a Filters panel. Also filters (dims) Brand+ brand pages.
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

  // Search results: one cell per product in the #card-list flex grid.
  const CARD_SELECTOR = '.search-card-item';
  const CELL_SELECTOR = '.search-item-card-wrapper-gallery';
  // Brand+ pages (/ssr/300002748/…?brandClusterId=…): a virtualised list of rows of
  // eight `normalRow_<hash>` cells, mounted and unmounted as you scroll (verified
  // 2026-10-26). Hiding would leave holes in fixed-height rows, so cards are dimmed.
  const BRAND_CELL_SELECTOR = '[class*="normalRow_"]';
  // Bundle cards link to /ssr/300000512/BundleDeals2?productIds=<id>:<sku> instead of
  // /item/<id>.html (verified 2026-10-26). Locale-independent, unlike the text markers.
  const BUNDLE_LINK = 'a[href*="BundleDeals"]';
  // Sponsored cards carry these params on their item link; organic ones never do
  // (15 of 15 ads, 0 of 45 others, 2026-10-26). The visible "Ad" tag is the fallback.
  const AD_LINK = 'a[href*="aem_p4p_detail"], a[href*="search_p4p_id"]';
  const AD_TAGS = ['Ad', 'מודעה'];

  // Max-price slider. Stops in USD; null = any price. The top stop is $72, which leaves
  // headroom under Israel's $75 customs de-minimis. The card price is the first price
  // on the card (the sale price; verified 2026-10-26). On the ILS channel it is
  // converted at ILS_PER_USD, an approximate rate: edit it if the shekel moves much.
  const PRICE_STOPS = [null, 10, 20, 30, 40, 50, 60, 70, 72];
  const MIN_PRICE_STOPS = [null, 1, 2, 3, 5, 10, 15, 20, 30];
  const RATING_STOPS = [null, 4, 4.5, 4.6, 4.7, 4.8, 4.9];
  const SOLD_STOPS = [null, 10, 50, 100, 500, 1000, 5000];
  const ILS_PER_USD = 3.7;
  const PRICE_RE = /(US ?\$|₪|\$) ?([\d,]+(?:\.\d+)?)/;
  // "1,000+ sold", "10K+ sold" (EN); the Hebrew word order is not verified, so both.
  const SOLD_RES = [
    /([\d][\d.,]*)\s*([KkMm])?\s*\+?\s*(?:sold|נמכר\S*)/i,
    /(?:sold|נמכר\S*)\s*\+?\s*([\d][\d.,]*)\s*([KkMm])?/i,
  ];

  // Server-side search filters applied together in one navigation. Comma-joined
  // selectedSwitches is honoured: both chips read aria-checked=true and the result
  // set changes (verified 2026-10-26, usb c cable). Navigating is deliberate: a chip
  // click can update the URL without re-rendering the grid.
  const COMBO_SWITCHES = ['filterCode:choice_atm', 'filterCode:freeshipping'];
  const FOUR_STAR = 'filterCode:4StarRating';
  const SHIP_FROM = [['', 'Anywhere'], ['IL', 'Israel'], ['CN', 'China'], ['TR', 'Turkey']];

  // Out of the box only bundle deals are hidden; every other filter is opt-in.
  // The key changed in 2.6.1 so everyone starts again from these defaults once,
  // dropping price limits carried over from 2.5.
  const KEY_SETTINGS = 'no-combo:settings-v2';
  const DEFAULTS = {
    enabled: true, showBundles: false, hideAds: false, maxPrice: null, minPrice: null,
    minRating: null, hideUnrated: false, minSold: null, dedupe: false, sort: 'best',
    alwaysExclude: '', words: {}, panelOpen: false, deepPages: 10, deepAutoStop: true,
  };

  // Version stamp, read by the update-userscripts skill in aliexpress-israel-skills.
  if (typeof GM_info !== 'undefined') {
    document.documentElement.setAttribute('data-us-no-combo', GM_info.script.version);
  }

  // ---------- Settings, remembered across pages ----------

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}; } catch (e) { s = {}; }
    return Object.assign({}, DEFAULTS, s, { words: Object.assign({}, s.words) });
  }
  const S = loadSettings();
  const save = () => localStorage.setItem(KEY_SETTINGS, JSON.stringify(S));

  // Title words are per search; "always exclude" applies everywhere.
  function queryKey() {
    const u = new URL(location.href);
    return u.searchParams.get('SearchText') || u.searchParams.get('brandClusterId') || u.pathname;
  }

  // ---------- Reading a card ----------

  const norm = s => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const leaves = cell => [...cell.querySelectorAll('*')]
    .filter(e => !e.children.length)
    .map(e => e.textContent.trim())
    .filter(Boolean);

  function parseSold(text) {
    for (const re of SOLD_RES) {
      const m = text.match(re);
      if (!m) continue;
      const mult = { k: 1e3, m: 1e6 }[(m[2] || '').toLowerCase()];
      return mult ? parseFloat(m[1].replace(/,/g, '')) * mult : parseInt(m[1].replace(/[.,]/g, ''), 10);
    }
    return null;
  }

  // Read fresh on every scan. A cell can render before its links or price hydrate,
  // and paging (same document) reuses the cell nodes for other products: a cached
  // verdict hid normal items on page 2 (2026-10-26).
  function readCell(cell) {
    const ls = leaves(cell);
    // Joined with a separator: raw textContent runs "US $7.23" into "1,000+ sold".
    const text = ls.join(' | ');
    const pm = text.replace(/\s+/g, ' ').match(PRICE_RE);
    const n = pm ? parseFloat(pm[2].replace(/,/g, '')) : null;
    const rating = ls.find(l => /^[1-5][.,]\d$/.test(l));
    const soldLeaf = ls.find(l => /sold|נמכר/i.test(l));
    const title = (cell.querySelector('h3, [class*="title_"]') || {}).textContent
      || (cell.querySelector('img[alt]') || {}).alt
      || ls.reduce((a, b) => (b.length > a.length ? b : a), '');
    return {
      bundle: !!cell.querySelector(BUNDLE_LINK) || COMBO_MARKERS.some(m => norm(cell.textContent).includes(m)),
      ad: !!cell.querySelector(AD_LINK) || ls.some(l => AD_TAGS.includes(l)),
      usd: n == null ? null : pm[1] === '₪' ? n / ILS_PER_USD : n,
      rating: rating ? parseFloat(rating.replace(',', '.')) : null,
      // No sold line on a card means nothing sold yet.
      sold: soldLeaf ? parseSold(soldLeaf) : 0,
      title: norm(title),
    };
  }

  // ---------- Title words ----------
  // `word` and `"a phrase"` must appear; `-word` and `-"a phrase"` must not.

  function parseWords(q) {
    const req = [], exc = [];
    const re = /(-?)"([^"]+)"|(-?)(\S+)/g;
    let m;
    while ((m = re.exec(q || ''))) {
      const neg = m[1] || m[3];
      const term = norm(m[2] || m[4]);
      if (!term || term === '-') continue;
      (neg ? exc : req).push(term);
    }
    return { req, exc };
  }
  // Whole-word match that also works for Hebrew, where \b does not.
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasTerm = (title, term) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${esc(term)}($|[^\\p{L}\\p{N}])`, 'u').test(title);

  // ---------- Duplicates ----------

  const tokens = t => new Set(t.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 1));
  function similar(a, b) {
    let inter = 0;
    a.forEach(w => { if (b.has(w)) inter++; });
    return inter / (a.size + b.size - inter || 1) >= 0.8;
  }

  // ---------- Filtering ----------

  let mode = null; // 'search' | 'brand' | null
  let cells = [];  // [{ cell, info, why }]
  const counts = {};

  const REASONS = ['bundle', 'ad', 'words', 'always', 'minPrice', 'maxPrice', 'rating', 'unrated', 'sold', 'dupe'];

  function reasonFor(info, words, always) {
    if (info.bundle && !S.showBundles) return 'bundle';
    if (S.hideAds && info.ad) return 'ad';
    if (info.title) {
      if (words.req.some(t => !hasTerm(info.title, t)) || words.exc.some(t => hasTerm(info.title, t))) return 'words';
      if (always.exc.concat(always.req).some(t => hasTerm(info.title, t))) return 'always';
    }
    // Fail open: a card whose price or rating can't be read is never hidden for it.
    if (S.minPrice != null && info.usd != null && info.usd < S.minPrice) return 'minPrice';
    if (S.maxPrice != null && info.usd != null && info.usd > S.maxPrice) return 'maxPrice';
    if (S.minRating != null && info.rating != null && info.rating < S.minRating) return 'rating';
    if (S.hideUnrated && info.rating == null) return 'unrated';
    if (S.minSold != null && info.sold != null && info.sold < S.minSold) return 'sold';
    return null;
  }

  const SORTS = {
    best: null,
    price: c => (c.info.usd == null ? Infinity : c.info.usd),
    sold: c => -(c.info.sold || 0),
    rating: c => -((c.info.rating || 0) * 1e7 + (c.info.sold || 0)),
    // Rating above 3 stars, times log of sales, per square root of price.
    value: c => (c.info.usd == null ? Infinity
      : -(((c.info.rating || 3.5) - 3) * Math.log10((c.info.sold || 0) + 10) / Math.sqrt(Math.max(c.info.usd, 0.5)))),
  };

  function apply() {
    REASONS.forEach(r => { counts[r] = 0; });
    const words = parseWords(S.words[queryKey()]);
    const always = parseWords(S.alwaysExclude);
    const kept = [];
    // DOM order is AliExpress's own ranking, so the first of a duplicate set is kept.
    for (const c of cells) {
      c.why = S.enabled ? reasonFor(c.info, words, always) : null;
      if (!c.why && S.enabled && S.dedupe && mode === 'search' && c.info.title) {
        const tk = tokens(c.info.title);
        if (kept.some(k => similar(tk, k))) c.why = 'dupe';
        else kept.push(tk);
      }
      if (c.why) counts[c.why]++;
      // An attribute plus a stylesheet rule, not inline style: it survives the site
      // rewriting the cell's style or class.
      const attr = mode === 'brand' ? 'data-nc-dim' : 'data-nc-hide';
      if (c.why) c.cell.setAttribute(attr, c.why); else c.cell.removeAttribute(attr);
    }
    // Sort by CSS order: the flex grid reorders without React's nodes moving.
    const key = mode === 'search' && S.enabled && SORTS[S.sort];
    if (key) {
      [...cells].sort((a, b) => key(a) - key(b)).forEach((c, i) => { c.cell.style.order = String(i); });
    } else {
      cells.forEach(c => { if (c.cell.style.order) c.cell.style.order = ''; });
    }
    updateBar();
  }

  // ---------- Deep search ----------
  // Loads pages 1..N of the current search into one grid, so filters and sort work
  // across the long tail instead of 60 cards at a time. Pages come from the endpoint
  // the page itself calls when you page: POST /fn/search-pc/index, same-origin,
  // unsigned, 60 items per page in data.result.mods.itemList.content, and it honours
  // the URL's selectedSwitches / shpf_co / sortType (verified 2026-10-26). Requests
  // go one at a time with a 1.5-3 s gap; a non-JSON reply (captcha) stops the run.

  const KEY_DEEP = 'no-combo:deep';
  const DEEP_TTL_MS = 30 * 60 * 1000;
  const deep = { active: false, loading: false, stop: false, key: null, items: [], pages: [], note: '', box: null, cards: [] };

  // The search identity: the URL without its page number.
  function deepKey() {
    const u = new URL(location.href);
    u.searchParams.delete('page');
    u.searchParams.sort();
    return u.pathname + '?' + u.searchParams.toString();
  }

  function itemInfo(x, page) {
    const sale = (x.prices && (x.prices.salePrice || x.prices.originalPrice)) || {};
    const price = typeof sale.minPrice === 'number' ? sale.minPrice : null;
    const tags = (x.sellingPoints || []).map(sp => sp.tagContent && sp.tagContent.tagText).filter(Boolean);
    const url = x.productDetailUrl && /BundleDeals/.test(x.productDetailUrl)
      ? x.productDetailUrl : `https://www.aliexpress.com/item/${x.productId}.html`;
    const img = ((x.image && x.image.imgUrl) || '').replace(/^\/\//, 'https://');
    const title = (x.title && (x.title.displayTitle || x.title.seoTitle)) || '';
    const trade = x.trade || {};
    return {
      id: x.productId, page, url, img, rawTitle: title, priceText: sale.formattedPrice || '',
      bundle: /BundleDeals/.test(url),
      ad: x.productType === 'ad',
      usd: price == null ? null : sale.currencyCode === 'ILS' ? price / ILS_PER_USD : price,
      rating: (x.evaluation && x.evaluation.starRating) || null,
      sold: parseInt(trade.realTradeCount, 10) || (trade.tradeDesc ? parseSold(trade.tradeDesc) : 0) || 0,
      soldText: trade.tradeDesc || '',
      choice: (x.sellingPoints || []).some(sp => sp.source === 'choice_atm'),
      freeShip: tags.find(t => /free shipping/i.test(t)) || '',
      title: norm(title),
    };
  }

  async function fetchPage(page) {
    const u = new URL(location.href);
    const data = { origin: 'y' };
    u.searchParams.forEach((v, k) => { data[k] = v; });
    data.page = page;
    const body = {
      pageVersion: (window._dida_config_ || {}).pageVersion,
      target: 'root', data, eventName: 'onChange', dependency: [],
    };
    const r = await fetch('/fn/search-pc/index', {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('AliExpress answered with a non-JSON page (likely a captcha)'); }
    const list = j && j.data && j.data.result && j.data.result.mods && j.data.result.mods.itemList;
    if (!j.success || !list) throw new Error('AliExpress returned no result list');
    return list.content || [];
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function deepLoad() {
    if (deep.loading) { deep.stop = true; return; }
    Object.assign(deep, { loading: true, stop: false, key: deepKey(), items: [], pages: [], note: '' });
    const seen = new Set();
    let weak = 0;
    try {
      for (let p = 1; p <= S.deepPages && !deep.stop; p++) {
        deep.note = `Loading page ${p} of ${S.deepPages}…`;
        updateBar();
        const raw = await fetchPage(p);
        const fresh = raw.filter(x => x.productId && !seen.has(x.productId));
        fresh.forEach(x => seen.add(x.productId));
        const infos = fresh.map(x => itemInfo(x, p));
        deep.items.push(...infos);
        const words = parseWords(S.words[queryKey()]);
        const always = parseWords(S.alwaysExclude);
        const kept = infos.filter(i => !reasonFor(i, words, always)).length;
        deep.pages.push({ page: p, items: fresh.length, kept });
        showDeep();
        if (!fresh.length) { deep.note = `No new items after page ${p - 1}.`; break; }
        // Signal check: two pages in a row with at most 2 keepers ends the run.
        weak = kept <= 2 ? weak + 1 : 0;
        if (S.deepAutoStop && weak >= 2) { deep.note = `Stopped at page ${p}: two pages in a row with ≤2 matches.`; break; }
        if (p < S.deepPages) await sleep(1500 + Math.random() * 1500);
      }
      if (!deep.note || deep.note.startsWith('Loading')) deep.note = deep.stop ? 'Stopped.' : '';
    } catch (e) {
      deep.note = `Stopped at page ${deep.pages.length + 1}: ${e.message}.`;
    }
    deep.loading = false;
    if (deep.items.length) {
      try {
        sessionStorage.setItem(KEY_DEEP, JSON.stringify({ key: deep.key, at: Date.now(), pages: deep.pages, items: deep.items, note: deep.note }));
      } catch (e) { /* over quota: the view still works, it just won't survive a refresh */ }
    }
    showDeep();
  }

  function restoreDeep() {
    let c;
    try { c = JSON.parse(sessionStorage.getItem(KEY_DEEP)); } catch (e) { c = null; }
    if (!c || c.key !== deepKey() || Date.now() - c.at > DEEP_TTL_MS) return false;
    Object.assign(deep, { key: c.key, items: c.items, pages: c.pages, note: c.note || '' });
    showDeep();
    return true;
  }

  function exitDeep(forget) {
    deep.active = false;
    deep.stop = true;
    if (deep.box) deep.box.remove();
    deep.box = null;
    deep.cards = [];
    document.querySelectorAll('[data-nc-deep-off]').forEach(e => e.removeAttribute('data-nc-deep-off'));
    if (forget) sessionStorage.removeItem(KEY_DEEP);
    scan();
  }

  function deepCard(i) {
    const a = el('a', { className: 'nc-card', href: i.url, target: '_blank', rel: 'noopener' });
    const badges = el('div', { className: 'nc-badges' },
      el('span', { className: 'nc-b', textContent: `p${i.page}` }),
      i.ad ? el('span', { className: 'nc-b nc-b-ad', textContent: 'Ad' }) : null,
      i.bundle ? el('span', { className: 'nc-b nc-b-ad', textContent: 'Bundle' }) : null,
      i.choice ? el('span', { className: 'nc-b nc-b-ch', textContent: 'Choice' }) : null);
    a.append(...[
      el('div', { className: 'nc-img' }, el('img', { src: i.img, loading: 'lazy', alt: '' }), badges),
      el('div', { className: 'nc-t', textContent: i.rawTitle, title: i.rawTitle }),
      el('div', { className: 'nc-p', textContent: i.priceText }),
      el('div', { className: 'nc-m', textContent: [i.rating ? `★ ${i.rating}` : 'unrated', i.soldText].filter(Boolean).join(' · ') }),
      i.freeShip ? el('div', { className: 'nc-m nc-fs', textContent: i.freeShip }) : null].filter(Boolean));
    return a;
  }

  // Render (or extend) the deep grid and switch the page to it.
  function showDeep() {
    deep.active = true;
    if (!deep.box) deep.box = el('div', { id: 'nc-deep' });
    const have = new Set(deep.cards.map(c => c.info.id));
    deep.items.filter(i => !have.has(i.id)).forEach(info => {
      const cell = deepCard(info);
      deep.box.appendChild(cell);
      deep.cards.push({ cell, info, why: null });
    });
    scan();
  }

  function scan() {
    if (deep.active) {
      if (deep.key !== deepKey()) { exitDeep(false); return; }
      mode = 'search';
      // The native grid and pager stand aside while the deep grid is up.
      ['#card-list', '.comet-pagination'].forEach(q => {
        const e = document.querySelector(q);
        if (e) e.setAttribute('data-nc-deep-off', '');
      });
      cells = deep.cards;
      apply();
      return;
    }
    let found = [...document.querySelectorAll(CELL_SELECTOR)];
    if (!found.length) found = [...document.querySelectorAll(CARD_SELECTOR)].map(c => c.closest(CELL_SELECTOR) || c);
    mode = found.length ? 'search' : null;
    if (!found.length) {
      found = [...document.querySelectorAll(BRAND_CELL_SELECTOR)].filter(c => c.querySelector('a[href*="/item/"]'));
      if (found.length) mode = 'brand';
    }
    cells = [...new Set(found)].map(cell => ({ cell, info: readCell(cell), why: null }));
    apply();
  }

  // ---------- The bar ----------
  // Labelled as a userscript and styled unlike AliExpress's own UI, so it's
  // obviously an add-on. Basics in the top row; the rest in a Filters panel of
  // collapsible sections.

  const css = document.createElement('style');
  css.textContent = `
    [data-nc-hide], [data-nc-deep-off] { display: none !important; }
    #nc-deep { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 24px; }
    #nc-deep .nc-card { flex: 0 0 calc(20% - 12px); min-width: 170px; box-sizing: border-box; background: #fff; color: #191919;
      border-radius: 10px; overflow: hidden; text-decoration: none; font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-shadow: 0 1px 4px rgba(0,0,0,.12); padding-bottom: 8px; }
    #nc-deep .nc-card:hover { box-shadow: 0 4px 14px rgba(0,0,0,.2); }
    #nc-deep .nc-img { position: relative; aspect-ratio: 1; background: #f3f4f6; }
    #nc-deep .nc-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #nc-deep .nc-badges { position: absolute; top: 6px; left: 6px; display: flex; gap: 4px; }
    #nc-deep .nc-b { background: #1f2937; color: #fff; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
    #nc-deep .nc-b-ad { background: #6b7280; }
    #nc-deep .nc-b-ch { background: #f59e0b; color: #1f2937; }
    #nc-deep .nc-t { margin: 8px 10px 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    #nc-deep .nc-p { margin: 0 10px; font-size: 17px; font-weight: 700; }
    #nc-deep .nc-m { margin: 2px 10px 0; color: #4b5563; font-size: 12px; }
    #nc-deep .nc-fs { color: #15803d; }
    [data-nc-dim] { opacity: .18 !important; filter: grayscale(1); transition: opacity .15s; }
    [data-nc-dim]:hover { opacity: .7 !important; }
    #no-combo-badge { background: #1f2937; color: #fff; font: 13px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 8px 14px; border: 2px dashed #a78bfa; border-radius: 10px; user-select: none; margin: 12px 0;
      width: fit-content; max-width: 100%; box-sizing: border-box; }
    #no-combo-badge.nc-float { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; margin: 0;
      max-width: calc(100vw - 32px); max-height: 80vh; overflow: auto; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
    #no-combo-badge .nc-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    #no-combo-badge label { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; cursor: pointer; }
    #no-combo-badge .nc-n { font-weight: 400; opacity: .8; }
    #no-combo-badge .nc-tag { background: #a78bfa; color: #1f2937; font-weight: 700; font-size: 11px; padding: 2px 6px;
      border-radius: 4px; letter-spacing: .03em; text-transform: uppercase; }
    #no-combo-badge button { color: #fff; background: transparent; border: 1px solid #a78bfa; border-radius: 6px;
      padding: 4px 10px; font: inherit; font-weight: 600; cursor: pointer; }
    #no-combo-badge button.nc-on { background: #16a34a; }
    #no-combo-badge select, #no-combo-badge input[type=text] { background: #111827; color: #fff; border: 1px solid #4b5563;
      border-radius: 5px; padding: 3px 6px; font: inherit; }
    #no-combo-badge input[type=text] { width: 260px; }
    #no-combo-badge .nc-panel { margin-top: 10px; border-top: 1px solid #374151; padding-top: 8px; display: grid; gap: 6px; }
    #no-combo-badge details { background: #111827; border-radius: 6px; padding: 6px 10px; }
    #no-combo-badge summary { cursor: pointer; font-weight: 700; }
    #no-combo-badge details > div { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
    #no-combo-badge .nc-help { font-size: 11px; opacity: .7; flex-basis: 100%; }
    #no-combo-badge.nc-off .nc-dep { opacity: .4; pointer-events: none; }
  `;
  (document.head || document.documentElement).appendChild(css);

  let bar, panel;
  const ui = {}; // controls and count spans, by name

  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props || {});
    e.append(...kids.filter(k => k != null));
    return e;
  };
  const countSpan = name => (ui['n_' + name] = el('span', { className: 'nc-n' }));

  function checkbox(name, text, onChange) {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => onChange(box.checked));
    ui[name] = box;
    return el('label', null, box, text, countSpan(name));
  }

  function select(name, text, options, onChange) {
    const sel = el('select');
    options.forEach(([v, t]) => sel.append(el('option', { value: v == null ? '' : String(v), textContent: t })));
    sel.addEventListener('change', () => onChange(sel.value));
    ui[name] = sel;
    return el('label', null, text, sel, countSpan(name));
  }

  function textInput(name, text, placeholder, onInput) {
    const inp = el('input', { type: 'text', placeholder, spellcheck: false });
    // Save on every keystroke and delay only the re-filter: a rescan in between
    // would otherwise reset the field to the old saved value.
    let t;
    inp.addEventListener('input', () => { onInput(inp.value); save(); clearTimeout(t); t = setTimeout(apply, 250); });
    ui[name] = inp;
    return el('label', null, text, inp, countSpan(name));
  }

  const set = (k, v) => { S[k] = v; save(); apply(); };
  const num = v => (v === '' ? null : +v);
  const usd = v => (v == null ? 'Any' : `$${v}`);

  function section(name, title, ...rows) {
    const d = el('details', null, el('summary', { textContent: title }), el('div', null, ...rows));
    ui['sec_' + name] = d;
    return d;
  }

  // ---------- Server-side filters (reload the search) ----------

  function currentSwitches() {
    const v = new URL(location.href).searchParams.get('selectedSwitches');
    return v ? v.split(',').filter(Boolean) : [];
  }
  const comboOn = () => COMBO_SWITCHES.every(sw => currentSwitches().includes(sw));

  function navigateWith(edit) {
    const url = new URL(location.href);
    edit(url);
    url.searchParams.delete('page');
    location.assign(url.toString());
  }
  function setSwitches(remove, add) {
    navigateWith(url => {
      const sw = currentSwitches().filter(x => !remove.includes(x)).concat(add);
      if (sw.length) url.searchParams.set('selectedSwitches', sw.join(','));
      else url.searchParams.delete('selectedSwitches');
    });
  }

  function buildBar() {
    bar = el('div', { id: 'no-combo-badge' });
    // Keep the site's keyboard shortcuts from eating typing in the panel.
    ['keydown', 'keyup', 'keypress'].forEach(t => bar.addEventListener(t, e => e.stopPropagation()));

    const tag = el('span', {
      className: 'nc-tag', textContent: 'Userscript',
      title: 'Added by the "AliExpress — Hide Combo Deals" userscript, not by AliExpress',
    });

    // Max-price slider: leftmost = any price.
    ui.maxPrice = el('input', { type: 'range', min: '0', max: String(PRICE_STOPS.length - 1), step: '1' });
    ui.maxPrice.style.width = '110px';
    ui.maxPrice.addEventListener('input', () => set('maxPrice', PRICE_STOPS[+ui.maxPrice.value]));
    ui.maxLabel = el('span', { style: 'min-width:70px' });
    const priceCtl = el('label', { className: 'nc-dep' }, ui.maxLabel, ui.maxPrice, countSpan('maxPrice'));

    ui.combo = el('button', { type: 'button', className: 'nc-dep nc-search' });
    ui.combo.addEventListener('click', () => {
      const on = comboOn();
      setSwitches(COMBO_SWITCHES, on ? [] : COMBO_SWITCHES);
    });

    ui.shown = el('span', { className: 'nc-n' });
    ui.deepBtn = el('button', { type: 'button', className: 'nc-dep' });
    ui.deepBtn.addEventListener('click', () => {
      if (deep.loading) deep.stop = true;
      else if (deep.active) exitDeep(true);
      else deepLoad();
    });
    ui.deepNote = el('span', { className: 'nc-n' });

    ui.toggle = el('button', { type: 'button' });
    ui.toggle.addEventListener('click', () => set('panelOpen', !S.panelOpen));

    const top = el('div', { className: 'nc-row' },
      tag,
      checkbox('enabled', 'On', v => set('enabled', v)),
      el('span', { className: 'nc-dep nc-row' },
        checkbox('bundle', 'Show bundle deals', v => set('showBundles', v)),
        checkbox('ad', 'Hide ads', v => set('hideAds', v))),
      priceCtl, ui.combo, ui.deepBtn, ui.toggle, ui.shown, ui.deepNote);

    const stops = arr => arr.map(v => [v, v == null ? 'Any' : String(v)]);
    panel = el('div', { className: 'nc-panel nc-dep' },
      section('price', 'Price',
        select('minPrice', 'Min price', MIN_PRICE_STOPS.map(v => [v, usd(v)]), v => set('minPrice', num(v))),
        el('span', { className: 'nc-help', textContent:
          'Card prices are the cheapest variant\'s. A min price drops $1–3 bait listings priced on an accessory or sticker variant.' })),
      section('quality', 'Rating & sales',
        select('rating', 'Min rating', stops(RATING_STOPS).map(([v, t]) => [v, v == null ? t : t + '★']), v => set('minRating', num(v))),
        checkbox('unrated', 'Hide unrated', v => set('hideUnrated', v)),
        select('sold', 'Min sold', stops(SOLD_STOPS).map(([v, t]) => [v, v == null ? t : t + '+']), v => set('minSold', num(v))),
        el('span', { className: 'nc-help', textContent:
          'A card without a rating is unaffected by Min rating; use Hide unrated for those. No "sold" line counts as 0 sold.' })),
      section('words', 'Title words',
        textInput('words', 'This search', '"hall effect" -case -cable', v => {
          const k = queryKey();
          if (v.trim()) S.words[k] = v; else delete S.words[k];
        }),
        textInput('always', 'Always hide', 'sticker replacement', v => { S.alwaysExclude = v; }),
        el('span', { className: 'nc-help', textContent:
          'This search: plain words and "quoted phrases" must be in the title, -word and -"phrase" must not. Remembered per search. Always hide: any word listed hides the card on every search.' })),
      section('dupes', 'Duplicates',
        checkbox('dupe', 'Collapse near-identical listings', v => set('dedupe', v)),
        el('span', { className: 'nc-help', textContent:
          'Keeps the first (best-ranked) of listings whose titles share 80% of their words.' })),
      section('sort', 'Sort this page',
        select('sortSel', 'Order', [['best', 'Best match (AliExpress)'], ['price', 'Price, low to high'],
          ['sold', 'Most sold'], ['rating', 'Top rated'], ['value', 'Best value']], v => set('sort', v)),
        el('span', { className: 'nc-help', textContent:
          'Re-orders the loaded page only. Best value: rating above 3★ × log(sales) ÷ √price.' })),
      section('deep', 'Deep search',
        select('deepPagesSel', 'Pages to load', [5, 10, 15, 20].map(v => [v, String(v)]), v => set('deepPages', +v)),
        checkbox('deepAuto', 'Stop when the signal runs out', v => set('deepAutoStop', v)),
        ui.deepPerPage = el('span', { className: 'nc-help' }),
        el('span', { className: 'nc-help', textContent:
          'Loads pages 1..N of this search into one grid, so the filters and sort reach the long tail. ' +
          'One page every 1.5-3 s. "Stop when the signal runs out" ends after two pages in a row with at most 2 matches. ' +
          'Cards are tagged with the page they came from. The set lasts for the browser session (30 min).' })),
      section('server', 'AliExpress filters (reloads the search)',
        checkbox('fourStar', '4★ & up', on => setSwitches([FOUR_STAR], on ? [FOUR_STAR] : [])),
        select('shipFrom', 'Ships from', SHIP_FROM, v => navigateWith(url => {
          if (v) url.searchParams.set('shpf_co', v); else url.searchParams.delete('shpf_co');
        }))),
      el('div', { className: 'nc-row' }, (() => {
        const b = el('button', { type: 'button', textContent: 'Reset filters' });
        b.addEventListener('click', () => {
          Object.assign(S, DEFAULTS, { enabled: true, panelOpen: true, words: S.words });
          delete S.words[queryKey()];
          save(); apply();
        });
        return b;
      })()));

    bar.append(top, panel);
  }

  function mountBar() {
    if (mode === 'search') {
      // Sit just above the results grid so it scrolls with the page; the deep grid,
      // when up, goes between the two.
      bar.classList.remove('nc-float');
      const grid = document.querySelector('#card-list');
      if (grid && grid.parentElement) {
        const first = deep.box || grid;
        if (deep.box && deep.box.nextElementSibling !== grid) grid.parentElement.insertBefore(deep.box, grid);
        if (bar.nextElementSibling !== first) grid.parentElement.insertBefore(bar, first);
        return;
      }
    } else {
      // Brand pages are an immersive full-screen layout: float bottom-left.
      bar.classList.add('nc-float');
    }
    if (bar.parentElement !== document.body) document.body.appendChild(bar);
  }

  const ADVANCED = ['minPrice', 'minRating', 'hideUnrated', 'minSold', 'dedupe'];

  function updateBar() {
    if (!bar) buildBar();
    if (!mode) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    mountBar();
    const search = mode === 'search';
    const verb = search ? 'hidden' : 'dimmed';
    bar.classList.toggle('nc-off', !S.enabled);

    ui.enabled.checked = S.enabled;
    ui.bundle.checked = S.showBundles;
    ui.ad.checked = S.hideAds;
    ui.unrated.checked = S.hideUnrated;
    ui.dupe.checked = S.dedupe;
    ui.maxPrice.value = String(Math.max(0, PRICE_STOPS.indexOf(S.maxPrice)));
    ui.maxLabel.textContent = S.maxPrice == null ? 'Any price' : `Max $${S.maxPrice}`;
    ui.minPrice.value = S.minPrice == null ? '' : String(S.minPrice);
    ui.rating.value = S.minRating == null ? '' : String(S.minRating);
    ui.sold.value = S.minSold == null ? '' : String(S.minSold);
    ui.sortSel.value = S.sort;
    ui.deepPagesSel.value = String(S.deepPages);
    ui.deepAuto.checked = S.deepAutoStop;
    ui.deepBtn.style.display = search ? '' : 'none';
    ui.deepBtn.textContent = deep.loading ? 'Stop loading'
      : deep.active ? `✓ Deep: ${deep.items.length} items · back to normal` : `Deep search (${S.deepPages} pages)`;
    ui.deepBtn.classList.toggle('nc-on', deep.active && !deep.loading);
    ui.deepNote.textContent = deep.note;
    ui.deepPerPage.textContent = deep.pages.length
      ? 'Matches per page: ' + deep.pages.map(p => `p${p.page} ${p.kept}/${p.items}`).join(' · ')
      : '';
    // Don't overwrite a field while it's being typed in.
    const w = S.words[queryKey()] || '';
    if (document.activeElement !== ui.words && ui.words.value !== w) ui.words.value = w;
    if (document.activeElement !== ui.always && ui.always.value !== S.alwaysExclude) ui.always.value = S.alwaysExclude;

    const n = (name, reasons) => {
      const k = reasons.reduce((a, r) => a + counts[r], 0);
      ui['n_' + name].textContent = k ? `(${k} ${verb})` : '';
    };
    ui.n_bundle.textContent = `(${counts.bundle} ${S.showBundles ? 'shown' : verb})`;
    n('ad', ['ad']); n('maxPrice', ['maxPrice']); n('minPrice', ['minPrice']); n('rating', ['rating']);
    n('unrated', ['unrated']); n('sold', ['sold']); n('words', ['words']); n('always', ['always']); n('dupe', ['dupe']);
    ui.n_enabled.textContent = '';

    const hidden = cells.filter(c => c.why).length;
    ui.shown.textContent = search
      ? `Showing ${cells.length - hidden} of ${cells.length}`
      : `${hidden} of ${cells.length} loaded dimmed`;

    const active = ADVANCED.filter(k => S[k] !== DEFAULTS[k]).length
      + (S.words[queryKey()] ? 1 : 0) + (S.alwaysExclude.trim() ? 1 : 0) + (S.sort !== 'best' ? 1 : 0);
    ui.toggle.textContent = `Filters ${S.panelOpen ? '▴' : '▾'}${active ? ` (${active} on)` : ''}`;
    panel.style.display = S.panelOpen ? '' : 'none';

    // Search-only controls; they mean nothing on a brand page.
    ui.combo.style.display = search ? '' : 'none';
    ['dupes', 'sort', 'server', 'deep'].forEach(s => { ui['sec_' + s].style.display = search ? '' : 'none'; });
    ui.ad.parentElement.style.display = search ? '' : 'none';
    ui.bundle.parentElement.style.display = search ? '' : 'none';

    // State is read from the URL on every update, not once at load: paging and
    // AliExpress's own filter chips change the URL without reloading the page.
    const on = comboOn();
    ui.combo.textContent = on ? '✓ Choice All In' : 'Choice All In';
    ui.combo.title = on ? 'Remove Choice + Free shipping' : 'Apply AliExpress\'s Choice and Free shipping filters at once';
    ui.combo.classList.toggle('nc-on', on);
    ui.fourStar.checked = currentSwitches().includes(FOUR_STAR);
    ui.shipFrom.value = new URL(location.href).searchParams.get('shpf_co') || '';
  }

  // ---------- Boot + observer ----------

  // A deep set loaded earlier this session for this same search comes back on refresh.
  if (!restoreDeep()) scan();

  // Text and href changes count too: a reused cell can change product in place.
  // The bar's own updates are ignored, or every scan would schedule another.
  let t;
  const rescan = () => { clearTimeout(t); t = setTimeout(scan, 150); };
  const obs = new MutationObserver(muts => {
    if (muts.some(m =>
      !(bar && bar.contains(m.target)) && !(deep.box && deep.box.contains(m.target)) &&
      (m.type !== 'childList' || [...m.addedNodes].some(n => n !== bar)))) rescan();
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] });
  // A page restored from the back/forward cache, or a late full load, gets a fresh pass.
  window.addEventListener('pageshow', rescan);
  window.addEventListener('load', rescan);
  window.addEventListener('popstate', rescan);
})();
