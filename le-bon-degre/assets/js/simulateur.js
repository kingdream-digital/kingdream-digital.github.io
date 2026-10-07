/* Le Bon Degré — simulateur d'aides (démonstration : rien n'est envoyé).

   Règles 2026 utilisées (guide officiel « MaPrimeRénov’, le mode d’emploi »,
   édition septembre 2026, et arrêté du 13 juillet 2026 pour la TVA des
   pompes à chaleur air/air) — à mettre à jour à chaque changement de barème :
   - MaPrimeRénov’ par geste, pompe à chaleur air/eau : 5 000 € (revenus très
     modestes), 4 000 € (modestes), 3 000 € (intermédiaires), rien au-delà ;
     propriétaire occupant ou bailleur, logement construit depuis 15 ans au
     moins, travaux par une entreprise RGE. La pompe à chaleur air/air
     (climatisation réversible) n'est pas financée en rénovation par geste.
   - Prime énergie (CEE) : tous revenus, logement de plus de 2 ans.
   - TVA 5,5 % : logement de plus de 2 ans ; pour l'air/air, modèles les plus
     performants (A++ mono-split, A+ multi-split) depuis le 18 juillet 2026.
   - Éco-PTZ : propriétaires, logement de plus de 2 ans ; air/air seulement
     dans une rénovation globale. */
