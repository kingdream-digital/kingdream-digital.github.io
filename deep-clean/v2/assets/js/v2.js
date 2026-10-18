/* ==========================================================================
   Deep Clean V2 « La Plongée » — interactions & animations

   Sans bibliothèque d'animation : Web Animations API + une seule boucle de
   défilement (requestAnimationFrame). Lenis (MIT) adoucit la molette sur
   ordinateur uniquement.

   Robustesse :
   - chaque module est isolé (safe()) ; en cas d'erreur, la page repasse en
     affichage statique (classes « js » et « motion » retirées) ;
   - filet de sécurité de 6 s dans <head> si ce fichier ne se charge pas ;
   - « réduire les animations » : ni intro, ni plongée, ni eau, ni bulles —
     contenu final immédiatement.
   ========================================================================== */

(function () {
  "use strict";

  var doc = document.documentElement;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var mq = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };

  var REDUCED = mq("(prefers-reduced-motion: reduce)");
  var MOTION = !REDUCED && doc.classList.contains("motion");
  var FINE = mq("(hover: hover) and (pointer: fine)");
  var HAS_IO = "IntersectionObserver" in window;
  var EASE_OUT = "cubic-bezier(.16, 1, .3, 1)";
  var EASE_IN_OUT = "cubic-bezier(.7, 0, .2, 1)";

  var errors = 0;
  var lenis = null;
  var menuOpen = false;
  var menuApi = { close: function () {} };
  var chatApi = { preset: function () {} };
  var surfaceApi = { enter: function () {} };
  var videoApi = { start: function () {} };
  var filterState = { value: "tous" };
  var FILTER_PROFIL = { particulier: "Particulier", professionnel: "Professionnel", proprietaire: "Propriétaire (conciergerie)" };

  function safe(name, fn) {
    try { return fn(); } catch (err) { errors++; if (window.console) console.error("[Deep Clean] " + name, err); }
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function range01(v, a, b) { return clamp01((v - a) / (b - a)); }
  var ease = {
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  };
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tween(ms, fn, easing) {
    return new Promise(function (resolve) {
      var t0 = 0;
      function f(now) {
        if (!t0) t0 = now;
        var t = Math.min(1, (now - t0) / ms);
        fn(easing ? easing(t) : t);
        if (t < 1) requestAnimationFrame(f); else resolve();
      }
      requestAnimationFrame(f);
    });
  }
  function absTop(el) { return el.getBoundingClientRect().top + window.pageYOffset; }
  function headerOffset() { var p = $(".head__pill"); return p ? p.getBoundingClientRect().bottom + 10 : 76; }
  function isDark(hex) {
    var n = parseInt(String(hex || "#ffffff").slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.42;
  }

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  $$("[data-year]").forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* ------------------------------------------------------------------ */
  /* Boucle unique : défilement & redimensionnement                       */
  /* ------------------------------------------------------------------ */

  var onScroll = [], onResize = [];
  var loop = (function () {
    var scheduled = false, dirty = true, lastY = -1;
    function read() { return lenis ? lenis.scroll : window.pageYOffset; }
    function run() {
      scheduled = false;
      var y = read();
      if (y === lastY && !dirty) return;
      lastY = y; dirty = false;
      for (var i = 0; i < onScroll.length; i++) {
        try { onScroll[i](y); } catch (err) { if (window.console) console.error("[Deep Clean] scroll", err); }
      }
    }
    function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(run); } }
    function measure() {
      for (var i = 0; i < onResize.length; i++) {
        try { onResize[i](); } catch (err) { if (window.console) console.error("[Deep Clean] resize", err); }
      }
      dirty = true; schedule();
    }
    var rt = 0, lastW = window.innerWidth, lastH = window.innerHeight;
    window.addEventListener("resize", function () {
      /* sur mobile, la barre d'adresse qui se replie change la hauteur : on
         ne recalcule que si la largeur change ou si la hauteur varie beaucoup */
      var w = window.innerWidth, h = window.innerHeight;
      if (w === lastW && Math.abs(h - lastH) < 120 && !FINE) return;
      lastW = w; lastH = h;
      clearTimeout(rt); rt = setTimeout(measure, 140);
    });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("load", measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    return { schedule: schedule, measure: measure, force: function () { dirty = true; schedule(); } };
  })();

  /* ------------------------------------------------------------------ */
  /* Démarrage                                                            */
  /* ------------------------------------------------------------------ */

  safe("lenis", initLenis);
  safe("menu", initMenu);
  safe("anchors", initAnchors);
  safe("faq", initFaq);
  safe("filter", initFilter);
  safe("rooms", initRooms);
  safe("reviews", initReviews);
  safe("sonar", initSonar);
  safe("chat", initChat);
  safe("reveals", initReveals);
  safe("counters", initCounters);
  safe("cycle", initCycle);
  safe("depth", initDepth);
  safe("surface", initSurface);
  safe("video", initHeroVideo);
  safe("parallax", initParallax);
  safe("quote", initQuote);
  safe("water", initWater);
  safe("bubbles", initBubbles);
  safe("taps", initTaps);

  if (errors) {
    doc.classList.remove("js", "motion", "intro-on", "intro-head");
    var deadIntro = $("[data-intro]");
    if (deadIntro) deadIntro.remove();
    return;
  }
  doc.classList.add("is-ready");
  loop.measure();

  var introDone = safe("intro", runIntro) || Promise.resolve(false);
  introDone.then(function (played) {
    safe("hero-in", function () { heroIn(played); });
    setTimeout(function () { safe("video-start", videoApi.start); }, played ? 300 : 900);
  });

  /* ================================================================== */
  /* Défilement doux (souris) & ancres                                    */
  /* ================================================================== */

  function initLenis() {
    if (!MOTION || !FINE || !window.Lenis) return;
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on("scroll", loop.schedule);
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
  }

  function scrollToY(y, slow) {
    if (lenis) {
      lenis.scrollTo(y, { duration: slow ? 2.6 : 1.5, easing: function (t) { return 1 - Math.pow(1 - t, 4); } });
    } else {
      window.scrollTo({ top: y, behavior: REDUCED ? "auto" : "smooth" });
    }
  }

  function scrollToEl(el, slow) {
    var y;
    if (el.id === "surface") y = 0;
    else if (el.id === "promesse") y = absTop(el);
    else y = absTop(el) - headerOffset() + 12;
    scrollToY(Math.max(0, y), slow);
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    try { el.focus({ preventScroll: true }); } catch (err) { /* ancien navigateur */ }
  }

  function initAnchors() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = decodeURIComponent(a.getAttribute("href").slice(1));
      var target = id && document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      if (a.hasAttribute("data-preset-service")) {
        chatApi.preset(a.getAttribute("data-preset"), a.getAttribute("data-preset-service"));
        /* sur mobile, on amène directement à la conversation */
        if (window.innerWidth < 960 && $("[data-chat]")) target = $("[data-chat]");
      }
      var wasOpen = menuOpen;
      menuApi.close();
      setTimeout(function () { scrollToEl(target, a.hasAttribute("data-ascend")); }, wasOpen ? 260 : 0);
      try {
        if (id === "surface") history.replaceState(null, "", location.pathname + location.search);
        else history.replaceState(null, "", "#" + id);
      } catch (err) { /* file:// */ }
    });
  }

  /* ================================================================== */
  /* Intro : le logo se dessine, puis rejoint l'en-tête                   */
  /* ================================================================== */

  function runIntro() {
    var intro = $("[data-intro]");
    if (!intro) return Promise.resolve(false);
    if (!MOTION || window.pageYOffset > 40 || (location.hash && location.hash.length > 1) || !intro.animate) {
      intro.remove();
      return Promise.resolve(false);
    }

    var emb = $(".intro__emb", intro), txt = $(".intro__txt", intro), bg = $("[data-intro-bg]", intro);
    var img = $(".head__logo img");
    var disk = emb.querySelector('circle[fill="#fff"]');
    var ring = $(".dc-ring", emb);
    var waves = [$(".dc-w1", emb), $(".dc-w2", emb), $(".dc-w3", emb)];
    var dropG = $(".dc-drop", emb);
    var deep = $(".dc-deep", txt), clean = $(".dc-clean", txt), tag = $(".dc-tag", txt);
    var D = JSON.parse($("#dc-logo-data").textContent);
    var orig = waves.map(function (w) { return w.getAttribute("d"); });
    var anims = [];
    var skipped = false, wavesOn = true, skipNow;
    var skipP = new Promise(function (r) { skipNow = r; });

    function A(el, kf, o) {
      o.fill = "both";
      var an = el.animate(kf, o);
      anims.push(an);
      return an;
    }
    function hold(ms) { return Promise.race([wait(ms), skipP]); }

    doc.classList.add("intro-on", "intro-head");
    emb.style.opacity = "1";
    txt.style.opacity = "1";

    /* disque blanc + anneau qui se trace */
    var C = "308.2px 270px";
    disk.style.transformOrigin = C;
    ring.style.transformOrigin = C;
    A(disk, [{ transform: "scale(.5)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 700, easing: EASE_OUT });
    var L = Math.ceil(2 * Math.PI * 241.95) + 2;
    ring.style.strokeDasharray = L + " " + L;
    A(ring, [
      { strokeDashoffset: L, transform: "rotate(-90deg)" },
      { strokeDashoffset: 0, transform: "rotate(-90deg)" }
    ], { duration: 1150, delay: 120, easing: "cubic-bezier(.65, 0, .35, 1)" }).finished.then(function () {
      ring.style.strokeDasharray = "";
    }, function () {});

    /* vagues vivantes : elles montent, ondulent, puis se figent en forme exacte */
    function wavePath(base, off, amp, phase, tt) {
      var xs = D.xs, n = xs.length, ys = new Array(n), i;
      for (i = 0; i < n; i++) ys[i] = base[i] + off + amp * Math.sin(xs[i] * 0.024 + phase + tt * 3.4);
      var d = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
      for (i = 0; i < n - 1; i++) {
        var x0 = i ? xs[i - 1] : xs[i], y0 = i ? ys[i - 1] : ys[i];
        var x3 = i + 2 < n ? xs[i + 2] : xs[i + 1], y3 = i + 2 < n ? ys[i + 2] : ys[i + 1];
        d += "C" + (xs[i] + (xs[i + 1] - x0) / 6).toFixed(1) + " " + (ys[i] + (ys[i + 1] - y0) / 6).toFixed(1) + " " +
          (xs[i + 1] - (x3 - xs[i]) / 6).toFixed(1) + " " + (ys[i + 1] - (y3 - ys[i]) / 6).toFixed(1) + " " +
          xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
      }
      var yb = (D.yb + Math.max(0, off)).toFixed(1);
      return d + "L" + xs[n - 1].toFixed(1) + " " + yb + "L" + xs[0].toFixed(1) + " " + yb + "Z";
    }
    var bases = [D.b1, D.b2, D.b3];
    waves.forEach(function (w, j) { w.setAttribute("d", wavePath(bases[j], 340, 0, 0, 0)); });
    var wStart = performance.now() + 380, WDUR = 1900;
    function stopWaves() {
      wavesOn = false;
      waves.forEach(function (w, j) { w.setAttribute("d", orig[j]); });
    }
    (function waveFrame(now) {
      if (!wavesOn) return;
      var t = (now - wStart) / WDUR;
      if (t >= 0) {
        for (var j = 0; j < 3; j++) {
          var tj = clamp01(t * 1.12 - j * 0.07);
          var off = (1 - ease.outCubic(tj)) * 340;
          var amp = 17 * Math.pow(1 - tj, 1.5);
          waves[j].setAttribute("d", wavePath(bases[j], off, amp, j * 1.9, (now - wStart) / 1000));
        }
      }
      if (t < 1.08) requestAnimationFrame(waveFrame); else stopWaves();
    })(performance.now());

    /* la goutte tombe, s'écrase légèrement, une onde part à la surface */
    dropG.style.transformOrigin = "308px 232px";
    A(dropG, [
      { transform: "translateY(-330px) scale(.9, 1.14)", opacity: 0, easing: "cubic-bezier(.5, 0, .9, .4)" },
      { opacity: 1, offset: 0.12 },
      { transform: "translateY(0) scale(1.16, .8)", opacity: 1, offset: 0.55, easing: EASE_OUT },
      { transform: "translateY(0) scale(.95, 1.06)", offset: 0.78 },
      { transform: "translateY(0) scale(1, 1)", opacity: 1 }
    ], { duration: 1050, delay: 950 });
    var splash = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
    splash.setAttribute("cx", "308.2"); splash.setAttribute("cy", "250"); splash.setAttribute("rx", "10"); splash.setAttribute("ry", "2");
    splash.setAttribute("fill", "none"); splash.setAttribute("stroke", "#fff"); splash.setAttribute("stroke-width", "2.5");
    splash.setAttribute("vector-effect", "non-scaling-stroke");
    splash.style.transformOrigin = "308.2px 250px";
    var clipG = emb.querySelector("g[clip-path]");
    (clipG || emb).appendChild(splash);
    A(splash, [{ transform: "scale(1)", opacity: 0 }, { transform: "scale(1)", opacity: 0.9, offset: 0.01 }, { transform: "scale(15, 8)", opacity: 0 }], { duration: 950, delay: 1530, easing: "cubic-bezier(.2, .7, .3, 1)" });

    /* le nom, puis la signature */
    A(deep, [{ transform: "translateX(-70px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 850, delay: 1350, easing: EASE_OUT });
    A(clean, [{ transform: "translateX(70px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 850, delay: 1470, easing: EASE_OUT });
    A(tag, [{ transform: "translateY(30px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 750, delay: 1760, easing: EASE_OUT });

    intro.addEventListener("click", function () { skipped = true; skipNow(); }, { once: true });

    function flip(dur) {
      var ir = img.getBoundingClientRect();
      var s = ir.height / 168;
      var er = emb.getBoundingClientRect(), tr = txt.getBoundingClientRect();
      var e1 = emb.animate([
        { transform: "none" },
        { transform: "translate(" + (ir.left - er.left) + "px," + (ir.top - er.top) + "px) scale(" + (168 * s / er.width) + ")" }
      ], { duration: dur, easing: EASE_IN_OUT, fill: "forwards" });
      txt.animate([
        { transform: "none" },
        { transform: "translate(" + (ir.left + 202 * s - tr.left) + "px," + (ir.top + 11.2 * s - tr.top) + "px) scale(" + (613.5 * s / tr.width) + ")" }
      ], { duration: dur, easing: EASE_IN_OUT, fill: "forwards" });
      bg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur * 0.75, delay: dur * 0.18, easing: "ease-out", fill: "forwards" });
      return e1.finished;
    }

    /* la page apparaît pendant que le logo rejoint l'en-tête (pas de temps mort) */
    return new Promise(function (reveal) {
      var finished = false;
      function cleanup() {
        if (finished) return;
        finished = true;
        doc.classList.remove("intro-on", "intro-head");
        intro.remove();
        reveal(true);
      }
      hold(2150).then(function () {
        anims.forEach(function (an) { try { an.finish(); } catch (err) { /* déjà fini */ } });
        stopWaves();
        doc.classList.remove("intro-head");
        return wait(skipped ? 520 : 680);
      }).then(function () {
        var dur = skipped ? 650 : 1050;
        setTimeout(function () { reveal(true); }, dur * 0.4);
        return flip(dur);
      }).then(cleanup, cleanup);
      setTimeout(cleanup, 7000);
    });
  }

  function heroIn(played) {
    if (!played) { surfaceApi.enter(0); return; }
    $$("[data-in-line]").forEach(function (el, i) {
      el.animate([{ transform: "translateY(112%)", opacity: 1 }, { transform: "none", opacity: 1 }], { duration: 1250, delay: 60 + i * 120, easing: EASE_OUT, fill: "both" });
    });
    $$(".surface [data-in]").forEach(function (el, i) {
      el.animate([{ opacity: 0, transform: "translateY(24px)" }, { opacity: 1, transform: "none" }], { duration: 1000, delay: 260 + i * 100, easing: EASE_OUT, fill: "both" });
    });
    surfaceApi.enter(1400);
  }

  /* ================================================================== */
  /* 1. Surface : hublot -> plein écran -> « Plongez. » -> marée           */
  /* ================================================================== */

  function initSurface() {
    var sec = $("[data-surface]");
    if (!sec || !MOTION) return;
    var stage = $(".surface__stage", sec), anchor = $("[data-ph-anchor]", sec);
    var media = $("[data-ph-media]", sec), ring = $("[data-ph-ring]", sec), wavesEl = $("[data-ph-waves]", sec);
    var copy = $("[data-surface-copy]", sec), dive = $("[data-dive]", sec), tide = $("[data-tide]", sec), cue = $("[data-surface-cue]", sec);
    var g = { top: 0, range: 1, W: 1, H: 1, cx: 0, cy: 0, r: 1, R: 1 };
    var enter = 1;

    function measure() {
      var sr = stage.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      g.W = sr.width; g.H = sr.height;
      g.cx = ar.left - sr.left + ar.width / 2;
      g.cy = ar.top - sr.top + ar.height / 2;
      g.r = Math.max(10, ar.width / 2);
      g.R = Math.sqrt(g.W * g.W + g.H * g.H) / 2 + 4;
      g.top = absTop(sec);
      g.range = Math.max(1, sec.offsetHeight - stage.offsetHeight);
      ring.style.setProperty("--hx", (g.cx - g.r) + "px");
      ring.style.setProperty("--hy", (g.cy - g.r) + "px");
      ring.style.setProperty("--hd", (2 * g.r) + "px");
    }

    var lastP = -1;
    function update(y) {
      var p = clamp01((y - g.top) / g.range);
      lastP = p;
      var a = ease.inOutCubic(range01(p, 0.06, 0.55));
      var e = ease.outCubic(enter);
      var cx = lerp(g.cx, g.W / 2, a), cy = lerp(g.cy, g.H / 2, a), r = lerp(g.r * e, g.R, a);
      media.style.clipPath = "circle(" + r.toFixed(1) + "px at " + cx.toFixed(1) + "px " + cy.toFixed(1) + "px)";
      ring.style.transform = "translate(" + (cx - g.cx).toFixed(1) + "px," + (cy - g.cy).toFixed(1) + "px) scale(" + (r / g.r).toFixed(4) + ")";
      ring.style.opacity = String(Math.min(e * 1.4, 1 - range01(p, 0.26, 0.46)));
      wavesEl.style.transform = "translateY(" + ((a * 70) + (1 - e) * 100).toFixed(1) + "%)";
      media.style.setProperty("--veil", range01(p, 0.36, 0.56).toFixed(3));

      var c = range01(p, 0.03, 0.26);
      copy.style.opacity = String(1 - c);
      copy.style.transform = "translateY(" + (-60 * ease.outCubic(range01(p, 0.02, 0.34))).toFixed(1) + "px)";
      copy.style.visibility = c > 0.98 ? "hidden" : "";

      var d = ease.outCubic(range01(p, 0.46, 0.64));
      dive.style.opacity = String(d);
      dive.style.transform = "translateY(" + ((1 - d) * 50).toFixed(1) + "px) scale(" + (0.94 + 0.06 * d).toFixed(3) + ")";

      var t = ease.inOutCubic(range01(p, 0.7, 0.98));
      tide.style.transform = "translateY(calc(" + ((1 - t) * 100).toFixed(2) + "% + " + ((1 - t) * 160).toFixed(1) + "px))";
      cue.style.opacity = String(1 - range01(p, 0, 0.04));
    }

    surfaceApi.enter = function (ms) {
      if (!ms) { enter = 1; update(window.pageYOffset); return; }
      enter = 0;
      tween(ms, function (v) { enter = v; update(lenis ? lenis.scroll : window.pageYOffset); });
    };
    enter = 0;
    onResize.push(measure);
    onScroll.push(update);
  }

  function initHeroVideo() {
    var video = $("[data-ph-video]");
    if (!video || !MOTION) return;
    var conn = navigator.connection || {};
    if (conn.saveData) return;
    var probe = document.createElement("video");
    var ext = probe.canPlayType && probe.canPlayType('video/mp4; codecs="avc1.64001F"') ? "mp4"
      : probe.canPlayType && probe.canPlayType('video/webm; codecs="vp9"') ? "webm" : "";
    if (!ext) return;
    var current = "", inView = true;
    function pick() {
      if (window.innerWidth > window.innerHeight) return "hero-land";
      return window.innerWidth * (window.devicePixelRatio || 1) > 760 ? "hero-720" : "hero-540";
    }
    function play() {
      if (!inView || !current) return;
      var pr = video.play();
      if (pr && pr.catch) pr.catch(function () { /* lecture auto refusée : l'affiche reste */ });
    }
    function load() {
      var name = pick();
      if (name === current) return;
      current = name;
      video.classList.remove("is-playing");
      video.src = "assets/video/" + name + "." + ext;
      video.load();
      play();
    }
    video.addEventListener("playing", function () { video.classList.add("is-playing"); });
    if (HAS_IO) {
      new IntersectionObserver(function (en) {
        inView = en[0].isIntersecting;
        if (inView) play(); else video.pause();
      }).observe($("[data-surface]"));
    }
    videoApi.start = load;
    onResize.push(function () { if (current) load(); });
  }

  /* ================================================================== */
  /* Profondeur : jauge, pastille, barre de progression, couleur du       */
  /* navigateur, lien actif, barre d'actions mobile                        */
  /* ================================================================== */

  function initDepth() {
    var secs = $$("[data-depth]");
    if (!secs.length) return;
    var vals = $$("[data-depth-value]"), gauge = $("[data-gauge]"), gName = $("[data-gauge-name]");
    var meta = $("meta[data-theme-color]"), progress = $("[data-progress]"), dock = $("[data-dock]");
    var taps = $("[data-taps]");
    var nav = $$(".head__nav a").map(function (a) { return { a: a, el: document.getElementById(a.getAttribute("href").slice(1)) }; });
    var tops = [], docH = 1, surfEnd = 0, contactTop = 1e9, navTops = [];
    var last = { depth: null, name: null, theme: null, dark: null, nav: null };
    var maxDepth = +secs[secs.length - 1].getAttribute("data-depth") || 46;

    function measure() {
      tops = secs.map(absTop);
      docH = Math.max(1, doc.scrollHeight - window.innerHeight);
      var sf = $("[data-surface]"), ct = $("#contact");
      surfEnd = sf ? absTop(sf) + sf.offsetHeight : 0;
      contactTop = ct ? absTop(ct) : 1e9;
      navTops = nav.map(function (n) { return n.el ? [absTop(n.el), absTop(n.el) + n.el.offsetHeight] : [0, 0]; });
    }

    function update(y) {
      /* ligne de référence : du haut de l'écran (début) au bas (fin de page),
         pour que la profondeur parte de 0 m et atteigne le fond */
      var vh = window.innerHeight, mid = y + vh * clamp01(y / docH), i = 0;
      while (i < secs.length - 1 && tops[i + 1] <= mid) i++;
      var d0 = +secs[i].getAttribute("data-depth"), depth = d0;
      if (i < secs.length - 1 && mid >= tops[i]) {
        depth = lerp(d0, +secs[i + 1].getAttribute("data-depth"), clamp01((mid - tops[i]) / Math.max(1, tops[i + 1] - tops[i])));
      }
      var di = Math.round(depth);
      if (di !== last.depth) {
        last.depth = di;
        var txt = di === 0 ? "0" : "−" + di;
        vals.forEach(function (v) { v.textContent = txt; });
      }
      if (gauge) {
        gauge.style.setProperty("--g", (depth / maxDepth).toFixed(4));
        gauge.classList.toggle("is-on", y > 30);
      }
      var name = secs[i].getAttribute("data-depth-name");
      if (gName && name !== last.name) { last.name = name; gName.textContent = name; }

      /* section sous l'en-tête : couleur du navigateur, contraste de la jauge */
      var top = y + 40, k = 0;
      while (k < secs.length - 1 && tops[k + 1] <= top) k++;
      var theme = secs[k].getAttribute("data-theme");
      if (y > (tops[1] || 0) - vh * 0.15 && k === 0) theme = "#CBE9F4"; /* fin de plongée : la marée a recouvert l'écran */
      if (theme !== last.theme) {
        last.theme = theme;
        if (meta) meta.setAttribute("content", theme);
      }
      var midTheme = secs[i].getAttribute("data-theme"), dark = isDark(midTheme);
      if (dark !== last.dark) {
        last.dark = dark;
        if (gauge) gauge.classList.toggle("is-dark", dark);
        if (taps) taps.style.setProperty("--tap", dark ? "rgba(79, 209, 242, .75)" : "rgba(4, 157, 196, .7)");
      }
      if (progress) progress.style.setProperty("--p", (y / docH).toFixed(4));
      if (dock) dock.classList.toggle("is-on", !menuOpen && y > surfEnd - vh * 0.7 && y + vh * 0.62 < contactTop);
      var cur = -1;
      for (var n = 0; n < navTops.length; n++) if (mid >= navTops[n][0] && mid < navTops[n][1]) cur = n;
      if (cur !== last.nav) {
        last.nav = cur;
        nav.forEach(function (o, j) { o.a.classList.toggle("is-current", j === cur); });
      }
    }
    onResize.push(measure);
    onScroll.push(update);
  }

  /* ================================================================== */
  /* Apparitions                                                          */
  /* ================================================================== */

  function splitWords(el, cls, maskCls) {
    var n = 0, out = [];
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var parts = c.nodeValue.split(/(\s+)/), frag = document.createDocumentFragment();
          parts.forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            var w = document.createElement("span");
            w.className = cls;
            w.style.setProperty("--i", n++);
            w.textContent = part;
            out.push(w);
            if (maskCls) {
              var m = document.createElement("span");
              m.className = maskCls;
              m.appendChild(w);
              frag.appendChild(m);
            } else frag.appendChild(w);
          });
          c.parentNode.replaceChild(frag, c);
        } else if (c.nodeType === 1) walk(c);
      });
    })(el);
    return out;
  }

  function initReveals() {
    var splits = $$("[data-split]");
    var els = $$("[data-reveal], .port, .value").concat(splits);
    if (!MOTION || !HAS_IO) {
      splits.forEach(function (el) { el.classList.add("is-split"); });
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    splits.forEach(function (el) {
      el.setAttribute("aria-label", el.textContent.replace(/\s+/g, " ").trim());
      splitWords(el, "sw", "sw-mask").forEach(function (w) { w.setAttribute("aria-hidden", "true"); });
      el.classList.add("is-split");
    });
    var io = new IntersectionObserver(function (entries) {
      var k = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        if (el.hasAttribute("data-reveal") || el.classList.contains("value")) el.style.setProperty("--rd", (k++ * 0.09).toFixed(2) + "s");
        el.classList.add("is-in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -7% 0px", threshold: 0 });
    els.forEach(function (el) { io.observe(el); });
  }

  function initCounters() {
    var els = $$("[data-count]");
    if (!els.length || !MOTION || !HAS_IO) return;
    function fmt(v, dec) { return dec ? v.toFixed(dec).replace(".", ",") : String(Math.round(v)); }
    els.forEach(function (el) { el.textContent = fmt(0, +el.getAttribute("data-decimals") || 0); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, to = parseFloat(el.getAttribute("data-count")), dec = +el.getAttribute("data-decimals") || 0;
        tween(1700, function (v) { el.textContent = fmt(to * v, dec); }, ease.outExpo);
      });
    }, { threshold: 0.5 });
    els.forEach(function (el) { io.observe(el); });
  }

  function initParallax() {
    if (!MOTION) return;
    var imgs = $$(".uni .port img");
    var data = [];
    onResize.push(function () {
      data = imgs.map(function (img) { var f = img.parentNode; return { img: img, top: absTop(f), h: f.offsetHeight }; });
    });
    onScroll.push(function (y) {
      var vh = window.innerHeight;
      for (var i = 0; i < data.length; i++) {
        var d = data[i], p = (y + vh - d.top) / (vh + d.h);
        if (p < -0.05 || p > 1.05) continue;
        d.img.style.setProperty("--py", ((p - 0.5) * -40).toFixed(1) + "px");
      }
    });
  }

  function initQuote() {
    var q = $("[data-quote]");
    if (!q || !MOTION) return;
    var words = splitWords(q, "qw");
    var top = 0, h = 1, lastLit = -1;
    onResize.push(function () { top = absTop(q); h = q.offsetHeight; });
    onScroll.push(function (y) {
      var vh = window.innerHeight;
      var p = range01(y + vh * 0.88 - top, 0, vh * 0.42 + h);
      var lit = p * (words.length + 2);
      var key = Math.round(lit * 10);
      if (key === lastLit) return;
      lastLit = key;
      for (var i = 0; i < words.length; i++) words[i].style.opacity = String(0.2 + 0.8 * clamp01(lit - i));
    });
  }

  /* ================================================================== */
  /* 2. Promesse : eau interactive                                       */
  /* ================================================================== */

  function initWater() {
    var sec = $("[data-water]");
    if (!sec || !MOTION || !window.DCWater) return;
    var canvas = $("[data-water-canvas]", sec), dropImg = $("[data-water-drop]", sec), hint = $("[data-water-hint]", sec);
    sec.classList.add("has-water");
    var icon = new Image();
    icon.src = "assets/img/goutte.svg";
    var water = null;
    try {
      water = window.DCWater(canvas, {
        textRoot: $("[data-water-text]", sec), icon: icon, top: "#D9F0F8", bottom: "#BBE0EF",
        onLost: function () { sec.classList.remove("has-water"); }
      });
    } catch (err) {
      if (window.console) console.warn("[Deep Clean] eau WebGL indisponible", err);
      water = null;
    }
    if (!water) { sec.classList.remove("has-water"); return; }
    icon.onload = function () { water.refresh(); };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { water.refresh(); });
    onResize.push(function () { water.refresh(); });

    var lastX = null, lastY = null, idleT = 0, visible = false, interacted = false;
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function touched() {
      idleT = performance.now();
      if (!interacted) { interacted = true; if (hint) hint.classList.add("is-off"); }
    }
    canvas.addEventListener("pointerdown", function (e) {
      var p = pos(e);
      water.drop(p.x, p.y, 2.4, 26);
      touched();
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = pos(e);
      if (lastX !== null) {
        var d = Math.sqrt((p.x - lastX) * (p.x - lastX) + (p.y - lastY) * (p.y - lastY));
        if (d < 8) return;
        water.drop(p.x, p.y, Math.min(1.3, 0.3 + d / 55), 13);
      }
      lastX = p.x; lastY = p.y;
      touched();
    });
    canvas.addEventListener("pointerleave", function () { lastX = lastY = null; });
    canvas.addEventListener("pointercancel", function () { lastX = lastY = null; });

    function fall() {
      var r = canvas.getBoundingClientRect(), t = $("[data-water-title]", sec).getBoundingClientRect();
      var tx = r.width / 2, ty = t.top - r.top + t.height * 0.42;
      var hImg = dropImg.offsetHeight || 44;
      dropImg.style.left = tx + "px";
      var an = dropImg.animate([
        { transform: "translate(-50%, -80px) scale(.9, 1.15)", opacity: 0 },
        { opacity: 1, offset: 0.12 },
        { transform: "translate(-50%, " + (ty - hImg) + "px) scale(.9, 1.15)", opacity: 1 }
      ], { duration: 1000, easing: "cubic-bezier(.5, 0, .95, .5)", fill: "forwards" });
      an.finished.then(function () {
        water.drop(tx, ty, 4.2, 34);
        dropImg.animate([
          { transform: "translate(-50%, " + (ty - hImg) + "px) scale(.9, 1.15)", opacity: 1 },
          { transform: "translate(-50%, " + (ty - hImg * 0.3) + "px) scale(1.8, .15)", opacity: 0 }
        ], { duration: 260, easing: "ease-out", fill: "forwards" });
        idleT = performance.now();
      }, function () {});
    }
    if (HAS_IO) {
      var first = true;
      new IntersectionObserver(function (en) {
        visible = en[0].isIntersecting;
        if (visible && first && en[0].intersectionRatio >= 0.4) { first = false; fall(); }
      }, { threshold: [0, 0.4] }).observe(sec);
    }
    /* quelques gouttes de temps en temps, si personne ne touche l'eau */
    setInterval(function () {
      if (!visible || document.hidden || performance.now() - idleT < 4000) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      water.drop(w * (0.12 + Math.random() * 0.76), h * (0.15 + Math.random() * 0.7), 0.9 + Math.random() * 0.8, 12 + Math.random() * 10);
    }, 2300);
  }

  /* ================================================================== */
  /* 3. Univers : filtre « Vous êtes »                                    */
  /* ================================================================== */

  function initFilter() {
    var wrap = $(".filter__opts"), pill = $("[data-filter-pill]");
    if (!wrap || !pill) return;
    var opts = $$("[data-filter-opt]", wrap), items = $$("[data-uni]");
    function place() {
      var b = $(".is-on", wrap);
      if (!b) return;
      pill.style.setProperty("--x", b.offsetLeft + "px");
      pill.style.setProperty("--y", b.offsetTop + "px");
      pill.style.setProperty("--w", b.offsetWidth + "px");
      pill.style.setProperty("--h", b.offsetHeight + "px");
    }
    function set(val) {
      filterState.value = val;
      opts.forEach(function (o) {
        var on = o.getAttribute("data-filter-opt") === val;
        o.classList.toggle("is-on", on);
        o.setAttribute("aria-pressed", on ? "true" : "false");
      });
      items.forEach(function (it) {
        var fit = val === "tous" || (" " + it.getAttribute("data-for") + " ").indexOf(" " + val + " ") >= 0;
        it.classList.toggle("is-dim", !fit);
        it.classList.toggle("is-pick", val !== "tous" && fit);
      });
      place();
    }
    opts.forEach(function (o) { o.addEventListener("click", function () { set(o.getAttribute("data-filter-opt")); }); });
    onResize.push(place);
    place();
  }

  /* ================================================================== */
  /* 4. Pièce par pièce : onglets + balayage au doigt                     */
  /* ================================================================== */

  function initRooms() {
    var root = $("[data-rooms]");
    if (!root) return;
    var tabsEl = $("[data-rooms-tabs]", root), tabs = $$("[data-room-tab]", root), panels = $$("[data-room]", root);
    var wrap = $("[data-rooms-panels]", root), n = tabs.length, cur = 0;
    panels.forEach(function (p) { $$(".checks li", p).forEach(function (li, i) { li.style.setProperty("--i", i); }); });
    function show(i, focus) {
      i = (i + n) % n;
      if (i === cur) return;
      var dir = i > cur ? 1 : -1;
      cur = i;
      tabs.forEach(function (t, j) {
        var on = j === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.tabIndex = on ? 0 : -1;
      });
      panels.forEach(function (p, j) {
        p.classList.toggle("is-active", j === i);
        p.classList.toggle("from-left", j === i && dir < 0);
      });
      var t = tabs[i];
      if (tabsEl.scrollWidth > tabsEl.clientWidth) {
        tabsEl.scrollTo({ left: t.offsetLeft - tabsEl.offsetLeft - 20, behavior: REDUCED ? "auto" : "smooth" });
      }
      if (focus) t.focus();
    }
    tabs.forEach(function (t, j) {
      t.addEventListener("click", function () { show(j); });
      t.addEventListener("keydown", function (e) {
        var k = e.key;
        if (k === "ArrowRight" || k === "ArrowLeft" || k === "Home" || k === "End") {
          e.preventDefault();
          show(k === "Home" ? 0 : k === "End" ? n - 1 : cur + (k === "ArrowRight" ? 1 : -1), true);
        }
      });
    });
    var sx = 0, sy = 0, down = false;
    wrap.addEventListener("pointerdown", function (e) { if (e.pointerType === "mouse") return; down = true; sx = e.clientX; sy = e.clientY; });
    wrap.addEventListener("pointerup", function (e) {
      if (!down) return;
      down = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) show(cur + (dx < 0 ? 1 : -1));
    });
    wrap.addEventListener("pointercancel", function () { down = false; });
  }

  /* ================================================================== */
  /* 5. Méthode : la goutte fait le tour de l'anneau                      */
  /* ================================================================== */

  function initCycle() {
    var root = $("[data-cycle]");
    if (!root) return;
    var steps = $$("[data-step]", root), nodes = $$("[data-cycle-node]", root), imgs = $$("[data-cycle-img]", root);
    var prog = $("[data-cycle-progress]", root), drop = $("[data-cycle-drop]", root), sticky = $(".cycle__sticky", root);
    var list = $(".cycle__steps", root);
    var centers = [], listEnd = 0, refOff = 0, active = -1, lastF = -1;
    function measure() {
      centers = steps.map(function (s) { return absTop(s) + s.offsetHeight / 2; });
      listEnd = absTop(list) + list.offsetHeight;
      var vh = window.innerHeight;
      var twoCol = getComputedStyle(root).gridTemplateColumns.split(" ").length > 1;
      if (twoCol) refOff = vh * 0.5;
      else {
        var top = parseFloat(getComputedStyle(sticky).top) || 70;
        refOff = (top + sticky.offsetHeight + vh) / 2;
      }
    }
    function update(y) {
      var ref = y + refOff, f;
      if (ref <= centers[0]) f = 0;
      else if (ref >= centers[centers.length - 1]) f = 3 + range01(ref, centers[centers.length - 1], listEnd);
      else {
        var k = 0;
        while (k < centers.length - 2 && ref > centers[k + 1]) k++;
        f = k + range01(ref, centers[k], centers[k + 1]);
      }
      if (Math.abs(f - lastF) < 0.002) return;
      lastF = f;
      if (prog) prog.style.strokeDashoffset = (1106 * (1 - f / 4)).toFixed(1);
      if (drop) drop.style.setProperty("--ca", (f * 90).toFixed(2) + "deg");
      nodes.forEach(function (nd, j) { nd.classList.toggle("is-on", f >= j - 0.02); });
      var a = Math.min(steps.length - 1, Math.round(Math.min(f, 3)));
      if (a !== active) {
        active = a;
        steps.forEach(function (s, j) { s.classList.toggle("is-on", j === a); });
        imgs.forEach(function (im, j) { im.classList.toggle("is-on", j === a); });
      }
    }
    onResize.push(measure);
    onScroll.push(update);
  }

  /* ================================================================== */
  /* 8. Zone : sonar                                                      */
  /* ================================================================== */

  function initSonar() {
    var chips = $$("[data-towns] [data-town]"), svg = $(".sonar__svg");
    if (!chips.length || !svg) return;
    var blips = $$("[data-town]", svg), nameEl = $("[data-sonar-name]"), infoEl = $("[data-sonar-info]");
    var beam = $("[data-sonar-beam]", svg), rangeEl = $("[data-sonar-range]", svg);
    var pos = { x: 200, y: 200 };
    function target(slug) {
      var b = blips.filter(function (x) { return x.getAttribute("data-town") === slug; })[0];
      if (!b || b.classList.contains("sonar__home")) return { x: 200, y: 200 };
      var m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(b.getAttribute("transform") || "");
      return m ? { x: +m[1], y: +m[2] } : { x: 200, y: 200 };
    }
    var anim = 0;
    function select(slug) {
      chips.forEach(function (c) {
        var on = c.getAttribute("data-town") === slug;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
        if (on) {
          nameEl.textContent = c.querySelector("b").textContent;
          infoEl.textContent = c.getAttribute("data-info");
        }
      });
      blips.forEach(function (b) { b.classList.toggle("is-on", b.getAttribute("data-town") === slug); });
      var to = target(slug), from = { x: pos.x, y: pos.y }, my = ++anim;
      tween(REDUCED ? 1 : 650, function (v) {
        if (my !== anim) return;
        pos.x = lerp(from.x, to.x, v); pos.y = lerp(from.y, to.y, v);
        beam.setAttribute("x2", pos.x.toFixed(1));
        beam.setAttribute("y2", pos.y.toFixed(1));
        rangeEl.setAttribute("r", Math.sqrt((pos.x - 200) * (pos.x - 200) + (pos.y - 200) * (pos.y - 200)).toFixed(1));
      }, ease.outCubic);
    }
    chips.forEach(function (c) { c.addEventListener("click", function () { select(c.getAttribute("data-town")); }); });
    blips.forEach(function (b) { b.addEventListener("click", function () { select(b.getAttribute("data-town")); }); });
  }

  /* ================================================================== */
  /* 9. Avis : carrousel (défilement natif + boutons)                     */
  /* ================================================================== */

  function initReviews() {
    var track = $("[data-reviews-track]");
    if (!track) return;
    var cards = $$(".review", track), prev = $("[data-reviews-prev]"), next = $("[data-reviews-next]"), idx = $("[data-reviews-index]");
    var cur = 0;
    function offsets() {
      var tr = track.getBoundingClientRect(), pad = parseFloat(getComputedStyle(track).scrollPaddingLeft) || 0;
      return cards.map(function (c) { return c.getBoundingClientRect().left - tr.left + track.scrollLeft - pad; });
    }
    function sync() {
      var offs = offsets(), x = track.scrollLeft, best = 0;
      for (var i = 1; i < offs.length; i++) if (Math.abs(offs[i] - x) < Math.abs(offs[best] - x)) best = i;
      if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 4) best = cards.length - 1;
      cur = best;
      if (idx) idx.textContent = String(best + 1);
      if (prev) prev.disabled = x <= 4;
      if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    }
    function go(i) {
      i = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: offsets()[i], behavior: REDUCED ? "auto" : "smooth" });
    }
    if (prev) prev.addEventListener("click", function () { go(cur - 1); });
    if (next) next.addEventListener("click", function () { go(cur + 1); });
    var t = 0;
    track.addEventListener("scroll", function () { if (!t) t = requestAnimationFrame(function () { t = 0; sync(); }); }, { passive: true });
    onResize.push(sync);
    sync();
  }

  /* ================================================================== */
  /* 10. FAQ : ouverture animée                                           */
  /* ================================================================== */

  function initFaq() {
    $$("[data-qa]").forEach(function (d) {
      var sum = $("summary", d), panel = $(".qa__panel", d);
      if (d.open) d.classList.add("is-open");
      sum.addEventListener("click", function (e) {
        e.preventDefault();
        if (d.classList.contains("is-open")) {
          d.classList.remove("is-open");
          var done = false;
          var end = function () { if (done) return; done = true; if (!d.classList.contains("is-open")) d.open = false; };
          panel.addEventListener("transitionend", end, { once: true });
          setTimeout(end, REDUCED ? 0 : 650);
        } else {
          d.open = true;
          requestAnimationFrame(function () { requestAnimationFrame(function () { d.classList.add("is-open"); }); });
        }
      });
      d.addEventListener("toggle", function () { if (d.open && !d.classList.contains("is-open")) d.classList.add("is-open"); });
    });
  }

  /* ================================================================== */
  /* 11. Devis en conversation (remplit le formulaire mailto)             */
  /* ================================================================== */

  function initChat() {
    var chat = $("[data-chat]"), log = $("[data-chat-log]"), box = $("[data-chat-input]");
    var form = $("form[data-quote]"), restart = $("[data-chat-restart]");
    if (!chat || !log || !box || !form || !restart) return;
    var EMAIL = "deepclean.contact.pro@gmail.com";
    var PROFILS = $$('input[name="profil"]', form).map(function (i) { return i.value; });
    var SERVICES = $$('input[name="prestation"]', form).map(function (i) { return { value: i.value, label: i.parentNode.querySelector("span").textContent }; });
    var COMMUNES = $$("#commune option", form).map(function (o) { return o.value; }).filter(Boolean);
    var A = { services: [] }, token = 0, started = false, wantFocus = false;
    var preset = { profil: "", service: "" };

    log.setAttribute("data-lenis-prevent", "");
    chat.classList.add("is-live");

    function el(tag, cls, text) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function bubble(cls, content) {
      var m = el("div", "msg " + cls);
      if (typeof content === "string") m.textContent = content; else if (content) m.appendChild(content);
      log.appendChild(m);
      log.scrollTop = log.scrollHeight;
      return m;
    }
    function setInput(node) {
      box.innerHTML = "";
      if (node) box.appendChild(node);
      log.scrollTop = log.scrollHeight;
    }
    function say(text, next) {
      var my = token;
      var typing = bubble("msg--bot msg--typing", null);
      typing.innerHTML = "<i></i><i></i><i></i>";
      typing.setAttribute("aria-hidden", "true");
      setInput(null);
      setTimeout(function () {
        if (my !== token) return;
        typing.remove();
        bubble("msg--bot", text);
        if (next) next();
      }, REDUCED ? 120 : 520 + Math.min(900, text.length * 8));
    }
    function me(text) {
      bubble("msg--me", text);
      restart.hidden = false;
      wantFocus = true;
    }
    function button(cls, text, fn) {
      var b = el("button", cls, text);
      b.type = "button";
      b.addEventListener("click", fn);
      return b;
    }
    function choice(options, label, suggested, onPick) {
      var wrap = el("div", "chips");
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", label);
      options.forEach(function (o) {
        var b = button("chip", o, function () { onPick(o); });
        if (suggested && suggested === o) b.classList.add("is-suggested");
        wrap.appendChild(b);
      });
      return wrap;
    }
    function multi(options, selected, onDone) {
      var frag = el("div"), wrap = el("div", "chips"), sel = selected.slice();
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Services");
      var go = button("chip chip--go", "", function () { if (sel.length) onDone(sel); });
      function sync() {
        go.disabled = !sel.length;
        go.textContent = sel.length ? "Valider (" + sel.length + ")" : "Choisissez au moins un service";
      }
      options.forEach(function (o) {
        var b = button("chip", o.label, function () {
          var i = sel.indexOf(o.value);
          if (i >= 0) sel.splice(i, 1); else sel.push(o.value);
          b.setAttribute("aria-pressed", i >= 0 ? "false" : "true");
          sync();
        });
        b.setAttribute("aria-pressed", sel.indexOf(o.value) >= 0 ? "true" : "false");
        wrap.appendChild(b);
      });
      var actions = el("div", "chat__actions");
      actions.appendChild(go);
      sync();
      frag.appendChild(wrap);
      frag.appendChild(actions);
      return frag;
    }
    function field(o, onSubmit) {
      var f = el("form", "chat__form");
      f.noValidate = true;
      var row = el("div", "chat__row");
      var input = el(o.multiline ? "textarea" : "input", "chat__field");
      if (o.multiline) input.rows = 2; else input.type = o.type || "text";
      input.name = "chat-" + o.name;
      input.placeholder = o.placeholder || "";
      if (o.autocomplete) input.setAttribute("autocomplete", o.autocomplete);
      if (o.inputmode) input.setAttribute("inputmode", o.inputmode);
      input.setAttribute("aria-label", o.label);
      var send = el("button", "chat__send");
      send.type = "submit";
      send.setAttribute("aria-label", "Envoyer");
      send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>';
      row.appendChild(input);
      row.appendChild(send);
      f.appendChild(row);
      var err = el("p", "chat__error");
      err.hidden = true;
      err.setAttribute("role", "alert");
      f.appendChild(err);
      if (o.optional) {
        var actions = el("div", "chat__actions");
        actions.appendChild(button("chip chip--ghost", "Passer cette étape", function () { onSubmit(""); }));
        f.appendChild(actions);
      }
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var v = input.value.trim();
        var msg = o.validate ? o.validate(v) : "";
        if (msg) {
          err.textContent = msg;
          err.hidden = false;
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }
        onSubmit(v);
      });
      if (o.multiline) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send.click(); }
        });
      }
      if (wantFocus) setTimeout(function () { try { input.focus({ preventScroll: true }); } catch (err2) { input.focus(); } }, 40);
      return f;
    }

    function firstName() { return (A.nom || "").split(/\s+/)[0]; }
    function askProfil() {
      var t = preset.service
        ? "Bonjour ! Vous vous intéressez à : " + preset.service + ". Pour commencer, vous êtes…"
        : "Bonjour ! Je prépare votre demande de devis en quelques questions. Pour commencer, vous êtes…";
      var sug = preset.profil || FILTER_PROFIL[filterState.value] || "";
      say(t, function () {
        setInput(choice(PROFILS, "Vous êtes", sug, function (v) { A.profil = v; me(v); askServices(); }));
      });
    }
    function askServices() {
      var pre = preset.service ? [preset.service] : A.profil === "Propriétaire (conciergerie)" ? ["Conciergerie"] : [];
      say("Quel(s) service(s) vous intéresse(nt) ? Plusieurs choix possibles.", function () {
        setInput(multi(SERVICES, pre, function (sel) { A.services = sel; me(sel.join(", ")); askCommune(); }));
      });
    }
    function askCommune() {
      say("Où se situe le logement ou le local ?", function () {
        setInput(choice(COMMUNES, "Commune", "", function (v) { A.commune = v; me(v); askMessage(); }));
      });
    }
    function askMessage() {
      say("Une précision ? Surface, état, disponibilités… (facultatif)", function () {
        setInput(field({ name: "message", label: "Précisions", placeholder: "Ex. : maison de 90 m², avant un état des lieux…", multiline: true, optional: true }, function (v) {
          A.message = v;
          me(v || "Pas de précision pour l'instant");
          askNom();
        }));
      });
    }
    function askNom() {
      say("Très bien. À quel nom dois-je préparer la demande ?", function () {
        setInput(field({
          name: "nom", label: "Nom complet", placeholder: "Prénom Nom", autocomplete: "name",
          validate: function (v) { return v.length < 2 ? "Indiquez votre nom pour que nous puissions vous répondre." : ""; }
        }, function (v) { A.nom = v; me(v); askTel(); }));
      });
    }
    function askTel() {
      say("Merci " + firstName() + ". Votre numéro de téléphone ?", function () {
        setInput(field({
          type: "tel", name: "telephone", label: "Téléphone", placeholder: "06 12 34 56 78", autocomplete: "tel", inputmode: "tel",
          validate: function (v) { return v.replace(/\D/g, "").length < 10 ? "Ce numéro semble incomplet : il faut au moins 10 chiffres." : ""; }
        }, function (v) { A.tel = v; me(v); askEmail(); }));
      });
    }
    function askEmail() {
      say("Et votre adresse email ?", function () {
        setInput(field({
          type: "email", name: "email", label: "Email", placeholder: "vous@exemple.fr", autocomplete: "email", inputmode: "email",
          validate: function (v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "Cette adresse email ne semble pas valide."; }
        }, function (v) { A.email = v; me(v); recap(); }));
      });
    }
    function syncForm() {
      $$('input[name="profil"]', form).forEach(function (i) { i.checked = i.value === A.profil; });
      $$('input[name="prestation"]', form).forEach(function (i) { i.checked = A.services.indexOf(i.value) >= 0; });
      form.commune.value = A.commune || "";
      form.message.value = A.message || "";
      form.nom.value = A.nom || "";
      form.telephone.value = A.tel || "";
      form.email.value = A.email || "";
    }
    function recap() {
      syncForm();
      say("Parfait ! Voici le récapitulatif de votre demande :", function () {
        var wrapper = el("div"), dl = el("dl");
        [["Profil", A.profil], ["Service(s)", A.services.join(", ")], ["Commune", A.commune], ["Précisions", A.message || "—"],
          ["Nom", A.nom], ["Téléphone", A.tel], ["Email", A.email]].forEach(function (r) {
          dl.appendChild(el("dt", "", r[0]));
          dl.appendChild(el("dd", "", r[1]));
        });
        wrapper.appendChild(dl);
        bubble("msg--bot msg--recap", wrapper);
        var actions = el("div", "chat__actions");
        actions.appendChild(button("chip chip--go", "Envoyer ma demande", send));
        actions.appendChild(button("chip chip--ghost", "Recommencer", function () { start(true); }));
        setInput(actions);
      });
    }
    function send() {
      if (form.societe && form.societe.value) return;
      var subject = "Demande de devis — " + A.profil + (A.commune ? " — " + A.commune : "");
      var lines = [
        "Bonjour,", "", "Je souhaite recevoir un devis.", "",
        "Profil : " + A.profil,
        "Prestation(s) : " + A.services.join(", "),
        "Commune : " + (A.commune || "non précisée"),
        "", "Précisions :", A.message || "—", "",
        "Nom : " + A.nom, "Téléphone : " + A.tel, "Email : " + A.email
      ];
      var href = "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(lines.join("\n"));
      me("Envoyer ma demande");
      setInput(null);
      window.location.href = href;
      say("Votre messagerie s'ouvre avec la demande pré-remplie : il ne reste qu'à l'envoyer. Si rien ne s'ouvre, écrivez-nous à " + EMAIL + " ou appelez le 06 81 70 07 51.", function () {
        var actions = el("div", "chat__actions");
        actions.appendChild(button("chip", "Préparer une autre demande", function () { preset = { profil: "", service: "" }; start(true); }));
        setInput(actions);
      });
    }
    function start(fromUser) {
      token++;
      started = true;
      A = { services: [] };
      log.innerHTML = "";
      restart.hidden = true;
      wantFocus = !!fromUser;
      setInput(null);
      askProfil();
    }
    restart.addEventListener("click", function () { preset = { profil: "", service: "" }; start(true); });

    var io = null;
    if (HAS_IO) {
      io = new IntersectionObserver(function (en) {
        if (en[0].isIntersecting && !started) { io.disconnect(); start(false); }
      }, { threshold: 0.2 });
      io.observe(chat);
    } else start(false);

    chatApi.preset = function (profil, service) {
      preset = { profil: profil || "", service: service || "" };
      if (io) io.disconnect();
      start(false);
    };
  }

  /* ================================================================== */
  /* Menu mobile                                                          */
  /* ================================================================== */

  function initMenu() {
    var btn = $("[data-burger]"), menu = $("[data-menu]");
    if (!btn || !menu) return;
    $$(".menu__nav a", menu).forEach(function (a, i) { a.style.setProperty("--i", i); });
    menu.setAttribute("data-lenis-prevent", "");
    var bubbles = null;
    function set(open) {
      menuOpen = open;
      if (open) {
        var r = btn.getBoundingClientRect();
        menu.style.setProperty("--mx", (r.left + r.width / 2) + "px");
        menu.style.setProperty("--my", (r.top + r.height / 2) + "px");
      }
      menu.classList.toggle("is-open", open);
      menu.setAttribute("aria-hidden", open ? "false" : "true");
      if (open) menu.removeAttribute("inert"); else menu.setAttribute("inert", "");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
      doc.classList.toggle("menu-open", open);
      if (lenis) { if (open) lenis.stop(); else lenis.start(); }
      if (open && !bubbles && MOTION) bubbles = makeBubbles($("[data-bubbles='menu']", menu), { density: 16000, max: 40 });
      loop.force();
    }
    btn.addEventListener("click", function () { set(!menuOpen); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menuOpen) { set(false); btn.focus(); }
    });
    menuApi.close = function () { if (menuOpen) set(false); };
  }

  /* ================================================================== */
  /* Bulles (engagements, pied de page, menu)                             */
  /* ================================================================== */

  function makeBubbles(canvas, o) {
    if (!canvas || !canvas.getContext) return null;
    o = o || {};
    var ctx = canvas.getContext("2d");
    var parts = [], W = 0, H = 0, dpr = 1, raf = 0, visible = false, last = 0;
    var pointer = { x: -1e4, y: -1e4 };
    function make(anywhere) {
      return {
        x: Math.random() * W,
        y: anywhere ? Math.random() * H : H + 10 + Math.random() * 60,
        r: 1.2 + Math.pow(Math.random(), 2.3) * 6.5,
        vy: 14 + Math.random() * 34,
        ph: Math.random() * 6.283,
        wob: 4 + Math.random() * 12,
        a: 0.12 + Math.random() * 0.38,
        ox: 0, oy: 0
      };
    }
    function resize() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = r.width; H = r.height;
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      var n = Math.max(10, Math.min(o.max || 70, Math.round(W * H / (o.density || 12000))));
      parts = [];
      for (var i = 0; i < n; i++) parts.push(make(true));
    }
    function frame(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      var dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.y -= p.vy * dt * (1 + p.r / 9);
        p.ph += dt * 1.7;
        var x = p.x + Math.sin(p.ph) * p.wob + p.ox, y = p.y + p.oy;
        var dx = x - pointer.x, dy = y - pointer.y, d2 = dx * dx + dy * dy;
        if (d2 < 11000) {
          var d = Math.sqrt(d2) || 1, f = (1 - d / 105) * 260 * dt;
          p.ox += dx / d * f; p.oy += dy / d * f;
        }
        p.ox *= 0.965; p.oy *= 0.965;
        if (y < -14) { parts[i] = make(false); continue; }
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, 6.283);
        ctx.fillStyle = "rgba(255,255,255," + (p.a * 0.16).toFixed(3) + ")";
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(190,236,250," + p.a.toFixed(3) + ")";
        ctx.stroke();
        if (p.r > 2.6) {
          ctx.beginPath();
          ctx.arc(x - p.r * 0.35, y - p.r * 0.35, p.r * 0.32, 0, 6.283);
          ctx.fillStyle = "rgba(255,255,255," + (p.a * 0.9).toFixed(3) + ")";
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    }
    function wake() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } }
    resize();
    onResize.push(resize);
    if (HAS_IO) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; wake(); }).observe(canvas);
    } else { visible = true; wake(); }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pointermove", function (e) {
      if (!visible) return;
      var r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
    }, { passive: true });
    window.addEventListener("pointerdown", function (e) {
      if (!visible) return;
      var r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
    }, { passive: true });
    return { resize: resize };
  }

  function initBubbles() {
    if (!MOTION) return;
    $$("canvas[data-bubbles]").forEach(function (c) {
      if (c.getAttribute("data-bubbles") === "menu") return;
      makeBubbles(c, { density: 13000, max: 60 });
    });
  }

  /* ================================================================== */
  /* Ondes au toucher                                                     */
  /* ================================================================== */

  function initTaps() {
    var layer = $("[data-taps]");
    if (!layer || !MOTION) return;
    document.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest && e.target.closest("input, textarea, select, [data-water-canvas], [data-intro]")) return;
      for (var k = 0; k < 2; k++) {
        var s = document.createElement("span");
        s.className = "tap";
        s.style.left = e.clientX + "px";
        s.style.top = e.clientY + "px";
        layer.appendChild(s);
        setTimeout(function (n) { return function () { n.remove(); }; }(s), 1300);
      }
    }, { passive: true });
  }
})();
