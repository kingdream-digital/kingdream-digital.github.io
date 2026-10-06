/* Délice — interactions du site multi-boutiques (démo KingDream Digital) */
(function () {
  "use strict";

  var $ = function (s, ctx) { return (ctx || document).querySelector(s); };
  var $$ = function (s, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(s)); };

  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  function toast(msg) {
    var t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* --- Menu mobile + menu déroulant « Nos boutiques » --------------------- */
  var burger = $(".burger"), nav = $(".nav");
  if (burger && nav) {
    burger.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      burger.setAttribute("aria-expanded", open);
    });
  }
  $$(".nav__drop > button").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var d = btn.parentNode, open = d.classList.toggle("open");
      btn.setAttribute("aria-expanded", open);
    });
  });
  document.addEventListener("click", function (e) {
    $$(".nav__drop.open").forEach(function (d) { if (!d.contains(e.target)) { d.classList.remove("open"); } });
  });

  /* --- Statut ouvert / fermé en temps réel -------------------------------- */
  function toMin(hhmm) { var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
  function fmt(hhmm) { var p = hhmm.split(":"); return +p[0] + "h" + (p[1] === "00" ? "" : p[1]); }
  function updateStatus() {
    var now = new Date(), m = now.getHours() * 60 + now.getMinutes();
    $$("[data-hours]").forEach(function (el) {
      var h = el.getAttribute("data-hours").split("-");
      if (h.length !== 2) { return; }
      var open = m >= toMin(h[0]) && m < toMin(h[1]);
      el.classList.toggle("is-open", open);
      el.classList.toggle("is-closed", !open);
      el.textContent = open
        ? "Ouvert · ferme à " + fmt(h[1])
        : "Fermé · ouvre à " + fmt(h[0]);
    });
    var day = (now.getDay() + 6) % 7; // lundi = 0
    $$(".hours tr").forEach(function (tr, i) { tr.classList.toggle("today", i === day); });
  }
  updateStatus();
  setInterval(updateStatus, 60000);

  /* --- Filtres (boutiques, produits, bons plans) --------------------------- */
  $$("[data-filter-group]").forEach(function (group) {
    var target = $(group.getAttribute("data-filter-group"));
    if (!target) { return; }
    group.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter");
      if (!btn) { return; }
      $$(".filter", group).forEach(function (b) { b.classList.toggle("active", b === btn); b.setAttribute("aria-pressed", b === btn); });
      var f = btn.getAttribute("data-filter");
      $$("[data-tags]", target).forEach(function (item) {
        var tags = " " + item.getAttribute("data-tags") + " ";
        item.hidden = !(f === "all" || tags.indexOf(" " + f + " ") !== -1);
      });
    });
  });

  /* --- Apparition au défilement ------------------------------------------- */
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px" });
    $$(".reveal").forEach(function (el) { io.observe(el); });
  } else {
    $$(".reveal").forEach(function (el) { el.classList.add("in"); });
  }

  /* --- Galerie / lightbox -------------------------------------------------- */
  var lb = $(".lightbox");
  if (lb) {
    var lbImg = $("img", lb);
    $$(".gallery a").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        lbImg.src = a.getAttribute("href");
        lbImg.alt = ($("img", a) || {}).alt || "";
        lb.classList.add("open");
      });
    });
    lb.addEventListener("click", function (e) { if (e.target !== lbImg) { lb.classList.remove("open"); } });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") { lb.classList.remove("open"); } });
  }

  /* --- Liste de réservation (click & collect, démo) ------------------------ */
  var KEY = "delice-reservation";
  var basket = store.get(KEY, []);
  var drawerBody = $(".drawer__body");

  function save() { store.set(KEY, basket); render(); }
  function count() { return basket.reduce(function (n, it) { return n + it.qty; }, 0); }

  function render() {
    $$(".basket-count").forEach(function (c) { c.textContent = count(); });
    if (!drawerBody) { return; }
    if (!basket.length) {
      drawerBody.innerHTML = '<p class="drawer__empty">Votre liste est vide.<br>Ajoutez des produits avec le bouton <strong>+</strong> pour les réserver et les retirer en boutique.</p>';
      return;
    }
    drawerBody.innerHTML = basket.map(function (it, i) {
      return '<div class="line"><img src="' + it.img + '" alt="">' +
        '<div><strong>' + it.name + '</strong><span>' + it.store + (it.unit ? " · " + it.unit : "") + '</span></div>' +
        '<div class="qty"><button type="button" data-q="-1" data-i="' + i + '" aria-label="Retirer">−</button>' +
        '<output>' + it.qty + '</output>' +
        '<button type="button" data-q="1" data-i="' + i + '" aria-label="Ajouter">+</button></div></div>';
    }).join("");
  }

  if (drawerBody) {
    drawerBody.addEventListener("click", function (e) {
      var b = e.target.closest("[data-q]");
      if (!b) { return; }
      var it = basket[+b.getAttribute("data-i")];
      it.qty += +b.getAttribute("data-q");
      if (it.qty <= 0) { basket.splice(+b.getAttribute("data-i"), 1); }
      save();
    });
  }

  $$(".add-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var d = btn.dataset, id = d.store + "|" + d.name;
      var found = basket.filter(function (it) { return it.id === id; })[0];
      if (found) { found.qty += 1; } else { basket.push({ id: id, name: d.name, store: d.store, img: d.img, unit: d.unit || "", qty: 1 }); }
      save();
      btn.classList.add("added");
      setTimeout(function () { btn.classList.remove("added"); }, 600);
      toast("« " + d.name + " » ajouté à votre réservation");
    });
  });

  function openDrawer(open) {
    // boutique de retrait par défaut : celle du premier produit de la liste
    var sel = $("#resa-form select");
    if (open && sel && basket.length) {
      $$("option", sel).forEach(function (o) { if (o.textContent === basket[0].store) { sel.value = o.value; } });
    }
    document.body.classList.toggle("drawer-open", open);
  }
  $$(".basket-btn").forEach(function (b) { b.addEventListener("click", function () { openDrawer(true); }); });
  $$("[data-close-drawer]").forEach(function (b) { b.addEventListener("click", function () { openDrawer(false); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { openDrawer(false); } });

  var resaForm = $("#resa-form");
  if (resaForm) {
    var dateInput = $("input[type=date]", resaForm);
    if (dateInput) { dateInput.min = new Date().toISOString().slice(0, 10); }
    resaForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!basket.length) { toast("Ajoutez au moins un produit à votre liste."); return; }
      var shop = $("select", resaForm).value;
      basket = [];
      save();
      openDrawer(false);
      resaForm.reset();
      toast("Réservation envoyée à " + shop + " (démo) — vous serez rappelé·e.");
    });
  }
  render();

  /* --- Formulaires de démonstration --------------------------------------- */
  $$("form[data-demo]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var note = $(".form-note", f) || f.nextElementSibling;
      if (note) { note.textContent = f.getAttribute("data-demo"); }
      f.reset();
    });
  });

  /* --- Année du pied de page --------------------------------------------- */
  $$(".js-year").forEach(function (el) { el.textContent = new Date().getFullYear(); });
})();
