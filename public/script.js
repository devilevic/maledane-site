/* ================================
   Mobile navigation + UX helpers
================================ */
(() => {
  const btn = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');
  const header = document.querySelector('[data-header]');

  if (btn && nav) {
    const setOpen = (open) => {
      nav.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    };

    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      setOpen(open);
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!nav.classList.contains('is-open')) return;
      if (e.target.closest('[data-nav]')) return;
      if (e.target.closest('[data-nav-toggle]')) return;
      setOpen(false);
    });

    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a && nav.classList.contains('is-open')) setOpen(false);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) setOpen(false);
    });
  }

  /* ================================
     Theme toggle (light / dark)
  ================================ */
  const html = document.documentElement;
  const themeBtn = document.querySelector('[data-theme-toggle]');
  const themeEmoji = document.querySelector('[data-theme-emoji]');

  const getSystemTheme = () =>
    window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';

  const savedTheme = localStorage.getItem('theme');
  const initialTheme = savedTheme || getSystemTheme();

  const applyTheme = (theme) => {
    html.setAttribute('data-theme', theme);
    if (themeEmoji) {
      themeEmoji.textContent = theme === 'light' ? '☀️' : '🌙';
    }
  };

  applyTheme(initialTheme);

  themeBtn?.addEventListener('click', () => {
    const next =
      html.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('theme', next);
  });

  /* ================================
     Header shadow on scroll
  ================================ */
  const onScroll = () => {
    header?.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ================================
   AI Chat – memory + /api/chat
================================ */
(() => {
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');
  const messagesEl = document.getElementById('aiMessages');

  if (!form || !input || !messagesEl) return;

  const STORAGE_KEY = 'aiChatHistory_v1';
  const MAX_TURNS = 8; // 8 turns = 16 messages (user+bot)
  let isSending = false;

  // Load existing history (if any) and render it
  let history = loadHistory();
  renderHistory(history);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSending) return;

    const text = input.value.trim();
    if (!text) return;

    // Add user message to UI + memory
    pushToHistory({ role: 'user', content: text });
    addMessage(text, 'user');
    input.value = '';
    input.focus();

    // Typing indicator
    const typingEl = addMessage('…', 'bot', { isTyping: true });

    isSending = true;
    input.disabled = true;

    try {
      const payload = {
        // send a trimmed window of messages to keep cost low
        messages: getRecentHistoryForRequest()
      };

      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const data = await r.json();
      const reply = (data?.reply || '').toString().trim();

      // Replace typing indicator with real reply
      typingEl.textContent =
        reply || 'Děkuji. Můžete prosím dotaz upřesnit?';

      // Save bot message to memory
      pushToHistory({ role: 'assistant', content: typingEl.textContent });
    } catch (err) {
      console.error('Chat request failed:', err);
      typingEl.textContent =
        'Omlouvám se, teď se mi nepodařilo odpovědět. Zkuste to prosím znovu, nebo nám napište přes Kontakt.';
      pushToHistory({ role: 'assistant', content: typingEl.textContent });
    } finally {
      isSending = false;
      input.disabled = false;
      input.focus();
    }
  });

  function addMessage(text, type, opts = {}) {
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${type}`;
    div.textContent = text;

    if (opts.isTyping) div.setAttribute('aria-live', 'polite');

    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      // sanitize
      return parsed
        .filter(
          (m) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
        )
        .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
    } catch {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }

  function pushToHistory(msg) {
    history.push(msg);

    // Keep last MAX_TURNS turns (user+assistant = 2 msgs per turn)
    const maxMessages = MAX_TURNS * 2;
    if (history.length > maxMessages) {
      history = history.slice(history.length - maxMessages);
    }

    saveHistory();
  }

  function getRecentHistoryForRequest() {
    // Return only last MAX_TURNS turns; already trimmed in pushToHistory,
    // but keep it explicit + safe.
    const maxMessages = MAX_TURNS * 2;
    return history.slice(-maxMessages);
  }

  function renderHistory(hist) {
    messagesEl.innerHTML = '';
    hist.forEach((m) => {
      addMessage(m.content, m.role === 'user' ? 'user' : 'bot');
    });
  }
})();