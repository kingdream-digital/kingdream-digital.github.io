/* Le Bon Degré — interactions de la page : en-tête, apparitions, cadran, téléphones. */
(function () {
  "use strict";

  var reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- En-tête : filet discret dès qu'on défile ----------------------------- */
  var entete = document.getElementById("entete");
  if (entete) {
    var attente = false;
    var majEntete = function () {
      entete.classList.toggle("est-defile", window.scrollY > 8);
      attente = false;
    };
    window.addEventListener("scroll", function () {
      if (!attente) { attente = true; window.requestAnimationFrame(majEntete); }
    }, { passive: true });
    majEntete();
  }

  /* --- Apparitions au défilement --------------------------------------------
     Les blocs déjà à l'écran restent visibles (pas de clignotement) ; les
     autres apparaissent en douceur. Sans animation si l'utilisateur l'a demandé. */
  var blocs = document.querySelectorAll(".apparait");
  var telephones = document.querySelector("[data-telephones]");
  if (!reduit && "IntersectionObserver" in window) {
    var hauteur = window.innerHeight;
    blocs.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < hauteur && r.bottom > 0) el.classList.add("est-visible");
    });
    document.documentElement.classList.add("js");

    var observateur = new IntersectionObserver(function (entrees) {
      entrees.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("est-visible");
        observateur.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0 });
    blocs.forEach(function (el) {
      if (!el.classList.contains("est-visible")) observateur.observe(el);
    });

    if (telephones) {
      var obsTel = new IntersectionObserver(function (entrees) {
        if (!entrees[0].isIntersecting) return;
        obsTel.disconnect();
        var ailleurs = telephones.querySelector(".telephone--ailleurs");
        telephones.querySelectorAll(".telephone").forEach(function (t) { t.classList.add("est-actif"); });
        window.setTimeout(function () { ailleurs.classList.add("vibre"); }, 1300);
      }, { threshold: 0.35 });
      obsTel.observe(telephones);
    }
  }

  /* --- Le cadran : un thermostat à régler ------------------------------------ */
  var cadran = document.querySelector("[data-cadran]");
  if (cadran) initialiserCadran(cadran);

  function initialiserCadran(cadran) {
    var MIN = 14, MAX = 32, CENTRE = 200, RAYON = 140, NS = "http://www.w3.org/2000/svg";
    var hero = cadran.closest(".hero");
    var svg = cadran.querySelector("svg");
    var arc = cadran.querySelector("[data-arc]");
    var bouton = cadran.querySelector("[data-bouton]");
    var coeur = cadran.querySelector("[data-bouton-coeur]");
    var poignee = cadran.querySelector("[data-poignee]");
    var elTemp = cadran.querySelector("[data-temp]");
    var elSaison = cadran.querySelector("[data-saison]");
    var elMessage = cadran.querySelector("[data-message]");
    var annonce = document.querySelector("[data-annonce]");
    var carteChaud = document.querySelector(".choix__carte--chaud");
    var carteFroid = document.querySelector(".choix__carte--froid");

    // valeur : position affichée ; vise : position visée (une animation peut être en cours)
    var valeur = 19, vise = 19, auto = !reduit, minuterie = null, anim = null, glisse = false, visible = true;

    function angle(v) {
      return (135 + (v - MIN) / (MAX - MIN) * 270) * Math.PI / 180;
    }

    // Graduations : un trait par degré, les deux « bons degrés » marqués.
    var graduations = cadran.querySelector("[data-graduations]");
    for (var v = MIN; v <= MAX; v++) {
      var a = angle(v), majeur = v === 19 || v === 26;
      var r1 = majeur ? 156 : 160, r2 = majeur ? 168 : 165;
      var trait = document.createElementNS(NS, "line");
      trait.setAttribute("x1", (CENTRE + r1 * Math.cos(a)).toFixed(2));
      trait.setAttribute("y1", (CENTRE + r1 * Math.sin(a)).toFixed(2));
      trait.setAttribute("x2", (CENTRE + r2 * Math.cos(a)).toFixed(2));
      trait.setAttribute("y2", (CENTRE + r2 * Math.sin(a)).toFixed(2));
      trait.setAttribute("stroke", majeur ? "#1D1B19" : "#CDBFAF");
      trait.setAttribute("stroke-width", majeur ? "2.6" : "1.6");
      trait.setAttribute("stroke-linecap", "round");
      graduations.appendChild(trait);
      if (majeur) {
        var texte = document.createElementNS(NS, "text");
        texte.setAttribute("x", (CENTRE + 177 * Math.cos(a)).toFixed(2));
        texte.setAttribute("y", (CENTRE + 177 * Math.sin(a)).toFixed(2));
        texte.setAttribute("text-anchor", "middle");
        texte.setAttribute("dominant-baseline", "central");
        texte.setAttribute("class", "cadran__repere-txt");
        texte.textContent = v + "°";
        graduations.appendChild(texte);
      }
    }

    function etat(t) {
      if (t <= 17) return { saison: "Trop froid", message: "Brrr… Une pompe à chaleur vous remet au bon degré.", projet: "chauffage" };
      if (t === 18) return { saison: "Hiver", message: "Un peu frais… Visez 19°.", projet: "chauffage" };
      if (t === 19) return { saison: "Hiver", message: "Le bon degré pour l’hiver", projet: "chauffage" };
      if (t <= 21) return { saison: "Hiver", message: "Bien au chaud", projet: "chauffage" };
      if (t <= 23) return { saison: "Mi-saison", message: "Doux et agréable", projet: null };
      if (t <= 25) return { saison: "Été", message: "Agréablement frais", projet: "climatisation" };
      if (t === 26) return { saison: "Été", message: "Le bon degré pour l’été", projet: "climatisation" };
      if (t <= 28) return { saison: "Été", message: "Il commence à faire chaud…", projet: "climatisation" };
      return { saison: "Canicule", message: "Ouf\u202f! Une clim réversible vous rafraîchit.", projet: "climatisation" };
    }

    // Couleur du cœur du bouton, le long du dégradé froid → doux → chaud.
    var paliers = [[42, 140, 158], [232, 181, 98], [217, 87, 42]];
    function couleur(t) {
      var s = t < 0.5 ? 0 : 1, k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      var c = paliers[s].map(function (x, i) { return Math.round(x + (paliers[s + 1][i] - x) * k); });
      return "rgb(" + c.join(",") + ")";
    }

    var dernierAffiche = null;
    function rendre(v) {
      v = Math.min(MAX, Math.max(MIN, v));
      valeur = v;
      var t = (v - MIN) / (MAX - MIN), a = angle(v);
      var x = CENTRE + RAYON * Math.cos(a), y = CENTRE + RAYON * Math.sin(a);
      arc.setAttribute("stroke-dasharray", (t * 270).toFixed(2) + " 270");
      bouton.setAttribute("transform", "translate(" + x.toFixed(2) + " " + y.toFixed(2) + ")");
      poignee.style.left = (x / 4).toFixed(3) + "%";
      poignee.style.top = (y / 4).toFixed(3) + "%";
      coeur.setAttribute("fill", couleur(t));
      hero.style.setProperty("--chaleur", t.toFixed(3));

      var entier = Math.round(v);
      if (entier === dernierAffiche) return;
      dernierAffiche = entier;
      var e = etat(entier);
      elTemp.textContent = entier;
      elSaison.textContent = e.saison;
      elMessage.textContent = e.message;
      poignee.setAttribute("aria-valuenow", entier);
      poignee.setAttribute("aria-valuetext", entier + " degrés : " + e.message);
      if (carteChaud) carteChaud.classList.toggle("est-suggere", e.projet === "chauffage");
      if (carteFroid) carteFroid.classList.toggle("est-suggere", e.projet === "climatisation");
    }

    function adoucir(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

    function allerA(cible, duree) {
      if (anim) window.cancelAnimationFrame(anim);
      cible = Math.min(MAX, Math.max(MIN, cible));
      vise = cible;
      if (reduit || !duree) { rendre(cible); return; }
      var depart = valeur, debut = null;
      function pas(maintenant) {
        if (debut === null) debut = maintenant;
        var p = Math.min(1, (maintenant - debut) / duree);
        rendre(depart + (cible - depart) * adoucir(p));
        if (p < 1) anim = window.requestAnimationFrame(pas);
        else anim = null;
      }
      anim = window.requestAnimationFrame(pas);
    }

    // Démonstration automatique : 19° l'hiver, 26° l'été, jusqu'au premier geste.
    var cibles = [19, 26], indice = 0;
    function boucle() {
      if (!auto) return;
      if (visible && !document.hidden) {
        indice = 1 - indice;
        allerA(cibles[indice], 1500);
      }
      minuterie = window.setTimeout(boucle, 4200);
    }
    function arreterAuto() {
      auto = false;
      window.clearTimeout(minuterie);
    }
    if (auto) {
      minuterie = window.setTimeout(boucle, 2400);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(cadran);
      }
    }

    function annoncer() {
      if (annonce) annonce.textContent = poignee.getAttribute("aria-valuetext");
    }

    // Glisser le bouton (souris, doigt, stylet)
    function valeurPointeur(e) {
      var r = svg.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width * 400 - CENTRE;
      var y = (e.clientY - r.top) / r.height * 400 - CENTRE;
      var deg = Math.atan2(y, x) * 180 / Math.PI;
      var alpha = (deg - 135 + 720) % 360;
      if (alpha > 270) alpha = alpha > 315 ? 0 : 270;
      return MIN + alpha / 270 * (MAX - MIN);
    }
    poignee.addEventListener("pointerdown", function (e) {
      arreterAuto();
      if (anim) window.cancelAnimationFrame(anim);
      glisse = true;
      poignee.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    poignee.addEventListener("pointermove", function (e) {
      if (glisse) rendre(vise = valeurPointeur(e));
    });
    function lacher() {
      if (!glisse) return;
      glisse = false;
      allerA(Math.round(valeur), 200);
    }
    poignee.addEventListener("pointerup", lacher);
    poignee.addEventListener("pointercancel", lacher);

    // Toucher la piste : le bouton s'y rend
    svg.addEventListener("click", function (e) {
      if (e.target !== arc && !e.target.classList.contains("cadran__piste")) return;
      arreterAuto();
      allerA(Math.round(valeurPointeur(e)), 450);
    });

    // Clavier (le bouton est un curseur accessible)
    poignee.addEventListener("keydown", function (e) {
      var v = Math.round(vise), cible = null;
      switch (e.key) {
        case "ArrowUp": case "ArrowRight": cible = v + 1; break;
        case "ArrowDown": case "ArrowLeft": cible = v - 1; break;
        case "PageUp": cible = v + 3; break;
        case "PageDown": cible = v - 3; break;
        case "Home": cible = MIN; break;
        case "End": cible = MAX; break;
      }
      if (cible === null) return;
      e.preventDefault();
      arreterAuto();
      allerA(cible, 160);
    });

    // Boutons − / +
    document.querySelectorAll("[data-pas]").forEach(function (b) {
      b.addEventListener("click", function () {
        arreterAuto();
        allerA(Math.round(vise) + Number(b.getAttribute("data-pas")), 260);
        window.setTimeout(annoncer, 300);
      });
    });

    // Survoler un choix règle le cadran sur sa saison
    [[carteChaud, 19], [carteFroid, 26]].forEach(function (paire) {
      if (!paire[0]) return;
      var regler = function () {
        if (!auto) return;
        arreterAuto();
        allerA(paire[1], 900);
      };
      paire[0].addEventListener("mouseenter", regler);
      paire[0].addEventListener("focus", regler);
    });

    rendre(valeur);
  }
})();
