/* Le Bon Degré — formulaires des pages Contact et Artisan partenaire.
   Version de démonstration : on vérifie la saisie, puis on affiche le
   remerciement ; rien n'est envoyé. */
(function () {
  "use strict";

  document.querySelectorAll("[data-formulaire-demo]").forEach(function (form) {
    form.addEventListener("input", effacer);
    form.addEventListener("change", effacer);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var premiere = null;
      function noter(champ) { if (!premiere) premiere = champ; } // tous les champs sont signalés

      form.querySelectorAll("input[required], textarea[required]").forEach(function (champ) {
        var valeur = champ.value.trim();
        var ok = valeur !== "";
        if (ok && champ.type === "email") ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valeur);
        if (ok && champ.pattern) ok = new RegExp("^(?:" + champ.pattern + ")$").test(valeur.replace(/\s+/g, ""));
        if (!ok) noter(signaler(champ, champ.getAttribute("data-message") || "Ce champ est obligatoire."));
      });

      var groupe = form.querySelectorAll("[data-groupe]");
      if (groupe.length && !Array.prototype.some.call(groupe, function (c) { return c.checked; })) {
        noter(signaler(groupe[0], "Cochez au moins une activité."));
      }

      if (premiere) { premiere.focus(); return; }

      var merci = form.parentNode.querySelector("[data-merci]");
      form.hidden = true;
      merci.classList.add("est-visible");
      merci.focus();
    });
  });

  function signaler(champ, message) {
    var bloc = champ.closest("[data-champ]");
    bloc.classList.add("champ--erreur");
    bloc.querySelector(".champ__erreur").textContent = message;
    champ.setAttribute("aria-invalid", "true");
    return champ;
  }

  function effacer(e) {
    var bloc = e.target.closest("[data-champ]");
    if (!bloc) return;
    bloc.classList.remove("champ--erreur");
    var msg = bloc.querySelector(".champ__erreur");
    if (msg) msg.textContent = "";
    e.target.removeAttribute("aria-invalid");
  }
})();
