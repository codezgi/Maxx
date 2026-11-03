/* Maxx Global Medikal — site scripti (kütüphanesiz).
   Motion dili: tek easing ailesi, yalnızca transform/opacity/clip-path.
   JS kapalıysa hiçbir içerik gizli kalmaz ("js" sınıfı hiç eklenmez). */
(function () {
  "use strict";

  /* ---------- Ziyaretçi doğrulama sinyali ----------
     Sunucudaki sayaç bu sinyali gönderen ziyaretçileri "gerçek insan" sayar;
     JS çalıştırmayan botlar gönderemez. Otomasyon tarayıcıları (webdriver) hariç. */
  try {
    if (!navigator.webdriver) {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/iz");
      else fetch("/api/iz", { method: "POST", keepalive: true }).catch(function () {});
    }
  } catch (e) { /* sayım sitenin çalışmasını asla engellemesin */ }

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Mobil menü ---------- */
  var burger = document.querySelector(".nav-burger");
  var closeButton = document.querySelector(".nav-close");
  var subToggles = document.querySelectorAll(".nav-toggle-sub");
  function closeMobileNav() {
    document.body.classList.remove("nav-open");
    if (burger) burger.setAttribute("aria-expanded", "false");
    subToggles.forEach(function (btn) {
      btn.setAttribute("aria-expanded", "false");
      if (btn.parentElement) btn.parentElement.classList.remove("sub-open");
    });
  }
  if (burger) {
    burger.addEventListener("click", function () {
      var open = document.body.classList.toggle("nav-open");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) closeMobileNav();
    });
  }
  if (closeButton) {
    closeButton.addEventListener("click", closeMobileNav);
  }
  subToggles.forEach(function (btn) {
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function () {
      if (!window.matchMedia("(max-width: 1080px)").matches) return;
      var item = btn.parentElement;
      var willOpen = !item.classList.contains("sub-open");
      document.querySelectorAll(".nav > li.sub-open").forEach(function (li) {
        if (li !== item) {
          li.classList.remove("sub-open");
          var other = li.querySelector(".nav-toggle-sub");
          if (other) other.setAttribute("aria-expanded", "false");
        }
      });
      item.classList.toggle("sub-open", willOpen);
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  });
  document.querySelectorAll(".main-nav a").forEach(function (link) {
    link.addEventListener("click", function () {
      if (window.matchMedia("(max-width: 1080px)").matches) closeMobileNav();
    });
  });
  window.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeMobileNav();
  });
  window.addEventListener("resize", function () {
    if (!window.matchMedia("(max-width: 1080px)").matches) closeMobileNav();
  });

  /* ---------- Hero videosu ----------
     Tarayıcılar otomatik oynatmaya yalnızca video sessizse izin verir ve
     bazıları muted'ı JS üzerinden ister. iOS düşük güç modunda ilk dokunuşta
     ve sekmeye geri dönüldüğünde yeniden başlatmayı deneriz. */
  var heroVideo = document.querySelector(".hero-bg");
  if (heroVideo) {
    heroVideo.muted = true;
    heroVideo.defaultMuted = true;
    var tryPlay = function () {
      if (heroVideo.paused) heroVideo.play().catch(function () {});
    };
    tryPlay();
    heroVideo.addEventListener("loadedmetadata", tryPlay);
    heroVideo.addEventListener("canplay", tryPlay);
    window.addEventListener("touchstart", tryPlay, { passive: true });
    window.addEventListener("pointerdown", tryPlay);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) tryPlay();
    });
  }

  var lang = (document.documentElement.lang || "tr").slice(0, 2);
  var T = lang === "en" ? {
    gateTitle: "For healthcare professionals",
    gateBody: "This section contains technical and scientific information about medical devices intended for healthcare professionals and technical staff of healthcare institutions, in line with medical device promotion rules. It is not medical advice for patients.",
    gateYes: "I am a healthcare professional / authorised partner",
    gateNo: "Return to home page", prev: "Previous products", next: "Next products", home: "/en/"
  } : {
    gateTitle: "Sağlık meslek mensupları için",
    gateBody: "Bu bölüm, tıbbi cihaz tanıtım mevzuatı gereği sağlık meslek mensuplarına ve sağlık kurum ve kuruluşlarının teknik elemanlarına yönelik teknik ve bilimsel bilgiler içerir. Hastalara yönelik tıbbi tavsiye değildir.",
    gateYes: "Sağlık meslek mensubuyum / yetkili iş ortağıyım",
    gateNo: "Ana sayfaya dön", prev: "Önceki ürünler", next: "Sonraki ürünler", home: "/"
  };

  /* ---------- Mesleki içerik bildirimi (Yönetmelik m.18/2, m.19/4) ---------- */
  if (document.body.getAttribute("data-audience") === "hcp") {
    var approved = false;
    try { approved = localStorage.getItem("mx-hcp") === "1"; } catch (e) {}
    if (!approved && typeof HTMLDialogElement === "function") {
      var gate = document.createElement("dialog");
      gate.className = "hcp-gate";
      gate.setAttribute("aria-labelledby", "hcp-title");
      gate.innerHTML = '<div class="hcp-gate-box"><h2 id="hcp-title">' + T.gateTitle + "</h2><p>" + T.gateBody +
        '</p><div class="hcp-gate-actions"><button type="button" class="btn btn-accent" data-yes>' + T.gateYes +
        '</button><a class="btn btn-outline" href="' + T.home + '">' + T.gateNo + "</a></div></div>";
      document.body.appendChild(gate);
      gate.addEventListener("cancel", function (e) { e.preventDefault(); });
      gate.querySelector("[data-yes]").addEventListener("click", function () {
        try { localStorage.setItem("mx-hcp", "1"); } catch (e) {}
        gate.close(); gate.remove();
      });
      gate.showModal();
    }
  }

  /* ---------- Başlık çubuğu ---------- */
  var header = document.querySelector(".site-header");
  var lastY = window.scrollY;
  function headerState() {
    if (!header) return;
    var y = window.scrollY;
    header.classList.toggle("is-solid", y > 40);
    if (document.body.classList.contains("nav-open")) { lastY = y; return; }
    if (Math.abs(y - lastY) > 6) {
      header.classList.toggle("is-away", y > lastY && y > 420 && !header.contains(document.activeElement));
      lastY = y;
    }
  }
  headerState();

  /* ---------- Ürün slaytı: sürükleme, oklar, ilerleme ---------- */
  var ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
  document.querySelectorAll("[data-carousel]").forEach(function (root) {
    var track = root.querySelector(".carousel-track");
    if (!track) return;
    var paused = false;
    var ui = document.createElement("div");
    ui.className = "carousel-ui";
    ui.innerHTML = '<div class="carousel-bar" aria-hidden="true"><i></i></div><div class="carousel-btns">' +
      '<button type="button" class="carousel-btn" data-dir="-1" aria-label="' + T.prev + '" style="transform:scaleX(-1)">' + ARROW + "</button>" +
      '<button type="button" class="carousel-btn" data-dir="1" aria-label="' + T.next + '">' + ARROW + "</button></div>";
    root.appendChild(ui);
    var bar = ui.querySelector(".carousel-bar i");
    function progress() {
      var max = track.scrollWidth - track.clientWidth;
      var vis = track.clientWidth / track.scrollWidth;
      bar.style.setProperty("--p", (vis + (max > 0 ? track.scrollLeft / max : 1) * (1 - vis)).toFixed(3));
    }
    track.addEventListener("scroll", progress, { passive: true });
    window.addEventListener("resize", progress);
    progress();
    function step(dir) {
      var first = track.children[0], gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      var w = (first ? first.getBoundingClientRect().width : 300) + gap;
      var max = track.scrollWidth - track.clientWidth;
      var to = track.scrollLeft + dir * w;
      if (to > max + 4) to = 0; else if (to < -4) to = max;
      track.scrollTo({ left: to, behavior: reduceMotion ? "auto" : "smooth" });
    }
    ui.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-dir]");
      if (b) { step(parseInt(b.getAttribute("data-dir"), 10)); paused = true; root.setAttribute("data-held", "1"); }
    });
    root.addEventListener("mouseenter", function () { paused = true; });
    root.addEventListener("mouseleave", function () { if (!root.getAttribute("data-held")) paused = false; });
    root.addEventListener("focusin", function () { paused = true; });
    root.addEventListener("focusout", function () { if (!root.getAttribute("data-held")) paused = false; });

    var startX = 0, startScroll = 0, dragging = false, moved = false;
    track.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType !== "mouse") return;
      dragging = true; moved = false;
      startX = ev.clientX; startScroll = track.scrollLeft;
      track.classList.add("dragging");
    });
    window.addEventListener("pointermove", function (ev) {
      if (!dragging) return;
      var dx = ev.clientX - startX;
      if (Math.abs(dx) > 5) moved = true;
      track.scrollLeft = startScroll - dx;
    });
    window.addEventListener("pointerup", function () { dragging = false; track.classList.remove("dragging"); });
    track.addEventListener("click", function (ev) {
      if (moved) { ev.preventDefault(); moved = false; }
    }, true);
    track.addEventListener("dragstart", function (ev) { ev.preventDefault(); });

    if (!reduceMotion) {
      setInterval(function () {
        if (paused || dragging || document.hidden) return;
        var r = root.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;
        step(1);
      }, 6000);
    }
  });

  /* ---------- Canvas sahneleri: ilk gerektiğinde yüklenir ---------- */
  var sceneEls = document.querySelectorAll("[data-scene]");
  if (sceneEls.length) {
    var loadScenes = function () {
      if (loadScenes.done) return; loadScenes.done = true;
      var s = document.createElement("script");
      s.src = "/assets/js/scenes.js?v=motion-20261103j"; s.async = true;
      document.head.appendChild(s);
    };
    if ("IntersectionObserver" in window) {
      var sceneIO = new IntersectionObserver(function (es) {
        if (es.some(function (e) { return e.isIntersecting; })) { loadScenes(); sceneIO.disconnect(); }
      }, { rootMargin: "400px" });
      sceneEls.forEach(function (el) { sceneIO.observe(el); });
    } else loadScenes();
  }

  /* ---------- İçindekiler: okunan bölümü işaretle (hareket tercihinden bağımsız) ---------- */
  var tocLinks = document.querySelectorAll(".toc a");
  if (tocLinks.length && "IntersectionObserver" in window) {
    var tocIO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        tocLinks.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-20% 0px -70% 0px" });
    document.querySelectorAll(".article-body h2[id]").forEach(function (h) { tocIO.observe(h); });
  }

  var progressBar = document.querySelector(".read-progress");
  var articleEl = document.querySelector(".article-body");
  var heroInner = document.querySelector(".hero-inner");
  var ctaBand = document.querySelector(".cta-band");
  var globeStage = document.querySelector(".globe-stage");
  var ticking = false;
  function onScroll() {
    ticking = false;
    headerState();
    var y = window.scrollY, vh = window.innerHeight;
    if (progressBar && articleEl) {
      var r = articleEl.getBoundingClientRect();
      progressBar.style.setProperty("--p", Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh))).toFixed(4));
    }
    if (reduceMotion) return;
    if (heroInner && y < vh * 1.1) {
      heroInner.style.setProperty("--hero-y", (y * .12).toFixed(1) + "px");
      heroInner.style.setProperty("--hero-o", Math.max(0, 1 - y / (vh * .8)).toFixed(3));
    }
    if (ctaBand) {
      var c = ctaBand.getBoundingClientRect();
      if (c.bottom > 0 && c.top < vh) ctaBand.style.setProperty("--band-y", ((c.top - vh / 2) * -.08).toFixed(1) + "px");
    }
    if (globeStage) {
      var g = globeStage.getBoundingClientRect();
      if (g.bottom > 0 && g.top < vh) globeStage.style.setProperty("--scroll", ((g.top + g.height / 2 - vh / 2) / vh).toFixed(3));
    }
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  onScroll();

  if (reduceMotion) return; // animasyon istenmiyorsa burada bitir

  document.documentElement.classList.add("js");

  /* ---------- 1) Giriş hareketleri ----------
     [seçici, kademe (sn), satırdaki öge, tür] */
  var revealGroups = [
    [".hero-badge", .15, 1, ""],
    [".hero .lead", .55, 1, ""],
    [".hero-actions", .7, 1, ""],
    [".hero-list li", .12, 9, ""],
    [".breadcrumb", .35, 1, "fade"],
    [".section-head .eyebrow", 0, 1, ""],
    [".section-head h2", .06, 1, "line"],
    [".section-head p", .14, 1, ""],
    [".about-media", 0, 1, "mask"],
    [".product-detail .media", 0, 1, "mask"],
    [".article-cover", 0, 1, "mask"],
    [".stat-cards > *", .09, 9, ""],
    [".grid > *", .08, 3, ""],
    [".carousel-track > *", .08, 3, ""],
    [".carousel-ui", .2, 1, "fade"],
    [".globe-stage", 0, 1, ""],
    [".icon-box", .09, 9, ""],
    [".call-box", .15, 1, ""],
    [".cta-band", 0, 1, ""],
    [".product-detail .content", .12, 1, ""],
    [".article-body > *", 0, 1, ""],
    [".form-wrap", .1, 1, ""],
  ];
  var seen = [];
  revealGroups.forEach(function (g) {
    var els = document.querySelectorAll(g[0]);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (seen.indexOf(el) !== -1) continue;
      seen.push(el);
      el.setAttribute("data-anim", g[3]);
      var delay = g[2] > 1 ? g[1] * (i % g[2]) : g[1];
      if (delay) el.style.setProperty("--d", delay.toFixed(2) + "s");
    }
  });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("in-view");
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  seen.forEach(function (el) {
    /* İlk ekrandaki hero ögeleri kaydırma beklemeden açılır */
    if (el.closest(".hero")) requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add("in-view"); }); });
    else io.observe(el);
  });

  /* ---------- 2) Ana başlık: kelime kelime maskeli açılış ----------
     Yalnız tek h1'de uygulanır; bölüm başlıkları bölünmeden açılır (GEO). */
  document.querySelectorAll(".hero h1, .page-hero h1").forEach(function (el) {
    var text = el.textContent.replace(/\s+/g, " ").trim();
    el.setAttribute("aria-label", text);
    var wrap = document.createElement("span");
    wrap.setAttribute("aria-hidden", "true");
    text.split(" ").forEach(function (part, i, all) {
      var word = document.createElement("span");
      word.className = "ta-word";
      var inner = document.createElement("span");
      inner.className = "ta-char";
      inner.textContent = part;
      inner.style.setProperty("--w", (.08 + i * .055).toFixed(3) + "s");
      word.appendChild(inner);
      wrap.appendChild(word);
      if (i < all.length - 1) wrap.appendChild(document.createTextNode(" "));
    });
    el.textContent = "";
    el.appendChild(wrap);
    el.classList.add("ta");
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add("ta-in"); }); });
  });

  /* ---------- 3) Sayaçlar ---------- */
  var counters = document.querySelectorAll(".stat-card .num, .exp-badge strong");
  var cntIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      cntIO.unobserve(e.target);
      var el = e.target;
      var m = el.textContent.match(/^(\D*)(\d+)(\D*)$/);
      if (!m) return;
      var prefix = m[1], target = parseInt(m[2], 10), suffix = m[3];
      var t0 = null, DUR = 1500;
      el.textContent = prefix + "0" + suffix;
      (function tick(t) {
        if (t === undefined) return requestAnimationFrame(tick);
        if (!t0) t0 = t;
        var p = Math.min((t - t0) / DUR, 1);
        el.textContent = prefix + Math.round(target * (1 - Math.pow(2, -10 * p))) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = prefix + target + suffix;
      })();
      setTimeout(function () { el.textContent = prefix + target + suffix; }, DUR + 400);
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  counters.forEach(function (el) { cntIO.observe(el); });

  /* ---------- 4) Kartlarda imleci izleyen ışık ---------- */
  if (window.matchMedia("(hover: hover)").matches) {
    document.addEventListener("pointermove", function (ev) {
      var c = ev.target.closest && ev.target.closest(".card, .product-card, .stat-card");
      if (!c) return;
      var r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (ev.clientX - r.left).toFixed(0) + "px");
      c.style.setProperty("--my", (ev.clientY - r.top).toFixed(0) + "px");
    }, { passive: true });
  }
})();
