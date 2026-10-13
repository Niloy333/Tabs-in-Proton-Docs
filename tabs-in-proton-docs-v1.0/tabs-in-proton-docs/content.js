// Tabs in Proton Docs
// Every Heading 1 starts a new tab. Only the selected tab's blocks are shown; the rest get
// a data attribute that hides them with CSS. The document text itself is never modified.

(() => {
  'use strict';

  const HIDDEN = 'data-ptabs-hidden';
  const ROOT_MARK = 'data-ptabs-root';

  let root = null;          // the main Lexical editor element
  let tabs = [];            // [{ h1, label, blocks, intro }]
  let activeKey = null;     // H1 element of the selected tab, or 'intro'
  let lastIndex = 0;        // fallback if the selected H1 element gets recreated
  let showAll = false;
  let scheduled = false;
  let barSignature = '';

  // ---------- Page-level CSS (hides blocks, leaves room for the bar) ----------
  const pageStyle = document.createElement('style');
  pageStyle.textContent = `
    [${HIDDEN}] { display: none !important; }
    [${ROOT_MARK}].ptabs-active { padding-bottom: 72px !important; }
  `;
  (document.head || document.documentElement).appendChild(pageStyle);

  // ---------- Tab bar (Shadow DOM so Proton's styles don't leak in) ----------
  const host = document.createElement('div');
  host.id = 'ptabs-host';
  host.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { --page:#ffffff; --rail:#f1eff6; --ink:#262a33; --muted:#6c6f7d; --edge:#dcd8e6; --accent:#6d4aff; }
      :host(.dark) { --page:#1c1b24; --rail:#16151d; --ink:#e9e8ef; --muted:#9a98a8; --edge:#2e2c3a; --accent:#8a6eff; }
      .rail { display:flex; align-items:flex-start; gap:2px; height:40px; padding:0 12px; background:var(--rail); border-top:1px solid var(--edge); font:13px/1 system-ui,-apple-system,"Segoe UI",sans-serif; }
      .tabs { display:flex; gap:2px; overflow-x:auto; scrollbar-width:thin; flex:1; min-width:0; }
      button { all:unset; box-sizing:border-box; cursor:pointer; height:32px; padding:0 14px; max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--muted); border-radius:0 0 8px 8px; border:1px solid transparent; border-top:none; margin-top:-1px; flex-shrink:0; }
      button:hover { color:var(--ink); background:color-mix(in srgb, var(--page) 55%, transparent); }
      button:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
      button[aria-selected="true"] { color:var(--ink); background:var(--page); border-color:var(--edge); box-shadow:inset 0 -2px 0 var(--accent); font-weight:600; }
      button.intro { font-style:italic; }
      .all { margin-left:8px; border-left:1px solid var(--edge); padding-left:8px; display:flex; }
      @media (prefers-reduced-motion: no-preference) { button { transition:color .12s, background-color .12s; } }
    </style>
    <div class="rail" role="tablist" aria-label="Document tabs">
      <div class="tabs"></div>
      <div class="all"><button data-all title="Show the whole document">All</button></div>
    </div>`;
  const tabsEl = shadow.querySelector('.tabs');
  const allBtn = shadow.querySelector('[data-all]');

  // ---------- Helpers ----------
  function findRoot() {
    let best = null, bestArea = 0;
    document.querySelectorAll('[data-lexical-editor="true"]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > bestArea) { bestArea = r.width * r.height; best = el; }
    });
    return best;
  }

  function buildTabs() {
    const result = [], intro = [];
    let cur = null;
    for (const b of root.children) {
      if (b.tagName === 'H1') { cur = { h1: b, label: b.textContent.trim() || 'Untitled', blocks: [b] }; result.push(cur); }
      else if (cur) cur.blocks.push(b);
      else intro.push(b);
    }
    if (!result.length) return [];
    if (intro.length) {
      const hasContent = intro.some(b => b.textContent.trim() !== '' || b.querySelector('img, table, hr, input'));
      if (hasContent) result.unshift({ h1: null, label: 'Intro', blocks: intro, intro: true });
      else result[0].blocks.unshift(...intro);    // stray empty lines above the first H1 belong to tab 1
    }
    return result;
  }

  function blockOf(node, offset) {
    if (node === root) return root.children[Math.min(offset, root.children.length - 1)] || null;
    while (node && node.parentNode !== root) node = node.parentNode;
    return node;
  }

  function caretTabIndex() {
    const sel = document.getSelection();
    if (!root || !sel || !sel.anchorNode || !root.contains(sel.anchorNode)) return -1;
    const b = blockOf(sel.anchorNode, sel.anchorOffset);
    return tabs.findIndex(t => t.blocks.includes(b));
  }

  function keyIndex() {
    return tabs.findIndex(t => (activeKey === 'intro' ? t.intro : t.h1 === activeKey));
  }

  function setHidden(el, hide) {
    if (hide) { if (!el.hasAttribute(HIDDEN)) el.setAttribute(HIDDEN, ''); }
    else if (el.hasAttribute(HIDDEN)) el.removeAttribute(HIDDEN);
  }

  function unhideAll() {
    document.querySelectorAll(`[${HIDDEN}]`).forEach(el => el.removeAttribute(HIDDEN));
  }

  function isDark() {
    for (const el of [root, document.body, document.documentElement]) {
      if (!el) continue;
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (m && (m.length < 4 || +m[3] > 0)) return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 128;
    }
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ---------- Main update ----------
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }

  function apply() {
    scheduled = false;
    const r = findRoot();
    if (r !== root) {
      if (root) root.removeAttribute(ROOT_MARK);
      unhideAll();
      root = r;
      if (root) root.setAttribute(ROOT_MARK, '');
    }
    tabs = root ? buildTabs() : [];

    if (!tabs.length) {
      unhideAll();
      if (root) root.classList.remove('ptabs-active');
      host.style.display = 'none';
      barSignature = '';
      return;
    }
    if (!host.isConnected) document.body.appendChild(host);
    host.style.display = 'block';
    host.classList.toggle('dark', isDark());
    root.classList.add('ptabs-active');

    let idx = -1;
    if (!showAll) {
      idx = caretTabIndex();                         // follow the caret (e.g. a freshly typed "# ")
      if (idx === -1) idx = keyIndex();               // otherwise keep the selected tab
      if (idx === -1) idx = Math.min(lastIndex, tabs.length - 1);
      activeKey = tabs[idx].intro ? 'intro' : tabs[idx].h1;
      lastIndex = idx;
    }
    tabs.forEach((t, i) => t.blocks.forEach(b => setHidden(b, !showAll && i !== idx)));
    renderBar(idx);
  }

  function renderBar(idx) {
    const sig = JSON.stringify([showAll, idx, tabs.map(t => t.label)]);
    if (sig === barSignature) return;
    barSignature = sig;
    tabsEl.textContent = '';
    tabs.forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.title = t.label;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(!showAll && i === idx));
      if (t.intro) b.classList.add('intro');
      b.addEventListener('click', () => selectTab(i));
      tabsEl.appendChild(b);
      if (!showAll && i === idx) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    allBtn.setAttribute('aria-selected', String(showAll));
  }

  function selectTab(i) {
    const t = tabs[i];
    if (!t) return;
    showAll = false;
    activeKey = t.intro ? 'intro' : t.h1;
    lastIndex = i;
    // Move the caret into the selected tab so typing never lands in hidden content
    const target = t.h1 || t.blocks[0];
    root.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    apply();
    target.scrollIntoView({ block: 'start' });
  }

  allBtn.addEventListener('click', () => { showAll = !showAll; apply(); });

  // ---------- Events ----------
  // Switch tabs when the caret moves into another tab (new "# " heading, Outline click, search, etc.)
  document.addEventListener('selectionchange', () => {
    if (!root || showAll || !tabs.length) return;
    const i = caretTabIndex();
    if (i !== -1 && i !== lastIndex) schedule();
  });

  // Ctrl/Cmd+A selects only the visible tab, so a select-all + delete can't wipe hidden tabs
  window.addEventListener('keydown', e => {
    if (!root || showAll || !tabs.length) return;
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'a') return;
    if (!root.contains(document.activeElement) && document.activeElement !== root) return;
    const t = tabs[lastIndex];
    if (!t) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const first = t.blocks[0], last = t.blocks[t.blocks.length - 1];
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, true);

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();
