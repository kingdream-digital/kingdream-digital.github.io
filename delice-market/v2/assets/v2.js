/* Délice Market — V2 « La visite » (démo KingDream Digital) */
(function () {
  "use strict";

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canHover = window.matchMedia("(hover: hover)").matches;
  var animated = !!(window.gsap && window.ScrollTrigger) && !reduce;

  /* --- Moment de la journée : ciel de l'entrée et salutation --------------- */
  var now = new Date(), h = now.getHours();
  root.classList.add("t-" + (h >= 21 || h < 6 ? "nuit" : h < 11 ? "matin" : h < 18 ? "jour" : "soir"));
  $$(".js-greeting").forEach(function (el) { el.textContent = h >= 18 || h < 5 ? "Bonsoir" : "Bonjour"; });

  /* --- Ouvert / fermé en direct -------------------------------------------- */
  function toMin(s) { var p = s.split(":"); return +p[0] * 60 + +p[1]; }
  function fmt(s) { var p = s.split(":"); return +p[0] + "h" + (p[1] === "00" ? "" : p[1]); }
  function updateStatus() {
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    $$("[data-hours]").forEach(function (el) {
      var r = el.getAttribute("data-hours").split("-"), open = m >= toMin(r[0]) && m < toMin(r[1]);
      el.classList.toggle("is-open", open);
      el.classList.toggle("is-closed", !open);
      el.textContent = open ? "Ouvert · ferme à " + fmt(r[1]) : "Fermé · ouvre à " + fmt(r[0]);
    });
  }
  updateStatus();
  setInterval(updateStatus, 60000);

  /* --- Rôtisserie : vendredi, samedi, dimanche ----------------------------- */
  var rot = $("[data-rotisserie]");
  if (rot) {
    var jour = now.getDay(), noms = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    if (jour === 5 || jour === 6 || jour === 0) {
      rot.innerHTML = "<b>Aujourd'hui, " + noms[jour] + " :</b> la rôtisserie tourne !";
      rot.classList.add("is-on");
    } else {
      var n = 5 - jour;
      rot.innerHTML = "Prochaine rôtisserie : <b>vendredi</b>, dans " + n + " jour" + (n > 1 ? "s" : "") + ".";
    }
  }

  /* --- Date du ticket de caisse --------------------------------------------- */
  var dateEl = $("[data-date]");
  if (dateEl) {
    dateEl.textContent = "Visite du " + now.toLocaleDateString("fr-FR") + " à " +
      now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  /* --- Vidéos : chargées et lues seulement à l'écran ------------------------ */
  function play(v) { var p = v.play(); if (p && p.catch) { p.catch(function () {}); } }
  var lazy = $$("video.lazy-video");
  if ("IntersectionObserver" in window) {
    var vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          if (!v.getAttribute("src") && v.dataset.src) { v.src = v.dataset.src; }
          play(v);
        } else { v.pause(); }
      });
    }, { rootMargin: "300px 0px" });
    lazy.forEach(function (v) { vio.observe(v); });
  } else {
    lazy.forEach(function (v) { v.src = v.dataset.src; play(v); });
  }
  var film = $(".entree__film");
  if (film) { play(film); }

  /* --- « Vous êtes ici » + rayons visités ------------------------------------ */
  var ordre = ["plan", "primeur", "boucherie", "rotisserie", "epicerie", "fromagerie", "surgeles", "nouveautes", "caisse", "venir"];
  var rayons = ["primeur", "boucherie", "rotisserie", "epicerie", "fromagerie", "surgeles"];
  var couleurs = { green: "var(--green)", red: "var(--red)", orange: "var(--orange)", black: "#000", yellow: "var(--yellow)", cyan: "var(--cyan)", purple: "var(--purple)", slate: "var(--slate)" };
  var gps = $(".gps"), gpsTxt = $(".gps__txt"), gpsBar = $(".gps__bar");
  var zones = $$("[data-zone]");
  var visites = {};
  var courante = null;

  ordre.forEach(function () { gpsBar.appendChild(document.createElement("i")); });

  function majTicket() {
    rayons.forEach(function (r) {
      var li = $('[data-line="' + r + '"]');
      if (li) { li.classList.toggle("ok", !!visites[r]); $("b", li).textContent = visites[r] ? "✓" : "—"; }
    });
    var c = rayons.filter(function (r) { return visites[r]; }).length;
    var el = $("[data-count]");
    if (el) { el.textContent = "Rayons visités : " + c + "/6" + (c === 6 ? " · visite complète !" : ""); }
  }

  function choisir(zone) {
    var id = zone.dataset.zone;
    if (rayons.indexOf(id) !== -1 && !visites[id]) { visites[id] = true; majTicket(); }
    if (zone === courante) { return; }
    courante = zone;
    gps.classList.toggle("on", id !== "entree");
    $(".top").classList.toggle("solid", id !== "entree");
    gpsTxt.textContent = zone.dataset.label || id;
    gpsTxt.style.background = couleurs[zone.dataset.color] || "var(--slate)";
    gpsTxt.style.color = zone.dataset.color === "yellow" ? "#111" : "#fff";
    var idx = ordre.indexOf(id);
    $$("i", gpsBar).forEach(function (seg, i) {
      seg.classList.toggle("done", i < idx);
      seg.classList.toggle("now", i === idx);
    });
  }

  function detecter() {
    var mid = window.innerHeight * 0.5, trouvee = null;
    zones.forEach(function (z) {
      var r = z.getBoundingClientRect();
      if (r.top <= mid && r.bottom >= mid) { trouvee = z; }
    });
    if (trouvee) { choisir(trouvee); }
  }
  var tick = false;
  window.addEventListener("scroll", function () {
    if (!tick) { tick = true; requestAnimationFrame(function () { tick = false; detecter(); }); }
  }, { passive: true });
  window.addEventListener("resize", detecter);
  detecter();

  $$("[data-gps]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var i = courante ? ordre.indexOf(courante.dataset.zone) : -1;
      i += btn.getAttribute("data-gps") === "next" ? 1 : -1;
      i = Math.max(0, Math.min(ordre.length - 1, i));
      var cible = document.getElementById(ordre[i]);
      if (cible) { cible.scrollIntoView({ behavior: reduce ? "auto" : "smooth" }); }
    });
  });

  /* --- Loupe de l'épicerie ------------------------------------------------- */
  var loupe = $(".loupe");
  if (loupe) {
    var lens = $(".loupe__lens", loupe), img = $("img", loupe), Z = 2.6, auto = null;
    lens.style.backgroundImage = "url('" + loupe.dataset.img + "')";
    var placer = function (x, y) {
      var r = img.getBoundingClientRect();
      x = Math.max(0, Math.min(r.width, x)); y = Math.max(0, Math.min(r.height, y));
      lens.style.left = x + "px"; lens.style.top = y + "px";
      lens.style.backgroundSize = (r.width * Z) + "px " + (r.height * Z) + "px";
      var w = lens.offsetWidth / 2;
      lens.style.backgroundPosition = (-(x * Z - w)) + "px " + (-(y * Z - w)) + "px";
    };
    if (canHover) {
      loupe.addEventListener("pointermove", function (e) {
        var r = img.getBoundingClientRect();
        loupe.classList.add("on");
        placer(e.clientX - r.left, e.clientY - r.top);
      });
      loupe.addEventListener("pointerleave", function () { loupe.classList.remove("on"); });
    } else {
      // Écran tactile : la loupe balaie les rayons toute seule ; un appui la déplace
      var t0 = 0, cibleX = null, cibleY = null;
      var balayer = function (t) {
        if (!t0) { t0 = t; }
        var r = img.getBoundingClientRect(), k = (t - t0) / 1000;
        if (cibleX === null) { placer(r.width * (0.5 + 0.38 * Math.sin(k * 0.6)), r.height * (0.5 + 0.28 * Math.sin(k * 1.1))); }
        auto = requestAnimationFrame(balayer);
      };
      var lio = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { loupe.classList.add("on"); if (!auto) { auto = requestAnimationFrame(balayer); } }
          else { loupe.classList.remove("on"); cancelAnimationFrame(auto); auto = null; }
        });
      });
      lio.observe(loupe);
      loupe.addEventListener("click", function (e) {
        var r = img.getBoundingClientRect();
        cibleX = e.clientX - r.left; cibleY = e.clientY - r.top;
        placer(cibleX, cibleY);
        setTimeout(function () { cibleX = cibleY = null; }, 2500);
      });
    }
  }

  /* --- Étal du boucher : glisser à la souris -------------------------------- */
  var etal = $(".etal-boucher__list");
  if (etal) {
    var down = false, sx = 0, sl = 0;
    etal.addEventListener("pointerdown", function (e) {
      if (e.pointerType !== "mouse") { return; }
      down = true; sx = e.clientX; sl = etal.scrollLeft; etal.classList.add("dragging");
    });
    window.addEventListener("pointermove", function (e) { if (down) { etal.scrollLeft = sl - (e.clientX - sx); } });
    window.addEventListener("pointerup", function () { down = false; etal.classList.remove("dragging"); });
  }

  /* --- Tête de gondole : produit au centre mis en avant ----------------------- */
  var gondole = $(".gondole");
  if (gondole && "IntersectionObserver" in window) {
    var gio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { e.target.classList.toggle("center", e.intersectionRatio > 0.6); });
    }, { root: gondole, threshold: [0, 0.6, 1] });
    $$("li", gondole).forEach(function (li) { gio.observe(li); });
    // au départ, le 2e produit au centre : il y a des produits des deux côtés
    window.addEventListener("load", function () {
      var li = $$("li", gondole)[1];
      if (li) { gondole.scrollLeft = li.offsetLeft - (gondole.clientWidth - li.offsetWidth) / 2; }
    });
  }

  /* --- Neige du rayon surgelés -------------------------------------------- */
  var canvas = $(".snow");
  if (canvas && !reduce) {
    var ctx = canvas.getContext("2d"), flocons = [], actif = false, raf = null;
    var taille = function () {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      flocons = [];
      for (var i = 0; i < Math.round(r.width / 9); i++) {
        flocons.push({ x: Math.random() * r.width, y: Math.random() * r.height, r: 1 + Math.random() * 2.6, v: 0.4 + Math.random() * 1.1, o: Math.random() * 6 });
      }
    };
    var dessiner = function () {
      var r = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      ctx.fillStyle = "rgba(235,250,255,.85)";
      flocons.forEach(function (f) {
        f.y += f.v; f.o += 0.01; f.x += Math.sin(f.o) * 0.4;
        if (f.y > r.height + 4) { f.y = -4; f.x = Math.random() * r.width; }
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      });
      if (actif) { raf = requestAnimationFrame(dessiner); }
    };
    new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        actif = e.isIntersecting;
        if (actif) { taille(); cancelAnimationFrame(raf); raf = requestAnimationFrame(dessiner); }
      });
    }).observe(canvas);
  }

  /* --- Sans animations (mouvements réduits) : état final directement ------- */
  if (!animated) {
    var th = $("[data-thermo]"); if (th) { th.textContent = "-18"; }
    var tk = $("[data-ticket]"); if (tk) { tk.textContent = "042"; tk.parentNode.classList.add("called"); }
    return;
  }

  /* ========================================================================
     Animations au défilement (GSAP + ScrollTrigger)
     ======================================================================== */
  root.classList.add("anim");
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  // 1. Entrée : on s'approche du magasin, les portes s'ouvrent, on entre
  var tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: { trigger: "#entree", start: "top top", end: "+=260%", scrub: 0.6, pin: true, anticipatePin: 1 }
  });
  tl.to(".entree__title", { y: -90, opacity: 0, duration: 0.22 }, 0)
    .to(".scroll-hint", { opacity: 0, duration: 0.06 }, 0)
    .to(".entree__store img", { scale: 4.4, duration: 0.46, ease: "power2.in" }, 0)
    .to(".entree__sun", { y: -120, opacity: 0, duration: 0.3 }, 0)
    .to(".entree__doors", { opacity: 1, duration: 0.1 }, 0.34)
    .set(".entree__inside", { opacity: 1 }, 0.42)
    .to(".entree__stage", { opacity: 0, duration: 0.06 }, 0.42)
    .to(".door--l", { xPercent: -100, duration: 0.28, ease: "power2.inOut" }, 0.5)
    .to(".door--r", { xPercent: 100, duration: 0.28, ease: "power2.inOut" }, 0.5)
    .from(".entree__film", { scale: 1.25, duration: 0.4 }, 0.42)
    .from(".entree__welcome > *", { y: 50, opacity: 0, stagger: 0.04, duration: 0.18 }, 0.7)
    .to({}, { duration: 0.12 });

  // 2. Plan : le parcours se dessine, le repère avance
  var route = $(".pm-route"), you = $(".pm-you");
  if (route) {
    var len = route.getTotalLength();
    route.style.strokeDasharray = len;
    route.style.strokeDashoffset = len;
    gsap.to(route, {
      strokeDashoffset: 0, ease: "none",
      scrollTrigger: {
        trigger: ".plan__map", start: "top 75%", end: "bottom 35%", scrub: 0.5,
        onUpdate: function (self) {
          var p = route.getPointAtLength(len * self.progress);
          you.setAttribute("cx", p.x); you.setAttribute("cy", p.y);
        }
      }
    });
  }

  // 3. Primeur : on longe l'étal
  var track = $(".etal__track");
  if (track) {
    var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
    gsap.to(track, {
      x: function () { return -dist(); }, ease: "none",
      scrollTrigger: { trigger: ".etal", start: "top top", end: function () { return "+=" + dist(); }, pin: true, scrub: 0.6, invalidateOnRefresh: true }
    });
    $$(".etal__item img").forEach(function (im) {
      gsap.fromTo(im, { scale: 1.15 }, { scale: 1, ease: "none", scrollTrigger: { trigger: ".etal", start: "top top", end: function () { return "+=" + dist(); }, scrub: true } });
    });
  }

  // 4. Boucherie : fond en parallaxe, ticket appelé
  gsap.fromTo(".zone--boucherie .zone__bg img", { yPercent: -8, scale: 1.18 }, {
    yPercent: 8, scale: 1.05, ease: "none",
    scrollTrigger: { trigger: "#boucherie", start: "top bottom", end: "bottom top", scrub: true }
  });
  var ticket = $("[data-ticket]");
  if (ticket) {
    var num = { v: 38 };
    ScrollTrigger.create({
      trigger: ".ticket-zone", start: "top 70%", once: true,
      onEnter: function () {
        gsap.to(num, {
          v: 42, duration: 2.2, ease: "steps(4)",
          onUpdate: function () { ticket.textContent = String(Math.round(num.v)).padStart(3, "0"); },
          onComplete: function () { ticket.parentNode.classList.add("called"); }
        });
      }
    });
  }

  // 5. Rôtisserie : le four s'approche
  gsap.fromTo(".rot__four", { scale: 0.82, rotate: -6 }, {
    scale: 1, rotate: 0, ease: "none",
    scrollTrigger: { trigger: "#rotisserie", start: "top bottom", end: "center center", scrub: true }
  });

  // 6. Épicerie : bandeau d'épices qui suit le défilement
  gsap.fromTo(".spices", { xPercent: 4 }, {
    xPercent: -4, ease: "none",
    scrollTrigger: { trigger: ".spices", start: "top bottom", end: "bottom top", scrub: true }
  });

  // 8. Surgelés : la température descend
  var thermo = $("[data-thermo]");
  if (thermo) {
    var temp = { v: 20 };
    gsap.to(temp, {
      v: -18, ease: "none",
      onUpdate: function () { thermo.textContent = Math.round(temp.v); },
      scrollTrigger: { trigger: "#surgeles", start: "top 75%", end: "center 55%", scrub: 0.4 }
    });
  }

  // 10. Caisse : le ticket s'imprime
  gsap.fromTo(".receipt__paper", { yPercent: -100 }, {
    yPercent: 0, ease: "none",
    scrollTrigger: { trigger: ".receipt", start: "top 85%", end: "top 25%", scrub: 0.5 }
  });

  // Apparitions douces
  ScrollTrigger.batch(".rv", {
    start: "top 88%",
    onEnter: function (els) { gsap.to(els, { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: "power3.out", overwrite: true }); }
  });

  // Les images chargées à la demande changent les hauteurs : on recalcule
  window.addEventListener("load", function () { ScrollTrigger.refresh(); });
})();
