/* Maxx Global Medikal — site scripti.
   Orijinal temadaki WOW/GSAP/Swiper animasyonlarının kütüphanesiz karşılığı.
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

  if (reduceMotion) return; // animasyon istenmiyorsa burada bitir

  document.documentElement.classList.add("js");

  /* ---------- 1) Kayarken belirme (WOW fadeInUp karşılığı) ----------
     Seçici grupları: [selector, grupiçi kademe (s), kolon sayısı] */
  var revealGroups = [
    [".hero-badge", 0, 1],
    [".hero .lead", 0.2, 1],
    [".hero-actions", 0.4, 1],
    [".hero-list li", 0.2, 9],
    [".section-head", 0, 1],
    [".about-media", 0, 1],
    [".stat-cards > *", 0.2, 9],
    [".grid > *", 0.2, 3],
    [".carousel-track > *", 0.2, 3],
    [".why-grid > div", 0.2, 2],
    [".icon-box", 0.2, 9],
    [".call-box", 0.4, 1],
    [".cta-band", 0, 1],
    [".product-detail .media", 0, 1],
    [".product-detail .content", 0.2, 1],
    [".form-wrap", 0.2, 1],
    [".breadcrumb", 0.2, 1],
  ];
  var seen = [];
  revealGroups.forEach(function (g) {
    var els = document.querySelectorAll(g[0]);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (seen.indexOf(el) !== -1) continue;
      seen.push(el);
      el.setAttribute("data-anim", "");
      var delay = g[1] * ((i % g[2]) + (g[1] && g[2] === 1 ? 1 : 0));
      if (g[2] > 1) delay = g[1] * (i % g[2]);
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
  }, { rootMargin: "0px 0px -10% 0px" });
  seen.forEach(function (el) { io.observe(el); });

  /* ---------- 2) Harf harf başlık açılması (text-anime-style-3 karşılığı)
     Yalnızca sayfanın tek ana başlığında (hero/page-hero h1) uygulanır — bölüm
     başlıklarında (.section-head h2) metni parçalamak, arama motoru/LLM
     tarayıcılarının ham HTML'de okuduğu metni gereksiz yere "işlenmiş" hale
     getiriyordu (GEO denetimi). section-head zaten kendi fadeInUp efektini
     data-anim ile alıyor, o yüzden görsel kayıp yok. */
  var taTargets = document.querySelectorAll(".hero h1, .page-hero h1");
  var taIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("ta-in");
        taIO.unobserve(e.target);
      }
    });
  }, { rootMargin: "0px 0px -10% 0px" });

  taTargets.forEach(function (el) {
    var text = el.textContent;
    el.setAttribute("aria-label", text.trim());
    var wrap = document.createElement("span");
    wrap.setAttribute("aria-hidden", "true");
    var chIndex = 0;
    text.split(/(\s+)/).forEach(function (part) {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        wrap.appendChild(document.createTextNode(" "));
        return;
      }
      var word = document.createElement("span");
      word.className = "ta-word";
      for (var i = 0; i < part.length; i++) {
        var ch = document.createElement("span");
        ch.className = "ta-char";
        ch.textContent = part[i];
        ch.style.transitionDelay = (chIndex * 0.02).toFixed(2) + "s";
        word.appendChild(ch);
        chIndex++;
      }
      wrap.appendChild(word);
    });
    el.textContent = "";
    el.appendChild(wrap);
    el.classList.add("ta");
    taIO.observe(el);
  });

  /* ---------- 3) Yukarı sayan sayaçlar (counterUp karşılığı) ---------- */
  var counters = document.querySelectorAll(".stat-card .num, .exp-badge strong");
  var cntIO = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      cntIO.unobserve(e.target);
      var el = e.target;
      var m = el.textContent.match(/^(\D*)(\d+)(\D*)$/);
      if (!m) return;
      var prefix = m[1], target = parseInt(m[2], 10), suffix = m[3];
      var t0 = null, DUR = 1800, done = false;
      function tick(t) {
        if (done) return;
        if (!t0) t0 = t;
        var p = Math.min((t - t0) / DUR, 1);
        p = 1 - Math.pow(1 - p, 3); // ease-out
        el.textContent = prefix + Math.round(target * p) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else done = true;
      }
      requestAnimationFrame(tick);
      // Sigorta: her durumda süre sonunda kesin değeri yaz
      setTimeout(function () {
        done = true;
        el.textContent = prefix + target + suffix;
      }, DUR + 200);
    });
  }, { rootMargin: "0px 0px -10% 0px" });
  counters.forEach(function (el) { cntIO.observe(el); });

  /* ---------- 4) Ürün grupları slaytı (Swiper karşılığı: 5 sn otomatik, sürüklenebilir) ---------- */
  document.querySelectorAll("[data-carousel]").forEach(function (root) {
    var track = root.querySelector(".carousel-track");
    if (!track) return;
    var paused = false;

    root.addEventListener("mouseenter", function () { paused = true; });
    root.addEventListener("mouseleave", function () { paused = false; });

    // Masaüstünde fare ile sürükleme
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
    window.addEventListener("pointerup", function () {
      dragging = false;
      track.classList.remove("dragging");
    });
    // Sürükleme sonrası karta tıklama sayılmasın
    track.addEventListener("click", function (ev) {
      if (moved) { ev.preventDefault(); moved = false; }
    }, true);

    setInterval(function () {
      if (paused || dragging || document.hidden) return;
      var slides = track.children;
      if (!slides.length) return;
      var next = null;
      for (var i = 0; i < slides.length; i++) {
        if (slides[i].offsetLeft > track.scrollLeft + 10) { next = slides[i]; break; }
      }
      var maxScroll = track.scrollWidth - track.clientWidth;
      if (!next || track.scrollLeft >= maxScroll - 10) {
        track.scrollTo({ left: 0, behavior: "smooth" }); // başa dön (loop)
      } else {
        track.scrollTo({ left: next.offsetLeft, behavior: "smooth" });
      }
    }, 5000);
  });
})();
