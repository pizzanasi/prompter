(() => {
  'use strict';

  // Bridge from preload.js; missing when index.html is opened in a normal browser.
  const api = window.prompter || null;
  const I18N = window.PROMPTER_I18N;
  const $ = (id) => document.getElementById(id);

  const SETTINGS_KEY = 'prompter.settings.v1';
  const SCRIPT_KEY = 'prompter.script.v1';
  const SEEN_KEY = 'prompter.seenIntro.v1';

  const SPEED_MIN = 1;
  const SPEED_MAX = 30;
  // Scroll rate in px/s = speed × fontSize × SPEED_K, so a given speed reads
  // at roughly the same pace whatever the text size.
  const SPEED_K = 0.1;
  const WORDS_PER_MINUTE = 140;

  const DEFAULTS = {
    lang: /^id\b/i.test(navigator.language || '') ? 'id' : 'en',
    speed: 5,
    fontSize: window.innerWidth < 600 ? 34 : 56, // phones get a size that fits a few words per line
    lineHeight: 1.45,
    width: 90,
    fontFamily: 'sans',
    fontWeight: '600',
    align: 'center',
    textColor: '#ffffff',
    outline: true,
    bgColor: '#000000',
    bgOpacity: 55,
    showGuide: true,
    guidePos: 33,
    fade: true,
    mirror: false,
    alwaysOnTop: true,
    hideFromCapture: false,
  };

  const FONTS = {
    sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
  };

  const FORMAT = {
    fontSize: (v) => `${v}px`,
    lineHeight: (v) => `${Number(v).toFixed(2)}×`,
    width: (v) => `${v}%`,
    bgOpacity: (v) => `${v}%`,
    guidePos: (v) => `${v}%`,
  };

  const WINDOW_KEYS = new Set(['alwaysOnTop', 'hideFromCapture']);

  const store = {
    load(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    save(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage unavailable: settings just won't survive a restart.
      }
    },
  };

  const saved = store.load(SETTINGS_KEY, {});
  const settings = { ...DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!I18N[settings.lang]) settings.lang = DEFAULTS.lang;
  // null until the user saves their own script; until then the sample follows the UI language.
  let customScript = store.load(SCRIPT_KEY, null);
  if (typeof customScript !== 'string') customScript = null;
  const currentScript = () => customScript ?? t('script.sample');

  function t(key, vars = {}) {
    const text = I18N[settings.lang]?.[key] ?? I18N.en[key] ?? key;
    return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
  }

  const el = {
    frame: $('frame'),
    bar: $('bar'),
    stage: $('stage'),
    scroller: $('scroller'),
    content: $('content'),
    progress: document.querySelector('#progress > div'),
    hud: $('hud'),
    status: $('status'),
    editorText: $('editorText'),
    wordCount: $('wordCount'),
    fileInput: $('fileInput'),
  };
  const panels = { editor: $('editor'), settings: $('settings'), help: $('help') };
  const controls = [...document.querySelectorAll('[data-key]')];

  let playing = false;
  let pos = 0;     // px scrolled; 0 puts the first line on the reading guide
  let nudge = 0;   // pending manual movement, eased in over the next frames
  let maxPos = 0;  // pos at which the last line sits on the guide
  let lineH = 0;
  let stageH = 0;
  let lastT = 0;
  let drawnPos = null;
  let openPanel = null;
  let frameWin = window; // the window showing the prompter: this tab, or the floating one
  let pipWin = null;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Timers follow the prompter too; a background tab's timers get throttled.
  function later(fn, ms) {
    const w = frameWin;
    const id = w.setTimeout(fn, ms);
    return () => {
      try {
        w.clearTimeout(id);
      } catch {
        // That window is already closed, and its timers with it.
      }
    };
  }

  function hexToRgba(hex, alpha) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex) || [null, '000000'];
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  // ---------- Layout ----------

  function applySettings() {
    const s = settings;
    const root = document.documentElement.style;
    root.setProperty('--font-size', `${s.fontSize}px`);
    root.setProperty('--line-height', String(s.lineHeight));
    root.setProperty('--font', FONTS[s.fontFamily] || FONTS.sans);
    root.setProperty('--weight', String(s.fontWeight));
    root.setProperty('--text-width', `${s.width}%`);
    root.setProperty('--align', s.align);
    root.setProperty('--text-color', s.textColor);
    // Keep a sliver of alpha: fully transparent pixels can let clicks fall
    // through to whatever window is behind.
    root.setProperty('--bg', hexToRgba(s.bgColor, Math.max(0.01, s.bgOpacity / 100)));

    const cls = document.body.classList;
    cls.toggle('outline', s.outline);
    cls.toggle('no-guide', !s.showGuide);
    cls.toggle('fade', s.fade);
    cls.toggle('mirror', s.mirror);
    measure();
  }

  function applyWindowSettings() {
    api?.setAlwaysOnTop(settings.alwaysOnTop);
    api?.setContentProtection(settings.hideFromCapture);
  }

  function measure() {
    const ratio = maxPos > 0 ? pos / maxPos : 0;
    stageH = el.stage.clientHeight;
    lineH = settings.fontSize * settings.lineHeight;
    const guideY = stageH * settings.guidePos / 100;

    el.scroller.style.paddingTop = `${guideY - lineH / 2}px`;
    el.scroller.style.paddingBottom = `${stageH}px`;
    const root = document.documentElement.style;
    root.setProperty('--guide-y', `${guideY}px`);
    root.setProperty('--line-px', `${lineH}px`);

    maxPos = Math.max(0, el.content.offsetHeight - lineH);
    pos = ratio * maxPos;
    drawnPos = null;
  }

  function renderScript() {
    const frag = document.createDocumentFragment();
    const text = currentScript().replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '');

    if (!text) {
      const div = document.createElement('div');
      div.className = 'line para placeholder';
      div.textContent = t('script.empty');
      frag.appendChild(div);
    } else {
      let prevBlank = true;
      for (const line of text.split('\n')) {
        const blank = line.trim() === '';
        const div = document.createElement('div');
        div.className = blank ? 'line blank' : prevBlank ? 'line para' : 'line';
        div.textContent = blank ? ' ' : line;
        frag.appendChild(div);
        prevBlank = blank;
      }
    }

    el.content.replaceChildren(frag);
    pos = 0;
    nudge = 0;
    maxPos = 0;
    measure();
  }

  // ---------- Motion ----------

  // The animation runs on whichever window shows the prompter: a hidden tab
  // stops its own frames, but the floating window keeps going.
  let loopId = 0;
  function startLoop() {
    const id = ++loopId;
    const w = frameWin;
    lastT = 0;
    drawnPos = null;
    const step = () => {
      if (id !== loopId) return;
      // Schedule first so one bad frame can never stop the prompter for good.
      w.requestAnimationFrame(step);
      tick(performance.now());
    };
    w.requestAnimationFrame(step);
  }

  function tick(now) {
    const dt = lastT ? clamp((now - lastT) / 1000, 0, 0.05) : 0;
    lastT = now;

    if (playing) pos += settings.speed * settings.fontSize * SPEED_K * dt;
    if (nudge !== 0) {
      const step = Math.abs(nudge) < 0.5 ? nudge : nudge * Math.min(1, dt * 14);
      pos += step;
      nudge -= step;
    }

    if (pos <= 0) {
      pos = 0;
      if (nudge < 0) nudge = 0;
    }
    if (pos >= maxPos) {
      pos = maxPos;
      if (nudge > 0) nudge = 0;
      if (playing) {
        setPlaying(false);
        showHud(t('hud.done'));
      }
    }

    if (pos !== drawnPos) {
      drawnPos = pos;
      el.scroller.style.transform = `translate3d(0, ${-pos}px, 0)`;
      el.progress.style.transform = `scaleX(${maxPos > 0 ? pos / maxPos : 0})`;
    }
  }

  function setPlaying(on) {
    if (on && pos >= maxPos - 1) {
      pos = 0;
      nudge = 0;
    }
    playing = on;
    document.body.classList.toggle('playing', on);
    updateStatus();
  }

  function togglePlay() {
    setPlaying(!playing);
    showHud(playing ? t('hud.playing', { speed: settings.speed }) : t('hud.paused'));
  }

  function changeSpeed(delta) {
    const next = clamp(settings.speed + delta, SPEED_MIN, SPEED_MAX);
    if (next === settings.speed) {
      showHud(t(delta > 0 ? 'hud.speedMax' : 'hud.speedMin', { speed: next }));
      return;
    }
    settings.speed = next;
    settingChanged('speed');
    showHud(t('hud.speed', { speed: next }));
  }

  function goTo(target) {
    nudge = clamp(target, 0, maxPos) - pos;
  }

  function jumpParagraph(dir) {
    const current = pos + nudge;
    const tops = [...el.content.querySelectorAll('.para')].map((p) => p.offsetTop);
    const dest = dir > 0
      ? tops.find((top) => top > current + 2)
      : tops.reverse().find((top) => top < current - 2);
    goTo(dest ?? (dir > 0 ? maxPos : 0));
  }

  // ---------- UI ----------

  let cancelHud = () => {};
  function showHud(text, ms = 1300) {
    el.hud.textContent = text;
    el.hud.classList.add('show');
    cancelHud();
    cancelHud = later(() => el.hud.classList.remove('show'), ms);
  }

  function updateStatus() {
    el.status.textContent = t(playing ? 'status.playing' : 'status.paused', { speed: settings.speed });
  }

  function syncControls() {
    for (const c of controls) {
      const key = c.dataset.key;
      const value = settings[key];
      if (c.type === 'checkbox') c.checked = !!value;
      else c.value = String(value);
      const out = el.frame.querySelector(`output[data-for="${key}"]`);
      if (out) out.textContent = FORMAT[key] ? FORMAT[key](value) : String(value);
    }
  }

  function applyLanguage() {
    document.documentElement.lang = settings.lang;
    // Query from the document root: the pip notice lives outside the frame.
    const nodes = (sel) => [...document.querySelectorAll(sel), ...(pipWin ? el.frame.querySelectorAll(sel) : [])];
    for (const n of nodes('[data-i18n]')) n.textContent = t(n.dataset.i18n);
    for (const n of nodes('[data-i18n-title]')) n.title = t(n.dataset.i18nTitle);
    for (const n of nodes('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
  }

  function settingChanged(key) {
    applySettings();
    if (WINDOW_KEYS.has(key)) applyWindowSettings();
    if (key === 'lang') {
      applyLanguage();
      if (customScript == null) renderScript(); // the sample script is translated too
    }
    store.save(SETTINGS_KEY, settings);
    syncControls();
    updateStatus();
  }

  function setPanel(name) {
    for (const [key, node] of Object.entries(panels)) node.hidden = key !== name;
    openPanel = name;
    document.body.classList.toggle('panel-open', !!name);

    if (name === 'editor') {
      setPlaying(false);
      el.editorText.value = currentScript();
      updateWordCount();
      el.editorText.focus();
      el.editorText.setSelectionRange(0, 0);
      el.editorText.scrollTop = 0;
    } else {
      // Hand the keyboard back to the prompter.
      el.frame.ownerDocument.activeElement?.blur?.();
    }
  }

  const togglePanel = (name) => setPanel(openPanel === name ? null : name);

  function updateWordCount() {
    const words = (el.editorText.value.match(/\S+/g) || []).length;
    const minutes = words / WORDS_PER_MINUTE;
    const duration = minutes < 1
      ? t('editor.seconds', { n: Math.max(1, Math.round(minutes * 60)) })
      : t('editor.minutes', { n: minutes.toFixed(1) });
    el.wordCount.textContent = words ? t('editor.count', { words, duration }) : '';
  }

  function saveScript(text) {
    customScript = text;
    store.save(SCRIPT_KEY, customScript);
    renderScript();
  }

  function saveEditor() {
    saveScript(el.editorText.value);
    setPanel(null);
    showHud(t('hud.saved'));
  }

  const isTextFile = (file) =>
    /^text\//.test(file.type) || /\.(txt|md|markdown|text)$/i.test(file.name);

  async function loadFile(file) {
    if (!file) return;
    if (!isTextFile(file)) {
      showHud(t('hud.notText'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showHud(t('hud.tooBig'));
      return;
    }
    const text = await file.text();
    if (openPanel === 'editor') {
      el.editorText.value = text;
      updateWordCount();
    } else {
      setPlaying(false);
      saveScript(text);
      showHud(t('hud.loaded', { name: file.name }), 2000);
    }
  }

  // Bar + window edge fade out when the mouse sits still, so they don't cover the text.
  let cancelIdle = () => {};
  function wakeUi() {
    document.body.classList.add('ui-active');
    cancelIdle();
    cancelIdle = later(sleepUi, 2500);
  }
  function sleepUi() {
    if (el.bar.querySelector('.actions:hover')) return wakeUi();
    document.body.classList.remove('ui-active');
  }

  // ---------- Input ----------

  const isTyping = (target) =>
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && /^(text|search|number|email|url)$/.test(target.type));

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (openPanel) {
        e.preventDefault();
        setPanel(null);
      }
      return;
    }
    if (openPanel === 'editor') {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEditor();
      }
      return;
    }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case ' ':
        if (!e.repeat) togglePlay();
        break;
      case 'ArrowDown':
        playing ? changeSpeed(+1) : (nudge += lineH);
        break;
      case 'ArrowUp':
        playing ? changeSpeed(-1) : (nudge -= lineH);
        break;
      case 'ArrowRight': jumpParagraph(+1); break;
      case 'ArrowLeft': jumpParagraph(-1); break;
      case 'PageDown': nudge += stageH * 0.7; break;
      case 'PageUp': nudge -= stageH * 0.7; break;
      case 'Home': goTo(0); break;
      case 'End': goTo(maxPos); break;
      case '+':
      case '=':
        settings.fontSize = clamp(settings.fontSize + 4, 18, 160);
        settingChanged('fontSize');
        showHud(t('hud.fontSize', { size: settings.fontSize }));
        break;
      case '-':
      case '_':
        settings.fontSize = clamp(settings.fontSize - 4, 18, 160);
        settingChanged('fontSize');
        showHud(t('hud.fontSize', { size: settings.fontSize }));
        break;
      case 'm':
      case 'M':
        settings.mirror = !settings.mirror;
        settingChanged('mirror');
        showHud(t(settings.mirror ? 'hud.mirrorOn' : 'hud.mirrorOff'));
        break;
      case 'e':
      case 'E': setPanel('editor'); break;
      case 's':
      case 'S': togglePanel('settings'); break;
      case 'h':
      case 'H':
      case '?':
      case 'F1': togglePanel('help'); break;
      case 'f':
      case 'F':
        if (api) return; // the desktop window has its own size handles
        toggleFullscreen();
        break;
      case 'l':
      case 'L':
        settings.lang = settings.lang === 'id' ? 'en' : 'id';
        settingChanged('lang');
        showHud(t('hud.language'));
        break;
      case 'p':
      case 'P':
        if (api) return; // the desktop app already floats
        togglePip();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // Phones and tablets have no arrow keys: let a finger drag the text directly.
  let touchY = null;
  el.stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    touchY = e.clientY;
    try {
      el.stage.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone; the drag still works while the finger stays on the stage.
    }
  });
  el.stage.addEventListener('pointermove', (e) => {
    if (touchY == null) return;
    pos += touchY - e.clientY;
    nudge = 0;
    touchY = e.clientY;
  });
  const endTouch = () => { touchY = null; };
  el.stage.addEventListener('pointerup', endTouch);
  el.stage.addEventListener('pointercancel', endTouch);

  el.frame.addEventListener('wheel', (e) => {
    if (e.target instanceof Element && e.target.closest('.panel')) return;
    e.preventDefault();
    nudge += e.deltaMode === 1 ? e.deltaY * lineH * 0.4 : e.deltaY;
  }, { passive: false });

  for (const c of controls) {
    c.addEventListener('input', () => {
      const key = c.dataset.key;
      settings[key] = c.type === 'checkbox' ? c.checked : c.type === 'range' ? Number(c.value) : c.value;
      settingChanged(key);
    });
    // Mouse-driven controls shouldn't keep focus, or they'd swallow Space/arrows.
    if (c.type !== 'range') c.addEventListener('change', () => c.blur());
    else c.addEventListener('pointerup', () => c.blur());
  }

  // Listeners that belong to a window rather than an element. Bound to this tab
  // at startup and again to the floating window each time it opens.
  function bindWindow(w) {
    const doc = w.document;
    w.addEventListener('keydown', onKeyDown);
    w.addEventListener('resize', measure);
    w.addEventListener('dragover', (e) => e.preventDefault());
    w.addEventListener('drop', (e) => {
      e.preventDefault();
      loadFile(e.dataTransfer?.files[0]);
    });
    doc.addEventListener('mousemove', wakeUi);
    doc.addEventListener('pointerdown', wakeUi); // covers taps on touch screens too
    doc.documentElement.addEventListener('mouseleave', () => {
      cancelIdle();
      cancelIdle = later(sleepUi, 700);
    });
    // Buttons shouldn't keep focus (a focused button would also "click" on Space).
    doc.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('button');
      if (btn) btn.blur();
    });
  }

  // ---------- Floating window (web) ----------
  // Browsers can't draw a see-through window over other apps, but Chrome and
  // Edge can open an always-on-top "picture-in-picture" window holding any page
  // content. The prompter moves into it and back, keeping all its state.

  const canPip = !api && 'documentPictureInPicture' in window;
  let stopSync = () => {};

  async function togglePip() {
    if (pipWin) {
      pipWin.close();
      return;
    }
    if (!canPip) {
      showHud(t('hud.pipUnsupported'), 3500);
      return;
    }
    let w;
    try {
      w = await window.documentPictureInPicture.requestWindow({ width: 760, height: 300 });
    } catch {
      showHud(t('hud.pipUnsupported'), 3500);
      return;
    }
    pipWin = w;
    const doc = w.document;
    doc.title = 'Prompter';
    for (const sheet of document.styleSheets) {
      const style = doc.createElement('style');
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
      doc.head.append(style);
    }

    // State lives on this tab's <html> (CSS variables) and <body> (classes); mirror it.
    const sync = () => {
      doc.documentElement.style.cssText = document.documentElement.style.cssText;
      doc.documentElement.lang = document.documentElement.lang;
      doc.body.className = `${document.body.className} in-pip`;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'lang'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    stopSync = () => observer.disconnect();

    document.body.classList.add('pip-open');
    doc.body.append(el.frame);
    sync();
    bindWindow(w);
    frameWin = w;
    startLoop();
    measure();
    w.focus();
    w.addEventListener('pagehide', closePip, { once: true });
  }

  function closePip() {
    stopSync();
    document.body.prepend(el.frame);
    document.body.classList.remove('pip-open');
    pipWin = null;
    frameWin = window;
    startLoop();
    measure();
    // Timers that were pending in the closed window died with it.
    el.hud.classList.remove('show');
    wakeUi();
  }

  $('btnPlay').addEventListener('click', togglePlay);
  $('btnEdit').addEventListener('click', () => togglePanel('editor'));
  $('btnSettings').addEventListener('click', () => togglePanel('settings'));
  $('btnHelp').addEventListener('click', () => togglePanel('help'));
  $('btnFullscreen').addEventListener('click', toggleFullscreen);
  $('btnPip').addEventListener('click', togglePip);
  $('btnPipBack').addEventListener('click', togglePip);
  $('btnMin').addEventListener('click', () => api?.minimize());
  $('btnClose').addEventListener('click', () => api?.close());
  $('btnSaveScript').addEventListener('click', saveEditor);
  $('btnOpenFile').addEventListener('click', () => el.fileInput.click());
  $('btnReset').addEventListener('click', () => {
    Object.assign(settings, DEFAULTS, { lang: settings.lang });
    settingChanged('alwaysOnTop'); // a window key, so the window flags get re-applied too
    showHud(t('hud.reset'));
  });
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => setPanel(null));
  }

  el.editorText.addEventListener('input', updateWordCount);
  el.fileInput.addEventListener('change', () => {
    loadFile(el.fileInput.files[0]);
    el.fileInput.value = '';
  });

  bindWindow(window);

  // Resize handles (transparent windows have no native resize border).
  const endResize = () => api?.resizeEnd();
  for (const handle of document.querySelectorAll('.resize')) {
    handle.addEventListener('pointerdown', (e) => {
      if (!api || e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      api.resizeStart(handle.dataset.edge);
    });
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('lostpointercapture', endResize);
  }
  window.addEventListener('blur', endResize);

  // ---------- Start ----------

  if (!api) document.body.classList.add('browser');
  // OBS browser sources render transparent pages, so the opacity setting works there too.
  if (window.obsstudio) document.body.classList.add('obs');
  if (canPip) document.body.classList.add('can-pip');
  applyLanguage();
  syncControls();
  applySettings();
  applyWindowSettings();
  renderScript();
  updateStatus();
  startLoop();
  // Fonts can shift line heights after first layout.
  document.fonts?.ready.then(measure);

  if (!store.load(SEEN_KEY, false)) {
    store.save(SEEN_KEY, true);
    setTimeout(() => showHud(t(canPip ? 'hud.introPip' : 'hud.intro'), 4000), 400);
  }
})();
