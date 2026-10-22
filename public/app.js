'use strict';

/* ============================================================
   МАЙСТЕР — клиент логикасы
   ============================================================ */

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const AVATARS = ['olive', 'avocado', 'fish', 'walnut', 'leaf', 'drop'];
  const MONTHS = [
    'қаңтар',
    'ақпан',
    'наурыз',
    'сәуір',
    'мамыр',
    'маусым',
    'шілде',
    'тамыз',
    'қыркүйек',
    'қазан',
    'қараша',
    'желтоқсан',
  ];
  const WEEKDAYS = ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сн'];
  const ACH_ICONS = {
    seed: 'seed',
    target: 'target',
    flame: 'flame',
    calendar: 'calendar',
    sword: 'swords',
    trophy: 'trophy',
    book: 'book',
    star: 'star',
    medal: 'medal',
  };
  const TIPS = [
    'Май — ең қуатты энергия көзі: 1 г май шамамен 9 ккал береді.',
    'A, D, E, K дәрумендері майда ериді. Сондықтан май олардың сіңуіне көмектеседі.',
    'Омега-3 майлы балықта, зығыр тұқымында және жаңғақта кездеседі. Ол ми мен жүрекке пайдалы.',
    'Ересектер үшін май тәуліктік энергияның шамамен 25–30%-ын құрауы ұсынылады.',
    'Транс-майлар қандағы зиянды LDL холестеринді көтеріп, пайдалы HDL-ді төмендетеді.',
    'Май жарықтан, жылудан және ауадан тез тотығады. Оны қараңғы, салқын жерде сақта.',
  ];
  const nf = new Intl.NumberFormat('kk-KZ');

  const state = {
    user: null,
    achievements: [],
    view: null,
    authTab: 'enter',
    enterAvatar: 'olive',
    nickExists: null,
    profileAvatar: 'olive',
    board: 'xp',
    stats: null,
    intendedHash: null,
    solo: null,
    room: null,
    roomCode: null,
    roomES: null,
    roomPoll: null,
    search: null,
    gameOpen: false,
    gameKind: null,
    tickId: null,
    duelPhase: null,
    duelIndex: null,
    duelQuestionKey: null,
    duelDeadline: null,
    duelCountdownEnd: null,
    duelAnswerSent: false,
    duelFinishedHandled: false,
    duelRevealSoundedFor: null,
    duelResultKey: null,
    resultMode: null,
    sound: true,
    confirmOpen: false,
    revealTimer: null,
  };

  try {
    state.sound = localStorage.getItem('mai_sound') !== 'off';
  } catch {
    state.sound = true;
  }

  /* ------------------------------------------------------------
     Utilities
     ------------------------------------------------------------ */

  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const fmt = (n) => nf.format(Number(n) || 0);
  const icon = (name) =>
    `<svg class="ic" aria-hidden="true"><use href="/assets/icons.svg#${name}"></use></svg>`;
  const avatarSrc = (name) =>
    `/assets/avatar-${AVATARS.includes(name) ? name : 'olive'}.svg`;
  const avatarImg = (name, cls = 'avatar') =>
    `<img class="${cls}" src="${avatarSrc(name)}" alt="" loading="lazy">`;

  function todayKey() {
    return new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function formatDateStamp(ts, short = false) {
    if (!ts) return '—';
    const d = new Date(Number(ts) + 5 * 3600 * 1000);
    if (short) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  function dateToLabel(dateStr) {
    const d = new Date(`${dateStr}T12:00:00+05:00`);
    return WEEKDAYS[d.getUTCDay()];
  }

  function dayOfYear() {
    const d = new Date(Date.now() + 5 * 3600 * 1000);
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    return Math.floor((d.getTime() - start) / 86400000);
  }

  class ApiError extends Error {
    constructor(status, data) {
      super((data && data.error) || 'Белгісіз қате');
      this.name = 'ApiError';
      this.status = status;
      this.code = data && data.code;
      this.data = data || {};
    }
  }

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const headers = { ...(opts.headers || {}) };
    const fetchOpts = { method, headers, credentials: 'same-origin' };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
      fetchOpts.body = JSON.stringify(opts.body ?? {});
    }
    let res;
    try {
      res = await fetch(path, fetchOpts);
    } catch {
      throw new ApiError(0, {
        error: 'Желіге қосылу мүмкін болмады. Интернетті тексеріп, қайталап көр.',
      });
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      if (res.status === 401 && state.user && !path.startsWith('/api/auth/')) {
        handleSessionExpired();
      }
      throw new ApiError(res.status, data);
    }
    return data;
  }

  function toast(message, type = 'info', ms = 3800) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.textContent = type === 'error' ? '!' : type === 'success' ? '✓' : 'i';
    const text = document.createElement('span');
    text.textContent = message;
    el.append(iconEl, text);
    wrap.append(el);
    while (wrap.children.length > 4) wrap.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 240);
    }, ms);
  }

  function askConfirm({ title, text, ok = 'Иә', cancel = 'Болдырмау' }) {
    return new Promise((resolve) => {
      if (state.confirmOpen) {
        resolve(false);
        return;
      }
      const dlg = $('#confirmDialog');
      if (!dlg) {
        resolve(window.confirm(text || title || ''));
        return;
      }
      state.confirmOpen = true;
      $('[data-confirm-title]').textContent = title || 'Растау';
      $('[data-confirm-text]').textContent = text || '';
      $('[data-confirm-ok]').textContent = ok;
      const cancelBtn = dlg.querySelector('button[value="cancel"]');
      if (cancelBtn) cancelBtn.textContent = cancel;
      dlg.returnValue = 'cancel';
      dlg.showModal();
      const onClose = () => {
        state.confirmOpen = false;
        dlg.removeEventListener('close', onClose);
        resolve(dlg.returnValue === 'ok');
      };
      dlg.addEventListener('close', onClose);
    });
  }

  async function withLoading(el, fn) {
    if (!el) return fn();
    el.classList.add('is-loading');
    el.disabled = true;
    try {
      return await fn();
    } finally {
      el.classList.remove('is-loading');
      el.disabled = false;
    }
  }

  function showFormError(key, message) {
    const el = $(`[data-error-for="${key}"]`);
    if (!el) return;
    el.textContent = message || '';
    if (message) {
      el.classList.remove('is-visible');
      void el.offsetWidth;
      el.classList.add('is-visible');
    }
  }

  async function copyText(text, okMessage = 'Көшірілді') {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMessage, 'success');
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        toast(okMessage, 'success');
        return true;
      } catch {
        toast('Көшіру мүмкін болмады. Мәтінді өзің белгілеп көшір.', 'error');
        return false;
      }
    }
  }

  function roomUrl(code) {
    return `${location.origin}${location.pathname}#/room/${code}`;
  }

  function navigate(path) {
    const target = path.startsWith('#') ? path : `#${path}`;
    if (location.hash === target) {
      if (!state.gameOpen) window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    location.hash = target;
  }

  function replaceHash(path) {
    const target = path.startsWith('#') ? path : `#${path}`;
    try {
      history.replaceState(null, '', target);
    } catch {
      location.hash = target;
    }
  }

  /* ------------------------------------------------------------
     Sound
     ------------------------------------------------------------ */

  let audioCtx = null;

  function tone(freq, delay, duration, type = 'sine', volume = 0.035) {
    if (!state.sound) return;
    if (navigator.userActivation && navigator.userActivation.hasBeenActive === false) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const t = audioCtx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.03);
    } catch {
      /* дыбыс қосылмаса — ойын жалғасады */
    }
  }

  const sfxCorrect = () => {
    tone(660, 0, 0.16, 'sine', 0.04);
    tone(880, 0.08, 0.22, 'sine', 0.035);
  };
  const sfxWrong = () => {
    tone(220, 0, 0.22, 'triangle', 0.04);
    tone(164, 0.1, 0.26, 'triangle', 0.03);
  };
  const sfxStart = () => {
    tone(392, 0, 0.11, 'sine', 0.03);
    tone(523, 0.1, 0.16, 'sine', 0.03);
  };
  const sfxFinish = () => {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.11, 0.32, 'sine', 0.03));
  };
  const sfxClick = () => tone(520, 0, 0.05, 'sine', 0.018);

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function bumpText(el) {
    if (!el || prefersReducedMotion()) return;
    el.classList.remove('is-bumped');
    void el.offsetWidth;
    el.classList.add('is-bumped');
    setTimeout(() => el.classList.remove('is-bumped'), 560);
  }

  function animateNumber(el, target, duration = 1000) {
    if (!el) return;
    if (prefersReducedMotion()) {
      el.textContent = fmt(target);
      return;
    }
    const start = performance.now();
    const value = Number(target) || 0;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = (t) => {
      const p = Math.min(1, (t - start) / duration);
      el.textContent = fmt(Math.round(value * ease(p)));
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = fmt(value);
    };
    el.textContent = '0';
    requestAnimationFrame(frame);
  }

  function gameFlash(correct) {
    const flash = $('#fxFlash');
    if (!flash) return;
    flash.className = 'fx-flash';
    void flash.offsetWidth;
    flash.classList.add(correct ? 'is-good' : 'is-bad');
    setTimeout(() => {
      flash.className = 'fx-flash';
    }, 780);
    if (!correct && !prefersReducedMotion()) {
      const stage = $('#gameStage');
      if (stage) {
        stage.classList.remove('fx-wrong');
        void stage.offsetWidth;
        stage.classList.add('fx-wrong');
        setTimeout(() => stage.classList.remove('fx-wrong'), 540);
      }
    }
  }

  function floatPoints(message, muted = false) {
    if (!state.gameOpen || prefersReducedMotion()) return;
    const el = document.createElement('div');
    el.className = `float-points${muted ? ' is-muted' : ''}`;
    el.textContent = message;
    el.style.left = `${46 + Math.random() * 8}%`;
    document.body.append(el);
    setTimeout(() => el.remove(), 1200);
  }

  function sparkBurst(target) {
    if (prefersReducedMotion()) return;
    const rect = target?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight * 0.45;
    const burst = document.createElement('div');
    burst.className = 'burst';
    burst.style.left = `${x}px`;
    burst.style.top = `${y}px`;
    const colors = ['#e8b44a', '#f4d68e', '#8aae55', '#f3ead8'];
    for (let i = 0; i < 14; i++) {
      const piece = document.createElement('i');
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.35;
      const distance = 26 + Math.random() * 56;
      piece.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
      piece.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 90}ms`;
      burst.append(piece);
    }
    document.body.append(burst);
    setTimeout(() => burst.remove(), 950);
  }

  function setupHeroTilt() {
    const wrap = $('.hero-art');
    const card = $('.hero-art .art-card');
    if (!wrap || !card) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    wrap.addEventListener('pointermove', (event) => {
      if (prefersReducedMotion()) return;
      const r = wrap.getBoundingClientRect();
      const px = (event.clientX - r.left) / Math.max(1, r.width) - 0.5;
      const py = (event.clientY - r.top) / Math.max(1, r.height) - 0.5;
      card.style.transform = `perspective(1100px) rotateX(${(-py * 4.2).toFixed(2)}deg) rotateY(${(px * 6.4).toFixed(2)}deg) translateY(-2px)`;
    });
    wrap.addEventListener('pointerleave', () => {
      card.style.transform = '';
    });
  }

  function updateScrollProgress() {
    const bar = $('#scrollProgress');
    if (!bar) return;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${progress})`;
  }

  function unlockAudio() {
    if (!state.sound) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch {
      /* үнсіз */
    }
  }

  function syncSoundButton() {
    const btn = $('[data-sound-btn]');
    if (!btn) return;
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', `/assets/icons.svg#${state.sound ? 'sound-on' : 'sound-off'}`);
    btn.setAttribute('aria-label', state.sound ? 'Дыбысты өшіру' : 'Дыбысты қосу');
    btn.title = state.sound ? 'Дыбыс қосулы' : 'Дыбыс өшірулі';
  }

  function toggleSound() {
    state.sound = !state.sound;
    try {
      localStorage.setItem('mai_sound', state.sound ? 'on' : 'off');
    } catch {}
    syncSoundButton();
    if (state.sound) sfxClick();
    toast(state.sound ? 'Дыбыс қосылды' : 'Дыбыс өшірілді', 'info', 2000);
  }

  /* ------------------------------------------------------------
     Header / stats
     ------------------------------------------------------------ */

  function updateHeader() {
    document.body.classList.toggle('is-auth', Boolean(state.user));
    const u = state.user;
    $$('[data-header-avatar]').forEach((img) => {
      img.src = u ? avatarSrc(u.avatar) : avatarSrc('olive');
    });
    $$('[data-header-name]').forEach((el) => {
      el.textContent = u ? u.nickname : 'Ойыншы';
    });
    $$('[data-header-level]').forEach((el) => {
      el.textContent = u ? `Деңгей ${u.level}` : 'Деңгей 1';
    });
    const chip = $('.user-chip');
    if (chip) chip.setAttribute('aria-label', u ? `${u.nickname} профилі` : 'Профиль');
    syncSoundButton();
  }

  async function loadStats() {
    try {
      const s = await api('/api/stats');
      state.stats = s;
      $$('[data-live-online]').forEach((el) => (el.textContent = fmt(s.online)));
      $$('[data-stat-questions]').forEach((el) => (el.textContent = fmt(s.questions)));
    } catch {
      /* статистика уақытша болмаса, сайт жалғасады */
    }
  }

  function setActiveNav(name) {
    $$('[data-nav]').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.nav === name);
    });
  }

  function scrollToSection(id) {
    if (document.body.dataset.view !== 'landing') {
      navigate('/play');
      setTimeout(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
      return;
    }
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------------
     Reveal animation
     ------------------------------------------------------------ */

  let revealObserver = null;

  function setupReveals() {
    const els = $$('#view-landing .reveal');
    if (!els.length) return;
    if (revealObserver) revealObserver.disconnect();
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    revealObserver = new IntersectionObserver(
      (entries) => {
        let step = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const delay = step++ * 70;
          setTimeout(() => {
            entry.target.classList.add('in');
            revealObserver?.unobserve(entry.target);
          }, delay);
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -30px' }
    );
    els.forEach((el) => revealObserver.observe(el));
    setTimeout(() => {
      $$('#view-landing .hero .reveal').forEach((el) => el.classList.add('in'));
    }, 120);
  }

  /* ------------------------------------------------------------
     Auth
     ------------------------------------------------------------ */

  let nickLookupTimer = null;
  let nickLookupSeq = 0;

  function setNickState(kind, text) {
    const status = $('#nickStatus');
    if (!status) return;
    status.dataset.state = kind;
    const textEl = $('[data-nick-text]', status);
    if (textEl) textEl.textContent = text;
  }

  function setEnterMode({ exists = null, avatar = null } = {}) {
    state.nickExists = exists;
    const card = $('[data-returning-card]');
    const avatarField = $('[data-enter-avatar-pick]');
    const label = $('[data-enter-label]');
    const panel = $('[data-enter-panel]');
    panel?.classList.remove('is-checking');
    if (exists === true) {
      if (card) {
        card.hidden = false;
        const img = $('[data-returning-avatar]', card);
        if (img) img.src = avatarSrc(avatar || 'olive');
      }
      avatarField?.classList.add('is-away');
      avatarField?.setAttribute('aria-hidden', 'true');
      if (label) label.textContent = 'Профильге кіру';
    } else {
      if (card) card.hidden = true;
      avatarField?.classList.remove('is-away');
      avatarField?.removeAttribute('aria-hidden');
      if (label) label.textContent = exists === false ? 'Профиль ашу' : 'Аренаға кіру';
    }
  }

  function resetEnterForm() {
    clearTimeout(nickLookupTimer);
    nickLookupSeq++;
    state.nickExists = null;
    state.enterAvatar = 'olive';
    const form = $('#enterForm');
    if (form) {
      form.reset();
      $$('.avatar-option', form).forEach((el) => {
        const on = el.dataset.avatar === 'olive';
        el.classList.toggle('is-selected', on);
        el.setAttribute('aria-pressed', String(on));
      });
    }
    setNickState('idle', '3–16 таңба: әріп, сан немесе _');
    setEnterMode();
    showFormError('enter', '');
  }

  function scheduleNickLookup(rawValue) {
    const value = String(rawValue || '').trim();
    clearTimeout(nickLookupTimer);
    showFormError('enter', '');
    if (!value) {
      nickLookupSeq++;
      setNickState('idle', '3–16 таңба: әріп, сан немесе _');
      setEnterMode();
      return;
    }
    if (!validateNickname(value)) {
      nickLookupSeq++;
      setNickState('invalid', '3–16 таңба, кемінде бір әріп; бос орынсыз');
      setEnterMode();
      return;
    }
    setNickState('checking', 'Лақап ат тексерілуде…');
    setEnterMode();
    $('[data-enter-panel]')?.classList.add('is-checking');
    const seq = ++nickLookupSeq;
    nickLookupTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/auth/lookup?nickname=${encodeURIComponent(value)}`, { method: 'GET' });
        if (seq !== nickLookupSeq) return;
        $('[data-enter-panel]')?.classList.remove('is-checking');
        if (!data.valid) {
          setNickState('invalid', 'Бұл лақап ат жарамсыз');
          setEnterMode({ exists: false });
          return;
        }
        if (data.exists) {
          setNickState('found', 'Профиль табылды — қайта оралдың!');
          setEnterMode({ exists: true, avatar: data.avatar });
        } else {
          setNickState('free', 'Бос ат — жаңа профиль ашылады');
          setEnterMode({ exists: false });
        }
      } catch {
        if (seq !== nickLookupSeq) return;
        $('[data-enter-panel]')?.classList.remove('is-checking');
        setNickState('idle', 'Тексеру қолжетімсіз — бәрібір кіруге болады');
        setEnterMode();
      }
    }, 360);
  }

  function setAuthMode(mode, updateHash = true) {
    state.authTab = 'enter';
    if (updateHash && document.body.dataset.view === 'auth') replaceHash('/login');
    resetEnterForm();
  }

  function selectAvatar(button) {
    const picker = button.closest('.avatar-pick');
    if (!picker) return;
    const value = button.dataset.avatar;
    if (!AVATARS.includes(value)) return;
    $$('.avatar-option', picker).forEach((el) => {
      const on = el === button;
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', String(on));
    });
    if (picker.hasAttribute('data-profile-avatar-pick')) {
      state.profileAvatar = value;
    } else if (button.closest('[data-enter-avatar-pick]')) {
      state.enterAvatar = value;
    }
    sfxClick();
  }

  function validateNickname(nickname) {
    return /^(?=.*\p{L})[\p{L}\p{N}_]{3,16}$/u.test(nickname);
  }

  function welcomePlayer(user, created) {
    return new Promise((resolve) => {
      const overlay = $('#welcomeOverlay');
      if (!overlay || prefersReducedMotion()) {
        resolve();
        return;
      }
      const avatar = $('[data-welcome-avatar]', overlay);
      const name = $('[data-welcome-name]', overlay);
      const kicker = $('[data-welcome-kicker]', overlay);
      const sub = $('[data-welcome-sub]', overlay);
      if (avatar) avatar.src = avatarSrc(user.avatar);
      if (name) name.textContent = created ? `Қош келдің, ${user.nickname}!` : `Қайта оралдың, ${user.nickname}!`;
      if (kicker) kicker.textContent = created ? 'Жаңа ойыншы · профиль дайын' : 'Профиль табылды · прогресс сақталған';
      if (sub) {
        sub.textContent = created
          ? 'Арена дайын. Алғашқы сұрақ сені күтіп тұр.'
          : `${fmt(user.xp)} XP · деңгей ${user.level} · жалғастырайық.`;
      }
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('welcome-open');
      sfxStart();
      setTimeout(() => sparkBurst($('.welcome-avatar')), 90);
      setTimeout(() => {
        overlay.classList.remove('is-open');
        document.body.classList.remove('welcome-open');
        setTimeout(() => {
          overlay.setAttribute('aria-hidden', 'true');
          resolve();
        }, 260);
      }, 2200);
    });
  }

  async function handleEnter(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const btn = form.querySelector('[data-submit]');
    const nickname = String(form.elements.nickname.value || '').trim();
    showFormError('enter', '');
    if (!validateNickname(nickname)) {
      showFormError(
        'enter',
        'Лақап ат 3–16 таңбадан тұрып, кемінде бір әріп болуы керек. Бос орынсыз жаз.'
      );
      setNickState('invalid', '3–16 таңба, кемінде бір әріп; бос орынсыз');
      return;
    }
    clearTimeout(nickLookupTimer);
    nickLookupSeq++;
    await withLoading(btn, async () => {
      try {
        const data = await api('/api/auth/enter', {
          method: 'POST',
          body: { nickname, avatar: state.enterAvatar },
        });
        state.user = data.user;
        updateHeader();
        form.reset();
        setEnterMode();
        await welcomePlayer(data.user, Boolean(data.created));
        await afterAuth();
      } catch (err) {
        showFormError('enter', err.message);
        setNickState('invalid', 'Кіру орындалмады — қайта көр');
      }
    });
  }

  async function afterAuth() {
    const intended = state.intendedHash;
    state.intendedHash = null;
    const safeIntended =
      intended && intended.startsWith('#/') && !['#/', '#/login', '#/register'].includes(intended)
        ? intended
        : null;
    if (safeIntended) {
      navigate(safeIntended.slice(1));
    } else {
      navigate('/play');
    }
    loadStats();
  }

  async function doLogout() {
    const ok = await askConfirm({
      title: 'Аккаунттан шығасың ба?',
      text: 'Статистикаң мен марапаттарың сақталады. Қайта кіргенде жалғастырасың.',
      ok: 'Шығу',
    });
    if (!ok) return;
    if (state.roomCode) closeRoom(true);
    closeGameLayer();
    state.solo = null;
    state.gameKind = null;
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch {
      /* cookie тазаланбаса да, интерфейсті шығарамыз */
    }
    state.user = null;
    state.achievements = [];
    updateHeader();
    replaceHash('/');
    await router();
    toast('Аккаунттан шықтың', 'info');
  }

  let sessionExpiredLock = false;
  function handleSessionExpired() {
    if (sessionExpiredLock) return;
    sessionExpiredLock = true;
    if (state.roomCode) closeRoom(false);
    closeGameLayer();
    state.solo = null;
    state.gameKind = null;
    state.user = null;
    state.achievements = [];
    updateHeader();
    replaceHash('/login');
    router();
    toast('Сессия аяқталды. Қайта кір.', 'error');
    setTimeout(() => {
      sessionExpiredLock = false;
    }, 4000);
  }

  /* ------------------------------------------------------------
     Play dashboard
     ------------------------------------------------------------ */

  function paintPlay() {
    const u = state.user;
    if (!u) return;
    $$('[data-user-first]').forEach((el) => (el.textContent = u.nickname.split(' ')[0] || u.nickname));
    $$('[data-level]').forEach((el) => (el.textContent = u.level));
    $$('[data-xp]').forEach((el) => (el.textContent = fmt(u.xp)));
    $$('[data-xp-into]').forEach((el) => (el.textContent = fmt(u.xpInto)));
    $$('[data-xp-need]').forEach((el) => (el.textContent = fmt(u.xpNeed)));
    $$('[data-wins]').forEach((el) => (el.textContent = fmt(u.wins)));
    $$('[data-winrate]').forEach((el) => (el.textContent = u.winRate));
    $$('[data-best]').forEach((el) => (el.textContent = fmt(u.bestSolo)));
    $$('[data-streak]').forEach((el) => (el.textContent = u.streak));
    $$('[data-xp-bar]').forEach((el) => {
      el.style.width = `${Math.min(100, u.xpNeed ? (u.xpInto / u.xpNeed) * 100 : 0)}%`;
    });

    const dailyDone = Boolean(u.dailyDone);
    $$('[data-daily-status]').forEach((el) => {
      el.textContent = dailyDone
        ? `Бүгін өтті · ${fmt(u.dailyScore)} ұпай`
        : 'Бүгін әлі ойналмады';
    });
    $$('[data-daily-badge]').forEach((el) => {
      el.textContent = dailyDone ? 'Күніне 1' : '8 сұрақ';
    });
    $$('[data-daily-text]').forEach((el) => {
      el.textContent = dailyDone
        ? 'Бүгінгі мүмкіндік пайдаланылды. Ертең жаңа сегіз сұрақ пен жаңа мүмкіндік келеді.'
        : 'Барлығына бірдей сегіз сұрақ. Бүгінгі мүмкіндігіңді пайдалан.';
    });
    $$('[data-action="start-daily"]').forEach((btn) => {
      btn.disabled = dailyDone;
      btn.textContent = dailyDone ? 'Бүгін өтті' : 'Сынақтан өту';
      btn.title = dailyDone
        ? 'Күнделікті сынаққа күніне бір мүмкіндік беріледі'
        : 'Күнделікті сынақты бастау';
    });

    const tipIndex = dayOfYear() % TIPS.length;
    $$('[data-tip]').forEach((el) => (el.textContent = TIPS[tipIndex]));
    $$('.tip-index').forEach((el) => (el.textContent = String(tipIndex + 1).padStart(2, '0')));

    setActiveRoomCard(state.user.activeRoom);
  }

  function setActiveRoomCard(code) {
    const card = $('#activeRoomCard');
    if (!card) return;
    card.classList.toggle('hidden', !code);
    if (!code) return;
    const codeEl = card.querySelector('[data-active-code]');
    const link = card.querySelector('[data-active-link]');
    if (codeEl) codeEl.textContent = code;
    if (link) link.setAttribute('href', `#/room/${code}`);
  }

  function renderRecentSide(items) {
    const list = $('[data-recent]');
    if (!list) return;
    list.innerHTML = '';
    if (!items || !items.length) {
      list.innerHTML =
        '<li class="empty-state">Әзірге ойын жоқ. Алғашқы жаттығудан баста!</li>';
      return;
    }
    items.slice(0, 4).forEach((item) => {
      const li = document.createElement('li');
      let mainTitle = 'Жаттығу';
      let meta = `${item.correct}/${item.total} дұрыс · ${formatDateStamp(item.createdAt, true)}`;
      let iconName = 'seed';
      let pill = '';
      if (item.type === 'daily') {
        mainTitle = 'Күнделікті сынақ';
        iconName = 'sun';
      } else if (item.type === 'duel') {
        mainTitle = `Дүэл · ${item.opponent.nickname}`;
        meta = `${formatDateStamp(item.createdAt, true)} · қарсылас ${item.opponentScore} ұпай жинады`;
        iconName = 'swords';
        const label =
          item.result === 'win' ? 'Жеңіс' : item.result === 'loss' ? 'Жеңіліс' : 'Тең';
        pill = `<span class="result-pill ${item.result}">${label}</span>`;
      }
      li.innerHTML = `
        <span class="recent-icon">${icon(iconName)}</span>
        <span class="recent-main"><strong>${esc(mainTitle)}</strong><span>${esc(meta)}</span></span>
        <span class="recent-score">${fmt(item.score)} ${pill}</span>
      `;
      list.append(li);
    });
  }

  async function loadPlay() {
    if (!state.user) return;
    paintPlay();
    const u = state.user;
    const dailyBtn = $('[data-action="start-daily"]');
    if (dailyBtn && u.dailyDone) dailyBtn.disabled = true;
    try {
      const [me, profile] = await Promise.all([api('/api/me'), api('/api/profile')]);
      if (document.body.dataset.view !== 'play') {
        state.user = me.user;
        updateHeader();
        return;
      }
      state.user = me.user;
      state.achievements = me.achievements;
      state.user.activeRoom = me.activeRoom;
      updateHeader();
      paintPlay();
      renderRecentSide(profile.recent);
      setActiveRoomCard(me.activeRoom);
    } catch (err) {
      if (err.status !== 401) toast(err.message, 'error');
    }
  }

  async function fetchMeSilently() {
    try {
      const me = await api('/api/me');
      state.user = me.user;
      state.achievements = me.achievements;
      state.user.activeRoom = me.activeRoom;
      updateHeader();
      if (document.body.dataset.view === 'play') paintPlay();
    } catch {
      /* үнсіз */
    }
  }

  /* ------------------------------------------------------------
     Solo / daily game
     ------------------------------------------------------------ */

  async function startSolo(mode, button) {
    if (!state.user) {
      state.intendedHash = '#/play';
      navigate('/login');
      return;
    }
    if (mode === 'daily') {
      if (state.user.dailyDone) {
        await askConfirm({
          title: 'Бүгінгі сынақ өтілді',
          text: `Бүгін ${fmt(state.user.dailyScore)} ұпай жинадың. Жаңа мүмкіндік ертең пайда болады.`,
          ok: 'Түсіндім',
          cancel: 'Жабу',
        });
        return;
      }
      const ok = await askConfirm({
        title: 'Күнделікті сынақты бастайсың ба?',
        text: 'Барлығына бірдей 8 сұрақ. Күніне тек бір мүмкіндік бар: бастаған соң тоқтатсаң, бүгінгі мүмкіндік пайдаланылды деп саналады.',
        ok: 'Бастау',
      });
      if (!ok) return;
    }
    await withLoading(button, async () => {
      try {
        const data = await api('/api/solo/start', { method: 'POST', body: { mode } });
        if (mode === 'daily') {
          state.user.dailyDone = true;
          state.user.dailyDate = todayKey();
          paintPlay();
        }
        state.solo = {
          kind: mode,
          runId: data.runId,
          index: data.index,
          total: data.total,
          q: data.question,
          limitMs: data.limitMs,
          deadline: Date.now() + data.limitMs - 450,
          locked: false,
          reveal: null,
          finished: false,
          summary: null,
        };
        state.gameKind = 'solo';
        state.duelPhase = null;
        openGameLayer();
        renderSoloQuestion();
        sfxStart();
      } catch (err) {
        if (err.code === 'DAILY_DONE') {
          state.user.dailyDone = true;
          paintPlay();
          await fetchMeSilently();
        }
        toast(err.message, 'error');
      }
    });
  }

  function openGameLayer() {
    const layer = $('#gameLayer');
    if (!layer) return;
    layer.classList.add('open');
    layer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('game-open');
    state.gameOpen = true;
    $('#feedback')?.classList.add('hidden');
    $('#waiting')?.classList.add('hidden');
    syncSoundButton();
    startTick();
    window.scrollTo(0, 0);
  }

  function closeGameLayer() {
    const layer = $('#gameLayer');
    if (!layer) return;
    layer.classList.remove('open');
    layer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('game-open');
    state.gameOpen = false;
    stopTick();
    removeConfetti();
    $('#feedback')?.classList.add('hidden');
    $('#waiting')?.classList.add('hidden');
    requestAnimationFrame(updateScrollProgress);
  }

  function renderProgress(index1, total) {
    const wrap = $('[data-progress-dots]');
    if (!wrap) return;
    const parts = [];
    for (let i = 0; i < total; i++) {
      const cls = i + 1 === index1 ? 'p-dot is-active' : i + 1 < index1 ? 'p-dot is-done' : 'p-dot';
      parts.push(`<span class="${cls}"></span>`);
    }
    wrap.innerHTML = parts.join('');
  }

  function buildAnswers(options) {
    const wrap = $('[data-answers]');
    if (!wrap) return;
    wrap.innerHTML = '';
    options.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'answer';
      btn.dataset.choice = String(i);
      const key = document.createElement('span');
      key.className = 'answer-key';
      key.textContent = String(i + 1);
      const span = document.createElement('span');
      span.className = 'answer-text';
      span.textContent = text;
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      mark.setAttribute('class', 'answer-mark ic');
      mark.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '/assets/icons.svg#check');
      mark.append(use);
      btn.append(key, span, mark);
      wrap.append(btn);
    });
  }

  function setTimerVisual(remaining, limit, active) {
    const arc = $('#timerArc');
    const num = $('[data-time]');
    const ring = $('#timerRing');
    if (!arc || !num || !ring) return;
    const ratio = Math.max(0, Math.min(1, remaining / Math.max(1, limit)));
    arc.style.strokeDashoffset = String(282.74 * (1 - ratio));
    num.textContent = String(Math.max(0, Math.ceil(remaining / 1000)));
    ring.classList.toggle('is-urgent', Boolean(active) && remaining > 0 && remaining <= 5000);
  }

  function startTick() {
    stopTick();
    state.tickId = setInterval(tick, 100);
    tick();
  }

  function stopTick() {
    if (state.tickId) {
      clearInterval(state.tickId);
      state.tickId = null;
    }
  }

  function tick() {
    if (!state.gameOpen) return;
    if (state.gameKind === 'solo') tickSolo();
    else if (state.gameKind === 'duel') tickDuel();
  }

  function tickSolo() {
    const s = state.solo;
    if (!s || s.finished || s.reveal || s.locked || !s.deadline) return;
    const remaining = Math.max(0, s.deadline - Date.now());
    setTimerVisual(remaining, s.limitMs, true);
    if (remaining <= 0) {
      submitSoloAnswer(null);
    }
  }

  function tickDuel() {
    if (state.duelPhase === 'countdown' && state.duelCountdownEnd) {
      const el = $('[data-countdown]');
      if (el) {
        const sec = Math.max(1, Math.min(3, Math.ceil((state.duelCountdownEnd - Date.now()) / 1000)));
        if (el.textContent !== String(sec)) {
          el.textContent = String(sec);
          el.classList.remove('is-tick');
          void el.offsetWidth;
          el.classList.add('is-tick');
        }
      }
      return;
    }
    const room = state.room;
    if (!room || room.status !== 'playing' || room.phase !== 'question') return;
    if (!state.duelDeadline) return;
    const remaining = Math.max(0, state.duelDeadline - Date.now());
    setTimerVisual(remaining, room.limitMs || 15000, !state.duelAnswerSent);
  }

  function renderSoloQuestion() {
    const s = state.solo;
    if (!s || !s.q) return;
    const layer = $('#gameLayer');
    if (!layer) return;
    $('#gameStage').classList.remove('hidden');
    $('#resultStage').classList.add('hidden');
    $('#countdownStage').classList.add('hidden');
    const duelBar = $('#duelBar');
    if (duelBar) duelBar.classList.add('hidden');
    $('[data-game-mode]').textContent =
      s.kind === 'daily' ? 'Күнделікті сынақ · 8 сұрақ' : 'Жаттығу · 10 сұрақ';
    renderProgress(s.index + 1, s.total);
    $('[data-q-cat]').textContent = s.q.cat;
    $('[data-q-count]').textContent = `${s.index + 1} / ${s.total}`;
    $('[data-question]').textContent = s.q.q;
    buildAnswers(s.q.options);
    $('#feedback').classList.add('hidden');
    $('#waiting').classList.add('hidden');
    ensureSoloScoreChip();
    updateSoloScoreChip();
    setTimerVisual(s.limitMs, s.limitMs, true);
    sfxClick();
  }

  function ensureSoloScoreChip() {
    const meta = $('.q-meta');
    if (!meta) return;
    if (!meta.querySelector('[data-q-score]')) {
      const chip = document.createElement('span');
      chip.className = 'q-score';
      chip.setAttribute('data-q-score', '');
      meta.append(chip);
    }
  }

  function updateSoloScoreChip() {
    const chip = $('[data-q-score]');
    if (!chip || !state.solo) return;
    const s = state.solo;
    chip.textContent =
      s.streak > 0 ? `${fmt(s.score)} ұпай · ${s.streak} серия` : `${fmt(s.score)} ұпай`;
  }

  function markAnswers(correctIndex, choice) {
    $$('#gameStage .answer').forEach((btn, i) => {
      btn.disabled = true;
      btn.classList.remove('is-selected');
      const use = btn.querySelector('use');
      if (i === correctIndex) {
        btn.classList.add('is-correct');
        if (use) use.setAttribute('href', '/assets/icons.svg#check');
      } else if (choice != null && i === choice) {
        btn.classList.add('is-wrong');
        if (use) use.setAttribute('href', '/assets/icons.svg#x');
      } else {
        btn.classList.add('is-dim');
      }
    });
  }

  function showFeedback({ correct, correctIndex, choice, fact, points, timedOut, nextLabel }) {
    markAnswers(correctIndex, choice);
    const fb = $('#feedback');
    if (!fb) return;
    gameFlash(correct);
    if (correct) {
      const scoreEl = $('[data-q-score]') || $('[data-duel-my-score]');
      bumpText(scoreEl);
      floatPoints(`+${fmt(points)}`);
      sparkBurst($('#gameStage .answer.is-correct'));
    } else if (timedOut) {
      floatPoints('Уақыт бітті', true);
    }
    fb.classList.remove('hidden');
    fb.classList.toggle('is-wrong', !correct);
    const title = $('[data-feedback-title]');
    const pts = $('[data-feedback-points]');
    const factEl = $('[data-feedback-fact]');
    const iconUse = $('[data-feedback-icon] use');
    title.textContent = correct ? 'Дұрыс!' : timedOut ? 'Уақыт бітті' : 'Қате жауап';
    pts.textContent = correct
      ? `+${fmt(points)} ұпай`
      : '0 ұпай · дұрыс нұсқа жасылмен белгіленді';
    factEl.textContent = fact || '';
    if (iconUse) iconUse.setAttribute('href', `/assets/icons.svg#${correct ? 'check' : 'x'}`);
    const nextBtn = $('[data-action="next-question"]');
    if (nextBtn) {
      nextBtn.classList.toggle('hidden', !nextLabel);
      const label = nextBtn.querySelector('[data-next-label]');
      if (label) label.textContent = nextLabel || 'Келесі сұрақ';
    }
    const waiting = $('#waiting');
    if (waiting) waiting.classList.add('hidden');
    if (correct) sfxCorrect();
    else sfxWrong();
  }

  async function submitSoloAnswer(choice) {
    const s = state.solo;
    if (!s || s.locked || s.reveal || s.finished) return;
    s.locked = true;
    s.frozenRemaining = s.deadline ? Math.max(0, s.deadline - Date.now()) : 0;
    s.deadline = null;
    const answers = $$('#gameStage .answer');
    answers.forEach((btn) => {
      btn.disabled = true;
      btn.classList.remove('is-selected');
    });
    if (choice != null && answers[choice]) answers[choice].classList.add('is-selected');
    try {
      const res = await api('/api/solo/answer', {
        method: 'POST',
        body: { runId: s.runId, index: s.index, choice },
      });
      s.reveal = res;
      if (res.finished) {
        s.finished = true;
        s.summary = res.summary;
      }
      s.score = res.score;
      s.streak = res.streak;
      updateSoloScoreChip();
      setTimerVisual(s.frozenRemaining ?? 0, s.limitMs, false);
      const isLast = res.finished;
      showFeedback({
        correct: res.correct,
        correctIndex: res.correctIndex,
        choice: res.choice,
        fact: res.fact,
        points: res.points,
        timedOut: res.timedOut,
        nextLabel: isLast ? 'Нәтижені көру' : 'Келесі сұрақ',
      });
    } catch (err) {
      toast(err.message, 'error');
      s.locked = false;
      s.deadline = Date.now() + 2500;
      answers.forEach((btn) => (btn.disabled = false));
    }
  }

  async function nextSoloQuestion(button) {
    const s = state.solo;
    if (!s) return;
    if (s.finished) {
      renderSoloResult(s.summary);
      return;
    }
    await withLoading(button, async () => {
      try {
        const r = await api('/api/solo/next', {
          method: 'POST',
          body: { runId: s.runId },
        });
        s.index = r.index;
        s.q = r.question;
        s.limitMs = r.limitMs;
        s.deadline = Date.now() + r.limitMs - 300;
        s.locked = false;
        s.reveal = null;
        $('#feedback').classList.add('hidden');
        $('#waiting').classList.add('hidden');
        renderSoloQuestion();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function renderSoloResult(summary) {
    if (!summary) return;
    const score = summary.score;
    const accuracy = summary.accuracy;
    const perfect = summary.perfect;
    state.resultMode = summary.mode;
    stopTick();
    $('#gameStage').classList.add('hidden');
    $('#countdownStage').classList.add('hidden');
    const stage = $('#resultStage');
    stage.classList.remove('hidden');
    const kicker =
      summary.mode === 'daily' ? 'Күнделікті сынақ аяқталды' : 'Жаттығу аяқталды';
    const title = perfect
      ? 'Мінсіз ойын!'
      : accuracy >= 70
        ? 'Мықты нәтиже!'
        : accuracy >= 45
          ? 'Жақсы қарқын!'
          : 'Білім — жаттығудың арқасы.';
    const sub = perfect
      ? 'Барлық сұраққа дұрыс жауап бердің. Май тақырыбында нағыз сарапшысың.'
      : `${summary.total} сұрақтың ${summary.correct}-і дұрыс. Түсіндірмелерді оқып, келесі жолы рекордты жаңарт.`;
    const avgSec = Math.max(1, Math.round(summary.durationMs / Math.max(1, summary.total) / 1000));
    const newAch = summary.newAchievements || [];
    const levelNote =
      summary.newLevel > summary.previousLevel
        ? `<p class="result-note">${icon('star')} Жаңа деңгей: <b>${summary.newLevel}</b>. Жалғастыр!</p>`
        : '';
    stage.innerHTML = `
      <div class="result-inner">
        <div class="result-kicker">${esc(kicker)}</div>
        <h1 class="result-title">${esc(title)}</h1>
        <p class="result-sub">${esc(sub)}</p>
        <div class="result-score-block">
          <div class="result-score-main">
            <span class="result-score">${fmt(score)}</span>
            <span class="result-score-label">жалпы ұпай</span>
          </div>
          <div class="result-ring-wrap">
            <svg class="result-ring-bg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"></circle></svg>
            <svg class="result-ring-fg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"></circle></svg>
            <span class="result-ring-text">${accuracy}%<small>дәлдік</small></span>
          </div>
        </div>
        <div class="result-stats">
          <div class="result-stat"><span>Дұрыс жауап</span><strong>${summary.correct} / ${summary.total}</strong></div>
          <div class="result-stat"><span>Үздік серия</span><strong>${summary.bestStreak}</strong></div>
          <div class="result-stat"><span>Орташа уақыт</span><strong>${avgSec} сек</strong></div>
          <div class="result-stat"><span>XP қосылды</span><strong>+${fmt(summary.xpEarned)}</strong></div>
        </div>
        ${
          newAch.length
            ? `<div class="result-ach-list">${newAch
                .map(
                  (a) =>
                    `<div class="result-ach">${icon(ACH_ICONS[a.icon] || 'star')}<span>Жаңа марапат: <b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span></div>`
                )
                .join('')}</div>`
            : ''
        }
        ${levelNote}
        <div class="result-actions">
          ${
            summary.mode === 'daily'
              ? ''
              : `<button class="btn btn-gold" type="button" data-action="result-again">${icon('refresh')} Қайта ойнау</button>`
          }
          <button class="btn btn-outline" type="button" data-action="result-leaderboard">${icon('trophy')} Рейтинг</button>
          <button class="btn btn-ghost" type="button" data-action="result-play">Ойын алаңы</button>
        </div>
        <p class="result-tip">${
          summary.mode === 'daily'
            ? 'Ертең жаңа күнделікті сынақ келеді. Қатарынан ойнап, серияңды сақта.'
            : 'Күнделікті сынақ пен онлайн дүэлде де ұпай жинауға болады.'
        }</p>
      </div>
    `;
    const resultRing = stage.querySelector('.result-ring-fg');
    if (resultRing) {
      resultRing.style.strokeDashoffset = '301.59';
      setTimeout(() => {
        resultRing.style.strokeDashoffset = String(301.59 * (1 - accuracy / 100));
      }, 140);
    }
    const scoreEl = stage.querySelector('.result-score');
    if (scoreEl) {
      scoreEl.textContent = '0';
      animateNumber(scoreEl, score, 1150);
    }
    const levelUp = summary.newLevel > summary.previousLevel;
    if (summary.user) {
      state.user = summary.user;
      state.user.activeRoom = null;
      updateHeader();
      paintPlay();
    }
    if (perfect || levelUp) {
      confetti();
      sfxFinish();
    }
    stage.scrollTop = 0;
  }

  async function playAgain(button) {
    if (state.resultMode === 'daily') {
      toast('Күнделікті сынаққа ертең қайта орал.', 'info');
      return;
    }
    closeGameLayer();
    state.solo = null;
    state.gameKind = null;
    await startSolo('solo', button);
  }

  /* ------------------------------------------------------------
     Duel
     ------------------------------------------------------------ */

  async function createRoom(button) {
    if (!state.user) {
      navigate('/login');
      return;
    }
    await withLoading(button, async () => {
      try {
        const data = await api('/api/rooms', { method: 'POST', body: {} });
        navigate(`/room/${data.code}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  async function joinRoomCode(code, button) {
    if (!code || code.length < 4) {
      toast('Бөлме кодын толық енгіз.', 'error');
      return;
    }
    await withLoading(button, async () => {
      try {
        const data = await api('/api/rooms/join', {
          method: 'POST',
          body: { code: code.toUpperCase() },
        });
        $('#roomCodeInput')?.form?.reset();
        navigate(`/room/${data.code}`);
      } catch (err) {
        showFormError('join', err.message);
        toast(err.message, 'error');
      }
    });
  }

  function handleJoinSubmit(event) {
    event.preventDefault();
    const input = $('#roomCodeInput');
    const code = String(input?.value || '').trim().toUpperCase();
    if (code.length !== 6) {
      showFormError('join', 'Бөлме коды 6 таңбадан тұрады.');
      return;
    }
    showFormError('join', '');
    joinRoomCode(code, event.currentTarget.querySelector('button[type="submit"]'));
  }

  async function quickMatch(button) {
    if (!state.user) {
      navigate('/login');
      return;
    }
    if (state.search) return;
    await withLoading(button, async () => {
      try {
        const data = await api('/api/rooms/quick', { method: 'POST', body: {} });
        if (data.code) {
          navigate(`/room/${data.code}`);
          return;
        }
        openSearch();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function openSearch() {
    const dlg = $('#searchDialog');
    if (!dlg) return;
    if (state.search) return;
    const timeEl = $('[data-search-time]');
    state.search = {
      startedAt: Date.now(),
      interval: setInterval(() => {
        if (timeEl) {
          const sec = Math.floor((Date.now() - state.search.startedAt) / 1000);
          timeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        }
      }, 300),
      timeout: null,
    };
    dlg.showModal();
    pollSearch();
  }

  async function pollSearch() {
    if (!state.search) return;
    try {
      const r = await api('/api/rooms/quick/status');
      if (!state.search) return;
      if (r.code) {
        closeSearch();
        navigate(`/room/${r.code}`);
        return;
      }
      if (!r.queued) {
        closeSearch();
        toast('Қарсылас табылмады. Кейінірек қайталап көр.', 'info');
        return;
      }
    } catch (err) {
      if (!state.search) return;
      if (err.status === 401) {
        closeSearch();
        return;
      }
    }
    if (state.search) {
      state.search.timeout = setTimeout(pollSearch, 2000);
    }
  }

  function closeSearch(cancel = false) {
    if (!state.search) return;
    clearInterval(state.search.interval);
    clearTimeout(state.search.timeout);
    state.search = null;
    const dlg = $('#searchDialog');
    if (dlg && dlg.open) dlg.close();
    if (cancel) {
      api('/api/rooms/quick/cancel', { method: 'POST', body: {} }).catch(() => {});
    }
  }

  function stopSearchManually() {
    closeSearch(true);
    toast('Іздеу тоқтатылды', 'info', 2200);
  }

  async function enterRoom(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(normalized)) {
      toast('Бөлме коды дұрыс емес', 'error');
      navigate('/play');
      return;
    }
    if (state.roomCode === normalized && state.roomES) {
      applyRoom(state.room);
      return;
    }
    if (state.search) closeSearch(true);
    if (state.roomCode) closeRoom(false);
    state.roomCode = normalized;
    state.room = null;
    $$('[data-room-title-code], [data-lobby-code]').forEach((el) => (el.textContent = normalized));
    const link = $('[data-room-link]');
    if (link) link.textContent = roomUrl(normalized);
    setConnection('connecting');
    try {
      let data;
      try {
        data = await api(`/api/rooms/${normalized}`);
      } catch (err) {
        if (err.status === 403) {
          const joined = await api('/api/rooms/join', {
            method: 'POST',
            body: { code: normalized },
          });
          data = { room: joined.room };
        } else {
          throw err;
        }
      }
      if (state.roomCode !== normalized) return;
      state.room = data.room;
      applyRoom(data.room);
      connectRoomStream(normalized);
    } catch (err) {
      if (state.roomCode !== normalized) return;
      toast(err.message, 'error');
      closeRoom(false);
      navigate('/play');
    }
  }

  function connectRoomStream(code) {
    closeRoomStream();
    if (typeof EventSource === 'undefined') {
      startRoomPolling(code);
      return;
    }
    setConnection('connecting');
    const es = new EventSource(`/api/rooms/${encodeURIComponent(code)}/events`);
    state.roomES = es;
    es.addEventListener('open', () => {
      if (state.roomCode !== code) return;
      setConnection('live');
      stopRoomPolling();
    });
    es.addEventListener('state', (event) => {
      if (state.roomCode !== code) return;
      try {
        const room = JSON.parse(event.data);
        state.room = room;
        applyRoom(room);
      } catch {
        /* бұзылған кадрды өткізіп жібереміз */
      }
    });
    es.addEventListener('error', () => {
      if (state.roomCode !== code) return;
      setConnection('lost');
      startRoomPolling(code);
    });
  }

  function closeRoomStream() {
    if (state.roomES) {
      state.roomES.close();
      state.roomES = null;
    }
    stopRoomPolling();
  }

  function startRoomPolling(code) {
    if (state.roomPoll) return;
    state.roomPoll = setInterval(async () => {
      if (state.roomCode !== code) return;
      try {
        const data = await api(`/api/rooms/${code}`);
        state.room = data.room;
        applyRoom(data.room);
      } catch (err) {
        if (err.status === 403 || err.status === 404) {
          toast(err.message, 'error');
          closeRoom(false);
          navigate('/play');
        }
      }
    }, 3000);
  }

  function stopRoomPolling() {
    if (state.roomPoll) {
      clearInterval(state.roomPoll);
      state.roomPoll = null;
    }
  }

  function setConnection(status) {
    const el = $('[data-connection]');
    if (!el) return;
    el.classList.remove('is-live', 'is-lost');
    if (status === 'live') {
      el.classList.add('is-live');
      el.innerHTML = '<span class="pulse-dot" aria-hidden="true"></span> Тікелей байланыс';
    } else if (status === 'lost') {
      el.classList.add('is-lost');
      el.innerHTML = '<span class="pulse-dot" aria-hidden="true"></span> Қайта қосылуда…';
    } else if (status === 'connecting') {
      el.innerHTML = '<span class="pulse-dot" aria-hidden="true"></span> Қосылуда…';
    } else {
      el.innerHTML = '<span class="pulse-dot" aria-hidden="true"></span> Күтуде';
    }
  }

  function applyRoom(room) {
    if (!room || state.roomCode !== room.code) return;
    renderRoomHeader(room);
    if (room.status === 'waiting') {
      if (state.gameOpen && state.gameKind === 'duel') {
        closeGameLayer();
        state.gameKind = null;
      }
      state.duelPhase = 'waiting';
      renderLobby(room);
      return;
    }
    if (room.status === 'countdown') {
      if (!state.gameOpen || state.gameKind !== 'duel') {
        state.gameKind = 'duel';
        openGameLayer();
      }
      if (state.duelPhase !== 'countdown') {
        state.duelPhase = 'countdown';
        state.duelIndex = null;
        state.duelQuestionKey = null;
        state.duelAnswerSent = false;
        state.duelFinishedHandled = false;
        state.duelCountdownEnd = Date.now() + Math.max(500, room.countdownMs || 3500);
        state.duelResultKey = null;
        sfxStart();
      }
      showCountdown(room);
      updateDuelBar(room);
      return;
    }
    if (room.status === 'playing') {
      if (!state.gameOpen || state.gameKind !== 'duel') {
        state.gameKind = 'duel';
        openGameLayer();
      }
      if (!room.question) return;
      if (room.phase === 'question') {
        const my = room.players.find((p) => p.id === state.user?.id);
        const answered = Boolean(my?.answered);
        if (
          state.duelIndex !== room.index ||
          state.duelPhase !== 'question' ||
          state.duelQuestionKey !== room.question.id
        ) {
          state.duelIndex = room.index;
          state.duelPhase = 'question';
          state.duelQuestionKey = room.question.id;
          state.duelAnswerSent = answered;
          state.duelDeadline = Date.now() + Math.max(0, room.remainingMs);
          renderDuelQuestion(room);
        } else {
          state.duelAnswerSent = answered;
          updateDuelMeta(room);
        }
      } else if (room.phase === 'reveal') {
        if (state.duelIndex !== room.index || state.duelPhase !== 'reveal') {
          state.duelIndex = room.index;
          state.duelPhase = 'reveal';
          state.duelAnswerSent = true;
          renderDuelQuestion(room);
        }
        revealDuel(room);
      }
      updateDuelBar(room);
      return;
    }
    if (room.status === 'finished') {
      if (!state.gameOpen || state.gameKind !== 'duel') {
        state.gameKind = 'duel';
        openGameLayer();
      }
      state.duelPhase = 'finished';
      state.duelAnswerSent = true;
      const resultKey = `${room.code}:${room.index}:${room.result?.winnerId}:${room.players.map((p) => p.score).join(',')}:${room.result?.reason}`;
      if (state.duelResultKey !== resultKey) {
        state.duelResultKey = resultKey;
        renderDuelResult(room);
      } else {
        syncRematchButton(room);
      }
      if (!state.duelFinishedHandled) {
        state.duelFinishedHandled = true;
        sfxFinish();
        fetchMeSilently();
        if (room.result?.winnerId === state.user?.id) confetti();
      }
    }
  }

  function renderRoomHeader(room) {
    $$('[data-room-title-code], [data-lobby-code]').forEach(
      (el) => (el.textContent = room.code)
    );
    const link = $('[data-room-link]');
    if (link) link.textContent = roomUrl(room.code);
    const statusText = $('[data-room-status-text]');
    if (statusText) {
      statusText.textContent =
        room.status === 'waiting'
          ? 'Ойыншылар күтілуде'
          : room.status === 'countdown'
            ? 'Басталуға дайын'
            : room.status === 'playing'
              ? 'Ойын жүріп жатыр'
              : 'Матч аяқталды';
    }
  }

  function renderLobby(room) {
    const seats = $('[data-seats]');
    if (!seats) return;
    const meId = state.user?.id;
    const host = room.players.find((p) => p.isHost) || room.players[0];
    const guest = room.players.find((p) => !p.isHost) || null;
    const seatHtml = (p, emptyText) => {
      if (!p) {
        return `<div class="seat"><span class="seat-avatar placeholder"></span><span class="seat-name">Бос орын</span><span class="seat-tag">${esc(emptyText)}</span></div>`;
      }
      const isYou = p.id === meId;
      const tag = `${p.isHost ? 'Бөлме иесі' : 'Қосылды'}${isYou ? ' · Сен' : ''}`;
      return `<div class="seat${isYou ? ' is-you' : ''}">
        <span class="seat-avatar"><img src="${avatarSrc(p.avatar)}" alt=""></span>
        <span class="seat-name">${esc(p.nickname)}</span>
        <span class="seat-tag ${p.connected ? 'ready' : 'waiting'}">${tag}${p.connected ? '' : ' · офлайн'}</span>
      </div>`;
    };
    seats.innerHTML = `${seatHtml(host, 'Бөлме иесі')}<span class="seat-vs">VS</span>${seatHtml(guest, 'Күтуде…')}`;

    const startBtn = $('[data-action="start-room"]');
    const isHost = host && host.id === meId;
    const hasGuest = Boolean(guest);
    if (startBtn) {
      startBtn.classList.toggle('hidden', !isHost || !hasGuest);
      startBtn.disabled = !isHost || !hasGuest;
    }
    const hint = $('[data-lobby-hint]');
    if (hint) {
      if (!hasGuest) {
        hint.textContent = isHost
          ? 'Бөлме кодын досыңа жібер. Ол қосылғанда «Ойынды бастау» белсенді болады.'
          : 'Бөлме иесі қарсылас күтіп тұр.';
      } else if (isHost) {
        hint.textContent = 'Екеуің де дайынсыңдар. Ойынды бастауға болады.';
      } else {
        hint.textContent = 'Бөлме иесі ойынды бастайды. Дайын бол.';
      }
    }
  }

  async function startRoom(button) {
    if (!state.roomCode) return;
    await withLoading(button, async () => {
      try {
        await api(`/api/rooms/${state.roomCode}/start`, { method: 'POST', body: {} });
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function updateDuelBar(room) {
    const me = room.players.find((p) => p.id === state.user?.id);
    const op = room.players.find((p) => p.id !== state.user?.id);
    const set = (sel, text) => {
      const el = $(sel);
      if (el) el.textContent = text;
    };
    const setScore = (sel, value) => {
      const el = $(sel);
      if (!el) return;
      const prev = Number(el.dataset.value || 0);
      el.dataset.value = String(value);
      el.textContent = fmt(value);
      if (value > prev) bumpText(el);
    };
    if (me) {
      const img = $('[data-duel-my-avatar]');
      if (img) img.src = avatarSrc(me.avatar);
      set('[data-duel-my-name]', me.nickname);
      setScore('[data-duel-my-score]', me.score || 0);
      let status = me.answered ? 'Жауап берді' : 'Ойлануда';
      if (!me.connected) status = 'Байланыс жоқ';
      if (room.phase === 'reveal') {
        const ans = room.reveal?.answers?.[me.id];
        status = ans?.correct ? 'Дұрыс' : 'Қате';
      }
      set('[data-duel-my-status]', status);
    }
    if (op) {
      const img = $('[data-duel-op-avatar]');
      if (img) img.src = avatarSrc(op.avatar);
      set('[data-duel-op-name]', op.nickname);
      setScore('[data-duel-op-score]', op.score || 0);
      let status = op.answered ? 'Жауап берді' : 'Ойлануда';
      if (!op.connected) status = 'Байланыс жоқ';
      if (room.phase === 'reveal') {
        const ans = room.reveal?.answers?.[op.id];
        status = ans?.correct ? 'Дұрыс' : 'Қате';
      }
      set('[data-duel-op-status]', status);
    } else {
      set('[data-duel-op-name]', 'Қарсылас');
      set('[data-duel-op-status]', 'Күтілуде');
      set('[data-duel-op-score]', '0');
    }
  }

  function showCountdown(room) {
    $('#gameStage').classList.add('hidden');
    $('#resultStage').classList.add('hidden');
    $('#countdownStage').classList.remove('hidden');
    $('[data-countdown]').textContent = '3';
    const players = $('[data-countdown-players]');
    if (players) {
      players.innerHTML = room.players
        .map(
          (p) => `<div class="countdown-player">${avatarImg(p.avatar, 'avatar')}<span>${esc(p.nickname)}</span></div>`
        )
        .join('<span class="duel-vs">VS</span>');
    }
    renderProgress(1, room.total || 8);
    $('[data-game-mode]').textContent = 'Онлайн дүэл · дайындық';
  }

  function renderDuelQuestion(room) {
    const q = room.question;
    if (!q) return;
    $('#countdownStage').classList.add('hidden');
    $('#resultStage').classList.add('hidden');
    $('#gameStage').classList.remove('hidden');
    $('#duelBar').classList.remove('hidden');
    const qScore = $('[data-q-score]');
    if (qScore) qScore.remove();
    $('[data-game-mode]').textContent = 'Онлайн дүэл · 8 сұрақ';
    renderProgress(room.index, room.total);
    $('[data-q-cat]').textContent = q.cat;
    $('[data-q-count]').textContent = `${room.index} / ${room.total}`;
    $('[data-question]').textContent = q.q;
    buildAnswers(q.options);
    $('#feedback').classList.add('hidden');
    $('#waiting').classList.add('hidden');
    const my = room.players.find((p) => p.id === state.user?.id);
    const answered = Boolean(my?.answered);
    state.duelAnswerSent = answered;
    if (room.phase === 'question') {
      state.duelDeadline = Date.now() + Math.max(0, room.remainingMs);
      setTimerVisual(room.remainingMs, room.limitMs || 15000, !answered);
      if (answered) {
        $$('#gameStage .answer').forEach((btn) => (btn.disabled = true));
        const waiting = $('#waiting');
        if (waiting) {
          waiting.classList.remove('hidden');
          $('[data-waiting-text]').textContent = 'Жауабың жіберілді. Қарсылас күтілуде…';
        }
      }
    } else {
      setTimerVisual(0, room.limitMs || 15000, false);
    }
    updateDuelBar(room);
  }

  function updateDuelMeta(room) {
    const my = room.players.find((p) => p.id === state.user?.id);
    const answered = Boolean(my?.answered);
    state.duelAnswerSent = answered;
    if (answered) {
      $$('#gameStage .answer').forEach((btn) => (btn.disabled = true));
      const waiting = $('#waiting');
      if (waiting && room.phase === 'question') {
        waiting.classList.remove('hidden');
        $('[data-waiting-text]').textContent = 'Жауабың жіберілді. Қарсылас күтілуде…';
      }
    }
    updateDuelBar(room);
  }

  async function answerDuel(choice) {
    const room = state.room;
    if (!room || room.status !== 'playing' || room.phase !== 'question' || state.duelAnswerSent) {
      return;
    }
    state.duelAnswerSent = true;
    const answers = $$('#gameStage .answer');
    answers.forEach((btn) => {
      btn.disabled = true;
      btn.classList.remove('is-selected');
    });
    if (answers[choice]) answers[choice].classList.add('is-selected');
    const waiting = $('#waiting');
    if (waiting) {
      waiting.classList.remove('hidden');
      $('[data-waiting-text]').textContent =
        'Жауабың жіберілді. Қарсылас жауап берсе, дұрыс нұсқа ашылады…';
    }
    try {
      await api(`/api/rooms/${room.code}/answer`, {
        method: 'POST',
        body: { index: room.index - 1, choice },
      });
    } catch (err) {
      if (err.code === 'TIMEOUT' || err.code === 'NOT_ACCEPTING') return;
      toast(err.message, 'error');
      state.duelAnswerSent = false;
      answers.forEach((btn) => (btn.disabled = false));
      if (waiting) waiting.classList.add('hidden');
    }
  }

  function revealDuel(room) {
    const reveal = room.reveal;
    if (!reveal) return;
    const myId = state.user?.id;
    const myAnswer = reveal.answers?.[myId] || null;
    const choice = myAnswer ? myAnswer.choice : null;
    const correct = Boolean(myAnswer && myAnswer.correct);
    const timedOut = !myAnswer || myAnswer.choice == null;
    showFeedback({
      correct,
      correctIndex: reveal.answerIndex,
      choice,
      fact: reveal.fact,
      points: myAnswer?.points || 0,
      timedOut,
      nextLabel: null,
    });
    const answeredMs = myAnswer?.ms;
    setTimerVisual(
      answeredMs != null ? Math.max(0, (room.limitMs || 15000) - answeredMs) : 0,
      room.limitMs || 15000,
      false
    );
    const waiting = $('#waiting');
    if (waiting) {
      waiting.classList.remove('hidden');
      $('[data-waiting-text]').textContent = 'Келесі сұрақ 5 секундтан кейін автоматты түрде ашылады…';
    }
    if (state.duelRevealSoundedFor !== room.index) {
      state.duelRevealSoundedFor = room.index;
      if (correct) sfxCorrect();
      else sfxWrong();
    }
    updateDuelBar(room);
  }

  function renderDuelResult(room) {
    const result = room.result || {};
    const myId = state.user?.id;
    const me = room.players.find((p) => p.id === myId);
    const op = room.players.find((p) => p.id !== myId);
    const myScore = me ? me.score : 0;
    const opScore = op ? op.score : 0;
    const myCorrect = me ? me.correct : 0;
    const accuracy = room.total ? Math.round((myCorrect / room.total) * 100) : 0;
    const xp = Number(result.rewards?.[myId] || 0);
    const newAch = result.newAchievements?.[myId] || [];
    const votes = result.rematchVotes || [];
    const iVoted = votes.includes(myId);
    const canRematch = Boolean(op);
    const winner = result.winnerId;
    let title = 'Тең ойын';
    let kicker = 'Дүэл аяқталды';
    if (result.reason === 'forfeit') {
      kicker = 'Техникалық нәтиже';
      title = winner === myId ? 'Қарсылас кетті — жеңіс!' : 'Бұл жолы жеңіліс';
    } else if (winner === myId) {
      title = 'Жеңіс!';
      kicker = 'Дүэл жеңімпазы';
    } else if (winner) {
      title = 'Бұл жолы қарсылас басым түсті';
      kicker = 'Дүэл аяқталды';
    }
    const sub =
      result.reason === 'forfeit'
        ? 'Матч мерзімінен бұрын аяқталды. Нәтиже рейтингте есептелді.'
        : `${op ? op.nickname : 'Қарсылас'}мен болған сегіз сұрақтық сайыста ${myCorrect} дұрыс жауап бердің.`;
    state.duelPhase = 'finished';
    stopTick();
    $('#gameStage').classList.add('hidden');
    $('#countdownStage').classList.add('hidden');
    const stage = $('#resultStage');
    stage.classList.remove('hidden');
    stage.innerHTML = `
      <div class="result-inner">
        <div class="result-kicker">${esc(kicker)}</div>
        <h1 class="result-title">${esc(title)}</h1>
        <p class="result-sub">${esc(sub)}</p>
        <div class="result-score-block">
          <div class="result-score-main">
            <span class="result-score">${fmt(myScore)}</span>
            <span class="result-score-label">сенің ұпайың</span>
          </div>
          <div class="result-ring-wrap">
            <svg class="result-ring-bg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"></circle></svg>
            <svg class="result-ring-fg" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"></circle></svg>
            <span class="result-ring-text">${accuracy}%<small>дәлдік</small></span>
          </div>
        </div>
        <div class="result-duel">
          <div class="result-duel-side">${avatarImg(me?.avatar || state.user?.avatar, 'avatar')}<span><b>${fmt(myScore)}</b><span>${esc(me?.nickname || state.user?.nickname || 'Сен')}</span></span></div>
          <span class="result-duel-mid">VS</span>
          <div class="result-duel-side"><span><b>${fmt(opScore)}</b><span>${esc(op?.nickname || 'Қарсылас')}</span></span>${avatarImg(op?.avatar, 'avatar')}</div>
        </div>
        <div class="result-stats">
          <div class="result-stat"><span>Дұрыс</span><strong>${myCorrect} / ${room.total}</strong></div>
          <div class="result-stat"><span>Қате</span><strong>${Math.max(0, room.total - myCorrect)}</strong></div>
          <div class="result-stat"><span>Дәлдік</span><strong>${accuracy}%</strong></div>
          <div class="result-stat"><span>XP қосылды</span><strong>+${fmt(xp)}</strong></div>
        </div>
        ${
          newAch.length
            ? `<div class="result-ach-list">${newAch
                .map(
                  (a) =>
                    `<div class="result-ach">${icon(ACH_ICONS[a.icon] || 'star')}<span>Жаңа марапат: <b>${esc(a.name)}</b><small>${esc(a.desc)}</small></span></div>`
                )
                .join('')}</div>`
            : ''
        }
        <div class="result-actions">
          <button class="btn btn-gold" type="button" data-action="rematch" ${!canRematch || iVoted ? 'disabled' : ''}>${icon('refresh')} ${iVoted ? 'Қарсылас күтілуде…' : 'Қайта ойнау'}</button>
          <button class="btn btn-outline" type="button" data-action="result-leave-room">Бөлмеден шығу</button>
        </div>
        <p class="result-tip">${canRematch ? 'Екеуің де «Қайта ойнау» бассаң, жаңа сегіз сұрақтық матч басталады.' : 'Қарсылас бөлмеден шықты. Жаңа қарсыласпен ойнауға болады.'}</p>
      </div>
    `;
    const duelRing = stage.querySelector('.result-ring-fg');
    if (duelRing) {
      duelRing.style.strokeDashoffset = '301.59';
      setTimeout(() => {
        duelRing.style.strokeDashoffset = String(301.59 * (1 - accuracy / 100));
      }, 140);
    }
    const duelScoreEl = stage.querySelector('.result-score');
    if (duelScoreEl) {
      duelScoreEl.textContent = '0';
      animateNumber(duelScoreEl, myScore, 1150);
    }
  }

  function syncRematchButton(room) {
    const btn = $('[data-action="rematch"]');
    if (!btn) return;
    const myId = state.user?.id;
    const votes = room.result?.rematchVotes || [];
    const hasOpponent = room.players.some((p) => p.id !== myId);
    const voted = votes.includes(myId);
    btn.disabled = voted || !hasOpponent;
    btn.innerHTML = `${icon('refresh')} ${voted ? 'Қарсылас күтілуде…' : 'Қайта ойнау'}`;
  }

  async function requestRematch(button) {
    if (!state.roomCode) return;
    let voted = false;
    await withLoading(button, async () => {
      try {
        await api(`/api/rooms/${state.roomCode}/rematch`, { method: 'POST', body: {} });
        voted = true;
        toast('Қайта ойнауға дауыс бердің. Қарсылас күтілуде…', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    if (voted) {
      button.disabled = true;
      button.innerHTML = `${icon('refresh')} Қарсылас күтілуде…`;
    }
  }

  function closeRoom(leave = true) {
    const code = state.roomCode;
    closeRoomStream();
    if (leave && code) {
      api(`/api/rooms/${code}/leave`, { method: 'POST', body: {} }).catch(() => {});
    }
    state.room = null;
    state.roomCode = null;
    state.duelPhase = null;
    state.duelIndex = null;
    state.duelQuestionKey = null;
    state.duelDeadline = null;
    state.duelCountdownEnd = null;
    state.duelAnswerSent = false;
    state.duelFinishedHandled = false;
    state.duelRevealSoundedFor = null;
    state.duelResultKey = null;
    closeGameLayer();
    state.gameKind = null;
  }

  async function leaveRoomAndExit() {
    const room = state.room;
    if (room && room.status !== 'waiting' && room.status !== 'finished') {
      const ok = await askConfirm({
        title: 'Бөлмеден шығасың ба?',
        text: 'Ойын жүріп жатыр. Шықсаң, бұл матч жеңіліс ретінде есептеледі.',
        ok: 'Шығу',
      });
      if (!ok) return;
    }
    closeRoom(true);
    navigate('/play');
    toast('Бөлмеден шықтың', 'info', 2400);
  }

  async function quitGame() {
    if (state.gameKind === 'solo') {
      if (state.solo && !state.solo.finished) {
        const ok = await askConfirm({
          title: 'Ойынды тоқтатасың ба?',
          text:
            state.solo.kind === 'daily'
              ? 'Күнделікті сынақта бір ғана мүмкіндік бар. Тоқтатсаң, бүгінгі мүмкіндік пайдаланылды деп саналады және ұпай сақталмайды.'
              : 'Ағымдағы ұпай сақталмайды. Кейінірек қайта бастай аласың.',
          ok: 'Шығу',
        });
        if (!ok) return;
      }
      closeGameLayer();
      state.solo = null;
      state.gameKind = null;
      navigate('/play');
      fetchMeSilently();
      return;
    }
    if (state.gameKind === 'duel') {
      if (state.room && state.room.status === 'finished') {
        closeRoom(true);
        navigate('/play');
        return;
      }
      const ok = await askConfirm({
        title: 'Дүэлден шығасың ба?',
        text: 'Ойын жүріп жатыр. Шықсаң, матч жеңіліс ретінде есептеледі.',
        ok: 'Шығу',
      });
      if (!ok) return;
      closeRoom(true);
      navigate('/play');
      toast('Дүэлден шықтың', 'info', 2400);
      return;
    }
    closeGameLayer();
  }

  function exitGameTo(path) {
    if (state.gameKind === 'duel' && state.roomCode) {
      closeRoom(true);
    }
    closeGameLayer();
    state.solo = null;
    state.gameKind = null;
    navigate(path);
  }

  function removeConfetti() {
    $$('.confetti-field').forEach((el) => el.remove());
  }

  function confetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    removeConfetti();
    const field = document.createElement('div');
    field.className = 'confetti-field';
    const colors = ['#e8b44a', '#f4d68e', '#8aae55', '#f3ead8', '#dd8568'];
    for (let i = 0; i < 34; i++) {
      const piece = document.createElement('span');
      piece.className = 'confetti-piece';
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = `${2.2 + Math.random() * 2}s`;
      piece.style.animationDelay = `${Math.random() * 0.6}s`;
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 180}px`);
      piece.style.width = `${4 + Math.random() * 5}px`;
      piece.style.height = `${7 + Math.random() * 7}px`;
      field.append(piece);
    }
    $('#gameLayer')?.append(field);
    setTimeout(() => field.remove(), 5000);
  }

  /* ------------------------------------------------------------
     Leaderboard
     ------------------------------------------------------------ */

  async function setBoard(board) {
    state.board = ['xp', 'daily', 'solo'].includes(board) ? board : 'xp';
    $$('.lb-tab').forEach((tab) => {
      const active = tab.dataset.board === state.board;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    await loadLeaderboard();
  }

  async function loadLeaderboard() {
    const rowsEl = $('[data-lb-rows]');
    const podiumEl = $('[data-podium]');
    if (!rowsEl) return;
    rowsEl.innerHTML = '<div class="loading-row"><span class="spinner"></span> Рейтинг жүктелуде…</div>';
    if (podiumEl) podiumEl.innerHTML = '';
    try {
      const data = await api(`/api/leaderboard?board=${encodeURIComponent(state.board)}`);
      if (document.body.dataset.view !== 'leaderboard') return;
      if (data.board !== state.board) return;
      renderLeaderboard(data);
    } catch (err) {
      rowsEl.innerHTML = `<div class="loading-row">${esc(err.message)}</div>`;
    }
  }

  function renderLeaderboard(data) {
    const podium = $('[data-podium]');
    const rowsEl = $('[data-lb-rows]');
    const myRank = $('[data-my-rank]');
    const labels = {
      xp: { main: 'XP', extra: 'Жеңіс', unit: 'XP' },
      daily: { main: 'Бүгін', extra: 'Серия', unit: 'ұпай' },
      solo: { main: 'Рекорд', extra: 'Жеңіс', unit: 'ұпай' },
    };
    const label = labels[state.board] || labels.xp;
    const headSpans = $$('[data-lb-head] span');
    if (headSpans[3]) headSpans[3].textContent = label.main;
    if (headSpans[4]) headSpans[4].textContent = label.extra;

    const metric = (row) =>
      state.board === 'daily' ? row.dailyScore : state.board === 'solo' ? row.bestSolo : row.xp;
    const extra = (row) => (state.board === 'daily' ? row.streak : row.wins);

    if (podium) {
      podium.innerHTML = '';
      if (!data.rows.length) {
        podium.innerHTML = `<div class="podium-empty">${
          state.board === 'daily'
            ? 'Бүгін әлі ешкім күнделікті сынақтан өтпеді. Бірінші бол!'
            : 'Рейтинг әлі бос. Бірінші ойынды бастап, тарихқа ен.'
        }</div>`;
      } else {
        data.rows.slice(0, 3).forEach((row) => {
          const el = document.createElement('article');
          el.className = `podium-card podium-${row.rank}`;
          el.innerHTML = `
            <span class="podium-rank">#${row.rank}</span>
            ${row.rank === 1 ? `<svg class="podium-crown ic" aria-hidden="true"><use href="/assets/icons.svg#crown"></use></svg>` : ''}
            ${avatarImg(row.avatar, 'avatar')}
            <span class="podium-name">${esc(row.nickname)}</span>
            <span class="podium-metric">${fmt(metric(row))} ${esc(label.unit)}</span>
            <span class="level-tag">Деңгей ${row.level}</span>
          `;
          podium.append(el);
        });
      }
    }

    rowsEl.innerHTML = '';
    if (!data.rows.length) {
      rowsEl.innerHTML = `<div class="loading-row">${
        state.board === 'daily'
          ? 'Бүгінгі кесте әзірге бос. Бірінші нәтиже сенікі болуы мүмкін.'
          : 'Әзірге ойыншылар жоқ.'
      }</div>`;
    } else {
      data.rows.forEach((row) => {
        const isMe = row.id === state.user?.id;
        const a = document.createElement('a');
        a.className = `lb-row${isMe ? ' is-me' : ''}`;
        a.href = `#/profile/${encodeURIComponent(row.nickname)}`;
        a.innerHTML = `
          <span><span class="rank-badge ${row.rank <= 3 ? `top-${row.rank}` : ''}">${row.rank}</span></span>
          <span class="lb-player">
            ${avatarImg(row.avatar, 'avatar')}
            <span class="lb-player-name"><strong>${esc(row.nickname)}${isMe ? ' · сен' : ''}</strong><small>${row.games} ойын · ${row.online ? 'онлайн' : 'офлайн'}</small></span>
          </span>
          <span class="lb-level">${row.level}</span>
          <span class="lb-main">${fmt(metric(row))}<small> ${esc(label.unit)}</small></span>
          <span class="lb-wins">${fmt(extra(row))}</span>
        `;
        rowsEl.append(a);
      });
    }

    if (myRank) {
      myRank.classList.remove('hidden');
      if (data.myRank) {
        const meRow = data.me || {};
        myRank.innerHTML = `Сенің орның: <b>#${data.myRank}</b> · ${esc(meRow.nickname || state.user?.nickname || '')} · <b>${fmt(metric(meRow))}</b> ${esc(label.unit)}`;
      } else {
        myRank.innerHTML =
          state.board === 'daily'
            ? 'Бүгін әлі күнделікті сынақтан өтпедің. <a class="inline-link" href="#/play">Бірінші бол!</a>'
            : 'Сенің орның әзірге анықталмады.';
      }
    }
  }

  /* ------------------------------------------------------------
     Profile
     ------------------------------------------------------------ */

  async function loadProfile(nick) {
    const targetNick = nick ? decodeURIComponent(nick) : null;
    const achWrap = $('[data-achievements]');
    if (achWrap) {
      achWrap.innerHTML = '<div class="loading-row"><span class="spinner"></span> Профиль жүктелуде…</div>';
    }
    try {
      const data = await api(
        `/api/profile${targetNick ? `?nick=${encodeURIComponent(targetNick)}` : ''}`
      );
      if (document.body.dataset.view !== 'profile') {
        if (data.isSelf) {
          state.user = data.user;
          updateHeader();
        }
        return;
      }
      renderProfile(data);
    } catch (err) {
      toast(err.message, 'error');
      navigate('/leaderboard');
    }
  }

  function renderProfile(data) {
    const u = data.user;
    if (data.isSelf) {
      state.user = u;
      state.user.activeRoom = state.user.activeRoom || null;
      updateHeader();
    }
    $('[data-profile-avatar]').src = avatarSrc(u.avatar);
    $('[data-profile-name]').textContent = u.nickname;
    $('[data-profile-eyebrow]').textContent = data.isSelf ? 'Сенің профилің' : 'Қатысушы профилі';
    $('[data-profile-meta]').textContent = `Деңгей ${u.level} · ${data.rank ? `#${data.rank} орын` : 'рейтингте'} · ${u.online ? 'онлайн' : 'офлайн'}`;
    $('[data-profile-actions]').classList.toggle('hidden', !data.isSelf);
    $('[data-profile-level]').textContent = u.level;
    $('[data-profile-level-label]').textContent = `Деңгей ${u.level}`;
    $('[data-profile-xp-into]').textContent = fmt(u.xpInto);
    $('[data-profile-xp-need]').textContent = fmt(u.xpNeed);
    const bar = $('[data-profile-xp-bar]');
    if (bar) bar.style.width = `${Math.min(100, u.xpNeed ? (u.xpInto / u.xpNeed) * 100 : 0)}%`;
    $('[data-profile-rank]').textContent = data.rank ? `#${data.rank}` : '—';
    $$('[data-profile-games]').forEach((el) => (el.textContent = fmt(u.games)));
    $$('[data-profile-wins]').forEach((el) => (el.textContent = fmt(u.wins)));
    $$('[data-profile-accuracy]').forEach((el) => (el.textContent = u.accuracy));
    $$('[data-profile-accuracy-big]').forEach((el) => (el.textContent = `${u.accuracy}%`));
    $$('[data-profile-best]').forEach((el) => (el.textContent = fmt(u.bestSolo)));
    $$('[data-profile-streak]').forEach((el) => (el.textContent = u.streak));
    $$('[data-profile-duels]').forEach((el) => (el.textContent = fmt(u.duelGames)));
    $$('[data-profile-correct]').forEach((el) => (el.textContent = fmt(u.totalCorrect)));
    $('[data-profile-joined]').textContent = formatDateStamp(u.createdAt);
    const ring = $('[data-accuracy-ring]');
    if (ring) {
      ring.style.background = `conic-gradient(var(--gold) ${u.accuracy * 3.6}deg, rgba(255,255,255,.08) 0deg)`;
    }

    renderAchievements(data.achievements || []);
    renderProfileRecent(data.recent || []);
    renderDailyWeek(data.dailyWeek || []);

    state.profileAvatar = u.avatar;
    const picker = $('[data-profile-avatar-pick]');
    if (picker) {
      $$('.avatar-option', picker).forEach((btn) => {
        const on = btn.dataset.avatar === u.avatar;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    }
    const settings = $('[data-settings]');
    if (settings && !data.isSelf) settings.hidden = true;
    document.title = `${u.nickname} — МАЙСТЕР`;
  }

  function renderAchievements(items) {
    const wrap = $('[data-achievements]');
    if (!wrap) return;
    wrap.innerHTML = '';
    items.forEach((a) => {
      const card = document.createElement('div');
      card.className = `ach-card ${a.earned ? 'is-earned' : 'is-locked'}`;
      const pct = Math.min(100, a.goal ? (a.value / a.goal) * 100 : 0);
      card.dataset.progress = String(pct);
      card.innerHTML = `
        <span class="ach-icon">${icon(ACH_ICONS[a.icon] || 'star')}</span>
        <span class="ach-copy">
          <strong>${esc(a.name)}</strong>
          <span>${esc(a.desc)}</span>
          <span class="ach-progress"><span></span></span>
        </span>
      `;
      wrap.append(card);
    });
    $$('.ach-card', wrap).forEach((card) => {
      const bar = card.querySelector('.ach-progress span');
      if (bar) bar.style.width = `${card.dataset.progress}%`;
    });
    const count = items.filter((a) => a.earned).length;
    const countEl = $('[data-achievement-count]');
    if (countEl) countEl.textContent = `${count} / ${items.length}`;
  }

  function renderProfileRecent(items) {
    const wrap = $('[data-profile-recent]');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML =
        '<p class="empty-state">Әзірге ойын жоқ. Жаттығудан немесе дүэлден баста!</p>';
      return;
    }
    wrap.innerHTML = items
      .map((item) => {
        if (item.type === 'duel') {
          const label =
            item.result === 'win' ? 'Жеңіс' : item.result === 'loss' ? 'Жеңіліс' : 'Тең';
          return `<div class="history-item">
            <span class="history-icon">${icon('swords')}</span>
            <span class="history-main"><strong>Дүэл · ${esc(item.opponent.nickname)}</strong><span>${formatDateStamp(item.createdAt, true)} · ${item.correct}/${item.total} дұрыс</span></span>
            <span class="history-score">${fmt(item.score)}<small><span class="result-pill ${item.result}">${label}</span></small></span>
          </div>`;
        }
        return `<div class="history-item">
          <span class="history-icon">${icon(item.type === 'daily' ? 'sun' : 'seed')}</span>
          <span class="history-main"><strong>${item.type === 'daily' ? 'Күнделікті сынақ' : 'Жаттығу'}</strong><span>${formatDateStamp(item.createdAt, true)} · ${item.correct}/${item.total} дұрыс</span></span>
          <span class="history-score">${fmt(item.score)}<small>ұпай</small></span>
        </div>`;
      })
      .join('');
  }

  function renderDailyWeek(days) {
    const wrap = $('[data-daily-week]');
    if (!wrap) return;
    const today = todayKey();
    wrap.innerHTML = days
      .map((d) => {
        const isToday = d.date === today;
        const isPlayed = d.played;
        return `<div class="week-day">
          <span>${dateToLabel(d.date)}</span>
          <span class="week-dot${isPlayed ? ' is-played' : ''}${isToday ? ' is-today' : ''}" title="${d.date}${isPlayed ? ` · ${d.score} ұпай` : ''}">${isPlayed ? '✓' : d.date.slice(8)}</span>
        </div>`;
      })
      .join('');
  }

  function showSettings() {
    const panel = $('[data-settings]');
    if (!panel) return;
    panel.hidden = false;
    if (state.user) {
      state.profileAvatar = state.user.avatar;
      const picker = $('[data-profile-avatar-pick]');
      if (picker) {
        $$('.avatar-option', picker).forEach((btn) => {
          const on = btn.dataset.avatar === state.user.avatar;
          btn.classList.toggle('is-selected', on);
          btn.setAttribute('aria-pressed', String(on));
        });
      }
    }
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideSettings() {
    const panel = $('[data-settings]');
    if (panel) panel.hidden = true;
    showFormError('password', '');
  }

  async function saveAvatar(button) {
    if (!state.user) return;
    if (state.profileAvatar === state.user.avatar) {
      toast('Аватар өзгерген жоқ', 'info', 2000);
      return;
    }
    await withLoading(button, async () => {
      try {
        const data = await api('/api/me', {
          method: 'PATCH',
          body: { avatar: state.profileAvatar },
        });
        state.user = { ...state.user, ...data.user };
        updateHeader();
        $('[data-profile-avatar]').src = avatarSrc(state.user.avatar);
        toast('Аватар жаңартылды', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  /* ------------------------------------------------------------
     Router
     ------------------------------------------------------------ */

  function parseRoute() {
    const raw = (location.hash || '#/').replace(/^#/, '') || '/';
    const parts = raw.split('/').filter(Boolean);
    const first = parts[0] || '';
    if (!first) return { name: 'landing' };
    if (first === 'login') return { name: 'auth', mode: 'login' };
    if (first === 'register') return { name: 'auth', mode: 'register' };
    if (first === 'play') return { name: 'play' };
    if (first === 'leaderboard') return { name: 'leaderboard' };
    if (first === 'profile') return { name: 'profile', nick: parts[1] || null };
    if (first === 'rules') return { name: 'rules' };
    if (first === 'room') return { name: 'room', code: (parts[1] || '').toUpperCase() };
    return { name: 'landing' };
  }

  function showView(name) {
    $$('.view').forEach((view) => {
      view.classList.toggle('is-active', view.dataset.view === name);
    });
    document.body.dataset.view = name;
    state.view = name;
    if (name === 'landing') setupReveals();
    if (name !== 'play' && name !== 'room') {
      setActiveNav(name === 'auth' ? '' : name);
    }
    if (name === 'room') setActiveNav('play');
    if (name === 'play') setActiveNav('play');
    if (name === 'leaderboard') setActiveNav('leaderboard');
    if (name === 'profile') setActiveNav('profile');
    if (name === 'rules') setActiveNav('rules');
    const titles = {
      landing: 'МАЙСТЕР — майлар мен тағамтану сайысы',
      auth: 'Кіру — МАЙСТЕР',
      play: 'Ойын алаңы — МАЙСТЕР',
      leaderboard: 'Рейтинг — МАЙСТЕР',
      profile: 'Профиль — МАЙСТЕР',
      rules: 'Ережелер — МАЙСТЕР',
      room: 'Онлайн дүэл — МАЙСТЕР',
    };
    document.title = titles[name] || 'МАЙСТЕР';
    if (!state.gameOpen) {
      window.scrollTo(0, 0);
      requestAnimationFrame(updateScrollProgress);
    }
  }

  async function router() {
    const initialRoute = parseRoute();
    let route = initialRoute;

    if (!state.user && ['play', 'leaderboard', 'profile', 'room'].includes(route.name)) {
      state.intendedHash = location.hash || '#/play';
      route = { name: 'auth', mode: 'login' };
      replaceHash('/login');
    }
    if (state.user && (route.name === 'landing' || route.name === 'auth')) {
      route = { name: 'play' };
      replaceHash('/play');
    }
    if (!state.user && route.name === 'landing') {
      /* landing */
    }

    if (state.roomCode && route.name !== 'room') {
      closeRoom(true);
    }
    if (state.roomCode && route.name === 'room' && route.code !== state.roomCode) {
      closeRoom(true);
    }
    if (state.gameKind === 'solo' && route.name !== 'play' && state.gameOpen) {
      closeGameLayer();
      state.solo = null;
      state.gameKind = null;
    }

    showView(route.name);

    if (route.name === 'auth') {
      setAuthMode(route.mode || 'login', false);
      return;
    }
    if (route.name === 'play') {
      await loadPlay();
      return;
    }
    if (route.name === 'landing') {
      return;
    }
    if (route.name === 'leaderboard') {
      await setBoard(state.board);
      return;
    }
    if (route.name === 'profile') {
      await loadProfile(route.nick);
      return;
    }
    if (route.name === 'rules') {
      return;
    }
    if (route.name === 'room') {
      if (!route.code) {
        navigate('/play');
        return;
      }
      await enterRoom(route.code);
    }
  }

  /* ------------------------------------------------------------
     Event binding
     ------------------------------------------------------------ */

  function onAnswerClick(button) {
    if (button.disabled) return;
    const choice = Number(button.dataset.choice);
    if (!Number.isInteger(choice)) return;
    if (document.body.dataset.view === 'room' && state.gameKind === 'duel') {
      answerDuel(choice);
      return;
    }
    if (state.gameKind === 'solo' && state.solo && $('#feedback')?.classList.contains('hidden')) {
      submitSoloAnswer(choice);
    }
  }

  async function handleAction(action, el) {
    switch (action) {
      case 'logout':
        doLogout();
        break;
      case 'edit-profile':
        showSettings();
        break;
      case 'close-settings':
        hideSettings();
        break;
      case 'save-avatar':
        saveAvatar(el);
        break;
      case 'start-solo':
        startSolo('solo', el);
        break;
      case 'start-daily':
        startSolo('daily', el);
        break;
      case 'quick-match':
        quickMatch(el);
        break;
      case 'create-room':
        createRoom(el);
        break;
      case 'cancel-search':
        stopSearchManually();
        break;
      case 'copy-code':
        copyText(state.room?.code || $('[data-lobby-code]')?.textContent || '', 'Бөлме коды көшірілді');
        break;
      case 'copy-link':
        copyText(roomUrl(state.roomCode || state.room?.code || ''), 'Сілтеме көшірілді');
        break;
      case 'share-room':
        shareCurrentRoom();
        break;
      case 'start-room':
        startRoom(el);
        break;
      case 'leave-room':
        leaveRoomAndExit();
        break;
      case 'quit-game':
        quitGame();
        break;
      case 'next-question':
        nextSoloQuestion(el);
        break;
      case 'toggle-sound':
        toggleSound();
        break;
      case 'result-again':
        playAgain(el);
        break;
      case 'result-leaderboard':
        exitGameTo('/leaderboard');
        break;
      case 'result-play':
        exitGameTo('/play');
        break;
      case 'rematch':
        requestRematch(el);
        break;
      case 'result-leave-room':
        closeRoom(true);
        navigate('/play');
        break;
      default:
        break;
    }
  }

  async function shareCurrentRoom() {
    const code = state.roomCode || state.room?.code;
    if (!code) return;
    const url = roomUrl(code);
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'МАЙСТЕР — онлайн дүэл',
          text: `Бөлме коды: ${code}. МАЙСТЕР-де май туралы біліміңді сына!`,
          url,
        });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    copyText(url, 'Бөлме сілтемесі көшірілді');
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (actionEl) {
        event.preventDefault();
        handleAction(actionEl.dataset.action, actionEl);
      }

      const scrollEl = event.target.closest('[data-scroll]');
      if (scrollEl) {
        event.preventDefault();
        scrollToSection(scrollEl.dataset.scroll);
      }

      const avatarBtn = event.target.closest('[data-avatar]');
      if (avatarBtn) {
        event.preventDefault();
        selectAvatar(avatarBtn);
      }

      const boardBtn = event.target.closest('[data-board]');
      if (boardBtn) {
        event.preventDefault();
        setBoard(boardBtn.dataset.board);
      }

      const answerBtn = event.target.closest('.answer[data-choice]');
      if (answerBtn) {
        event.preventDefault();
        onAnswerClick(answerBtn);
      }

      const pwBtn = event.target.closest('[data-toggle-password]');
      if (pwBtn) {
        event.preventDefault();
        const wrap = pwBtn.closest('.password-wrap');
        const input = wrap?.querySelector('input');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        const use = pwBtn.querySelector('use');
        if (use) use.setAttribute('href', `/assets/icons.svg#${show ? 'eye-off' : 'eye'}`);
        pwBtn.setAttribute('aria-label', show ? 'Құпия сөзді жасыру' : 'Құпия сөзді көрсету');
      }

      const sameHashLink = event.target.closest('a[href^="#/"]');
      if (sameHashLink) {
        const href = sameHashLink.getAttribute('href');
        if (href === location.hash && !state.gameOpen) {
          event.preventDefault();
          router();
        }
      }
    });

    $('#enterForm')?.addEventListener('submit', handleEnter);
    $('#enterForm input[name="nickname"]')?.addEventListener('input', (event) => {
      scheduleNickLookup(event.currentTarget.value);
    });
    $('#joinRoomForm')?.addEventListener('submit', handleJoinSubmit);

    const roomInput = $('#roomCodeInput');
    if (roomInput) {
      roomInput.addEventListener('input', () => {
        roomInput.value = roomInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 6);
      });
    }

    $('#searchDialog')?.addEventListener('cancel', (event) => {
      event.preventDefault();
      stopSearchManually();
    });

    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio);

    document.addEventListener('pointerdown', (event) => {
      if (prefersReducedMotion()) return;
      const target = event.target.closest('.btn, .answer, .mode-card, .tab, .lb-tab');
      if (!target || target.disabled || target.classList.contains('is-loading')) return;
      if (getComputedStyle(target).position === 'static') return;
      const rect = target.getBoundingClientRect();
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      target.append(ripple);
      setTimeout(() => ripple.remove(), 720);
    });

    document.addEventListener('keydown', (event) => {
      if (!state.gameOpen) return;
      const tag = document.activeElement?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (/^[1-4]$/.test(event.key)) {
        const answer = $$('#gameStage .answer')[Number(event.key) - 1];
        if (answer && !answer.disabled && !$('#gameStage').classList.contains('hidden')) {
          event.preventDefault();
          answer.click();
        }
      }
      if (event.key === 'Enter') {
        const fb = $('#feedback');
        const nextBtn = $('[data-action="next-question"]');
        if (
          fb &&
          !fb.classList.contains('hidden') &&
          nextBtn &&
          !nextBtn.classList.contains('hidden')
        ) {
          event.preventDefault();
          nextBtn.click();
        }
      }
    });

    window.addEventListener('hashchange', () => {
      router();
    });

    window.addEventListener(
      'scroll',
      () => {
        $('#siteHead')?.classList.toggle('is-scrolled', window.scrollY > 8);
        updateScrollProgress();
      },
      { passive: true }
    );
  }

  /* ------------------------------------------------------------
     Boot
     ------------------------------------------------------------ */

  async function init() {
    bindEvents();
    updateHeader();
    syncSoundButton();
    setupReveals();
    setupHeroTilt();
    updateScrollProgress();
    loadStats();
    setInterval(loadStats, 60000);
    try {
      const me = await api('/api/me');
      state.user = me.user;
      state.user.activeRoom = me.activeRoom;
      state.achievements = me.achievements;
    } catch (err) {
      if (err.status !== 401 && err.status !== 0) {
        console.warn('auth check:', err.message);
      }
    }
    updateHeader();
    await router();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
