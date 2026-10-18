/* ==========================================================================
   Deep Clean — Manosque
   Script principal : Lenis + GSAP ScrollTrigger, reveals, interactions.
   Toutes les animations respectent prefers-reduced-motion et ne rejouent
   qu'une seule fois (once: true).
   ========================================================================== */

(function () {
  "use strict";

  document.documentElement.classList.add("js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  var isNarrow = window.matchMedia("(max-width: 820px)").matches;

  var hasGSAP = typeof window.gsap !== "undefined";
  if (hasGSAP && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
  }

  /* ---------------------------------------------------------------------
     Preloader
     ------------------------------------------------------------------- */
  function initPreloader() {
    var loader = document.querySelector("[data-preloader]");
    if (!loader) return Promise.resolve();

    if (reduceMotion || !hasGSAP) {
      loader.remove();
      return Promise.resolve();
    }

    var bar = loader.querySelector("[data-preloader-bar]");

    return new Promise(function (resolve) {
      var tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: function () {
          loader.remove();
          resolve();
        },
      });

      tl.fromTo(bar, { scaleX: 0, transformOrigin: "left" }, { scaleX: 1, duration: 1 })
        .to(loader, { autoAlpha: 0, duration: 0.7, ease: "power2.inOut" }, "+=0.1");

      // Safety net: never block the page for more than 2.4s.
      setTimeout(function () {
        if (loader.parentNode) {
          tl.progress(1);
        }
      }, 2400);
    });
  }

  /* ---------------------------------------------------------------------
     Lenis smooth scroll
     ------------------------------------------------------------------- */
  var lenis = null;

  function initLenis() {
    if (reduceMotion || typeof window.Lenis === "undefined" || isTouch) return;

    lenis = new window.Lenis({
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 0.95,
    });

    document.documentElement.classList.add("has-lenis");
    window.__lenis = lenis; // exposed for debugging / QA scroll control

    if (hasGSAP && window.ScrollTrigger) {
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(function (time) {
        lenis.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);

      // boot() (which creates every pinned ScrollTrigger, including the
      // "Pourquoi nous choisir" scene) normally runs before this promise
      // resolves, but the preloader delay isn't guaranteed to outlast it —
      // and boot()'s own `load`/`fonts.ready` refreshes aren't guaranteed
      // to run after Lenis exists either. Either ordering leaves Lenis's
      // internal scroll-height cache (`limit`) out of sync with whatever
      // ScrollTrigger's pin-spacers actually measured, which is exactly
      // what turns a normal wheel tick into a multi-thousand-pixel jump.
      // Reconcile once, right here, regardless of which side finished
      // first: let any pending layout settle, refresh ScrollTrigger, then
      // resize Lenis against that final, correct document height.
      requestAnimationFrame(function () {
        ScrollTrigger.refresh();
        lenis.resize();
      });
    } else {
      requestAnimationFrame(function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      });
    }
  }

  /* ---------------------------------------------------------------------
     Anchored navigation (works with or without Lenis)
     ------------------------------------------------------------------- */
  function initAnchorNav() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener("click", function (e) {
        var id = link.getAttribute("href");
        if (!id || id === "#") return;
        var target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        closeMobileNav();
        if (lenis) {
          lenis.scrollTo(target, { offset: -20 });
        } else {
          target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        }
        history.pushState(null, "", id);
      });
    });
  }

  /* ---------------------------------------------------------------------
     Floating header state on scroll
     ------------------------------------------------------------------- */
  function initHeaderState() {
    var header = document.querySelector("[data-site-header]");
    if (!header) return;

    function update() {
      if (window.scrollY > 24) {
        header.classList.add("is-scrolled");
      } else {
        header.classList.remove("is-scrolled");
      }
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
  }

  /* ---------------------------------------------------------------------
     Navbar reveal — the header is fully invisible (opacity + visibility,
     not just off-screen) on first paint so the hero reads as a true full-
     screen opener. It fades + slides in once the visitor scrolls. The
     gating itself is a deliberate content-reveal choice, kept even under
     prefers-reduced-motion (see the reduced-motion CSS override for the
     instant, non-animated version of the same state change).
     ------------------------------------------------------------------- */
  function initNavReveal() {
    var header = document.querySelector("[data-site-header]");
    if (!header) return;

    var revealed = false;

    function reveal() {
      if (revealed) return;
      revealed = true;
      header.classList.add("is-visible");
      window.removeEventListener("scroll", onScroll);
    }

    function onScroll() {
      if (window.scrollY > 4) reveal();
    }

    if (window.scrollY > 4) {
      reveal();
    } else {
      window.addEventListener("scroll", onScroll, { passive: true });
    }
  }

  /* ---------------------------------------------------------------------
     Mobile nav
     ------------------------------------------------------------------- */
  function closeMobileNav() {
    var nav = document.querySelector("[data-mobile-nav]");
    var toggle = document.querySelector("[data-nav-toggle]");
    if (!nav) return;
    nav.classList.remove("is-open");
    document.body.style.overflow = "";
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function initMobileNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var close = document.querySelector("[data-nav-close]");
    var nav = document.querySelector("[data-mobile-nav]");
    if (!toggle || !nav) return;

    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      document.body.style.overflow = isOpen ? "hidden" : "";
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    if (close) close.addEventListener("click", closeMobileNav);

    nav.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMobileNav();
    });
  }

  /* ---------------------------------------------------------------------
     Masked word reveal (hero title, short headlines)
     ------------------------------------------------------------------- */
  function escapeHTML(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function splitMaskedReveal(element) {
    if (element.dataset.maskedRevealReady === "true") return;
    var text = element.textContent.trim();
    element.setAttribute("aria-label", text);
    element.innerHTML = text
      .split(/(\s+)/)
      .map(function (part) {
        if (!part.trim()) return part;
        return '<span class="word-mask" aria-hidden="true"><span class="word">' + escapeHTML(part) + "</span></span>";
      })
      .join("");
    element.dataset.maskedRevealReady = "true";
    element.classList.add("is-split");
  }

  function runMaskedReveals() {
    var elements = document.querySelectorAll("[data-masked-reveal]");

    elements.forEach(function (element) {
      splitMaskedReveal(element);
      var words = element.querySelectorAll(".word");
      gsap.set(element, { autoAlpha: 1 });

      var isHero = element.hasAttribute("data-hero-reveal");

      gsap.fromTo(
        words,
        { yPercent: 112 },
        {
          yPercent: 0,
          duration: 0.9,
          ease: "power4.out",
          stagger: 0.045,
          delay: isHero ? 0.15 : 0,
          scrollTrigger: isHero
            ? undefined
            : {
                trigger: element,
                start: "top 85%",
                toggleActions: "play none none none",
              },
        }
      );
    });
  }

  function initMaskedReveals() {
    var elements = document.querySelectorAll("[data-masked-reveal]");
    if (!elements.length) return;

    if (reduceMotion || !hasGSAP) {
      elements.forEach(function (el) {
        el.style.visibility = "visible";
      });
      return;
    }

    // Wait for web fonts so word-mask heights (used by the yPercent-based
    // reveal) are measured against final metrics, not the fallback font.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(runMaskedReveals).catch(runMaskedReveals);
    } else {
      runMaskedReveals();
    }
  }

  /* ---------------------------------------------------------------------
     Hero entrance (subtitle, actions, scroll cue) + parallax, then a
     cinematic hand-off into the section that follows: as the hero
     recedes (slow zoom + fade) the proof bandeau rises into frame on its
     own scrubbed trigger. Both are scroll-linked so the two sections read
     as one continuous, depth-layered world rather than a hard cut.
     ------------------------------------------------------------------- */
  function initHero() {
    var hero = document.querySelector("[data-hero]");
    if (!hero) return;

    if (hasGSAP && !reduceMotion) {
      gsap.fromTo(
        "[data-hero-fade]",
        { autoAlpha: 0, y: 18 },
        { autoAlpha: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.12, delay: 0.55 }
      );

      var media = hero.querySelector("[data-parallax-layer]");
      var content = hero.querySelector(".hero__content");

      if (media && window.ScrollTrigger) {
        var heroTl = gsap.timeline({
          scrollTrigger: {
            trigger: hero,
            start: "top top",
            end: "bottom top",
            scrub: 1,
          },
          defaults: { ease: "none" },
        });

        heroTl.to(media, { yPercent: isNarrow ? 6 : 12, scale: isNarrow ? 1.05 : 1.14 }, 0);
        if (content) {
          heroTl.to(content, { autoAlpha: 0, y: isNarrow ? -16 : -36, scale: 0.96 }, 0);
        }
      }
    } else {
      document.querySelectorAll("[data-hero-fade]").forEach(function (el) {
        el.style.opacity = 1;
        el.style.transform = "none";
      });
    }

    var proof = document.querySelector("[data-continuity-in]");
    if (proof && hasGSAP && window.ScrollTrigger && !reduceMotion) {
      gsap.fromTo(
        proof,
        { autoAlpha: 0, y: isNarrow ? 28 : 56 },
        {
          autoAlpha: 1,
          y: 0,
          ease: "none",
          scrollTrigger: {
            trigger: proof,
            start: "top bottom",
            end: "top 60%",
            scrub: 1,
          },
        }
      );
    }
  }

  /* ---------------------------------------------------------------------
     Generic section reveals (fade-up + blur, staggered, once)
     ------------------------------------------------------------------- */
  function initSectionReveals() {
    var sections = document.querySelectorAll("[data-reveal-group]");
    if (!sections.length) return;

    if (reduceMotion || !hasGSAP) {
      document.querySelectorAll("[data-reveal-item]").forEach(function (el) {
        el.style.opacity = 1;
        el.style.transform = "none";
        el.style.filter = "none";
      });
      return;
    }

    sections.forEach(function (section) {
      var items = section.querySelectorAll("[data-reveal-item]");
      if (!items.length) return;

      gsap.fromTo(
        items,
        { y: 32, autoAlpha: 0, filter: "blur(6px)" },
        {
          y: 0,
          autoAlpha: 1,
          filter: "blur(0px)",
          duration: 0.9,
          ease: "power4.out",
          stagger: 0.09,
          scrollTrigger: {
            trigger: section,
            start: "top 82%",
            toggleActions: "play none none none",
          },
        }
      );
    });
  }

  /* ---------------------------------------------------------------------
     Number ticker for the proof bar (4,6 / 5 and 100% produits pro)
     ------------------------------------------------------------------- */
  function formatCount(value, decimals, suffix) {
    // French locale: comma as the decimal separator (4,6 not 4.6).
    return value.toFixed(decimals).replace(".", ",") + (suffix || "");
  }

  function animateCount(el, endValue, decimals, suffix) {
    var obj = { val: 0 };
    var duration = reduceMotion ? 0 : 1.4;

    if (!hasGSAP || duration === 0) {
      el.textContent = formatCount(endValue, decimals, suffix);
      return;
    }

    gsap.to(obj, {
      val: endValue,
      duration: duration,
      ease: "power2.out",
      onUpdate: function () {
        el.textContent = formatCount(obj.val, decimals, suffix);
      },
    });
  }

  function initCounters() {
    var counters = document.querySelectorAll("[data-count-to]");
    if (!counters.length) return;

    var run = function (el) {
      var end = parseFloat(el.getAttribute("data-count-to"));
      var decimals = parseInt(el.getAttribute("data-count-decimals") || "0", 10);
      var suffix = el.getAttribute("data-count-suffix") || "";
      animateCount(el, end, decimals, suffix);
    };

    if (!("IntersectionObserver" in window) || reduceMotion) {
      counters.forEach(run);
      return;
    }

    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            run(entry.target);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.6 }
    );

    counters.forEach(function (el) {
      io.observe(el);
    });
  }

  /* ---------------------------------------------------------------------
     Prestations — immersive scroll scene (replaces the old bento grid).

     Desktop, fine pointer, full motion: the stage pins for the length of
     six dwell-then-transition beats and the six full-bleed panels
     crossfade/scale into one another, with a slim progress indicator
     (not a numbered tile) tracking position. Everywhere else — touch,
     narrow viewports, reduced motion, no JS — the panels are never
     pinned: CSS already stacks them in normal document flow, full-bleed,
     one after another, and (motion allowed) each gets a light once-only
     fade/rise as it reaches the viewport. Content is identical either
     way; only the staging differs. Follows the scroll-scrubbed-visual-
     sequence and cinematic-scroll-storytelling patterns (sticky/pinned
     stage, single normalized progress, static reduced-motion fallback).
     ------------------------------------------------------------------- */
  function initPrestationsScene() {
    var section = document.querySelector("[data-scene]");
    if (!section) return;

    var stage = section.querySelector("[data-scene-stage]");
    var panels = Array.prototype.slice.call(section.querySelectorAll("[data-scene-panel]"));
    if (!stage || !panels.length) return;

    var canPin =
      hasGSAP &&
      window.ScrollTrigger &&
      !reduceMotion &&
      !isTouch &&
      window.matchMedia("(min-width: 901px)").matches;

    if (!canPin) {
      if (hasGSAP && window.ScrollTrigger && !reduceMotion) {
        panels.forEach(function (panel) {
          var targets = panel.querySelectorAll(".scene__media, .scene__panel-copy");
          gsap.fromTo(
            targets,
            { autoAlpha: 0, y: 26 },
            {
              autoAlpha: 1,
              y: 0,
              duration: 0.9,
              ease: "power3.out",
              stagger: 0.12,
              scrollTrigger: { trigger: panel, start: "top 82%", toggleActions: "play none none none" },
            }
          );
        });
      }
      return;
    }

    stage.classList.add("is-pinned");

    var n = panels.length;
    var indexEl = section.querySelector("[data-scene-index]");
    var fillEl = section.querySelector("[data-scene-fill]");
    // Reading/crossfade pacing per panel, and % of viewport height of
    // scroll per timeline unit. Trimmed down from the original (1 / 1 / 55)
    // so the six-panel journey covers noticeably less scroll distance while
    // the crossfade mechanic itself is untouched — see report to client,
    // item 2.
    var dwell = 0.82; // reading time per panel, in timeline units
    var trans = 0.85; // crossfade duration, in timeline units
    var unitVh = 40; // % of viewport height of scroll per timeline unit
    var slot = trans + dwell;
    var totalDuration = n * dwell + (n - 1) * trans;

    gsap.set(panels, { opacity: 0, scale: 1.06 });
    gsap.set(panels[0], { opacity: 1, scale: 1 });

    function pad2(num) {
      return (num < 10 ? "0" : "") + num;
    }

    function updateProgress(index) {
      if (indexEl) indexEl.textContent = pad2(index + 1);
      if (fillEl) fillEl.style.transform = "scaleX(" + (index + 1) / n + ")";
    }

    updateProgress(0);

    // `totalDuration` only paces how much scroll distance the pin spans —
    // it does not have to (and generally won't) equal the timeline's own
    // computed duration (GSAP derives that from the last scheduled tween,
    // which excludes the trailing reading beat). The progress indicator
    // must track the timeline's *actual* progress, not this pacing
    // constant, or it visibly drifts ahead of the real crossfade.
    var tl;
    tl = gsap.timeline({
      defaults: { ease: "power2.inOut" },
      scrollTrigger: {
        trigger: stage,
        start: "top top",
        end: "+=" + Math.round(totalDuration * unitVh) + "%",
        scrub: 1,
        pin: true,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: function () {
          var t = tl.progress() * tl.duration();
          var idx = Math.min(n - 1, Math.round(t / slot));
          updateProgress(idx);
        },
      },
    });

    var cursor = dwell;
    for (var i = 0; i < n - 1; i++) {
      tl.to(panels[i], { opacity: 0, scale: 0.94, filter: "blur(3px)", duration: trans }, cursor).to(
        panels[i + 1],
        { opacity: 1, scale: 1, filter: "blur(0px)", duration: trans },
        cursor
      );
      cursor += slot;
    }
  }

  /* ---------------------------------------------------------------------
     Notre exigence — 4-step narrative journey (replaces the 4 side-by-
     side text blocks). A sticky visual pane crossfades to match whichever
     step is active while a slim vertical line fills alongside the
     scrolling copy. Pure IntersectionObserver + CSS transitions: no pin,
     no scrub, works with or without GSAP, and is inert (still correct,
     just instant) under prefers-reduced-motion via the CSS override.
     On narrow viewports the sticky pane is hidden by CSS in favour of a
     small inline image per step, so nothing here needs a separate branch.
     ------------------------------------------------------------------- */
  function initExigenceJourney() {
    var section = document.querySelector("[data-exigence]");
    if (!section) return;

    var steps = Array.prototype.slice.call(section.querySelectorAll("[data-exigence-step]"));
    var visuals = Array.prototype.slice.call(section.querySelectorAll("[data-exigence-visual]"));
    var track = section.querySelector("[data-exigence-steps]");
    if (!steps.length) return;

    function setActive(index) {
      if (index < 0) return;
      steps.forEach(function (step, i) {
        step.classList.toggle("is-active", i === index);
      });
      visuals.forEach(function (visual, i) {
        visual.classList.toggle("is-active", i === index);
      });
      if (track) track.style.setProperty("--exigence-progress", String((index + 1) / steps.length));
    }

    setActive(0);

    if (!("IntersectionObserver" in window)) return;

    // Track how much of the readable band each step currently occupies
    // and let whichever one occupies the most drive the active state —
    // rather than "the last step to start intersecting wins", which let
    // a short first step (e.g. "Diagnostic") get skipped the instant the
    // next one started to peek into view, before it had been read.
    var ratios = steps.map(function () {
      return 0;
    });

    function leadingStep() {
      var best = 0;
      for (var i = 1; i < ratios.length; i++) {
        if (ratios[i] > ratios[best]) best = i;
      }
      return ratios[best] > 0 ? best : -1;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var index = steps.indexOf(entry.target);
          if (index === -1) return;
          ratios[index] = entry.isIntersecting ? entry.intersectionRatio : 0;
        });
        var leader = leadingStep();
        if (leader >= 0) setActive(leader);
      },
      {
        threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
        rootMargin: "-10% 0px -10% 0px",
      }
    );

    steps.forEach(function (step) {
      io.observe(step);
    });
  }

  /* ---------------------------------------------------------------------
     Pourquoi nous choisir — "Le Sommaire Vivant" (concept Clara, 3e
     itération).

     No full-screen pin, no ScrollTrigger, no scrub to coordinate with
     Lenis — deliberately, after the previous two concepts (a pinned
     kinetic-typography scene, then a pinned "Liquid Gold Reveal") turned
     out to be both a taste dead end and a reliability one (the
     pin-spacer/Lenis desync bug). Instead: a lightweight, rAF-throttled
     scroll listener computes one continuous 0–1 progress value from the
     *centres* of the first and last row (scroll-progress-timeline
     pattern), used to fill a rail (scaleY, compositor-only) and to tint
     the section background very slightly. Whichever row's centre sits
     closest to a fixed viewport anchor (40% down — identical on mobile
     and desktop, no hover anywhere, a single code path for both) becomes
     "active": its number/title tween to gold, its description gains
     emphasis, and its image is shown — as a sticky crossfading panel on
     desktop, inline under its own title (max-height + fade) on mobile.
     Reduced motion keeps every bit of this (nothing is hidden or
     skipped), it just turns off the CSS transitions elsewhere so state
     changes land instantly instead of easing.
     ------------------------------------------------------------------- */
  function initValuesScene() {
    var section = document.querySelector("[data-values]");
    if (!section) return;

    var rows = Array.prototype.slice.call(section.querySelectorAll("[data-values-value]"));
    if (!rows.length) return;
    var n = rows.length;

    var railFill = section.querySelector("[data-values-rail-fill]");
    var visualImgs = Array.prototype.slice.call(section.querySelectorAll("[data-values-visual-img]"));

    var current = -1;

    function openMobileMedia(row) {
      var media = row.querySelector("[data-values-row-media]");
      if (!media) return;
      var img = media.querySelector("img");
      function apply() {
        media.style.maxHeight = media.scrollHeight + "px";
      }
      if (img && !img.complete) img.addEventListener("load", apply, { once: true });
      media.classList.add("is-open");
      apply();
    }

    function closeMobileMedia(row) {
      var media = row.querySelector("[data-values-row-media]");
      if (!media) return;
      media.classList.remove("is-open");
      media.style.maxHeight = "0px";
    }

    function setActive(index) {
      if (index === current) return;
      current = index;

      rows.forEach(function (row, i) {
        var isActive = i === index;
        row.classList.toggle("is-active", isActive);
        if (isActive) {
          row.setAttribute("aria-current", "step");
          openMobileMedia(row);
        } else {
          row.removeAttribute("aria-current");
          closeMobileMedia(row);
        }
      });

      var activeImage = rows[index].getAttribute("data-values-image");
      visualImgs.forEach(function (img) {
        img.classList.toggle("is-active", img.getAttribute("data-values-visual-img") === activeImage);
      });
    }

    setActive(0);

    if (!("requestAnimationFrame" in window)) return;

    // Fixed viewport anchor (40% down), identical on every breakpoint —
    // there is no hover-driven behaviour here, so mobile and desktop share
    // this exact same trigger rather than two separate code paths.
    var anchorFraction = 0.4;
    var ticking = false;

    function update() {
      ticking = false;
      var anchorY = window.innerHeight * anchorFraction;

      // Progress normalised between the first and last row's centres
      // (scroll-progress-timeline), not arbitrary section edges.
      var firstRect = rows[0].getBoundingClientRect();
      var lastRect = rows[n - 1].getBoundingClientRect();
      var firstCenter = firstRect.top + firstRect.height / 2;
      var lastCenter = lastRect.top + lastRect.height / 2;
      var span = lastCenter - firstCenter;
      var progress = span > 0 ? (anchorY - firstCenter) / span : 0;
      progress = Math.max(0, Math.min(1, progress));

      section.style.setProperty("--values-progress", String(progress));
      if (railFill) railFill.style.setProperty("--values-fill", String(progress));

      var bestIndex = 0;
      var bestDist = Infinity;
      rows.forEach(function (row, i) {
        var r = row.getBoundingClientRect();
        var center = r.top + r.height / 2;
        var dist = Math.abs(center - anchorY);
        if (dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      });
      setActive(bestIndex);
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  /* ---------------------------------------------------------------------
     Zone d'intervention — line-art commune map (replaces the radar).

     A single scroll-triggered "draw-in" gesture, once: fine gold threads
     grow from the Manosque hub out to each surrounding commune, points
     scale in and labels fade up along the way — evoking a hand-drawn
     survey/contour map rather than a literal embed or a radar sweep.
     Purely decorative (aria-hidden; the accessible commune list lives in
     the text column beside it), degrades to instantly-drawn when
     reduced motion or no GSAP is available.
     ------------------------------------------------------------------- */
  function initCoverageMap() {
    var map = document.querySelector("[data-coverage-map]");
    if (!map) return;

    var lines = Array.prototype.slice.call(map.querySelectorAll("[data-coverage-line]"));
    var dots = Array.prototype.slice.call(map.querySelectorAll("[data-coverage-dot]"));
    var labels = Array.prototype.slice.call(map.querySelectorAll(".coverage__map-label"));
    var hub = map.querySelector(".coverage__map-hub");
    if (!lines.length) return;

    lines.forEach(function (line) {
      var length = typeof line.getTotalLength === "function" ? line.getTotalLength() : 220;
      line.style.strokeDasharray = String(length);
      line.style.strokeDashoffset = String(length);
    });

    if (reduceMotion || !hasGSAP || !window.IntersectionObserver) {
      lines.forEach(function (line) {
        line.style.strokeDashoffset = "0";
      });
      return;
    }

    gsap.set(dots, { transformOrigin: "50% 50%", scale: 0, opacity: 0 });
    gsap.set(labels, { autoAlpha: 0, y: 6 });
    if (hub) gsap.set(hub, { transformOrigin: "50% 50%", scale: 0, opacity: 0 });

    function run() {
      var tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      if (hub) tl.to(hub, { scale: 1, opacity: 1, duration: 0.5 });
      tl.to(lines, { strokeDashoffset: 0, duration: 1.1, ease: "power2.inOut", stagger: 0.1 }, "-=0.15")
        .to(dots, { scale: 1, opacity: 1, duration: 0.45, stagger: 0.1 }, "-=0.9")
        .to(labels, { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.09 }, "-=0.85");
    }

    var io = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            run();
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.35 }
    );
    io.observe(map);
  }

  /* ---------------------------------------------------------------------
     FAQ — animated disclosure.

     Keeps native <details>/<summary> as the baseline (fully functional,
     instant, with zero JS), then progressively enhances: clicks are
     intercepted, the panel is kept in the DOM while it animates open to
     its measured height / closed to 0, and only then is the native
     `open` state flipped — a smooth height + fade reveal on top of a
     markup structure that already works without any of this.
     ------------------------------------------------------------------- */
  function initFaqAccordion() {
    var items = Array.prototype.slice.call(document.querySelectorAll("[data-faq-item]"));
    if (!items.length || !hasGSAP) return;

    items.forEach(function (details) {
      var summary = details.querySelector("summary");
      var panel = details.querySelector("[data-faq-panel]");
      var inner = details.querySelector("[data-faq-panel-inner]");
      if (!summary || !panel) return;

      var animating = false;

      summary.addEventListener("click", function (e) {
        e.preventDefault();
        if (animating) return;
        if (details.open) {
          closeItem();
        } else {
          openItem();
        }
      });

      function openItem() {
        animating = true;
        details.open = true;
        var targetHeight = panel.scrollHeight;

        if (reduceMotion) {
          panel.style.height = "auto";
          animating = false;
          return;
        }

        gsap.fromTo(
          panel,
          { height: 0 },
          {
            height: targetHeight,
            duration: 0.5,
            ease: "power3.inOut",
            onComplete: function () {
              panel.style.height = "auto";
              animating = false;
            },
          }
        );
        if (inner) {
          gsap.fromTo(inner, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.45, delay: 0.08, ease: "power2.out" });
        }
      }

      function closeItem() {
        animating = true;
        var startHeight = panel.scrollHeight;

        if (reduceMotion) {
          details.open = false;
          animating = false;
          return;
        }

        if (inner) gsap.to(inner, { autoAlpha: 0, duration: 0.2, ease: "power1.out" });
        gsap.fromTo(
          panel,
          { height: startHeight },
          {
            height: 0,
            duration: 0.4,
            ease: "power3.inOut",
            onComplete: function () {
              details.open = false;
              animating = false;
            },
          }
        );
      }
    });
  }

  /* ---------------------------------------------------------------------
     Avis clients — editorial single-review stage.

     One review at a time, set in large magazine-style type, replacing
     the old auto-scrolling marquee track. Switching reviews (via the
     discreet dot navigation — no autoplay) is a single deep crossfade:
     the outgoing review fades back with a touch of blur while the next
     rises into focus. Off-JS the stage isn't created at all — CSS keeps
     every review stacked and fully readable in normal document flow.
     ------------------------------------------------------------------- */
  function initReviewsStage() {
    var stage = document.querySelector("[data-reviews-stage]");
    if (!stage) return;

    var entries = Array.prototype.slice.call(stage.querySelectorAll("[data-reviews-entry]"));
    var dots = Array.prototype.slice.call(stage.querySelectorAll("[data-reviews-dot]"));
    if (!entries.length || !dots.length) return;

    var current = 0;
    entries.forEach(function (entry, i) {
      if (entry.classList.contains("is-active")) current = i;
      if (i !== current) entry.setAttribute("aria-hidden", "true");
    });

    var animating = false;

    function goTo(index) {
      if (index === current || animating) return;
      var next = entries[index];
      var prev = entries[current];

      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === index);
        if (i === index) {
          dot.setAttribute("aria-current", "true");
        } else {
          dot.removeAttribute("aria-current");
        }
      });

      next.removeAttribute("aria-hidden");

      if (reduceMotion || !hasGSAP) {
        prev.classList.remove("is-active");
        prev.setAttribute("aria-hidden", "true");
        next.classList.add("is-active");
        current = index;
        return;
      }

      animating = true;
      gsap.set(next, { autoAlpha: 0, y: 20, scale: 0.97, filter: "blur(8px)" });
      next.classList.add("is-active");

      var tl = gsap.timeline({
        defaults: { ease: "power3.inOut" },
        onComplete: function () {
          prev.classList.remove("is-active");
          prev.setAttribute("aria-hidden", "true");
          animating = false;
        },
      });

      tl.to(prev, { autoAlpha: 0, y: -14, scale: 0.97, filter: "blur(8px)", duration: 0.55 }, 0).to(
        next,
        { autoAlpha: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.65 },
        0.1
      );

      current = index;
    }

    dots.forEach(function (dot, i) {
      dot.addEventListener("click", function () {
        goTo(i);
      });
    });
  }

  /* ---------------------------------------------------------------------
     Contact form — lightweight client-side handling
     ------------------------------------------------------------------- */
  function initContactForm() {
    var form = document.querySelector("[data-contact-form]");
    if (!form) return;
    var status = form.querySelector("[data-form-status]");

    form.addEventListener("submit", function (e) {
      // Honeypot check
      var honeypot = form.querySelector('input[name="societe"]');
      if (honeypot && honeypot.value) {
        e.preventDefault();
        return;
      }

      if (!form.checkValidity()) {
        return;
      }

      // If no real backend endpoint is configured, fall back to a mailto
      // draft so the request is never silently lost.
      if (form.getAttribute("data-fallback-mailto") === "true") {
        e.preventDefault();
        var data = new FormData(form);
        var body =
          "Nom: " + data.get("nom") + "%0D%0A" +
          "Telephone: " + data.get("telephone") + "%0D%0A" +
          "Email: " + data.get("email") + "%0D%0A" +
          "Prestation: " + data.get("prestation") + "%0D%0A%0D%0A" +
          encodeURIComponent(String(data.get("message") || ""));

        window.location.href =
          "mailto:deepclean.contact.pro@gmail.com?subject=" +
          encodeURIComponent("Demande de devis — site web") +
          "&body=" + body;

        if (status) status.textContent = "Votre messagerie va s'ouvrir pour envoyer la demande.";
      }
    });
  }

  /* ---------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------- */
  function boot() {
    initHeaderState();
    initNavReveal();
    initMobileNav();
    initAnchorNav();
    initMaskedReveals();
    initHero();
    initSectionReveals();
    initCounters();
    initPrestationsScene();
    initValuesScene();
    initExigenceJourney();
    initCoverageMap();
    initFaqAccordion();
    initReviewsStage();
    initContactForm();

    if (hasGSAP && window.ScrollTrigger) {
      // Keep Lenis's cached scroll-height in lockstep with every
      // ScrollTrigger.refresh(): a refresh can change pin-spacer sizes
      // (e.g. once web fonts swap in and reflow text), and if Lenis isn't
      // told about it via resize(), it keeps mapping wheel input against
      // the old, now-wrong document height — the mismatch compounds into
      // exactly the kind of huge scroll jump seen when scrolling through a
      // pinned section afterwards. See the matching reconciliation in
      // initLenis() for the case where this fires before Lenis exists yet.
      var doRefresh = function () {
        ScrollTrigger.refresh();
        if (lenis) lenis.resize();
      };

      window.addEventListener("load", doRefresh);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(doRefresh).catch(doRefresh);
      }
    }
  }

  initPreloader().then(function () {
    initLenis();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
