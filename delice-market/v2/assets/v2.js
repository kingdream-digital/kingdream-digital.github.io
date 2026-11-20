/* Délice — V2 immersive « Les portes Délice » */
(() => {
  "use strict";
  const doc = document.documentElement;
  const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const easeIO = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeIn = (t) => t * t * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  /* ---- Ciel selon l'heure -------------------------------------------------- */
  const h = new Date().getHours();
  doc.classList.add(h >= 7 && h < 17 ? "ciel-jour" : h >= 17 && h < 20 ? "ciel-soir" : "ciel-nuit");

  /* ---- Statut d'ouverture en temps réel ------------------------------------ */
  const fmt = (hm) => { const [hh, mm] = hm.split(":"); return +hh + "h" + (mm === "00" ? "" : mm); };
  const toMin = (hm) => { const [hh, mm] = hm.split(":").map(Number); return hh * 60 + mm; };
  function majStatuts() {
    const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
    document.querySelectorAll(".js-statut").forEach((el) => {
      const o = el.dataset.open, c = el.dataset.close;
      const ouvert = now >= toMin(o) && now < toMin(c);
      el.classList.toggle("is-ouvert", ouvert);
      el.classList.toggle("is-ferme", !ouvert);
      el.textContent = ouvert ? `Ouvert · ferme à ${fmt(c)}`
        : now < toMin(o) ? `Fermé · ouvre à ${fmt(o)}` : `Fermé · ouvre demain à ${fmt(o)}`;
    });
  }
  majStatuts();
  setInterval(majStatuts, 60000);

  /* ---- En-tête qui se remplit au défilement --------------------------------- */
  const top = document.querySelector("[data-top]");
  const entreeEl = document.querySelector("[data-entree]");
  const ouvertureEl = entreeEl || document.querySelector("[data-survol]");  // V3 : la maquette 3D
  function majTop() {
    const seuil = ouvertureEl ? ouvertureEl.offsetTop + ouvertureEl.offsetHeight - 170 : 40;
    top && top.classList.toggle("is-plein", window.scrollY > seuil);
  }
  window.addEventListener("scroll", majTop, { passive: true });
  majTop();

  /* ---- L'entrée : les portes coulissent, on entre --------------------------- */
  if (entreeEl) {
    const ent = entreeEl;
    const mode = ent.dataset.entree;
    const scene = ent.querySelector("[data-scene]");
    const baie = ent.querySelector("[data-baie]");
    const vg = ent.querySelector('[data-vantail="g"]');
    const vd = ent.querySelector('[data-vantail="d"]');
    const dedans = ent.querySelector("[data-dedans]");
    const dedansImg = dedans.querySelector("img");
    const flash = ent.querySelector(".entree__flash");
    const intro = ent.querySelector("[data-intro]");
    const capteur = ent.querySelector("[data-capteur]");
    let geo = null, cur = 0, cible = 0, raf = 0, auto = false;

    const dedansBaie = baie.querySelector(".porte__dedans img");

    // Mesure à plat (sans transformations) : centre du passage et échelle de raccord.
    // L'image vue à travers la porte a exactement le cadrage de l'image plein écran,
    // le fondu entre les deux est donc invisible.
    function mesurer() {
      const tS = scene.style.transform, tG = vg.style.transform, tD = vd.style.transform;
      scene.style.transform = vg.style.transform = vd.style.transform = "none";
      const sr = scene.getBoundingClientRect(), br = baie.getBoundingClientRect();
      const g = vg.getBoundingClientRect(), dr = vd.getBoundingClientRect();
      scene.style.transform = tS; vg.style.transform = tG; vd.style.transform = tD;
      const vw = sr.width, vh = sr.height;
      const iw = baie.clientWidth, ih = baie.clientHeight;
      const cx = (g.left + dr.right) / 2 - sr.left, cy = (g.top + g.bottom) / 2 - sr.top;
      const s0 = Math.min(vw / iw, vh / ih);
      const S = Math.max(s0 * 1.2, 1.7);
      const bx = baie.clientLeft + (br.left - sr.left), by = baie.clientTop + (br.top - sr.top);
      const w = vw / s0, h = vh / s0;
      Object.assign(dedansBaie.style, {
        position: "absolute", maxWidth: "none", width: w + "px", height: h + "px",
        left: (cx - bx - w / 2) + "px", top: (cy - by - h / 2) + "px",
      });
      geo = { cx, cy, vw, vh, s0, S };
      scene.style.transformOrigin = `${cx}px ${cy}px`;
      rendu(cur);
    }

    function rendu(p) {
      if (!geo) return;
      const open = easeIO(clamp((p - .04) / .38));
      const d = easeIO(clamp((p - .22) / .6));
      const s = 1 + (geo.S - 1) * d;
      const tx = (geo.vw / 2 - geo.cx) * d, ty = (geo.vh / 2 - geo.cy) * d;
      scene.style.transform = `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0) scale(${s.toFixed(4)})`;
      vg.style.transform = `translate3d(${(-open * 100).toFixed(2)}%,0,0)`;
      vd.style.transform = `translate3d(${(open * 100).toFixed(2)}%,0,0)`;
      ent.style.setProperty("--open", open.toFixed(3));
      // Fondu vers l'image plein écran, calée sur l'image vue à travers la porte
      const f = clamp((p - .6) / .2);
      dedans.style.opacity = f.toFixed(3);
      const k = easeOut(clamp((p - .8) / .2));      // puis la caméra se pose
      const hs = (s / geo.s0) * (1 - k) + k;
      const hx = (geo.cx + tx - geo.vw / 2) * (1 - k), hy = (geo.cy + ty - geo.vh / 2) * (1 - k);
      dedansImg.style.transform = `translate3d(${hx.toFixed(1)}px,${hy.toFixed(1)}px,0) scale(${hs.toFixed(4)})`;
      flash.style.opacity = (Math.sin(f * Math.PI) * .16).toFixed(3);
      if (intro) intro.style.opacity = (1 - clamp(p / .1)).toFixed(3);
      if (intro) intro.style.visibility = p > .12 ? "hidden" : "visible";
      capteur && capteur.classList.toggle("is-on", p > .005 || auto);
      ent.classList.toggle("is-dedans", p >= .88);
    }

    function boucle() {
      cur += (cible - cur) * .16;
      if (Math.abs(cible - cur) < .0008) cur = cible;
      rendu(cur);
      raf = cur !== cible ? requestAnimationFrame(boucle) : 0;
    }
    const viser = (p) => { cible = p; if (!raf) raf = requestAnimationFrame(boucle); };

    if (reduit) {
      ent.classList.add("is-reduit");
      cur = cible = 1;
      mesurer();
    } else if (mode === "scroll") {
      const lire = () => {
        const r = ent.getBoundingClientRect();
        const course = r.height - window.innerHeight;
        viser(clamp(-r.top / (course || 1)));
      };
      window.addEventListener("scroll", lire, { passive: true });
      mesurer();
      lire();
      const btn = ent.querySelector("[data-entrer]");
      btn && btn.addEventListener("click", () => {
        const fin = ent.offsetTop + ent.offsetHeight - window.innerHeight;
        window.scrollTo({ top: fin, behavior: "smooth" });
      });
    } else {
      // Page boutique : la porte s'ouvre toute seule, comme une vraie porte automatique
      mesurer();
      const go = () => {
        if (window.__fige) return; // captures d'écran : façade porte fermée
        auto = true;
        capteur && capteur.classList.add("is-on");
        const t0 = performance.now() + 380, D = 2700;
        const pas = (t) => {
          const k = clamp((t - t0) / D);
          cur = cible = k;
          rendu(k);
          if (k < 1) requestAnimationFrame(pas);
        };
        requestAnimationFrame(pas);
      };
      const img = baie.querySelector("img");
      if (img && !img.complete) {
        let fait = false;
        const once = () => { if (!fait) { fait = true; go(); } };
        img.addEventListener("load", once);
        img.addEventListener("error", once);
        setTimeout(once, 1500);
      } else go();
    }
    let tRes;
    window.addEventListener("resize", () => { clearTimeout(tRes); tRes = setTimeout(mesurer, 120); });
    window.addEventListener("load", mesurer);
  }

  /* ---- Apparitions au défilement ------------------------------------------- */
  const io = "IntersectionObserver" in window ? new IntersectionObserver((ents) => {
    ents.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("is-vu"); io.unobserve(x.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: .12 }) : null;
  document.querySelectorAll(".rv").forEach((el) => (io ? io.observe(el) : el.classList.add("is-vu")));

  /* ---- Cartes « porte » : sur écran tactile, elles s'ouvrent en entrant dans l'écran */
  const tactile = !window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (tactile && "IntersectionObserver" in window) {
    const io2 = new IntersectionObserver((ents) => {
      ents.forEach((x) => x.target.classList.toggle("is-ouverte", x.intersectionRatio > .6));
    }, { threshold: [0, .6, 1] });
    document.querySelectorAll(".dcard").forEach((c) => io2.observe(c));
  }

  /* ---- Carte de la région ↔ boutiques -------------------------------------- */
  const pins = document.querySelectorAll("[data-pin]");
  const allumer = (v) => pins.forEach((p) => p.classList.toggle("is-on", p.dataset.pin === v));
  document.querySelectorAll(".dcard[data-ville]").forEach((c) => {
    c.addEventListener("mouseenter", () => allumer(c.dataset.ville));
    c.addEventListener("mouseleave", () => allumer(null));
  });
  if (pins.length && "IntersectionObserver" in window) {
    const io3 = new IntersectionObserver((ents) => {
      ents.forEach((x) => { if (x.isIntersecting) allumer(x.target.dataset.villeGroupe); });
    }, { rootMargin: "-45% 0px -45% 0px" });
    document.querySelectorAll("[data-ville-groupe]").forEach((g) => io3.observe(g));
  }

  /* ---- Menu des boutiques -------------------------------------------------- */
  const menu = document.getElementById("menu");
  let dernierFocus = null;
  const ouvrirMenu = () => {
    dernierFocus = document.activeElement;
    menu.hidden = false;
    document.body.style.overflow = "hidden";
    menu.querySelector("[data-menu-close]").focus();
  };
  const fermerMenu = () => {
    menu.hidden = true;
    document.body.style.overflow = "";
    dernierFocus && dernierFocus.focus();
  };
  document.querySelectorAll("[data-menu-open]").forEach((b) => b.addEventListener("click", ouvrirMenu));
  if (menu) {
    menu.querySelector("[data-menu-close]").addEventListener("click", fermerMenu);
    menu.addEventListener("click", (ev) => { if (ev.target === menu) fermerMenu(); });
    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !menu.hidden) fermerMenu(); });
  }

  /* ---- Transition : les portes se referment, puis on change de boutique ---- */
  const passage = document.querySelector(".passage");
  document.querySelectorAll("a[data-passage]").forEach((a) => {
    a.addEventListener("click", (ev) => {
      if (reduit || !passage || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      ev.preventDefault();
      const href = a.href;
      if (menu && !menu.hidden) { menu.hidden = true; document.body.style.overflow = ""; }
      passage.classList.add("is-ferme");
      setTimeout(() => { window.location.href = href; }, 520);
    });
  });
  window.addEventListener("pageshow", () => passage && passage.classList.remove("is-ferme"));

  /* ---- Vitrine réfrigérée : glisser, flèches, filtres ---------------------- */
  const rail = document.querySelector("[data-rail]");
  if (rail) {
    let x0 = 0, s0 = 0, drag = false, bouge = false;
    rail.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType !== "mouse") return;
      drag = true; bouge = false; x0 = ev.clientX; s0 = rail.scrollLeft;
    });
    window.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dx = ev.clientX - x0;
      if (Math.abs(dx) > 4) { bouge = true; rail.classList.add("is-drag"); }
      rail.scrollLeft = s0 - dx;
    });
    window.addEventListener("pointerup", () => { drag = false; rail.classList.remove("is-drag"); });
    rail.addEventListener("click", (ev) => { if (bouge) { ev.preventDefault(); ev.stopPropagation(); } }, true);
    const pasRail = () => Math.max(240, rail.clientWidth * .7);
    const prev = document.querySelector("[data-rail-prev]"), next = document.querySelector("[data-rail-next]");
    prev && prev.addEventListener("click", () => rail.scrollBy({ left: -pasRail(), behavior: "smooth" }));
    next && next.addEventListener("click", () => rail.scrollBy({ left: pasRail(), behavior: "smooth" }));

    document.querySelectorAll("[data-filtre]").forEach((b) => {
      b.addEventListener("click", () => {
        const f = b.dataset.filtre;
        document.querySelectorAll("[data-filtre]").forEach((x) => {
          x.classList.toggle("is-on", x === b);
          x.setAttribute("aria-pressed", x === b ? "true" : "false");
        });
        rail.querySelectorAll(".produit").forEach((p) => { p.hidden = f !== "tout" && p.dataset.cat !== f; });
        rail.scrollTo({ left: 0, behavior: "smooth" });
      });
    });
  }

  /* ---- Léger parallaxe sur les photos de présentation ---------------------- */
  const para = document.querySelectorAll("[data-parallax] .presentation__petit");
  if (para.length && !reduit) {
    const maj = () => para.forEach((el) => {
      const r = el.parentElement.getBoundingClientRect();
      const k = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
      el.style.transform = `translate3d(0,${(k * -50).toFixed(1)}px,0)`;
    });
    window.addEventListener("scroll", () => requestAnimationFrame(maj), { passive: true });
    maj();
  }
})();
