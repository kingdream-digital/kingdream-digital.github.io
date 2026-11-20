/* Délice — V4 « Les stories Délice »
   Lecteur plein écran : tap à droite / à gauche pour avancer ou revenir,
   glisser sur le côté pour changer de boutique (effet cube), glisser vers le
   bas pour fermer, appui long pour mettre en pause. Le bouton retour du
   téléphone ferme la story. */
(() => {
  "use strict";
  const DATA = JSON.parse(document.getElementById("stories").textContent);
  const lecteur = document.querySelector("[data-lecteur]");
  const scene = lecteur.querySelector("[data-scene]");
  const fond = lecteur.querySelector("[data-fond]");
  const aide = lecteur.querySelector("[data-aide]");
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DUREE = { ouverture: 6500, photo: 5000, etal: 7000, affiche: 5500, avis: 7500, infos: 9000 };

  const svg = (d, fill) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
  const I = {
    pin: svg('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
    phone: svg('<path d="M5 3.5h3.2l1.6 4.3-2.1 1.4a12 12 0 0 0 7.1 7.1l1.4-2.1 4.3 1.6V19a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5z"/>'),
    route: svg('<path d="M3 11.5 21 3l-8.5 18-2.2-7.3z"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    pause: svg('<path d="M9 5v14M15 5v14"/>'),
    play: svg('<path d="M7 4.5v15l12-7.5z"/>', true),
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const hm = (h) => { const [a, b] = h.split(":"); return +a + "h" + (b === "00" ? "" : b); };
  const statut = (b) => `<span class="statut js-statut" data-open="${b.open}" data-close="${b.close}">Ouvert 7j/7</span>`;

  /* Statut d'ouverture en temps réel (les stories sont construites après le chargement) */
  const toMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
  function majStatuts(racine) {
    const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
    racine.querySelectorAll(".js-statut").forEach((el) => {
      const o = el.dataset.open, c = el.dataset.close, ouvert = now >= toMin(o) && now < toMin(c);
      el.classList.toggle("is-ouvert", ouvert); el.classList.toggle("is-ferme", !ouvert);
      el.textContent = ouvert ? `Ouvert · ferme à ${hm(c)}` : now < toMin(o) ? `Fermé · ouvre à ${hm(o)}` : `Fermé · ouvre demain à ${hm(o)}`;
    });
  }

  /* ---- Les diapositives --------------------------------------------------- */
  function diapo(s, b) {
    const img = (src) => `<img class="diapo__img" src="${src}" alt="" loading="lazy" decoding="async">`;
    switch (s.type) {
      case "ouverture":
        return `<div class="diapo diapo--ouverture" data-img="${s.img}">${img(s.img)}
          ${b.provisoire ? '<p class="diapo__provisoire">Photos provisoires</p>' : ""}
          <div class="diapo__txt">${s.nouveau ? '<span class="diapo__new">Nouvelle boutique</span>' : ""}
            <p class="diapo__kicker">${esc(s.kicker)}</p><h2 class="diapo__titre">${esc(s.titre)}</h2>
            <p class="diapo__texte">${esc(s.texte)}</p>
            <ul class="diapo__chips">${s.chips.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div></div>`;
      case "photo":
        return `<div class="diapo diapo--photo" data-img="${s.img}">${img(s.img)}
          <span class="diapo__panneau">${s.ico ? `<img src="${s.ico}" alt="">` : ""}${esc(s.etiquette)}</span>
          ${s.texte ? `<div class="diapo__txt"><p class="diapo__texte">${esc(s.texte)}</p></div>` : ""}</div>`;
      case "etal":
        return `<div class="diapo diapo--etal"><div class="etal"><h2 class="etal__titre">${esc(s.titre)}</h2>
          <div class="etal__grille">${s.produits.map((p) => `<div class="etal__p ${p.detoure ? "" : "etal__p--photo"}">
            <span class="etal__plateau"><img src="${p.img}" alt="${esc(p.nom)}" loading="lazy"></span>
            <span class="etal__ardoise"><b>${esc(p.nom)}</b><small>${esc(p.origine)}</small></span></div>`).join("")}</div>
          ${s.note ? `<p class="etal__note">${esc(s.note)}</p>` : ""}</div></div>`;
      case "affiche":
        return `<div class="diapo diapo--affiche" data-img="${s.img}"><span class="diapo__flou" style="background-image:url('${s.img}')"></span>
          <div class="affiche-story"><img src="${s.img}" alt="${esc(s.texte)}" loading="lazy"></div>
          <div class="diapo__txt"><p class="diapo__kicker">En ce moment</p><p class="diapo__texte">${esc(s.texte)}</p></div></div>`;
      case "avis":
        return `<div class="diapo diapo--avis"><div class="avis-story">
          <span class="avis-story__guillemet" aria-hidden="true">“</span>
          ${s.note ? `<p class="avis-story__note"><b>${esc(s.note)}</b><span>★★★★★</span><small>${esc(s.nb)}</small></p>` : ""}
          <blockquote><p>${esc(s.citation)}</p><cite>${esc(s.auteur)}, avis Google</cite></blockquote>
          ${s.sous ? `<p class="avis-story__sous">${esc(s.sous)}</p>` : ""}</div></div>`;
      case "infos":
        return `<div class="diapo diapo--infos" data-img="${s.img}">${img(s.img)}<div class="infos-story">
          <h3>Venir chez ${esc(b.nom)}</h3>
          <p class="infos-story__statut">${statut(b)}</p>
          <p>${I.clock}<span>Ouvert 7 jours sur 7, de ${hm(b.open)} à ${hm(b.close)}</span></p>
          <p>${I.pin}<span>${esc(b.adresse)}</span></p>
          <div class="infos-story__btns">
            <a class="plein" href="${b.maps}" target="_blank" rel="noopener">${I.route}Itinéraire</a>
            ${b.telHref ? `<a href="${b.telHref}">${I.phone}Appeler le ${esc(b.tel)}</a>` : ""}
            <a href="${b.url}">Toute la boutique ${I.arrow}</a>
          </div></div></div>`;
    }
    return "";
  }

  function construire(b) {
    const el = document.createElement("section");
    el.className = `story t-${b.type}${b.rouge ? " v-red" : ""}`;
    el.hidden = true;
    el.setAttribute("aria-label", `${b.nom}, ${b.ville}`);
    el.innerHTML = `<div class="story__cadre">
      ${b.slides.map((s) => diapo(s, b)).join("")}
      <div class="story__haut">
        <div class="story__barres">${b.slides.map(() => "<span><i></i></span>").join("")}</div>
        <div class="story__entete">
          <span class="story__avatar"><img src="${b.logo}" alt=""></span>
          <span class="story__qui"><b>${esc(b.nom)}</b><small>${esc(b.ville)} · ${statut(b)}</small></span>
          <button class="story__btn" type="button" data-pause aria-label="Mettre en pause">${I.pause}</button>
          <button class="story__btn" type="button" data-fermer aria-label="Fermer">${I.close}</button>
        </div>
      </div>
      <div class="story__bas">
        <a class="icone" href="${b.maps}" target="_blank" rel="noopener" aria-label="Itinéraire">${I.route}</a>
        ${b.telHref ? `<a class="icone" href="${b.telHref}" aria-label="Appeler">${I.phone}</a>` : ""}
        <a class="voir" href="${b.url}">Voir la boutique ${I.arrow}</a>
      </div>
    </div>`;
    el.querySelector("[data-fermer]").addEventListener("click", () => fermer());
    el.querySelector("[data-pause]").addEventListener("click", () => mettrePause(!pause, true));
    majStatuts(el);
    return el;
  }

  /* ---- État du lecteur ---------------------------------------------------- */
  let stories = null, cur = 0, diap = 0, ecoule = 0, dernier = 0, raf = 0, ouvert = false;
  let pause = false, pauseManuelle = false, enTransition = false, ouvertParLien = false, focusAvant = null;

  function story() { return stories[cur]; }
  function diapos() { return story().querySelectorAll(".diapo"); }
  function duree() { return DUREE[DATA[cur].slides[diap].type] || 5000; }

  function montrerDiapo(i) {
    const ds = diapos(), barres = story().querySelectorAll(".story__barres i");
    diap = Math.max(0, Math.min(ds.length - 1, i));
    ds.forEach((d, k) => d.classList.toggle("is-on", k === diap));
    barres.forEach((b, k) => { b.style.transform = `scaleX(${k < diap ? 1 : 0})`; });
    ecoule = 0;
    const d = ds[diap], src = d.dataset.img;
    fond.style.backgroundImage = src ? `url('${src}')` : "none";
    // charge d'avance la diapositive suivante et le début de la boutique suivante
    const suiv = ds[diap + 1] || (stories[cur + 1] && stories[cur + 1].querySelector(".diapo"));
    if (suiv) suiv.querySelectorAll("img").forEach((im) => { im.loading = "eager"; });
    d.querySelectorAll("img").forEach((im) => { im.loading = "eager"; });
  }

  function suivante() {
    if (diap < diapos().length - 1) montrerDiapo(diap + 1);
    else allerBoutique(cur + 1, 1);
  }
  function precedente() {
    if (diap > 0) montrerDiapo(diap - 1);
    else if (cur > 0) allerBoutique(cur - 1, -1);
    else montrerDiapo(0);
  }

  function allerBoutique(n, dir) {
    if (enTransition) return;
    if (n >= stories.length) { fermer(); return; }
    if (n < 0) { montrerDiapo(0); return; }
    const a = story(), b = stories[n];
    marquerVu(DATA[n].slug);
    b.hidden = false;
    cur = n;
    montrerDiapo(0);
    if (reduit) { a.hidden = true; return; }
    enTransition = true;
    const sa = dir > 0 ? "cube-sort-g" : "cube-sort-d", sb = dir > 0 ? "cube-entre-d" : "cube-entre-g";
    a.classList.add(sa); b.classList.add(sb);
    setTimeout(() => { a.hidden = true; a.classList.remove(sa); b.classList.remove(sb); enTransition = false; }, 570);
    majHash();
  }

  function boucle(now) {
    if (!ouvert) return;
    if (!pause && !enTransition && !document.hidden) ecoule += now - dernier;
    dernier = now;
    const k = Math.min(1, ecoule / duree());
    const barre = story().querySelectorAll(".story__barres i")[diap];
    if (barre) barre.style.transform = `scaleX(${k.toFixed(4)})`;
    if (k >= 1) suivante();
    raf = requestAnimationFrame(boucle);
  }

  function mettrePause(v, manuelle) {
    pause = v;
    if (manuelle) pauseManuelle = v;
    lecteur.classList.toggle("est-pause", v && !manuelle);
    stories && stories.forEach((s) => {
      const bt = s.querySelector("[data-pause]");
      bt.innerHTML = v && manuelle ? I.play : I.pause;
      bt.setAttribute("aria-label", v && manuelle ? "Reprendre" : "Mettre en pause");
    });
  }

  /* ---- Stories déjà vues (anneau gris) ------------------------------------ */
  const CLE = "delice-stories-vues";
  function lireVues() { try { return JSON.parse(localStorage.getItem(CLE) || "[]"); } catch (e) { return []; } }
  function marquerVu(slug) {
    const v = lireVues();
    if (!v.includes(slug)) { v.push(slug); try { localStorage.setItem(CLE, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
    document.querySelectorAll(`.rond[data-story="${slug}"]`).forEach((r) => r.classList.add("is-vu"));
  }
  lireVues().forEach((s) => document.querySelectorAll(`.rond[data-story="${s}"]`).forEach((r) => r.classList.add("is-vu")));

  /* ---- Ouvrir / fermer ----------------------------------------------------- */
  function majHash() {
    const h = "#story-" + DATA[cur].slug;
    if (location.hash !== h) history.replaceState({ story: DATA[cur].slug }, "", h);
  }
  function ouvrir(slug, viaLien) {
    if (!stories) {
      stories = DATA.map(construire);
      stories.forEach((s) => scene.appendChild(s));
    }
    const n = Math.max(0, DATA.findIndex((b) => b.slug === slug));
    focusAvant = document.activeElement;
    stories.forEach((s, k) => { s.hidden = k !== n; });
    cur = n;
    lecteur.hidden = false;
    document.documentElement.style.overflow = "hidden";
    mettrePause(false, true);
    montrerDiapo(0);
    marquerVu(slug);
    ouvert = true; dernier = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(boucle);
    ouvertParLien = !!viaLien;
    if (!viaLien) history.pushState({ story: slug }, "", "#story-" + slug);
    story().querySelector("[data-fermer]").focus({ preventScroll: true });
    // Petite aide la première fois
    let dejaAide = false;
    try { dejaAide = sessionStorage.getItem("delice-aide") === "1"; sessionStorage.setItem("delice-aide", "1"); } catch (e) { /* rien */ }
    if (!dejaAide) { aide.classList.add("is-on"); setTimeout(() => aide.classList.remove("is-on"), 3200); }
  }
  function fermer(depuisRetour) {
    if (!ouvert) return;
    ouvert = false;
    cancelAnimationFrame(raf);
    lecteur.hidden = true;
    document.documentElement.style.overflow = "";
    if (!depuisRetour) {
      if (ouvertParLien) history.replaceState(null, "", location.pathname + location.search);
      else history.back();
    }
    focusAvant && focusAvant.focus && focusAvant.focus({ preventScroll: true });
  }
  addEventListener("popstate", (ev) => {
    if (ouvert && !(ev.state && ev.state.story)) fermer(true);
  });
  document.querySelectorAll("[data-story]").forEach((bt) => bt.addEventListener("click", () => ouvrir(bt.dataset.story)));
  lecteur.querySelectorAll("[data-boutique]").forEach((bt) => bt.addEventListener("click", () => allerBoutique(cur + +bt.dataset.boutique, +bt.dataset.boutique)));
  const lien = location.hash.match(/^#story-(.+)$/);
  if (lien && DATA.some((b) => b.slug === lien[1])) ouvrir(lien[1], true);

  /* ---- Gestes ------------------------------------------------------------- */
  let p0 = null, tAppui = 0, appuiLong = false;
  scene.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("a, button") || enTransition) return;
    p0 = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    appuiLong = false;
    clearTimeout(tAppui);
    tAppui = setTimeout(() => { appuiLong = true; if (!pauseManuelle) mettrePause(true, false); }, 220);
    scene.setPointerCapture(ev.pointerId);
  });
  scene.addEventListener("pointermove", (ev) => {
    if (!p0) return;
    const dx = ev.clientX - p0.x, dy = ev.clientY - p0.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(tAppui);
    const st = story();
    if (dy > 0 && dy > Math.abs(dx)) st.style.transform = `translateY(${dy}px) scale(${Math.max(.82, 1 - dy / 1600)})`;
    else if (Math.abs(dx) > Math.abs(dy)) st.style.transform = `translateX(${dx * .3}px) rotateY(${dx * .03}deg)`;
  });
  function finGeste(ev, annule) {
    if (!p0) return;
    clearTimeout(tAppui);
    const dx = ev.clientX - p0.x, dy = ev.clientY - p0.y, st = story();
    st.style.transition = "transform .25s"; st.style.transform = "";
    setTimeout(() => { st.style.transition = ""; }, 260);
    const etaitLong = appuiLong;
    p0 = null; appuiLong = false;
    if (etaitLong && !pauseManuelle) mettrePause(false, false);
    if (annule) return;
    if (dy > 110 && dy > Math.abs(dx)) { fermer(); return; }
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { allerBoutique(cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); return; }
    if (etaitLong || Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
    const r = st.querySelector(".story__cadre").getBoundingClientRect();
    if (ev.clientX < r.left + r.width * .3) precedente(); else suivante();
  }
  scene.addEventListener("dragstart", (ev) => ev.preventDefault());
  scene.addEventListener("contextmenu", (ev) => { if (p0 || appuiLong) ev.preventDefault(); });
  scene.addEventListener("pointerup", (ev) => finGeste(ev, false));
  scene.addEventListener("pointercancel", (ev) => finGeste(ev, true));

  addEventListener("keydown", (ev) => {
    if (!ouvert) return;
    if (ev.key === "Escape") { ev.preventDefault(); fermer(); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); suivante(); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); precedente(); }
    else if (ev.key === "ArrowDown") { ev.preventDefault(); allerBoutique(cur + 1, 1); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); allerBoutique(cur - 1, -1); }
    else if (ev.key === " " && !ev.target.closest("a, button")) { ev.preventDefault(); mettrePause(!pause, true); }
  });
  document.addEventListener("visibilitychange", () => { dernier = performance.now(); });
})();
