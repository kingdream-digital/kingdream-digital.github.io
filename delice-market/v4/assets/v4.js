/* Délice — V4 « Les stories Délice »

   Accueil : carrousel des boutiques (la carte au centre est mise en avant).
   Lecteur : la story s'ouvre depuis le rond touché et s'y referme. Tap à droite
   ou à gauche pour avancer ou revenir, glisser sur le côté pour changer de
   boutique (cube 3D qui suit le doigt), glisser vers le bas pour fermer, appui
   long pour mettre en pause. Le bouton retour du téléphone ferme la story.
   Les images se chargent au fil de l'eau ; la story attend qu'elles soient
   prêtes avant d'avancer. */
(() => {
  "use strict";
  const doc = document.documentElement;
  const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tactile = matchMedia("(pointer: coarse)").matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const vibrer = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* rien */ } };
  const lire = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } };

  /* ======================================================================
     Accueil : le carrousel des boutiques
     ====================================================================== */
  const rail = document.querySelector("[data-cartes]");
  if (rail) {
    const cartes = [...rail.children];
    const points = [...document.querySelectorAll("[data-point]")];
    let rafC = 0;
    const majCartes = () => {
      rafC = 0;
      const r = rail.getBoundingClientRect(), centre = r.left + r.width / 2;
      let meilleure = 0, dMin = 9;
      cartes.forEach((el, k) => {
        const b = el.getBoundingClientRect();
        const d = Math.min(1, Math.abs(b.left + b.width / 2 - centre) / (b.width + 14));
        el.style.setProperty("--d", d.toFixed(3));
        if (d < dMin) { dMin = d; meilleure = k; }
      });
      cartes.forEach((el, k) => el.classList.toggle("is-actif", k === meilleure));
      points.forEach((p, k) => p.classList.toggle("is-on", k === meilleure));
    };
    rail.addEventListener("scroll", () => { if (!rafC) rafC = requestAnimationFrame(majCartes); }, { passive: true });
    addEventListener("resize", majCartes);
    majCartes();
  }

  /* ======================================================================
     Le lecteur de stories
     ====================================================================== */
  const source = document.getElementById("stories");
  const lecteur = document.querySelector("[data-lecteur]");
  if (!source || !lecteur) return;
  const DATA = JSON.parse(source.textContent);
  const scene = lecteur.querySelector("[data-scene]");
  const fond = lecteur.querySelector("[data-fond]");
  const coach = lecteur.querySelector("[data-coach]");
  const toast = lecteur.querySelector("[data-toast]");
  const apercus = { "-1": lecteur.querySelector(".apercu--prec"), "1": lecteur.querySelector(".apercu--suiv") };
  const DUREE = { portes: 8200, photo: 5600, etal: 7200, affiche: 5800, avis: 8200, infos: 10000 };

  const svg = (d, plein) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" ${plein ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
  const I = {
    pin: svg('<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
    phone: svg('<path d="M5 3.5h3.2l1.6 4.3-2.1 1.4a12 12 0 0 0 7.1 7.1l1.4-2.1 4.3 1.6V19a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3 5.7 2 2 0 0 1 5 3.5z"/>'),
    route: svg('<path d="M3 11.5 21 3l-8.5 18-2.2-7.3z"/>'),
    arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    left: svg('<path d="M15 5l-7 7 7 7"/>'),
    right: svg('<path d="M9 5l7 7-7 7"/>'),
    close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    pause: svg('<path d="M8.5 5v14M15.5 5v14"/>'),
    play: svg('<path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5a.8.8 0 0 0-1.2.7z"/>', true),
    share: svg('<path d="M12 3.5v11M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>'),
  };
  // Le « G » de Google (logo officiel, quatre couleurs)
  const GOOGLE = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FBBC05" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#EA4335" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#34A853" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#4285F4" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const hm = (h) => { const [a, b] = h.split(":"); return +a + "h" + (b === "00" ? "" : b); };
  const toMin = (h) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
  const statut = (b) => `<span class="statut js-statut" data-open="${b.open}" data-close="${b.close}">Ouvert 7j/7</span>`;
  const mots = (t) => esc(t).split(/\s+/).map((m, i) => `<span class="mot"><span style="--i:${i}">${m}</span></span>`).join(" ");
  const avatar = (b) => `<span class="story__avatar"><span><img src="${b.logo}" alt=""></span></span>`;

  function majStatuts(racine) {
    const d = new Date(), now = d.getHours() * 60 + d.getMinutes();
    racine.querySelectorAll(".js-statut").forEach((el) => {
      const o = el.dataset.open, c = el.dataset.close, ouv = now >= toMin(o) && now < toMin(c);
      el.classList.toggle("is-ouvert", ouv); el.classList.toggle("is-ferme", !ouv);
      el.textContent = ouv ? `Ouvert · ferme à ${hm(c)}` : now < toMin(o) ? `Fermé · ouvre à ${hm(o)}` : `Fermé · ouvre demain à ${hm(o)}`;
    });
    racine.querySelectorAll(".js-court").forEach((el) => {
      const ouv = now >= toMin(el.dataset.open) && now < toMin(el.dataset.close);
      el.classList.toggle("is-ouvert", ouv); el.classList.toggle("is-ferme", !ouv);
      el.textContent = ouv ? "Ouvert" : "Fermé";
    });
  }
  setInterval(() => { if (stories) majStatuts(scene); }, 60000);

  /* ---- Les diapositives ------------------------------------------------------ */
  function diapo(s, b, k) {
    const dur = (((DUREE[s.type] || 6000) + 2000) / 1000).toFixed(1);
    const pan = (src) => {
      const [x0, x1] = s.pan ? [-s.pan[0] * 100, -s.pan[1] * 100] : (k % 2 ? [-62, -38] : [-38, -62]);
      return `<img class="diapo__img" data-src="${src}" alt="" decoding="async" style="--x0:${x0}%;--x1:${x1}%;--duree:${dur}s">`;
    };
    const provisoire = b.provisoire ? '<p class="diapo__provisoire">Photos provisoires</p>' : "";
    switch (s.type) {
      case "portes":
        return `<div class="diapo diapo--portes diapo--sombre" data-fond-img="${s.img}">
          <div class="sas__dedans">${pan(s.img)}</div><div class="sas__nuit"></div>
          <div class="sas" aria-hidden="true">
            <div class="sas__enseigne"><img data-src="${b.logo}" alt=""></div>
            <div class="sas__imposte"><span class="sas__detecteur"><i></i></span></div>
            <div class="sas__baie"><span class="sas__lumiere"></span>
              <span class="sas__battant sas__battant--g"><span class="sas__bande"><img data-src="${b.logo}" alt=""></span><span class="sas__points"></span><span class="sas__vinyle">Bienvenue</span></span>
              <span class="sas__battant sas__battant--d"><span class="sas__bande"><img data-src="${b.logo}" alt=""></span><span class="sas__points"></span><span class="sas__vinyle"><b>Ouvert 7j/7</b>${hm(b.open)} – ${hm(b.close)}</span></span>
            </div>
          </div>${provisoire}
          <div class="diapo__txt">
            ${s.nouveau ? '<span class="diapo__new monte" style="--j:0">Nouvelle boutique</span>' : ""}
            <p class="diapo__kicker monte" style="--j:0">${esc(s.kicker)}</p>
            <h2 class="diapo__titre">${mots(s.titre)}</h2>
            <p class="diapo__texte monte" style="--j:3">${esc(s.texte)}</p>
            <ul class="diapo__chips monte" style="--j:4">${s.chips.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
          </div></div>`;
      case "photo":
        return `<div class="diapo diapo--photo diapo--sombre" data-fond-img="${s.img}">${pan(s.img)}
          ${s.etiquette ? `<span class="diapo__panneau">${s.ico ? `<img data-src="${s.ico}" alt="">` : ""}${esc(s.etiquette)}</span>` : ""}${provisoire}
          ${s.kicker ? `<div class="diapo__txt"><p class="diapo__kicker monte" style="--j:0">${esc(s.kicker)}</p>
            <p class="diapo__texte diapo__adresse monte" style="--j:1">${I.pin}<span>${esc(s.texte)}</span></p></div>`
            : s.texte ? `<div class="diapo__txt"><p class="diapo__texte monte" style="--j:1">${esc(s.texte)}</p></div>` : ""}</div>`;
      case "etal":
        return `<div class="diapo diapo--etal"><div class="etal">
          <p class="diapo__kicker etal__kicker monte" style="--j:0">Sur l'étal</p>
          <h2 class="etal__titre">${mots(s.titre)}</h2>
          <div class="etal__comptoir">${s.produits.map((p, j) => `<div class="etal__p${p.detoure ? "" : " etal__p--photo"}" style="--j:${j}">
            <span class="etal__plateau"><img data-src="${p.img}" alt="${esc(p.nom)}"></span>
            <span class="etal__ardoise"><b>${esc(p.nom)}</b><small>${esc(p.origine)}</small></span></div>`).join("")}</div>
          ${s.note ? `<p class="etal__note monte" style="--j:7">${esc(s.note)}</p>` : ""}</div></div>`;
      case "affiche":
        return `<div class="diapo diapo--affiche" data-fond-img="${s.img}"><span class="diapo__flou" data-bg="${s.img}"></span>
          <div class="affiche-story"><div class="affiche-story__cadre"><img data-src="${s.img}" alt="${esc(s.texte)}"></div></div>
          <div class="diapo__txt"><p class="diapo__kicker monte" style="--j:2">En ce moment</p><p class="diapo__texte monte" style="--j:3">${esc(s.texte)}</p></div></div>`;
      case "avis":
        return `<div class="diapo diapo--avis"><div class="avis-story">
          <p class="avis-story__source monte" style="--j:0">${GOOGLE}Avis Google</p>
          ${s.note ? `<p class="avis-story__note monte" style="--j:1"><b data-compte="${esc(s.note)}">${esc(s.note)}</b>
            <span class="avis-story__etoiles" aria-label="sur 5">${[0, 1, 2, 3, 4].map((j) => `<i style="--j:${j}">★</i>`).join("")}</span><small>${esc(s.nb)}</small></p>` : ""}
          <blockquote class="monte" style="--j:3"><p>${esc(s.citation)}</p><cite>${esc(s.auteur)}</cite></blockquote>
          ${s.sous ? `<p class="avis-story__sous monte" style="--j:4">${esc(s.sous)}</p>` : ""}</div></div>`;
      case "infos":
        return `<div class="diapo diapo--infos" data-fond-img="${s.img}"><img class="diapo__img" data-src="${s.img}" alt="">
          <div class="infos-story">
            <img class="infos-story__logo monte" style="--j:0" data-src="${b.logo}" alt="${esc(b.nom)}">
            <h3>${mots("Venir chez " + b.nom)}</h3>
            <p class="infos-story__statut monte" style="--j:2">${statut(b)}</p>
            <p class="infos-story__ligne monte" style="--j:3">${I.clock}<span>Ouvert 7 jours sur 7, de ${hm(b.open)} à ${hm(b.close)}</span></p>
            <p class="infos-story__ligne monte" style="--j:4">${I.pin}<span>${esc(b.adresse)}</span></p>
            <div class="infos-story__btns monte" style="--j:5">
              <a class="plein" href="${b.maps}" target="_blank" rel="noopener">${I.route}Itinéraire</a>
              ${b.telHref ? `<a href="${b.telHref}">${I.phone}Appeler le ${esc(b.tel)}</a>` : ""}
              <a href="${b.url}" data-voir>Toute la boutique ${I.arrow}</a>
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
      ${b.slides.map((s, k) => diapo(s, b, k)).join("")}
      <div class="story__charge" aria-hidden="true"></div>
      <div class="story__haut">
        <div class="story__barres">${b.slides.map(() => "<span><i></i></span>").join("")}</div>
        <div class="story__entete">
          ${avatar(b)}
          <span class="story__qui"><b>${esc(b.nom)}</b><small>${esc(b.ville)} · <span class="statut-court js-court" data-open="${b.open}" data-close="${b.close}">Ouvert 7j/7</span></small></span>
          <button class="story__btn" type="button" data-partager aria-label="Partager cette boutique">${I.share}</button>
          <button class="story__btn" type="button" data-pause aria-label="Mettre en pause">${I.pause}</button>
          <button class="story__btn" type="button" data-fermer aria-label="Fermer">${I.close}</button>
        </div>
      </div>
      <div class="story__bas">
        <a class="icone" href="${b.maps}" target="_blank" rel="noopener" aria-label="Itinéraire vers ${esc(b.nom)}">${I.route}</a>
        ${b.telHref ? `<a class="icone" href="${b.telHref}" aria-label="Appeler ${esc(b.nom)}">${I.phone}</a>` : ""}
        <a class="voir" href="${b.url}" data-voir>Voir la boutique ${I.arrow}</a>
      </div>
      <div class="story__ombre"></div>
    </div>`;
    el.querySelector("[data-fermer]").addEventListener("click", () => fermer());
    el.querySelector("[data-pause]").addEventListener("click", () => mettrePause(!pauseManuelle, true));
    el.querySelector("[data-partager]").addEventListener("click", partager);
    el._barres = el.querySelectorAll(".story__barres i");
    el._diapos = el.querySelectorAll(".diapo");
    majStatuts(el);
    return el;
  }

  /* ---- Chargement des images ---------------------------------------------------- */
  function charger(el) {
    if (!el) return;
    el.querySelectorAll("img[data-src]").forEach((im) => { im.src = im.dataset.src; im.removeAttribute("data-src"); });
    el.querySelectorAll("[data-bg]").forEach((x) => { x.style.backgroundImage = `url('${x.dataset.bg}')`; x.removeAttribute("data-bg"); });
  }
  const prete = (el) => [...el.querySelectorAll("img")].every((im) => im.getAttribute("src") && im.complete);
  const attendreImages = (el, ms) => Promise.race([
    Promise.all([...el.querySelectorAll("img")].map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))),
    new Promise((r) => setTimeout(r, ms)),
  ]);

  /* ---- État du lecteur ------------------------------------------------------------ */
  let stories = null, cur = 0, diap = 0, ecoule = 0, dernier = 0, raf = 0;
  let ouvert = false, enOuverture = false, enFermeture = false, ouvertParLien = false;
  let pause = false, pauseManuelle = false, coachOuvert = false;
  let anim = null, cube = null, geste = null, origine = null, focusAvant = null;
  const waapi = [];

  const story = () => stories[cur];
  const duree = () => DUREE[DATA[cur].slides[diap].type] || 6000;

  function montrerDiapo(i) {
    const st = story(), ds = st._diapos;
    diap = clamp(i, 0, ds.length - 1);
    ds.forEach((d, k) => {
      if (k === diap && d.classList.contains("is-on")) { d.classList.remove("is-on"); void d.offsetWidth; }  // relance ses animations
      d.classList.toggle("is-on", k === diap);
    });
    st._barres.forEach((b, k) => { b.style.transform = `scaleX(${k < diap ? 1 : 0})`; });
    ecoule = 0;
    const d = ds[diap];
    charger(d); charger(ds[diap + 1]);
    if (!ds[diap + 1] && stories[cur + 1]) charger(stories[cur + 1]._diapos[0]);
    if (fond) fond.style.backgroundImage = d.dataset.fondImg ? `url('${d.dataset.fondImg}')` : "none";
    compter(d);
  }

  // La note Google défile de 0 à sa valeur
  function compter(d) {
    const el = d.querySelector("[data-compte]");
    if (!el || reduit) return;
    const txt = el.dataset.compte, cible = parseFloat(txt.replace(",", "."));
    if (isNaN(cible)) return;
    const dec = (txt.split(",")[1] || "").length, t0 = performance.now() + 450;
    const pas = (t) => {
      const k = clamp((t - t0) / 1100, 0, 1);
      if (k < 1 && d.classList.contains("is-on")) { el.textContent = (cible * easeOut(k)).toFixed(dec).replace(".", ","); requestAnimationFrame(pas); }
      else el.textContent = txt;
    };
    el.textContent = (0).toFixed(dec).replace(".", ",");
    requestAnimationFrame(pas);
  }

  function suivante() {
    if (diap < story()._diapos.length - 1) montrerDiapo(diap + 1);
    else if (cur < stories.length - 1) changerBoutique(1);
    else fermer();
  }
  function precedente() {
    if (diap > 0) montrerDiapo(diap - 1);
    else if (cur > 0) changerBoutique(-1);
    else montrerDiapo(0);
  }

  /* ---- La boucle : avance la barre de progression -------------------------------- */
  function boucle(now) {
    if (!ouvert) return;
    const dt = Math.min(100, now - dernier);
    dernier = now;
    const st = story(), d = st._diapos[diap];
    const attente = !prete(d);
    const geste_ = !!(geste && (geste.axe || geste.long));
    st.classList.toggle("is-charge", attente);
    lecteur.classList.toggle("est-figee", attente || !!anim || !!cube || coachOuvert || pause || geste_);
    if (!pause && !anim && !cube && !attente && !coachOuvert && !geste_ && !document.hidden) ecoule += dt;
    const k = Math.min(1, ecoule / duree());
    const barre = st._barres[diap];
    if (barre) barre.style.transform = `scaleX(${k.toFixed(4)})`;
    if (k >= 1) suivante();
    raf = requestAnimationFrame(boucle);
  }

  function mettrePause(v, manuelle) {
    pause = v;
    if (manuelle) pauseManuelle = v;
    if (!stories) return;
    stories.forEach((s) => {
      const bt = s.querySelector("[data-pause]");
      bt.innerHTML = pauseManuelle ? I.play : I.pause;
      bt.setAttribute("aria-label", pauseManuelle ? "Reprendre" : "Mettre en pause");
    });
  }
  // Appui long : pause et interface masquée, comme sur Instagram
  function pauseAppui(v) { mettrePause(v || pauseManuelle, false); lecteur.classList.toggle("est-pause", v); }

  /* ---- Petites animations pilotées en JS -------------------------------------------- */
  function animer(de, a, ms, ease, etape, fin) {
    const t0 = performance.now(), moi = {};
    anim = moi;
    const pas = (t) => {
      if (anim !== moi) return;
      const k = ms > 0 ? clamp((t - t0) / ms, 0, 1) : 1;
      etape(de + (a - de) * ease(k));
      if (k < 1) requestAnimationFrame(pas);
      else { anim = null; if (fin) fin(); }
    };
    requestAnimationFrame(pas);
  }

  /* ---- Le cube : changer de boutique ------------------------------------------------- */
  const largeur = () => story().querySelector(".story__cadre").offsetWidth || innerWidth;
  function poser(el, deg, W) {
    el.style.transform = `translate3d(0,0,${(-W / 2).toFixed(1)}px) rotateY(${deg.toFixed(3)}deg) translate3d(0,0,${(W / 2).toFixed(1)}px)`;
    el.querySelector(".story__ombre").style.setProperty("--ombre", (Math.min(1, Math.abs(deg) / 90) * .6).toFixed(3));
  }
  function reposer(el) {
    el.style.transform = "";
    el.querySelector(".story__ombre").style.removeProperty("--ombre");
  }
  function lacher(el) {
    reposer(el); el.hidden = true; el.classList.remove("est-attente");
    el._diapos.forEach((d) => d.classList.remove("is-on"));
  }
  function cubeDebut(dir) {
    const n = cur + dir, voisin = stories[n] || null;
    cube = { dir, n, voisin, W: largeur(), p: 0 };
    if (voisin) {
      voisin.hidden = false;
      voisin.classList.add("est-attente");
      charger(voisin._diapos[0]);
      voisin._diapos.forEach((d, k) => d.classList.toggle("is-on", k === 0));
      voisin._barres.forEach((b) => { b.style.transform = "scaleX(0)"; });
      majStatuts(voisin);
    }
  }
  function cubeRendu(p) {
    cube.p = p;
    poser(story(), -cube.dir * 90 * p, cube.W);
    if (cube.voisin) poser(cube.voisin, cube.dir * 90 * (1 - p), cube.W);
  }
  function cubeTermine(complet) {
    const c = cube;
    if (complet && c.voisin) {
      lacher(story());
      reposer(c.voisin); c.voisin.classList.remove("est-attente");
      cur = c.n;
      marquerVu(DATA[cur].slug); majHash(); majApercus();
      montrerDiapo(0);
      vibrer(8);
    } else {
      reposer(story());
      if (c.voisin) lacher(c.voisin);
    }
    cube = null;
  }
  function cubeFin(complet) {
    const a = complet ? 1 : 0, de = cube.p;
    if (reduit) { cubeTermine(complet); return; }
    animer(de, a, Math.max(160, 460 * Math.abs(a - de)), easeOut, cubeRendu, () => cubeTermine(complet));
  }
  function changerBoutique(dir) {
    if (anim || cube || !ouvert) return;
    const n = cur + dir;
    if (n >= stories.length) { fermer(); return; }
    if (n < 0) { montrerDiapo(0); return; }
    cubeDebut(dir);
    if (reduit) { cubeTermine(true); return; }
    animer(0, 1, 620, easeIO, cubeRendu, () => cubeTermine(true));
  }

  /* ---- Glisser vers le bas : la story suit le doigt ------------------------------------ */
  function descente(dy, dx) {
    const st = story(), k = clamp(dy / innerHeight, 0, 1);
    st.classList.add("is-glisse");
    st.style.transform = `translate3d(${(dx * .3).toFixed(1)}px,${(dy * .8).toFixed(1)}px,0) scale(${(1 - k * .4).toFixed(4)})`;
    st.style.setProperty("--rayon", Math.min(26, dy / 5).toFixed(1));
    const o = clamp(1 - k * 1.7, 0, 1).toFixed(3);
    lecteur.style.backgroundColor = `rgba(0,0,0,${o})`;
    if (fond) fond.style.opacity = o;
  }
  function remonte() {
    const st = story();
    st.classList.remove("is-glisse");
    st.style.transform = "";
    st.style.removeProperty("--rayon");
    lecteur.style.backgroundColor = "";
    if (fond) fond.style.opacity = "";
  }

  /* ---- Ouverture et fermeture : la story naît du rond touché et y retourne -------------- */
  function cible(slug) {
    const cands = [...document.querySelectorAll(`[data-story="${slug}"]`)].filter((el) => !lecteur.contains(el) && el.matches(".rond, .carte__media"));
    if (origine && origine.dataset.story === slug && origine.matches(".rond, .carte__media")) cands.unshift(origine);
    for (const el of cands) {
      const ref = el.querySelector(".rond__anneau") || el;
      const r = ref.getBoundingClientRect();
      if (r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
        return { r, rad: el.matches(".carte__media") ? 24 : r.width / 2 };
      }
    }
    return null;
  }
  function geometrie(c) {
    const cadre = story().querySelector(".story__cadre");
    const W = cadre.offsetWidth, H = cadre.offsetHeight, s = c.r.width / W;
    const tx = c.r.left + c.r.width / 2 - innerWidth / 2, ty = c.r.top + c.r.height / 2 - innerHeight / 2;
    const hv = Math.min(H, c.r.height / s);
    return {
      transform: `translate3d(${tx.toFixed(1)}px,${ty.toFixed(1)}px,0) scale(${s.toFixed(4)})`,
      clip: `inset(${((H - hv) / 2).toFixed(1)}px 0px round ${(c.rad / s).toFixed(1)}px)`,
    };
  }
  function jouer(el, images, opt) {
    if (!el.animate) return null;
    const a = el.animate(images, opt);
    waapi.push(a);
    return a;
  }
  function animOuverture(c) {
    if (reduit) return;
    const st = story(), cadre = st.querySelector(".story__cadre");
    const opt = { duration: 540, easing: "cubic-bezier(.32,.72,0,1)" };
    if (c) {
      const g = geometrie(c);
      jouer(st, [{ transform: g.transform }, { transform: "none" }], opt);
      jouer(cadre, [{ clipPath: g.clip }, { clipPath: "inset(0px 0px round 0px)" }], opt);
    } else {
      jouer(st, [{ transform: "scale(.92)", opacity: 0 }, { transform: "none", opacity: 1 }], { ...opt, duration: 380 });
    }
    jouer(lecteur, [{ backgroundColor: "rgba(0,0,0,0)" }, { backgroundColor: "rgba(0,0,0,1)" }], opt);
    if (fond) jouer(fond, [{ opacity: 0 }, { opacity: 1 }], opt);
  }
  function animFermeture(fini) {
    const st = story(), cadre = st.querySelector(".story__cadre");
    if (reduit || !st.animate) { fini(); return; }
    const c = cible(DATA[cur].slug);
    const depart = st.style.transform || "none", rayon = st.style.getPropertyValue("--rayon") || "0";
    const fondDepart = lecteur.style.backgroundColor || getComputedStyle(lecteur).backgroundColor;
    const opt = { duration: 440, easing: "cubic-bezier(.32,.72,0,1)", fill: "forwards" };
    let a;
    if (c) {
      const g = geometrie(c);
      a = jouer(st, [{ transform: depart }, { transform: g.transform }], opt);
      jouer(cadre, [{ clipPath: `inset(0px 0px round ${rayon}px)` }, { clipPath: g.clip }], opt);
      jouer(st, [{ opacity: 1 }, { opacity: 1, offset: .82 }, { opacity: 0 }], opt);
    } else {
      a = jouer(st, [{ transform: depart, opacity: 1 }, { transform: (depart === "none" ? "" : depart + " ") + "scale(.9)", opacity: 0 }], { ...opt, duration: 280 });
    }
    jouer(lecteur, [{ backgroundColor: fondDepart }, { backgroundColor: "rgba(0,0,0,0)" }], opt);
    if (fond) jouer(fond, [{ opacity: getComputedStyle(fond).opacity }, { opacity: 0 }], opt);
    a.onfinish = fini;
  }

  /* ---- Stories déjà vues (anneau gris) ------------------------------------------------- */
  const CLE = "delice-stories-vues";
  function lireVues() { try { return JSON.parse(lire(CLE) || "[]"); } catch (e) { return []; } }
  function marquerVu(slug) {
    const v = lireVues();
    if (!v.includes(slug)) { v.push(slug); ecrire(CLE, JSON.stringify(v)); }
    document.querySelectorAll(`.rond:not(.rond--une)[data-story="${slug}"]`).forEach((r) => r.classList.add("is-vu"));
  }
  lireVues().forEach((s) => document.querySelectorAll(`.rond:not(.rond--une)[data-story="${s}"]`).forEach((r) => r.classList.add("is-vu")));

  /* ---- Boutiques voisines (grand écran) -------------------------------------------------- */
  function majApercus() {
    [-1, 1].forEach((dir) => {
      const bt = apercus[dir];
      if (!bt) return;
      const b = DATA[cur + dir];
      bt.hidden = !b;
      if (!b) return;
      bt.className = `apercu apercu--${dir < 0 ? "prec" : "suiv"} t-${b.type}${b.rouge ? " v-red" : ""}`;
      bt.setAttribute("aria-label", `${dir < 0 ? "Boutique précédente" : "Boutique suivante"} : ${b.nom} ${b.ville}`);
      bt.innerHTML = `<img class="apercu__img" src="${b.slides[0].img}" alt="" loading="lazy"><span class="apercu__qui">${avatar(b)}<b>${esc(b.nom)}</b><small>${esc(b.ville)}</small></span><span class="apercu__fleche">${dir < 0 ? I.left : I.right}</span>`;
    });
  }

  /* ---- Première visite : comment ça marche --------------------------------------------- */
  let coachVu = false;
  function montrerCoach() {
    if (!coach) return;
    let deja = coachVu;
    if (!deja) { deja = lire("delice-coach") === "1"; ecrire("delice-coach", "1"); }
    coachVu = true;
    if (deja) return;
    if (!tactile) {
      coach.querySelector(".coach__zone--g b").textContent = "Cliquez à gauche";
      coach.querySelector(".coach__zone--d b").textContent = "Cliquez à droite";
      const p = coach.querySelectorAll(".coach__bas p");
      p[0].lastChild.textContent = "Flèches du clavier ← → : boutique précédente ou suivante";
      p[1].lastChild.textContent = "Touche Échap : fermer";
    }
    coach.hidden = false;
    coachOuvert = true;
  }
  function masquerCoach() {
    if (!coach || coach.hidden) return;
    coach.hidden = true;
    coachOuvert = false;
  }
  if (coach) coach.addEventListener("click", masquerCoach);

  /* ---- Partager une boutique ---------------------------------------------------------- */
  let tToast = 0;
  function montrerToast(t) {
    toast.textContent = t;
    toast.classList.add("is-on");
    clearTimeout(tToast);
    tToast = setTimeout(() => toast.classList.remove("is-on"), 1900);
  }
  async function partager() {
    const b = DATA[cur];
    const url = location.href.split("#")[0] + "#story-" + b.slug;
    const avant = pauseManuelle;
    mettrePause(true, true);
    try {
      if (navigator.share) await navigator.share({ title: `${b.nom} · ${b.ville}`, text: `${b.nom} à ${b.ville}, en stories`, url });
      else { await navigator.clipboard.writeText(url); montrerToast("Lien de la boutique copié"); }
    } catch (e) {
      if (!e || e.name !== "AbortError") {
        try { await navigator.clipboard.writeText(url); montrerToast("Lien de la boutique copié"); } catch (_) { montrerToast(url); }
      }
    }
    mettrePause(avant, true);
  }

  /* ---- Ouvrir / fermer ----------------------------------------------------------------- */
  function majHash() {
    const h = "#story-" + DATA[cur].slug;
    if (location.hash !== h) history.replaceState({ story: DATA[cur].slug }, "", h);
  }

  async function ouvrir(slug, opts = {}) {
    if (ouvert || enOuverture || enFermeture) return;
    const n = DATA.findIndex((b) => b.slug === slug);
    if (n < 0) return;
    enOuverture = true;
    if (!stories) {
      stories = DATA.map(construire);
      stories.forEach((s) => scene.appendChild(s));
    }
    origine = opts.depuis || null;
    const i0 = clamp(opts.diapo || 0, 0, DATA[n].slides.length - 1);
    const d0 = stories[n]._diapos[i0];
    charger(d0);
    if (!prete(d0)) {
      // l'anneau du rond tourne pendant que la première image arrive
      const anneau = origine && (origine.matches(".rond, .carte__media") ? origine : document.querySelector(`.rond[data-story="${slug}"]`));
      if (anneau) anneau.classList.add("is-charge");
      await attendreImages(d0, 2500);
      if (anneau) anneau.classList.remove("is-charge");
    }
    focusAvant = document.activeElement;
    stories.forEach((s, k) => { if (k !== n) lacher(s); else { s.hidden = false; reposer(s); } });
    cur = n;
    lecteur.hidden = false;
    doc.classList.add("lecteur-ouvert");
    mettrePause(false, true);
    lecteur.classList.remove("est-pause");
    montrerDiapo(i0);
    marquerVu(slug);
    majApercus();
    ouvert = true; enOuverture = false;
    dernier = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(boucle);
    ouvertParLien = !!opts.lien;
    if (!opts.lien) history.pushState({ story: slug }, "", "#story-" + slug);
    animOuverture(opts.lien ? null : cible(slug));
    story().querySelector("[data-fermer]").focus({ preventScroll: true });
    montrerCoach();
  }

  function fermer(depuisRetour) {
    if (!ouvert || enFermeture) return;
    ouvert = false; enFermeture = true;
    cancelAnimationFrame(raf);
    anim = null;
    if (cube) { reposer(story()); if (cube.voisin) lacher(cube.voisin); cube = null; }
    geste = null;
    masquerCoach();
    lecteur.classList.add("est-figee");
    lecteur.classList.remove("est-pause");
    vibrer(6);
    animFermeture(() => {
      lecteur.hidden = true;
      waapi.splice(0).forEach((a) => { try { a.cancel(); } catch (e) { /* rien */ } });
      remonte();
      stories.forEach(lacher);
      lecteur.classList.remove("est-figee");
      doc.classList.remove("lecteur-ouvert");
      enFermeture = false;
    });
    if (!depuisRetour) {
      if (ouvertParLien) history.replaceState(null, "", location.pathname + location.search);
      else history.back();
    }
    if (focusAvant && focusAvant.focus) focusAvant.focus({ preventScroll: true });
  }

  addEventListener("popstate", (ev) => { if (ouvert && !(ev.state && ev.state.story)) fermer(true); });
  document.querySelectorAll("[data-story]").forEach((bt) => bt.addEventListener("click", () => {
    ouvrir(bt.dataset.story, { depuis: bt, diapo: +(bt.dataset.diapo || 0) });
  }));
  lecteur.querySelectorAll("[data-boutique]").forEach((bt) => bt.addEventListener("click", () => changerBoutique(+bt.dataset.boutique)));

  // « Voir la boutique » : les portes de transition se referment, puis on change de page
  scene.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-voir]");
    if (!a) return;
    if (a.getAttribute("href") === location.pathname.split("/").pop()) { ev.preventDefault(); fermer(); return; }
    const passage = document.querySelector(".passage");
    if (reduit || !passage || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    ev.preventDefault();
    mettrePause(true, false);
    passage.classList.add("is-ferme");
    setTimeout(() => { location.href = a.href; }, 520);
  });
  addEventListener("pageshow", () => { if (ouvert) { mettrePause(pauseManuelle, false); dernier = performance.now(); } });

  /* ---- Gestes ---------------------------------------------------------------------------- */
  scene.addEventListener("pointerdown", (ev) => {
    if (!ouvert || anim || cube || ev.button > 0 || ev.target.closest("a, button")) return;
    const t = performance.now();
    geste = { id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: 0, dy: 0, axe: null, long: false, hist: [[ev.clientX, ev.clientY, t]] };
    geste.minuterie = setTimeout(() => { if (geste && !geste.axe) { geste.long = true; pauseAppui(true); } }, 200);
    try { scene.setPointerCapture(ev.pointerId); } catch (e) { /* rien */ }
  });
  scene.addEventListener("pointermove", (ev) => {
    const g = geste;
    if (!g || ev.pointerId !== g.id) return;
    const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
    g.dx = dx; g.dy = dy;
    g.hist.push([ev.clientX, ev.clientY, performance.now()]);
    if (g.hist.length > 5) g.hist.shift();
    if (!g.axe) {
      if (Math.hypot(dx, dy) < 10) return;
      clearTimeout(g.minuterie);
      if (g.long) { pauseAppui(false); g.long = false; }
      g.axe = Math.abs(dx) > Math.abs(dy) ? "x" : dy > 0 ? "y" : "haut";
      if (g.axe === "x") cubeDebut(dx < 0 ? 1 : -1);
    }
    if (g.axe === "x") {
      let p = (-dx * cube.dir) / cube.W;
      if (p < -.02) {   // le doigt repart dans l'autre sens : on vise l'autre voisine
        reposer(story()); if (cube.voisin) lacher(cube.voisin);
        cubeDebut(-cube.dir);
        p = -p;
      }
      p = Math.max(0, p);
      if (!cube.voisin) p = p * .16;   // pas de boutique de ce côté : résistance élastique
      cubeRendu(Math.min(1, p));
    } else if (g.axe === "y") {
      descente(Math.max(0, dy), dx);
    } else {
      story().style.transform = `translate3d(0,${(Math.max(-60, dy) * .25).toFixed(1)}px,0)`;
    }
  });
  function finGeste(ev, annule) {
    const g = geste;
    if (!g || ev.pointerId !== g.id) return;
    clearTimeout(g.minuterie);
    geste = null;
    if (g.long) pauseAppui(false);
    const h = g.hist, a = h[0], z = h[h.length - 1], dt = Math.max(16, z[2] - a[2]);
    const vx = (z[0] - a[0]) / dt, vy = (z[1] - a[1]) / dt;
    if (g.axe === "x") {
      const vers = -vx * cube.dir;   // > 0 : le doigt va vers la boutique voisine
      cubeFin(!annule && !!cube.voisin && (cube.p > .32 || (vers > .3 && cube.p > .04)));
      return;
    }
    if (g.axe === "y") {
      if (!annule && (g.dy > innerHeight * .16 || (vy > .5 && g.dy > 36))) fermer();
      else { const y0 = Math.max(0, g.dy), x0 = g.dx; animer(1, 0, 300, easeOut, (k) => descente(y0 * k, x0 * k), remonte); }
      return;
    }
    if (g.axe === "haut") { animer(1, 0, 260, easeOut, (k) => { story().style.transform = `translate3d(0,${(Math.max(-60, g.dy) * .25 * k).toFixed(1)}px,0)`; }, () => { story().style.transform = ""; }); return; }
    if (annule || g.long) return;
    const r = story().querySelector(".story__cadre").getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return;
    if (ev.clientX < r.left + r.width * .3) precedente(); else suivante();
  }
  scene.addEventListener("pointerup", (ev) => finGeste(ev, false));
  scene.addEventListener("pointercancel", (ev) => finGeste(ev, true));
  scene.addEventListener("dragstart", (ev) => ev.preventDefault());
  scene.addEventListener("contextmenu", (ev) => { if (geste || lecteur.classList.contains("est-pause")) ev.preventDefault(); });

  addEventListener("keydown", (ev) => {
    if (!ouvert) return;
    if (coachOuvert && (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); masquerCoach(); return; }
    if (ev.key === "Escape") { ev.preventDefault(); fermer(); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); if (ev.shiftKey) changerBoutique(1); else suivante(); }
    else if (ev.key === "ArrowLeft") { ev.preventDefault(); if (ev.shiftKey) changerBoutique(-1); else precedente(); }
    else if (ev.key === "ArrowDown" || ev.key === "PageDown") { ev.preventDefault(); changerBoutique(1); }
    else if (ev.key === "ArrowUp" || ev.key === "PageUp") { ev.preventDefault(); changerBoutique(-1); }
    else if (ev.key === " " && !ev.target.closest("a, button")) { ev.preventDefault(); mettrePause(!pauseManuelle, true); }
  });
  document.addEventListener("visibilitychange", () => { dernier = performance.now(); });

  // Lien direct vers une boutique : …#story-delice-boucherie-digne
  const lien = location.hash.match(/^#story-(.+)$/);
  if (lien && DATA.some((b) => b.slug === lien[1])) ouvrir(lien[1], { lien: true });
})();
