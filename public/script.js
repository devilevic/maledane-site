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
   AI Chat – connected to /api/chat
================================ */
(() => {
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');
  const messages = document.getElementById('aiMessages');

  if (!form || !input || !messages) return;

  let isSending = false;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSending) return;

    const text = input.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    input.value = '';

    // Typing indicator
    const typingEl = addMessage('…', 'bot', { isTyping: true });

    isSending = true;
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });

      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }

      const data = await r.json();
      const reply = (data?.reply || '').toString().trim();

      // Replace typing indicator with real reply
      typingEl.textContent =
        reply ||
        'Děkuji. Můžete prosím dotaz upřesnit?';
    } catch (err) {
      console.error('Chat request failed:', err);
      typingEl.textContent =
        'Omlouvám se, teď se mi nepodařilo odpovědět. Zkuste to prosím znovu, nebo nám napište přes Kontakt.';
    } finally {
      isSending = false;
    }
  });

  function addMessage(text, type, opts = {}) {
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${type}`;
    div.textContent = text;

    if (opts.isTyping) {
      div.setAttribute('aria-live', 'polite');
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }
})();