(function () {
  "use strict";

  var dialog = document.getElementById("simulateur");
  if (!dialog) return;
  var corps = dialog.querySelector("[data-corps]");
  var barre = dialog.querySelector("[data-progression]");
  var retour = dialog.querySelector("[data-retour]");

  /* Plafonds de revenu fiscal de référence au 1er janvier 2026 (€) :
     [très modestes, modestes, intermédiaires] pour 1 à 5 personnes,
     puis le montant par personne supplémentaire. */
  var PLAFONDS = {
    idf: {
      base: [[24031, 29253, 40851], [35270, 42933, 60051], [42357, 51564, 71846], [49455, 60208, 84562], [56580, 68877, 96817]],
      parPersonne: [7116, 8663, 12257]
    },
    autres: {
      base: [[17363, 22259, 31185], [25393, 32553, 45842], [30540, 39148, 55196], [35676, 45735, 64550], [40835, 52348, 73907]],
      parPersonne: [5151, 6598, 9357]
    }
  };
  var DEPARTEMENTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"];
  var MPR_PAC_AIR_EAU = { tmo: 5000, mo: 4000, int: 3000 };
  var CATEGORIES = { tmo: "très modestes", mo: "modestes", int: "intermédiaires", sup: "supérieurs" };

  function plafonds(personnes, zone) {
    var t = PLAFONDS[zone];
    if (personnes <= 5) return t.base[personnes - 1];
    return t.base[4].map(function (v, i) { return v + t.parPersonne[i] * (personnes - 5); });
  }
  function zone(cp) { return DEPARTEMENTS_IDF.indexOf(cp.slice(0, 2)) >= 0 ? "idf" : "autres"; }

  var nombre = new Intl.NumberFormat("fr-FR");
  function euros(n) { return nombre.format(n) + " €"; }
  function echapper(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function icone(id, classe) {
    return '<svg class="icone' + (classe ? " " + classe : "") + '" aria-hidden="true"><use href="#' + id + '"/></svg>';
  }

  /* --- Les questions ---------------------------------------------------------- */

  var ETAPES = [
    {
      id: "projet", type: "choix", colonnes: 2,
      titre: "Quel est votre projet&#8239;?",
      options: [
        { v: "chauffage", titre: "Chauffage", desc: "Remplacer mon chauffage par une pompe à chaleur", icone: "i-radiateur", classe: "option--chaud" },
        { v: "climatisation", titre: "Climatisation", desc: "Installer une climatisation réversible", icone: "i-clim", classe: "option--froid" }
      ]
    },
    {
      id: "situation", type: "choix",
      titre: "Vous êtes…",
      aide: "Les aides dépendent de votre situation.",
      options: [
        { v: "maison", titre: "Propriétaire de ma maison", desc: "J’y habite toute l’année", icone: "i-maison" },
        { v: "appartement", titre: "Propriétaire de mon appartement", desc: "J’y habite toute l’année", icone: "i-immeuble" },
        { v: "bailleur", titre: "Propriétaire bailleur", desc: "Je loue mon logement à un locataire", icone: "i-cle" },
        { v: "locataire", titre: "Locataire", desc: "Je loue le logement où j’habite", icone: "i-personne" }
      ]
    },
    {
      id: "energie", type: "choix", colonnes: 2,
      si: function (r) { return r.projet === "chauffage"; },
      titre: "Comment vous chauffez-vous aujourd’hui&#8239;?",
      options: [
        { v: "fioul", titre: "Fioul", icone: "i-goutte" },
        { v: "gaz", titre: "Gaz", icone: "i-flamme" },
        { v: "electricite", titre: "Électricité", desc: "Radiateurs électriques", icone: "i-eclair" },
        { v: "bois", titre: "Bois ou granulés", icone: "i-sapin" },
        { v: "autre", titre: "Autre, ou je ne sais pas", icone: "i-points" }
      ]
    },
    {
      id: "pieces", type: "choix",
      si: function (r) { return r.projet === "climatisation"; },
      titre: "Combien de pièces souhaitez-vous équiper&#8239;?",
      options: [
        { v: "1", titre: "1 pièce", desc: "Une chambre, le séjour…", icone: "i-porte" },
        { v: "2-3", titre: "2 ou 3 pièces", icone: "i-porte" },
        { v: "4+", titre: "4 pièces ou plus", desc: "Jusqu’à toute la maison", icone: "i-maison" }
      ]
    },
    {
      id: "age", type: "choix",
      titre: "Votre logement a été construit…",
      aide: "Certaines aides dépendent de l’âge du logement.",
      options: [
        { v: "moins2", titre: "Il y a moins de 2 ans", icone: "i-calendrier" },
        { v: "2a15", titre: "Il y a 2 à 15 ans", icone: "i-calendrier" },
        { v: "plus15", titre: "Il y a plus de 15 ans", icone: "i-calendrier" }
      ]
    },
    {
      id: "cp", type: "code-postal",
      titre: "Où se trouve votre logement&#8239;?",
      aide: "Pour trouver un artisan près de chez vous et appliquer le bon barème."
    },
    {
      id: "foyer", type: "foyer",
      titre: "Combien de personnes vivent chez vous&#8239;?",
      aide: "Vous compris, ainsi que les personnes à votre charge."
    },
    {
      id: "revenus", type: "revenus",
      titre: "Votre revenu fiscal de référence",
      aide: "Il figure sur la première page de votre avis d’impôt. Si plusieurs personnes du foyer déclarent séparément, additionnez leurs revenus fiscaux."
    },
    { id: "resultat", type: "resultat" },
    { id: "coordonnees", type: "coordonnees" },
    { id: "merci", type: "merci" }
  ];
  var QUESTIONS = ["projet", "situation", "energie", "pieces", "age", "cp", "foyer", "revenus"];

  /* --- État ------------------------------------------------------------------- */

  var rep = {}, historique = [], courante = null, projetImpose = false, termine = false, verrou = false;

  function etape(id) { return ETAPES.filter(function (e) { return e.id === id; })[0]; }
  function visible(e) {
    if (e.id === "projet" && projetImpose) return false;
    return !e.si || e.si(rep);
  }
  function parcours() { return ETAPES.filter(visible); }
  function suivante(id) {
    var liste = parcours(), i = liste.indexOf(etape(id));
    return liste[i + 1] ? liste[i + 1].id : null;
  }

  /* --- Ouverture / fermeture --------------------------------------------------- */

  function ouvrir(projet) {
    var reprendre = !projet && courante && !termine;
    if (!reprendre) {
      rep = {};
      historique = [];
      termine = false;
      projetImpose = Boolean(projet);
      if (projet) rep.projet = projet;
      courante = projetImpose ? "situation" : "projet";
    }
    if (!dialog.open) dialog.showModal();
    afficher(courante, "avant");
  }
  function fermer() { if (dialog.open) dialog.close(); }

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-simulation]");
    if (!b) return;
    e.preventDefault();
    ouvrir(b.getAttribute("data-simulation") || null);
  });
  dialog.querySelector("[data-fermer]").addEventListener("click", fermer);
  dialog.addEventListener("click", function (e) { if (e.target === dialog) fermer(); });
  retour.addEventListener("click", function () {
    if (!historique.length) return;
    courante = historique.pop();
    afficher(courante, "retour");
  });

  // Lien direct : index.html#simulation, #simulation-chauffage, #simulation-climatisation
  function depuisAncre() {
    var m = /^#simulation(?:-(chauffage|climatisation))?$/.exec(window.location.hash);
    if (!m) return;
    ouvrir(m[1] || null);
    if (window.history.replaceState) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  window.addEventListener("hashchange", depuisAncre);
  depuisAncre();

  /* --- Navigation ------------------------------------------------------------- */

  function avancer() {
    var prochaine = suivante(courante);
    if (!prochaine) return;
    historique.push(courante);
    courante = prochaine;
    afficher(courante, "avant");
  }

  function afficher(id, sens) {
    var e = etape(id), html;
    if (e.type === "choix") html = vueChoix(e);
    else if (e.type === "code-postal") html = vueCodePostal(e);
    else if (e.type === "foyer") html = vueFoyer(e);
    else if (e.type === "revenus") html = vueRevenus(e);
    else if (e.type === "resultat") html = vueResultat();
    else if (e.type === "coordonnees") html = vueCoordonnees();
    else html = vueMerci();

    corps.innerHTML = html;
    var vue = corps.firstElementChild;
    if (sens === "retour") vue.classList.add("sim__vue--retour");
    corps.scrollTop = 0;

    var liste = parcours(), rang = liste.indexOf(e);
    barre.style.width = Math.round((rang + 1) / liste.length * 100) + "%";
    retour.hidden = !historique.length || id === "merci";

    if (id === "merci") termine = true;
    var titre = corps.querySelector(".sim__question");
    if (titre) titre.focus({ preventScroll: true });
    if (e.type === "code-postal") corps.querySelector("input").focus();
  }

  function compteur(e) {
    var questions = parcours().filter(function (x) { return QUESTIONS.indexOf(x.id) >= 0; });
    return "Question " + (questions.indexOf(e) + 1) + " sur " + questions.length;
  }

  function entete(e, aide) {
    return '<p class="sim__compteur">' + compteur(e) + "</p>" +
      '<h2 class="sim__question" tabindex="-1">' + e.titre + "</h2>" +
      (aide ? '<p class="sim__aide">' + aide + "</p>" : "");
  }

  /* --- Vues ---------------------------------------------------------------------- */

  function vueChoix(e) {
    var options = e.options.map(function (o) {
      var choisi = rep[e.id] === o.v;
      return '<button type="button" class="option ' + (o.classe || "") + '" data-valeur="' + o.v + '" aria-pressed="' + choisi + '">' +
        '<span class="option__icone">' + icone(o.icone) + "</span>" +
        '<span class="option__texte"><span class="option__titre">' + o.titre + "</span>" +
        (o.desc ? '<span class="option__desc">' + o.desc + "</span>" : "") + "</span>" +
        icone("i-fleche", "option__fleche") + "</button>";
    }).join("");
    return '<div class="sim__vue" data-etape="' + e.id + '">' + entete(e, e.aide) +
      '<div class="sim__options' + (e.colonnes === 2 ? " sim__options--2" : "") + '">' + options + "</div></div>";
  }

  function vueCodePostal(e) {
    return '<form class="sim__vue" data-etape="cp" novalidate>' + entete(e, e.aide) +
      '<div class="champ" data-champ="cp"><label for="sim-cp">Code postal</label>' +
      '<input class="champ-cp" id="sim-cp" name="cp" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" value="' + echapper(rep.cp || "") + '" aria-describedby="sim-cp-erreur">' +
      '<p class="champ__erreur" id="sim-cp-erreur" role="alert"></p></div>' +
      '<div class="sim__actions"><button class="bouton" type="submit">Continuer ' + icone("i-fleche", "icone--fleche") + "</button></div></form>";
  }

  function vueFoyer(e) {
    var n = rep.foyer || 2;
    return '<form class="sim__vue" data-etape="foyer" novalidate>' + entete(e, e.aide) +
      '<div class="compteur-foyer">' +
      '<button type="button" data-foyer="-1" aria-label="Une personne de moins"' + (n <= 1 ? " disabled" : "") + ">" + icone("i-moins") + "</button>" +
      '<output aria-live="polite" data-nombre>' + n + "</output>" +
      '<button type="button" data-foyer="1" aria-label="Une personne de plus"' + (n >= 12 ? " disabled" : "") + ">" + icone("i-plus") + "</button>" +
      '<span class="unite" data-unite>' + (n > 1 ? "personnes" : "personne") + "</span></div>" +
      '<div class="sim__actions"><button class="bouton" type="submit">Continuer ' + icone("i-fleche", "icone--fleche") + "</button></div></form>";
  }

  function vueRevenus(e) {
    var p = plafonds(rep.foyer || 1, zone(rep.cp || "00000"));
    e.options = [
      { v: "tmo", titre: "Jusqu’à " + euros(p[0]) },
      { v: "mo", titre: "De " + euros(p[0] + 1) + " à " + euros(p[1]) },
      { v: "int", titre: "De " + euros(p[1] + 1) + " à " + euros(p[2]) },
      { v: "sup", titre: "Plus de " + euros(p[2]) },
      { v: "inconnu", titre: "Je ne sais pas, ou je préfère ne pas répondre" }
    ].map(function (o) { o.icone = o.v === "inconnu" ? "i-points" : "i-euro"; return o; });
    var aide = e.aide + " Montants pour " + (rep.foyer || 1) + (rep.foyer > 1 ? " personnes" : " personne") +
      (zone(rep.cp || "") === "idf" ? ", en Île-de-France." : ", hors Île-de-France.");
    var html = vueChoix(e);
    return html.replace('<p class="sim__aide">' + e.aide + "</p>", '<p class="sim__aide">' + aide + "</p>");
  }

  /* --- Calcul du résultat -------------------------------------------------------- */

  function calculer() {
    var proprio = rep.situation !== "locataire";
    var plus2 = rep.age !== "moins2", plus15 = rep.age === "plus15";
    var cat = rep.revenus;
    var modestes = cat === "tmo" || cat === "mo";
    var aides = [];
    var non2ans = "Réservée aux logements construits il y a plus de 2 ans.";

    if (rep.projet === "chauffage") {
      var mpr = { nom: "MaPrimeRénov’" };
      if (!proprio) { mpr.statut = "non"; mpr.detail = "Réservée aux propriétaires. Votre propriétaire peut, lui, en bénéficier."; }
      else if (!plus15) { mpr.statut = "non"; mpr.detail = "Réservée aux logements construits il y a au moins 15 ans."; }
      else if (cat === "sup") { mpr.statut = "non"; mpr.detail = "Non accessible au-delà des plafonds de revenus intermédiaires. La prime énergie reste possible."; }
      else if (cat === "inconnu") { mpr.statut = "possible"; mpr.montant = "3 000 à 5 000 €"; mpr.detail = "Selon vos revenus : réservée aux revenus modestes à intermédiaires."; }
      else {
        mpr.statut = "oui"; mpr.montant = euros(MPR_PAC_AIR_EAU[cat]);
        mpr.detail = "Forfait 2026 pour une pompe à chaleur air/eau." + (rep.situation === "bailleur" ? " Le logement doit être loué comme résidence principale." : " Pour votre résidence principale.");
      }
      aides.push(mpr);
      aides.push(plus2
        ? { nom: "Prime énergie (CEE)", statut: "oui", montant: "Variable", detail: modestes ? "Versée par un fournisseur d’énergie, montant généralement plus élevé pour les revenus modestes." : "Versée par un fournisseur d’énergie, quel que soit votre revenu." }
        : { nom: "Prime énergie (CEE)", statut: "non", detail: non2ans });
      aides.push(plus2
        ? { nom: "TVA à 5,5 %", statut: "oui", detail: "Sur le matériel et la pose, au lieu de 20 %." }
        : { nom: "TVA à 5,5 %", statut: "non", detail: non2ans });
      aides.push(proprio && plus2
        ? { nom: "Éco-prêt à taux zéro", statut: "oui", detail: "Pour financer le reste à payer, sans intérêts et sans condition de revenus." }
        : { nom: "Éco-prêt à taux zéro", statut: "non", detail: proprio ? non2ans : "Réservé aux propriétaires." });
    } else {
      aides.push({ nom: "MaPrimeRénov’", statut: "non", detail: "La climatisation réversible (pompe à chaleur air/air) n’est pas financée en rénovation par geste. Nous préférons vous le dire." });
      aides.push(plus2
        ? { nom: "Prime énergie (CEE)", statut: "oui", montant: "Variable", detail: "Pour un équipement performant, posé par un artisan RGE." }
        : { nom: "Prime énergie (CEE)", statut: "non", detail: non2ans });
      aides.push(plus2
        ? { nom: "TVA à 5,5 %", statut: "oui", detail: "Depuis juillet 2026, pour les modèles les plus performants (classe A++ en mono-split, A+ en multi-split)." }
        : { nom: "TVA à 5,5 %", statut: "non", detail: non2ans });
      aides.push(proprio && plus2
        ? { nom: "Éco-prêt à taux zéro", statut: "possible", detail: "Uniquement dans le cadre d’une rénovation globale du logement." }
        : { nom: "Éco-prêt à taux zéro", statut: "non", detail: proprio ? non2ans : "Réservé aux propriétaires." });
    }
    aides.push({ nom: "Aides locales", statut: "possible", detail: "Certaines collectivités ajoutent un coup de pouce : votre artisan vérifie pour votre commune." });
    return aides;
  }

  function vueResultat() {
    var aides = calculer();
    var oui = aides.filter(function (a) { return a.statut === "oui"; }).length;
    var titre = oui >= 3 ? "Bonne nouvelle&#8239;: " + oui + " aides peuvent alléger votre projet."
      : oui === 2 ? "2 aides peuvent alléger votre projet."
      : oui === 1 ? "Une aide peut alléger votre projet."
      : "Votre projet n’ouvre pas droit aux principales aides.";
    var zoneTxt = zone(rep.cp) === "idf" ? "Île-de-France" : "hors Île-de-France";
    var profil = '<span class="pastille ' + (rep.projet === "chauffage" ? "pastille--chaud" : "pastille--froid") + '">' +
      (rep.projet === "chauffage" ? "Pompe à chaleur air/eau" : "Climatisation réversible") + "</span>" +
      (CATEGORIES[rep.revenus] ? '<span class="pastille pastille--neutre">Revenus ' + CATEGORIES[rep.revenus] + " · barème 2026, " + zoneTxt + "</span>" : "") +
      '<span class="pastille pastille--neutre">' + icone("i-epingle") + echapper(rep.cp) + "</span>";

    var lignes = aides.map(function (a) {
      var ico = a.statut === "oui" ? "i-check" : a.statut === "possible" ? "i-info" : "i-moins";
      var statut = a.statut === "oui" ? "Vous y avez probablement droit" : a.statut === "possible" ? "Possible, sous conditions" : "Non applicable";
      return '<li class="ligne-aide ligne-aide--' + a.statut + '">' +
        '<span class="ligne-aide__statut">' + icone(ico) + '<span class="visuellement-cache">' + statut + " : </span></span>" +
        '<span class="ligne-aide__nom">' + a.nom + "</span>" +
        '<span class="ligne-aide__montant">' + (a.montant || "") + "</span>" +
        '<span class="ligne-aide__detail">' + a.detail + "</span></li>";
    }).join("");

    var note = rep.situation === "locataire"
      ? '<p class="demo-note" style="margin-top:16px">' + icone("i-info") + "<span>En tant que locataire, l’accord de votre propriétaire est nécessaire avant tous travaux. Parlez-lui de cette simulation&nbsp;: c’est lui qui peut bénéficier de la plupart des aides.</span></p>"
      : "";

    return '<div class="sim__vue" data-etape="resultat"><div class="resultat__tete">' +
      '<p class="sim__compteur">Votre résultat</p>' +
      '<h2 class="sim__question" tabindex="-1">' + titre + "</h2>" +
      '<div class="resultat__profil">' + profil + "</div></div>" +
      '<ul class="resultat__liste">' + lignes + "</ul>" + note +
      '<p class="resultat__mention">Estimation indicative, établie d’après vos réponses et les règles 2026. Elle ne vaut pas accord&nbsp;: l’éligibilité est vérifiée lors de chaque demande d’aide. Le Bon Degré est un service privé et ne verse aucune aide.</p>' +
      '<div class="resultat__suite"><h3>Et maintenant&#8239;?</h3>' +
      "<p>Un seul artisan partenaire certifié RGE de votre secteur peut vous rappeler pour une étude gratuite et un devis détaillé. Personne d’autre ne vous contactera.</p>" +
      '<button class="bouton" type="button" data-action="coordonnees">Être rappelé par un artisan RGE ' + icone("i-fleche", "icone--fleche") + "</button></div></div>";
  }

  function vueCoordonnees() {
    var c = rep.contact || {};
    var creneaux = [["matin", "Matin", "9 h – 12 h"], ["midi", "Midi", "12 h – 14 h"], ["apres-midi", "Après-midi", "14 h – 18 h"], ["soir", "En soirée", "18 h – 20 h"]];
    var choisi = c.creneau || "matin";
    return '<form class="sim__vue" data-etape="coordonnees" novalidate>' +
      '<p class="sim__compteur">Dernière étape</p>' +
      '<h2 class="sim__question" tabindex="-1">À qui l’artisan doit-il s’adresser&#8239;?</h2>' +
      '<p class="sim__aide">Nous vous proposerons par SMS un seul artisan partenaire certifié RGE de votre secteur. Vos coordonnées ne lui seront transmises qu’après votre accord.</p>' +
      '<div class="grille-champs">' +
      champ("prenom", "Prénom", "text", "given-name", c.prenom) +
      champ("nom", "Nom", "text", "family-name", c.nom) + "</div>" +
      champ("tel", "Téléphone", "tel", "tel", c.tel, "Un numéro français, fixe ou mobile.") +
      champ("mail", 'E-mail <span class="facultatif">(facultatif)</span>', "email", "email", c.mail) +
      '<fieldset class="creneaux"><legend>Quand préférez-vous être rappelé&#8239;?</legend>' +
      creneaux.map(function (x) {
        return '<label class="creneau"><input type="radio" name="creneau" value="' + x[0] + '"' + (x[0] === choisi ? " checked" : "") + "><span>" + x[1] + "<small>" + x[2] + "</small></span></label>";
      }).join("") + "</fieldset>" +
      '<div data-champ="accord"><label class="case"><input type="checkbox" name="accord" aria-describedby="sim-accord-erreur"' + (c.accord ? " checked" : "") + ">" +
      "<span>J’accepte d’être recontacté au sujet de ce projet par <strong>Le Bon Degré</strong>, service de King Dream Digital, qui me proposera par SMS <strong>un seul artisan partenaire certifié RGE</strong> de mon secteur. Mes coordonnées ne lui seront transmises qu’après mon accord. Elles ne seront ni revendues, ni utilisées pour du démarchage. " +
      '<a href="confidentialite.html" target="_blank" rel="noopener">En savoir plus</a></span></label>' +
      '<p class="champ__erreur" id="sim-accord-erreur" role="alert"></p></div>' +
      '<div class="sim__actions"><button class="bouton" type="submit">Demander à être rappelé ' + icone("i-fleche", "icone--fleche") + "</button></div></form>";
  }

  function champ(nom, libelle, type, auto, valeur, indice) {
    var id = "sim-" + nom;
    return '<div class="champ" data-champ="' + nom + '"><label for="' + id + '">' + libelle + "</label>" +
      '<input id="' + id + '" name="' + nom + '" type="' + type + '" autocomplete="' + auto + '"' +
      (type === "tel" ? ' inputmode="tel"' : "") + ' value="' + echapper(valeur || "") + '" aria-describedby="' + id + '-erreur">' +
      (indice ? '<p class="sim__aide" style="margin:0;font-size:.9375rem">' + indice + "</p>" : "") +
      '<p class="champ__erreur" id="' + id + '-erreur" role="alert"></p></div>';
  }

  function vueMerci() {
    var c = rep.contact;
    var libelles = { matin: "le matin (9 h – 12 h)", midi: "à midi (12 h – 14 h)", "apres-midi": "l’après-midi (14 h – 18 h)", soir: "en soirée (18 h – 20 h)" };
    return '<div class="sim__vue confirmation" data-etape="merci">' +
      '<span class="confirmation__ok">' + icone("i-check") + "</span>" +
      '<h2 class="sim__question" tabindex="-1">Merci ' + echapper(c.prenom) + "&#8239;!</h2>" +
      '<p class="sim__aide">Voici ce qui se passerait ensuite, avec le service en ligne&nbsp;:</p>' +
      '<ol class="frise">' +
      "<li><b>1</b><span>Vous recevez un SMS avec le nom d’<strong>un seul artisan partenaire certifié RGE</strong> qui intervient près de chez vous (" + echapper(rep.cp) + ").</span></li>" +
      "<li><b>2</b><span>Vous l’acceptez en un clic&nbsp;: lui seul reçoit vos coordonnées. Personne d’autre ne vous contacte.</span></li>" +
      "<li><b>3</b><span>Il vous appelle " + libelles[c.creneau] + ", au " + echapper(c.tel) + ", étudie votre maison et vous remet un devis détaillé, avec les aides. Vous décidez, sans engagement.</span></li></ol>" +
      '<p class="demo-note">' + icone("i-info") + "<span><strong>Version de démonstration&nbsp;:</strong> aucune donnée n’a été envoyée ni enregistrée.</span></p>" +
      '<div class="sim__actions"><button class="bouton" type="button" data-fermer-fin>Fermer</button></div></div>';
  }

  /* --- Réponses ---------------------------------------------------------------------- */

  corps.addEventListener("click", function (e) {
    var option = e.target.closest(".option");
    if (option) {
      if (verrou) return; // un double clic ne doit pas sauter une question
      verrou = true;
      var id = option.closest("[data-etape]").getAttribute("data-etape");
      rep[id] = option.getAttribute("data-valeur");
      corps.querySelectorAll(".option").forEach(function (o) { o.setAttribute("aria-pressed", String(o === option)); });
      window.setTimeout(function () { verrou = false; avancer(); }, 180);
      return;
    }
    var pas = e.target.closest("[data-foyer]");
    if (pas) {
      var n = Math.min(12, Math.max(1, (rep.foyer || 2) + Number(pas.getAttribute("data-foyer"))));
      rep.foyer = n;
      corps.querySelector("[data-nombre]").textContent = n;
      corps.querySelector("[data-unite]").textContent = n > 1 ? "personnes" : "personne";
      corps.querySelector('[data-foyer="-1"]').disabled = n <= 1;
      corps.querySelector('[data-foyer="1"]').disabled = n >= 12;
      return;
    }
    if (e.target.closest('[data-action="coordonnees"]')) { avancer(); return; }
    if (e.target.closest("[data-fermer-fin]")) fermer();
  });

  corps.addEventListener("submit", function (e) {
    e.preventDefault();
    var form = e.target, id = form.getAttribute("data-etape");
    if (id === "cp") {
      var cp = form.cp.value.replace(/\s+/g, "");
      if (!/^(?:(?:0[1-9]|[1-8]\d|9[0-5])\d{3}|97[1-6]\d{2})$/.test(cp)) {
        erreur(form, "cp", "Indiquez un code postal français à 5 chiffres, par exemple 13100.");
        return;
      }
      rep.cp = cp;
      avancer();
    } else if (id === "foyer") {
      rep.foyer = rep.foyer || 2;
      avancer();
    } else if (id === "coordonnees") {
      validerCoordonnees(form);
    }
  });

  corps.addEventListener("input", function (e) {
    var bloc = e.target.closest("[data-champ]");
    if (bloc) effacer(bloc);
  });
  corps.addEventListener("change", function (e) {
    var bloc = e.target.closest("[data-champ]");
    if (bloc) effacer(bloc);
  });

  function erreur(form, nom, message) {
    var bloc = form.querySelector('[data-champ="' + nom + '"]');
    bloc.classList.add("champ--erreur");
    bloc.querySelector(".champ__erreur").textContent = message;
    var entree = bloc.querySelector("input");
    entree.setAttribute("aria-invalid", "true");
    return entree;
  }
  function effacer(bloc) {
    bloc.classList.remove("champ--erreur");
    var msg = bloc.querySelector(".champ__erreur");
    if (msg) msg.textContent = "";
    var entree = bloc.querySelector("input");
    if (entree) entree.removeAttribute("aria-invalid");
  }

  function validerCoordonnees(form) {
    var c = {
      prenom: form.prenom.value.trim(),
      nom: form.nom.value.trim(),
      tel: form.tel.value.trim(),
      mail: form.mail.value.trim(),
      creneau: (form.querySelector('input[name="creneau"]:checked') || {}).value || "matin",
      accord: form.accord.checked
    };
    rep.contact = c;
    var premiere = null;
    function noter(entree) { if (!premiere) premiere = entree; }
    if (!c.prenom) noter(erreur(form, "prenom", "Indiquez votre prénom."));
    if (!c.nom) noter(erreur(form, "nom", "Indiquez votre nom."));
    if (!/^(?:(?:\+|00)33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}$/.test(c.tel)) noter(erreur(form, "tel", "Indiquez un numéro de téléphone français valide, par exemple 06 12 34 56 78."));
    if (c.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.mail)) noter(erreur(form, "mail", "Cette adresse e-mail semble incomplète."));
    if (!c.accord) noter(erreur(form, "accord", "Cochez cette case pour que l’artisan puisse vous rappeler."));
    if (premiere) { premiere.focus(); return; }
    avancer(); // Démonstration : rien n'est envoyé.
  }
})();
