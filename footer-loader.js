(() => {
  // Keep footer markup in ONE place (footer.html), but include a fallback for Chrome file://
  const FALLBACK_FOOTER_HTML = `
<footer class="footer footer-compact">
  <div class="container footer-grid footer-grid-compact">
    <div class="footer-col footer-about">
      <p class="footer-title">Malé Daně s.r.o.</p>
      <p class="muted footer-blurb">
        Komplexní poradenství v oblasti účetnictví a daní.
      </p>
      <p class="footer-contact">
        <a href="tel:+420602400746">+420 602 400 746</a>
        <span class="sep">•</span>
        <a href="mailto:info@maledane.cz">info@maledane.cz</a>
      </p>

      <div class="footer-komora">
        <img
          class="kdp-logo"
          src="https://maledane.cz/wp-content/uploads/2022/09/komora.png"
          alt="Komora daňových poradců ČR"
          loading="lazy"
        />
        <span>Jsme členem Komory daňových poradců v ČR</span>
      </div>
    </div>

    <div class="footer-col footer-menu">
      <p class="footer-title">Menu</p>
      <div class="footer-links">
        <a href="index.html">Úvod</a>
        <a href="sluzby.html">Služby</a>
        <a href="o-nas.html">O nás</a>
        <a href="kontakt.html">Kontakt</a>
        <a href="ochrana-osobnich-udaju.html">Ochrana osobních údajů</a>
        <a href="zasady-cookies.html">Zásady cookies</a>
      </div>
    </div>

    <div class="footer-col footer-office">
      <p class="footer-title">Kancelář Koněvova</p>
      <p class="muted"><b>Po – Pá</b> 8:00 – 18:00</p>
      <p class="muted">Koněvova 39<br>130 00 Praha 3</p>
      <a class="footer-smalllink" href="kontakt.html">Zobrazit kontakt</a>
    </div>

    <div class="footer-col footer-office">
      <p class="footer-title">Kancelář Mukařov</p>
      <p class="muted"><b>Po – Pá</b> po telefonické domluvě</p>
      <p class="muted">Zelená 248<br>251 62 Mukařov</p>
      <a class="footer-smalllink" href="kontakt.html">Zobrazit kontakt</a>
    </div>
  </div>

  <div class="container footer-bottom">
    <span class="muted2">© 2026 Malé Daně s.r.o. | </span>
    <span class="muted2">Web &amp; design: <a href="https://semlin.eu">semlin.eu</a></span>
  </div>
</footer>
`.trim();

  function injectFooter(html) {
    const mount = document.getElementById("site-footer");
    if (!mount) return;
    mount.innerHTML = html;
  }

  // Try to load footer.html (works on http/https). If blocked (Chrome file://), use fallback.
  fetch("footer.html", { cache: "no-store" })
    .then((r) => {
      if (!r.ok) throw new Error("Footer fetch failed");
      return r.text();
    })
    .then((html) => injectFooter(html))
    .catch(() => injectFooter(FALLBACK_FOOTER_HTML));
})();