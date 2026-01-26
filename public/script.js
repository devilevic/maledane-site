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
   AI Chat – memory + STREAMING
================================ */
(() => {
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');
  const messagesEl = document.getElementById('aiMessages');

  if (!form || !input || !messagesEl) return;

  const STORAGE_KEY = 'aiChatHistory_v1';
  const MAX_TURNS = 8; // 8 turns = 16 messages (user+assistant)
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

    // Typing indicator (animated dots)
    const typingEl = addMessage('', 'bot', { isTyping: true });
    typingEl.innerHTML =
      '<span class="ai-typing"><span></span><span></span><span></span></span>';

    isSending = true;
    input.disabled = true;

    try {
      const r = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: getRecentHistoryForRequest() })
      });

      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      let started = false;
      let full = '';

      const reader = r.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events separated by blank line
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;

          const payload = JSON.parse(line.slice(6));

          if (payload.delta) {
            if (!started) {
              started = true;
              typingEl.textContent = ''; // remove dots
            }
            full += payload.delta;
            typingEl.textContent = full;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }

          if (payload.done) {
            const finalText = (full || typingEl.textContent || '').trim();
            if (finalText) {
              pushToHistory({ role: 'assistant', content: finalText });
            }
          }

          if (payload.error) {
            throw new Error(payload.error);
          }
        }
      }

      // If stream ended without "done", still save what we have
      const finalText = (full || typingEl.textContent || '').trim();
      if (finalText && !historyHasLastAssistant(finalText)) {
        pushToHistory({ role: 'assistant', content: finalText });
      }
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
      // ignore storage failures
    }
  }

  function pushToHistory(msg) {
    history.push(msg);

    const maxMessages = MAX_TURNS * 2;
    if (history.length > maxMessages) {
      history = history.slice(history.length - maxMessages);
    }

    saveHistory();
  }

  function getRecentHistoryForRequest() {
    const maxMessages = MAX_TURNS * 2;
    return history.slice(-maxMessages);
  }

  function renderHistory(hist) {
    messagesEl.innerHTML = '';
    hist.forEach((m) => {
      addMessage(m.content, m.role === 'user' ? 'user' : 'bot');
    });
  }

  function historyHasLastAssistant(text) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') {
        return history[i].content === text;
      }
    }
    return false;
  }
})();