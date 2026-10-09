window.KDC_CONFIG = {"mode":"demo","vendor":{"jspdf":"vendor/jspdf.umd.min.js","xterm":"vendor/xterm.js","fit":"vendor/addon-fit.js"},"presentation":true};
(function () {
'use strict';
/* ---- js/core.js ---- */
/* KingDream Control — core métier partagé (navigateur + serveur).
   Fonctions pures uniquement : dates, argent, totaux, statuts, numérotation, mentions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KDCCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VAT_RATES = [20, 10, 5.5, 2.1, 0];
  const UNITS = ['u', 'h', 'jour', 'mois', 'an', 'forfait', 'lot', 'page'];
  const PAYMENT_METHODS = ['Virement', 'Carte bancaire', 'Prélèvement SEPA', 'Chèque', 'Espèces'];
  const CATEGORIES = {
    services: 'Prestation de services',
    goods: 'Livraison de biens',
    mixed: 'Livraison de biens et prestation de services',
  };
  const KIND_LABELS = { invoice: 'Facture', quote: 'Devis', credit: 'Avoir' };
  const STATUS_LABELS = {
    invoice: { draft: 'Brouillon', sent: 'Envoyée', overdue: 'En retard', paid: 'Payée', cancelled: 'Annulée' },
    quote: { draft: 'Brouillon', sent: 'Envoyé', expired: 'Expiré', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' },
    credit: { draft: 'Brouillon', sent: 'Émis', refunded: 'Remboursé' },
  };
  const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  /* ---------- identifiants ---------- */
  function uid(prefix) {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    let s = '';
    for (const b of bytes) s += 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32];
    return (prefix ? prefix + '_' : '') + s;
  }

  /* ---------- dates (ISO aaaa-mm-jj, calendrier local) ---------- */
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) {
    const p = String(s || '').slice(0, 10).split('-').map(Number);
    return new Date(p[0] || 1970, (p[1] || 1) - 1, p[2] || 1);
  }
  function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
  function addMonths(iso, n) {
    const d = parseISO(iso);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return isoDate(d);
  }
  /** a − b en jours */
  function diffDays(a, b) { return Math.round((parseISO(a) - parseISO(b)) / 86400000); }
  function ym(iso) { return String(iso).slice(0, 7); }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = parseISO(iso);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function fmtDateLong(iso) {
    if (!iso) return '';
    const d = parseISO(iso);
    return d.getDate() + ' ' + MONTHS_LONG[d.getMonth()] + ' ' + d.getFullYear();
  }
  function monthLabel(ymStr, long) {
    const [y, m] = ymStr.split('-').map(Number);
    return (long ? MONTHS_LONG : MONTHS_SHORT)[m - 1] + (long ? ' ' + y : '');
  }

  /* ---------- argent (calculs en centimes) ---------- */
  function rnd(x) { return x < 0 ? -Math.round(-x + 1e-9) : Math.round(x + 1e-9); }
  function num(v, d) {
    if (typeof v === 'string') {
      v = v.replace(/[\s  ]/g, '').replace(',', '.');
      if (v === '') return d || 0;
    }
    if (v === null || v === undefined) return d || 0;
    const n = Number(v);
    return isFinite(n) ? n : (d || 0);
  }
  function cents(v) { return rnd(num(v) * 100); }
  const _eur = (typeof Intl !== 'undefined') ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }) : null;
  const _eur0 = (typeof Intl !== 'undefined') ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) : null;
  const _num = (typeof Intl !== 'undefined') ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }) : null;
  /** centimes → « 1 234,56 € » (espaces insécables fines remplacées pour le PDF si plain=true) */
  function fmtEUR(c, opts) {
    opts = opts || {};
    const v = (c || 0) / 100;
    let s = opts.round ? _eur0.format(Math.round(v)) : _eur.format(v);
    if (opts.plain) s = s.replace(/[  ]/g, ' ');
    return s;
  }
  function fmtNum(n, plain) {
    let s = _num.format(n || 0);
    if (plain) s = s.replace(/[  ]/g, ' ');
    return s;
  }
  function fmtRate(r) { return String(r).replace('.', ',') + ' %'; }

  /* ---------- lignes & totaux ---------- */
  function lineTotal(l) {
    const q = num(l.qty), pu = num(l.unitPrice);
    const disc = Math.min(100, Math.max(0, num(l.discount)));
    return cents(q * pu * (1 - disc / 100));
  }
  /** Totaux d'un document. Toutes les valeurs en centimes (positives, même pour un avoir). */
  function computeTotals(doc, company) {
    const franchise = company && company.vatRegime === 'franchise';
    const byRate = new Map();
    let gross = 0;
    for (const l of (doc.lines || [])) {
      const t = lineTotal(l);
      gross += t;
      const rate = franchise ? 0 : num(l.vatRate);
      byRate.set(rate, (byRate.get(rate) || 0) + t);
    }
    const g = Math.min(100, Math.max(0, num(doc.globalDiscount)));
    let discount = 0;
    const bases = [];
    for (const [rate, base] of byRate) {
      const d = rnd(base * g / 100);
      discount += d;
      const net = base - d;
      bases.push({ rate, base: net, vat: rnd(net * rate / 100) });
    }
    bases.sort((a, b) => b.rate - a.rate);
    const totalHT = gross - discount;
    const totalVAT = bases.reduce((s, b) => s + b.vat, 0);
    const totalTTC = totalHT + totalVAT;
    const paid = (doc.payments || []).reduce((s, p) => s + cents(p.amount), 0);
    return {
      gross, discount, totalHT, totalVAT, totalTTC, bases, franchise,
      paid, due: Math.max(0, totalTTC - paid),
      partial: paid > 0 && paid < totalTTC,
    };
  }
  /** Signe comptable : un avoir vient en déduction du chiffre d'affaires. */
  function sign(doc) { return doc.kind === 'credit' ? -1 : 1; }

  /* ---------- statuts ---------- */
  function docStatus(doc, today) {
    if (doc.kind === 'invoice') {
      if (doc.status === 'sent' && doc.dueDate && diffDays(today, doc.dueDate) > 0) return 'overdue';
      return doc.status;
    }
    if (doc.kind === 'quote') {
      if (doc.status === 'sent' && doc.validUntil && diffDays(today, doc.validUntil) > 0) return 'expired';
      return doc.status;
    }
    return doc.status;
  }
  function statusLabel(doc, today) {
    const s = docStatus(doc, today);
    return (STATUS_LABELS[doc.kind] || {})[s] || s;
  }
  /** Ton sémantique d'un statut affiché : ok | warn | crit | info | muted | accent */
  function statusTone(kind, s) {
    const map = {
      draft: 'muted', sent: 'info', overdue: 'crit', paid: 'ok', cancelled: 'muted',
      expired: 'warn', accepted: 'ok', refused: 'muted', invoiced: 'accent', refunded: 'ok',
    };
    if (kind === 'credit' && s === 'sent') return 'accent';
    return map[s] || 'muted';
  }
  function isIssued(doc) { return doc.status !== 'draft'; }
  function isLocked(doc) { return doc.status !== 'draft'; }

  /* ---------- numérotation ---------- */
  function formatNumber(prefix, year, seq) { return prefix + '-' + year + '-' + pad(seq, 4); }
  function parseNumber(n) {
    const m = /^([A-Z]{1,4})-(\d{4})-(\d{1,6})$/.exec(n || '');
    return m ? { prefix: m[1], year: +m[2], seq: +m[3] } : null;
  }
  function prefixFor(kind, company) {
    const p = (company && company.prefixes) || {};
    return kind === 'quote' ? (p.quote || 'D') : kind === 'credit' ? (p.credit || 'AV') : (p.invoice || 'F');
  }
  /** Prochain numéro libre d'une séquence (suite chronologique continue, une par type et par année). */
  function nextNumber(docs, kind, company, issueDate) {
    const prefix = prefixFor(kind, company);
    const year = parseISO(issueDate).getFullYear();
    let max = 0;
    for (const d of docs) {
      if (d.kind !== kind || !d.number) continue;
      const p = parseNumber(d.number);
      if (p && p.prefix === prefix && p.year === year && p.seq > max) max = p.seq;
    }
    return formatNumber(prefix, year, max + 1);
  }

  /* ---------- conformité ---------- */
  /** Mentions obligatoires manquantes (droit français, y compris les mentions ajoutées au 1er septembre 2026). */
  function missingMentions(company, client, doc) {
    const m = [];
    company = company || {};
    if (!company.tradeName && !company.legalName) m.push('Nom de l’entreprise');
    if (!company.address || !company.zip || !company.city) m.push('Adresse de l’entreprise');
    if (!company.siret) m.push('SIRET de l’entreprise');
    if (company.vatRegime !== 'franchise' && !company.vatNumber) m.push('N° de TVA intracommunautaire');
    if (!client) { m.push('Client'); return m; }
    if (!client.name) m.push('Nom du client');
    if (!client.address || !client.zip || !client.city) m.push('Adresse du client');
    if (client.type === 'pro' && !client.siren) m.push('SIREN du client');
    if (!doc.lines || !doc.lines.length) m.push('Au moins une ligne');
    return m;
  }
  function validateDocument(doc) {
    const e = [];
    if (!doc.clientId) e.push('Choisis un client.');
    if (!doc.issueDate) e.push('Indique la date d’émission.');
    if (!doc.lines || !doc.lines.length) e.push('Ajoute au moins une ligne.');
    (doc.lines || []).forEach((l, i) => {
      if (!String(l.description || '').trim()) e.push('Ligne ' + (i + 1) + ' : désignation manquante.');
      if (!(num(l.qty) > 0)) e.push('Ligne ' + (i + 1) + ' : quantité invalide.');
    });
    if (doc.kind === 'invoice' && doc.dueDate && doc.issueDate && diffDays(doc.dueDate, doc.issueDate) < 0) e.push('L’échéance précède la date d’émission.');
    return e;
  }

  /* ---------- transformations ---------- */
  function cloneLines(lines) {
    return (lines || []).map(l => ({
      id: uid('l'), description: l.description || '', details: l.details || '',
      qty: num(l.qty, 1), unit: l.unit || 'u', unitPrice: num(l.unitPrice), vatRate: num(l.vatRate), discount: num(l.discount),
    }));
  }
  function blankDocument(kind, company, today, clientId) {
    company = company || {};
    const doc = {
      id: uid(kind === 'quote' ? 'q' : kind === 'credit' ? 'a' : 'f'),
      kind, status: 'draft', number: null, clientId: clientId || null,
      issueDate: today, serviceDate: kind === 'invoice' ? today : null,
      dueDate: kind === 'invoice' ? addDays(today, company.paymentTermsDays || 30) : null,
      validUntil: kind === 'quote' ? addDays(today, company.quoteValidityDays || 30) : null,
      category: 'services', paymentMethod: company.defaultPaymentMethod || 'Virement',
      lines: [], globalDiscount: 0, notes: '', payments: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    return doc;
  }
  function quoteToInvoice(quote, company, today) {
    const inv = blankDocument('invoice', company, today, quote.clientId);
    inv.category = quote.category || 'services';
    inv.lines = cloneLines(quote.lines);
    inv.globalDiscount = quote.globalDiscount || 0;
    inv.notes = quote.notes || '';
    inv.fromQuoteId = quote.id;
    inv.fromQuoteNumber = quote.number;
    return inv;
  }
  function invoiceToCredit(inv, company, today) {
    const av = blankDocument('credit', company, today, inv.clientId);
    av.category = inv.category || 'services';
    av.lines = cloneLines(inv.lines);
    av.globalDiscount = inv.globalDiscount || 0;
    av.relatedInvoiceId = inv.id;
    av.relatedInvoiceNumber = inv.number;
    av.notes = 'Avoir annulant la facture ' + inv.number + ' du ' + fmtDate(inv.issueDate) + '.';
    return av;
  }
  function subscriptionInvoice(clientId, subs, company, today) {
    const inv = blankDocument('invoice', company, today, clientId);
    const period = monthLabel(ym(today), true);
    inv.lines = subs.map(s => ({
      id: uid('l'), description: s.label,
      details: s.period === 'annuel' ? 'Période du ' + fmtDate(s.renewalDate || today) + ' au ' + fmtDate(addDays(addMonths(s.renewalDate || today, 12), -1)) : 'Période : ' + period,
      qty: 1, unit: s.period === 'annuel' ? 'an' : 'mois', unitPrice: num(s.priceHT), vatRate: num(s.vatRate, 20), discount: 0,
    }));
    inv.notes = 'Abonnement ' + period + '.';
    return inv;
  }

  /* ---------- agrégats ---------- */
  function monthlyEquivalent(sub) {
    if (sub.status !== 'actif') return 0;
    const c = cents(sub.priceHT);
    return sub.period === 'annuel' ? rnd(c / 12) : c;
  }
  /** Facturé HT et encaissé HT par mois sur `months` mois glissants. */
  function monthlyRevenue(docs, company, today, months) {
    months = months || 12;
    const out = [];
    const idx = {};
    const start = addMonths(ym(today) + '-01', -(months - 1));
    for (let i = 0; i < months; i++) {
      const k = ym(addMonths(start, i));
      idx[k] = out.length;
      out.push({ ym: k, label: monthLabel(k), invoiced: 0, collected: 0 });
    }
    for (const d of docs) {
      if (d.kind === 'quote' || d.status === 'draft') continue;
      const t = computeTotals(d, company);
      if (d.kind === 'invoice' && d.status === 'cancelled') {
        // facture annulée : neutralisée par son avoir, on la compte quand même pour garder la trace comptable
      }
      const k = ym(d.issueDate);
      if (k in idx) out[idx[k]].invoiced += sign(d) * t.totalHT;
      if (d.kind === 'invoice' && t.totalTTC > 0) {
        for (const p of (d.payments || [])) {
          const pk = ym(p.date);
          if (pk in idx) out[idx[pk]].collected += rnd(cents(p.amount) * t.totalHT / t.totalTTC);
        }
      }
    }
    return out;
  }


  /* ---------- serveurs partagés : sites hébergés, chacun rattaché à son propriétaire ---------- */
  function siteHost(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return String(url || ''); } }
  /** Sites surveillés d'un serveur (l'ancien champ healthUrl devient un site du propriétaire). */
  function serverSites(s) {
    if (s && Array.isArray(s.sites) && s.sites.length) return s.sites;
    if (s && s.healthUrl) return [{ id: 'main', name: siteHost(s.healthUrl), url: s.healthUrl, clientId: s.clientId }];
    return [];
  }
  /** Clients présents sur un serveur : le propriétaire puis ceux dont un site y est hébergé. */
  function serverClientIds(s) {
    const out = [s.clientId];
    for (const x of serverSites(s)) if (x.clientId && !out.includes(x.clientId)) out.push(x.clientId);
    return out;
  }
  function isSharedServer(s) { return serverClientIds(s).length > 1; }
  /** État d'un site d'après la dernière mesure : ok, warn (lent), crit (erreur), unknown. */
  function siteState(m, site, slowMs) {
    if (!site.url) return { state: 'none' }; // dossier sans adresse web : rien à contrôler en HTTP
    const r = m && m.sites && m.sites[site.id];
    if (!r || r.status === null || r.status === undefined) return { state: 'unknown' };
    if (r.status === 0 || r.status >= 500) return Object.assign({ state: 'crit' }, r);
    if (r.ms > (slowMs || 2000)) return Object.assign({ state: 'warn' }, r);
    return Object.assign({ state: 'ok' }, r);
  }

  /**
   * Répartition d'un serveur partagé entre propriétaires : stockage propre de chaque dossier
   * (un dossier imbriqué est retiré de son parent), CPU et RAM de ses processus, reste « système ».
   */
  function serverBreakdown(s) {
    const m = (s && s.metrics) || {};
    const sites = serverSites(s);
    const sizes = m.sizes || {}, usage = (m.usage && m.usage.bySite) || {};
    const inside = (child, parent) => parent === '/' ? child !== '/' : child.startsWith(parent + '/');
    const withPath = sites.filter(x => x.path);
    const rows = sites.filter(x => x.path || x.user).map(x => {
      const z = sizes[x.id] || {};
      let own = typeof z.bytes === 'number' ? z.bytes : null;
      const kids = x.path ? withPath.filter(y => y !== x && inside(y.path, x.path) && !withPath.some(w => w !== x && w !== y && inside(w.path, x.path) && inside(y.path, w.path))) : [];
      if (own !== null) for (const k of kids) { const kz = sizes[k.id]; if (kz && typeof kz.bytes === 'number') own -= kz.bytes; }
      const u = usage[x.id] || null;
      return { site: x, clientId: x.clientId, bytes: own === null ? null : Math.max(0, own), totalBytes: typeof z.bytes === 'number' ? z.bytes : null,
        partial: !!z.partial, missing: !!z.missing, children: kids.map(k => k.id), parent: null, cpu: u ? u.cpu : null, ram: u ? u.ram : null, procs: u ? u.procs : null };
    });
    rows.forEach(r => { const p = rows.find(q => q.children.includes(r.site.id)); if (p) r.parent = p.site.id; });
    const used = s.diskTotal && typeof m.disk === 'number' ? s.diskTotal * m.disk / 100 : null;
    const topBytes = rows.filter(r => !r.parent && r.totalBytes !== null).reduce((t, r) => t + r.totalBytes, 0);
    const other = (m.usage && m.usage.other) || null;
    return { rows, diskUsed: used, systemBytes: used === null ? null : Math.max(0, used - topBytes), otherCpu: other ? other.cpu : null, otherRam: other ? other.ram : null, measuredAt: m.sizesAt || null };
  }
  /** Totaux par propriétaire (ses dossiers + sous-dossiers qui lui appartiennent). */
  function ownerTotals(s) {
    const b = serverBreakdown(s); const by = {};
    for (const r of b.rows) {
      const o = by[r.clientId] || (by[r.clientId] = { clientId: r.clientId, bytes: 0, cpu: 0, ram: 0, hasSize: false, hasUsage: false });
      if (r.bytes !== null) { o.bytes += r.bytes; o.hasSize = true; }
      if (r.cpu !== null) { o.cpu += r.cpu; o.ram += r.ram; o.hasUsage = true; }
    }
    return { owners: Object.values(by), systemBytes: b.systemBytes, otherCpu: b.otherCpu, otherRam: b.otherRam };
  }

  return {
    VAT_RATES, UNITS, PAYMENT_METHODS, CATEGORIES, KIND_LABELS, STATUS_LABELS, MONTHS_SHORT, MONTHS_LONG,
    uid, pad, isoDate, parseISO, addDays, addMonths, diffDays, ym, fmtDate, fmtDateLong, monthLabel,
    rnd, cents, num, fmtEUR, fmtNum, fmtRate,
    lineTotal, computeTotals, sign,
    docStatus, statusLabel, statusTone, isIssued, isLocked,
    formatNumber, parseNumber, prefixFor, nextNumber,
    missingMentions, validateDocument,
    cloneLines, blankDocument, quoteToInvoice, invoiceToCredit, subscriptionInvoice,
    monthlyEquivalent, monthlyRevenue,
    siteHost, serverSites, serverClientIds, isSharedServer, siteState, serverBreakdown, ownerTotals,
  };
});

/* ---- js/util.js ---- */
/* ===== Utilitaires DOM, formatage, icônes, dialogues ===== */
const C = window.KDCCore;
const CFG = window.KDC_CONFIG || { mode: 'demo', vendor: {} };
// police d'Apple sur ses appareils, Inter ailleurs (voir --f-ui dans styles.css)
if (/Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent || '')) {
  document.documentElement.setAttribute('data-kdc-os', 'apple');
}
const LIVE = CFG.mode === 'live';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/** Échappe toute donnée avant insertion HTML (protection XSS). */
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function nl2br(v) { return esc(v).replace(/\n/g, '<br>'); }
function cls(...a) { return a.filter(Boolean).join(' '); }

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- formatage ---------- */
const fmt = {
  eur: (c, o) => C.fmtEUR(c, o),
  eur0: c => C.fmtEUR(c, { round: true }),
  num: n => C.fmtNum(n),
  pct: (n, d) => (n === null || n === undefined || isNaN(n)) ? '—' : (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toString().replace('.', ',') + ' %',
  date: iso => C.fmtDate(iso),
  dateLong: iso => C.fmtDateLong(iso),
  time: ts => { const d = new Date(ts); return C.pad(d.getHours()) + ':' + C.pad(d.getMinutes()); },
  dateTime: ts => { const d = new Date(ts); return C.fmtDate(C.isoDate(d)) + ' ' + C.pad(d.getHours()) + ':' + C.pad(d.getMinutes()); },
  rel(ts) {
    const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 45) return 'à l’instant';
    const m = Math.round(s / 60);
    if (m < 60) return 'il y a ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    const d = Math.round(h / 24);
    if (d < 31) return 'il y a ' + d + ' j';
    return 'le ' + C.fmtDate(C.isoDate(new Date(ts)));
  },
  rate(bytesPerSec) {
    const b = bytesPerSec || 0;
    if (b < 1000) return Math.round(b) + ' o/s';
    if (b < 1e6) return (b / 1000).toFixed(b < 1e4 ? 1 : 0).replace('.', ',') + ' ko/s';
    return (b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',') + ' Mo/s';
  },
  bytes(b) {
    if (!b && b !== 0) return '—';
    const u = ['o', 'ko', 'Mo', 'Go', 'To'];
    let i = 0; let v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)).toString().replace('.', ',') + ' ' + u[i];
  },
  uptime(sec) {
    if (!sec && sec !== 0) return '—';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    if (d) return d + ' j ' + h + ' h';
    if (h) return h + ' h ' + m + ' min';
    return m + ' min';
  },
  plural: (n, one, many) => n + ' ' + (n > 1 ? (many || one + 's') : one),
};
function todayISO() { return C.isoDate(new Date()); }

/* ---------- icônes (tracé maison, 24×24) ---------- */
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.6"/><rect x="3" y="15" width="7.5" height="6" rx="1.6"/>',
  server: '<rect x="3" y="3.5" width="18" height="7.5" rx="2"/><rect x="3" y="13" width="18" height="7.5" rx="2"/><path d="M7 7.25h.01M7 16.75h.01M11 7.25h6M11 16.75h6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>',
  building: '<path d="M4 20.5V5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5v15M15 9.5h3.5A1.5 1.5 0 0 1 20 11v9.5M3 20.5h18"/><path d="M8 8h3M8 12h3M8 16h3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  quote: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12.5h6M9 16.5h2.5"/><circle cx="15" cy="16.5" r="1.2"/>',
  credit: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14.5h6"/>',
  euro: '<path d="M17.5 6.6A7 7 0 0 0 7 12a7 7 0 0 0 10.5 5.4"/><path d="M4.5 10h9M4.5 14h7.5"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5"/>',
  logs: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  alert: '<path d="M10.3 4.2L2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5v-3a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  convert: '<path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/>',
  card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  pulse: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  disk: '<path d="M3 13.5L6 5h12l3 8.5"/><rect x="3" y="13.5" width="18" height="6" rx="2"/><path d="M7 16.5h.01M10.5 16.5h.01"/>',
  ram: '<rect x="3" y="7" width="18" height="9" rx="1.5"/><path d="M7 10.5v2.5M11 10.5v2.5M15 10.5v2.5M6 16v3M10 16v3M14 16v3M18 16v3"/>',
  net: '<path d="M8 20V5M4.5 8.5L8 5l3.5 3.5M16 4v15M12.5 15.5L16 19l3.5-3.5"/>',
  signal: '<path d="M12 19.5h.01M8.5 16a5 5 0 0 1 7 0M5.5 13a9 9 0 0 1 13 0M2.5 10a13 13 0 0 1 19 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  zap: '<path d="M13 2.5L4.5 13.5H11l-1 8 8.5-11H12z"/>',
  repeat: '<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 4v4.5H8M12 8v4.5l3 1.5"/>',
  wave: '<path d="M7 11.5V6.5a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9a1.5 1.5 0 0 1 3 0v4.5a7 7 0 0 1-7 7h-.5a7 7 0 0 1-5.6-2.8L3.6 14a1.5 1.5 0 0 1 2.3-1.9L7 13.5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  power: '<path d="M12 3v8M6.4 6.6a8 8 0 1 0 11.2 0"/>',
  upload: '<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4.5h14"/>',
  hash: '<path d="M5 9h15M4 15h15M10 3.5L8 20.5M16 3.5l-2 17"/>',
  fingerprint: '<path d="M7.5 5.2A8 8 0 0 1 20 12v1.5M4 12a8 8 0 0 1 1.5-4.7M12 12v2.5a9 9 0 0 1-1.6 5.2M8.4 10a4 4 0 0 1 7.6 2v2a12 12 0 0 1-.9 4.7M4.6 16.2A8 8 0 0 0 5 14v-2M19.5 17.5a14 14 0 0 0 .4-2"/>',
  crown: '<path d="M3.5 8.5l4.2 3.6L12 5.5l4.3 6.6 4.2-3.6-1.6 9.5H5.1z"/><path d="M5.5 21h13"/>',
};
function icon(name, extra) {
  return '<svg class="i' + (extra ? ' ' + extra : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
}

/* ---------- stockage local (confort uniquement, jamais indispensable) ---------- */
const store_local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignoré */ } },
};

/* ---------- divers ---------- */
function debounce(fn, ms) { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
function throttle(fn, ms) { let last = 0, t; return function (...a) { const now = Date.now(); const run = () => { last = Date.now(); fn.apply(this, a); }; if (now - last >= ms) run(); else { clearTimeout(t); t = setTimeout(run, ms - (now - last)); } }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const _scripts = {};
function loadScript(src) {
  if (_scripts[src]) return _scripts[src];
  _scripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    if (!LIVE) s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { delete _scripts[src]; reject(new Error('Chargement impossible : ' + src)); };
    document.head.appendChild(s);
  });
  return _scripts[src];
}
async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copié dans le presse-papiers.');
    return true;
  } catch (e) {
    if (el) {
      const r = document.createRange(); r.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Texte sélectionné : copie-le avec Ctrl+C.');
    } else toast('Copie refusée par le navigateur.', { tone: 'warn' });
    return false;
  }
}
/** Propose un fichier au téléchargement (capacité « downloads » dans l’aperçu, lien direct en auto-hébergé). */
async function offerDownload(filename, data) {
  if (!LIVE) {
    try {
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) {
        await dl.save({ filename, data });
        toast('Fichier « ' + filename + ' » enregistré.');
        return true;
      }
    } catch (e) {
      if (e && e.code === 'declined') { toast('Téléchargement annulé.'); return false; }
      if (e && e.code === 'rate_limited') { toast('Une demande de téléchargement est déjà ouverte.', { tone: 'warn' }); return false; }
    }
    // hors visionneuse : tentative classique
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (e) {
    toast('Le téléchargement n’est pas disponible ici.', { tone: 'warn' });
    return false;
  }
}

/* ---------- toasts ---------- */
function toast(msg, opts) {
  opts = opts || {};
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast' + (opts.tone ? ' toast-' + opts.tone : '');
  t.innerHTML = '<span class="toast-ico">' + icon(opts.tone === 'crit' ? 'alert' : opts.tone === 'warn' ? 'info' : 'check') + '</span><span class="toast-msg"></span>' +
    (opts.action ? '<button class="btn btn-sm btn-ghost toast-act" type="button"></button>' : '');
  t.querySelector('.toast-msg').textContent = msg;
  if (opts.action) {
    const b = t.querySelector('.toast-act');
    b.textContent = opts.action.label;
    b.addEventListener('click', () => { opts.action.run(); t.remove(); });
  }
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, opts.duration || 4200);
}

/* ---------- couches (dialogues, tiroirs) ---------- */
const layers = [];
function trapKeys(e) {
  const top = layers[layers.length - 1];
  if (!top) return;
  if (e.key === 'Escape' && top.dismissible !== false) { e.preventDefault(); top.close(); }
  if (e.key === 'Tab') {
    const f = $$('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', top.el)
      .filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
document.addEventListener('keydown', trapKeys);

/**
 * Dialogue modal. body: HTML (déjà échappé). actions: [{label, tone, id, run(close, el) → false pour garder ouvert}]
 */
function dialog(opts) {
  const prevFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'layer layer-dialog';
  wrap.innerHTML = '<div class="scrim"></div><div class="dialog' + (opts.wide ? ' dialog-wide' : '') + (opts.className ? ' ' + opts.className : '') + '" role="dialog" aria-modal="true" aria-labelledby="dlg-t">' +
    '<header class="dialog-head"><div><h2 id="dlg-t" class="dialog-title"></h2>' + (opts.subtitle ? '<p class="dialog-sub"></p>' : '') + '</div>' +
    (opts.dismissible === false ? '' : '<button class="icon-btn dlg-x" type="button" aria-label="Fermer">' + icon('x') + '</button>') + '</header>' +
    '<div class="dialog-body">' + (opts.body || '') + '</div>' +
    (opts.actions && opts.actions.length ? '<footer class="dialog-foot"></footer>' : '') + '</div>';
  wrap.querySelector('.dialog-title').textContent = opts.title || '';
  if (opts.subtitle) wrap.querySelector('.dialog-sub').textContent = opts.subtitle;
  const layer = { el: wrap, dismissible: opts.dismissible };
  let closed = false;
  function close(result) {
    if (closed) return; closed = true;
    wrap.classList.remove('in');
    const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1);
    setTimeout(() => wrap.remove(), 180);
    if (opts.onClose) opts.onClose(result);
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* */ }
  }
  layer.close = close;
  const foot = wrap.querySelector('.dialog-foot');
  (opts.actions || []).forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + (a.tone === 'primary' ? 'btn-primary' : a.tone === 'danger' ? 'btn-danger' : 'btn-ghost');
    b.innerHTML = (a.icon ? icon(a.icon) : '') + '<span></span>';
    b.querySelector('span').textContent = a.label;
    if (a.id) b.id = a.id;
    b.addEventListener('click', async () => {
      if (!a.run) return close(a.value);
      b.disabled = true;
      try {
        const r = await a.run(close, wrap);
        if (r !== false) close(a.value);
      } finally { b.disabled = false; }
    });
    foot.appendChild(b);
  });
  if (opts.dismissible !== false) {
    wrap.querySelector('.scrim').addEventListener('click', () => close());
    wrap.querySelector('.dlg-x').addEventListener('click', () => close());
  }
  document.body.appendChild(wrap);
  layers.push(layer);
  requestAnimationFrame(() => wrap.classList.add('in'));
  if (opts.onOpen) opts.onOpen(wrap, close);
  setTimeout(() => {
    if (wrap.contains(document.activeElement)) return; // déjà en train de saisir : on ne vole pas le focus
    const af = wrap.querySelector('[autofocus]') || wrap.querySelector('.dialog-body input, .dialog-body select, .dialog-body textarea') || wrap.querySelector('.dialog-foot .btn-primary') || wrap.querySelector('.dialog');
    if (af && af.focus) af.focus();
  }, 30);
  return { close, el: wrap };
}
function confirmDialog(o) {
  return new Promise(resolve => {
    dialog({
      title: o.title, subtitle: o.subtitle,
      body: '<p class="dialog-text">' + esc(o.message || '') + '</p>' + (o.extra || ''),
      actions: [
        { label: o.cancelLabel || 'Annuler', run: (close) => { resolve(false); close(); return false; } },
        { label: o.confirmLabel || 'Confirmer', tone: o.danger ? 'danger' : 'primary', icon: o.icon, run: (close) => { resolve(true); close(); return false; } },
      ],
      onClose: () => resolve(false),
    });
  });
}
/** Tiroir latéral (détail serveur, aperçu). */
function drawer(opts) {
  const prevFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'layer layer-drawer';
  wrap.innerHTML = '<div class="scrim"></div><aside class="drawer' + (opts.wide ? ' drawer-wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(opts.label || opts.title || '') + '">' +
    '<div class="drawer-content"></div></aside>';
  const content = wrap.querySelector('.drawer-content');
  const layer = { el: wrap };
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    wrap.classList.remove('in');
    const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1);
    setTimeout(() => wrap.remove(), 220);
    if (opts.onClose) opts.onClose();
    if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* */ }
  }
  layer.close = close;
  wrap.querySelector('.scrim').addEventListener('click', close);
  document.body.appendChild(wrap);
  layers.push(layer);
  requestAnimationFrame(() => wrap.classList.add('in'));
  return { el: wrap, content, close };
}
function closeAllLayers() { while (layers.length) layers[layers.length - 1].close(); }

/* ---------- petits composants HTML ---------- */
function statusPill(tone, label, title) {
  const ico = tone === 'ok' ? 'check' : tone === 'warn' ? 'alert' : tone === 'crit' ? 'x' : null;
  return '<span class="pill pill-' + tone + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' +
    (ico ? '<span class="pill-ico">' + icon(ico) + '</span>' : '<span class="pill-dot"></span>') + esc(label) + '</span>';
}
function docPill(doc, today) {
  const s = C.docStatus(doc, today);
  return statusPill(C.statusTone(doc.kind, s), C.statusLabel(doc, today));
}
/** Témoin d’état serveur 🟢 🟠 🔴 : forme + couleur + libellé. */
const SERVER_STATUS = {
  ok: { label: 'Opérationnel', tone: 'ok' },
  warn: { label: 'Attention', tone: 'warn' },
  crit: { label: 'Critique', tone: 'crit' },
  unknown: { label: 'En attente', tone: 'muted' },
};
function serverDot(status, withLabel) {
  const s = SERVER_STATUS[status] || SERVER_STATUS.unknown;
  return '<span class="sdot sdot-' + status + '" role="img" aria-label="' + s.label + '"></span>' + (withLabel ? '<span class="sdot-label">' + s.label + '</span>' : '');
}
function meter(value, opts) {
  opts = opts || {};
  if (value === null || value === undefined || isNaN(value)) return '<div class="meter meter-empty" aria-label="' + esc(opts.label || '') + ' indisponible"><span class="meter-track"></span><span class="meter-val">—</span></div>';
  const v = Math.max(0, Math.min(100, value));
  const warn = opts.warn || 85, crit = opts.crit || 95;
  const tone = v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';
  return '<div class="meter meter-' + tone + '" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(v) + '" aria-label="' + esc(opts.label || '') + '">' +
    '<span class="meter-track"><span class="meter-fill" style="width:' + v.toFixed(1) + '%"></span></span><span class="meter-val">' + Math.round(v) + ' %</span></div>';
}
function emptyState(title, text, actionHtml) {
  return '<div class="empty"><div class="empty-mark">' + icon('sparkle') + '</div><p class="empty-title">' + esc(title) + '</p>' +
    (text ? '<p class="empty-text">' + esc(text) + '</p>' : '') + (actionHtml || '') + '</div>';
}
function initials(name) {
  const p = String(name || '?').replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : (p[0] || '?')[1] || '')).toUpperCase();
}
function avatar(name, hue) {
  // monogrammes dans la gamme des bleus KingDream (bleu ciel → bleu roi), teinte stable pour un même nom
  const h = hue !== undefined ? hue : 198 + [...String(name)].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) % 36, 7);
  return '<span class="avatar" style="--h:' + h + '">' + esc(initials(name)) + '</span>';
}

/* ---- js/demo-data.js ---- */
/* ===== Données de démonstration — toutes fictives (clients, serveurs, montants) =====
   Domaines en .example et adresses IP de documentation (RFC 5737) : rien ne pointe vers du réel. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function demoCompany() {
  return {
    tradeName: 'KingDream Digital',
    legalName: 'Boris Corsiez',
    legalForm: 'Entrepreneur individuel (micro-entreprise)',
    address: '26 rue de la Liberté', zip: '04700', city: 'La Brillanne', country: 'France',
    siret: '102 486 677 00010', vatNumber: '', rcs: '',
    email: 'contact@kingdream.fr', phone: '06 27 20 55 97', website: 'kingdream.fr',
    iban: '', bic: '', bank: '',
    vatRegime: 'normal', vatOnDebits: false,
    defaultVatRate: 20, paymentTermsDays: 30, quoteValidityDays: 30, defaultPaymentMethod: 'Virement',
    latePenalty: 'En cas de retard de paiement, pénalités au taux de 3 fois le taux d’intérêt légal en vigueur.',
    recoveryFee: 'Indemnité forfaitaire pour frais de recouvrement : 40 € (art. L441-10 du Code de commerce).',
    discountTerms: 'Pas d’escompte pour paiement anticipé.',
    footerNote: '',
    prefixes: { invoice: 'F', quote: 'D', credit: 'AV' },
    docColor: '#0058d0',
    logo: null,
    emailTemplates: {
      invoice: 'Bonjour {contact},\n\nVeuillez trouver ci-joint la facture {numero} d’un montant de {montant}, à régler avant le {echeance}.\n\nMerci pour votre confiance,\n{signature}',
      quote: 'Bonjour {contact},\n\nComme convenu, voici le devis {numero} d’un montant de {montant}, valable jusqu’au {validite}.\nJe reste disponible pour en discuter.\n\nBien cordialement,\n{signature}',
      reminder: 'Bonjour {contact},\n\nSauf erreur de ma part, la facture {numero} de {montant}, échue le {echeance}, reste à régler.\nPourriez-vous me confirmer la date de règlement ?\n\nBien cordialement,\n{signature}',
      credit: 'Bonjour {contact},\n\nVeuillez trouver ci-joint l’avoir {numero} d’un montant de {montant}.\n\nBien cordialement,\n{signature}',
    },
    signature: 'Boris — KingDream Digital\n06 27 20 55 97 · kingdream.fr',
    mascotName: 'Kingo', mascotEnabled: true, nightMode: true,
  };
}

function buildDemoState() {
  const R = mulberry32(20261006);
  const rr = (a, b) => a + R() * (b - a);
  const ri = (a, b) => Math.floor(rr(a, b + 1));
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const today = todayISO();
  const now = Date.now();
  const company = demoCompany();
  const fakeSiren = () => {
    // numéro volontairement INVALIDE (clé de Luhn fausse) : impossible qu’il désigne une vraie entreprise
    let s;
    do { s = String(ri(100000000, 999999999)); } while (luhnOk(s));
    return s.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  };
  const b64 = n => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(R() * 64)]; return s; };
  const fp = () => 'SHA256:' + b64(43);
  const monthStart = C.ym(today) + '-01';
  const mAgo = n => C.addMonths(monthStart, -n);

  /* ---- clients ---- */
  const clients = [
    { id: 'c_fournil', name: 'Fournil des Cigales', activity: 'Boulangerie-pâtisserie', type: 'pro', contact: 'Élodie Marchetti', email: 'contact@fournil-cigales.example', phone: '04 65 71 20 14', address: '12 rue des Artisans', zip: '04100', city: 'Manosque', since: C.addDays(mAgo(12), 19), status: 'actif', notes: 'Préfère être contactée le matin, avant 10 h.' },
    { id: 'c_durance', name: 'Durance Auto Services', activity: 'Garage automobile', type: 'pro', contact: 'Karim Benali', email: 'atelier@durance-auto.example', phone: '04 65 71 33 08', address: '4 avenue de la Gare', zip: '04700', city: 'Oraison', since: C.addDays(mAgo(11), 9), status: 'actif', notes: 'Paiements souvent en retard : relancer tôt.' },
    { id: 'c_adret', name: 'Camping L’Adret des Pins', activity: 'Camping 3 étoiles', type: 'pro', contact: 'Sandrine Aubert', email: 'reservation@adret-des-pins.example', phone: '04 65 71 47 92', address: 'Chemin des Pins', zip: '04180', city: 'Villeneuve', since: C.addDays(mAgo(12), 2), status: 'actif', notes: 'Pic de trafic juin–août : surveiller l’API de réservation.' },
    { id: 'c_sauvan', name: 'Domaine Mas Sauvan', activity: 'Domaine viticole', type: 'pro', contact: 'Thomas Giraud', email: 'boutique@mas-sauvan.example', phone: '04 65 71 52 61', address: 'Route de Manosque', zip: '04860', city: 'Pierrevert', since: C.addDays(mAgo(11), 1), status: 'actif', notes: 'Boutique en ligne : pas de maintenance le samedi.' },
    { id: 'c_quinze', name: 'Bistrot Le Quinze', activity: 'Restaurant', type: 'pro', contact: 'Nadia Ferhat', email: 'bonjour@bistrot-le-quinze.example', phone: '04 65 71 15 15', address: '15 place de la République', zip: '04190', city: 'Les Mées', since: C.addDays(mAgo(8), 3), status: 'actif', notes: '' },
    { id: 'c_clim', name: 'Provence Clim Énergie', activity: 'Chauffage et climatisation', type: 'pro', contact: 'Julien Roux', email: 'direction@provence-clim.example', phone: '04 65 71 68 40', address: '2 zone d’activités des Lauzières', zip: '04310', city: 'Peyruis', since: C.addDays(mAgo(7), 6), status: 'actif', notes: 'Application de planning utilisée par 14 techniciens.' },
    { id: 'c_kine', name: 'Cabinet Kiné du Plateau', activity: 'Masseurs-kinésithérapeutes', type: 'pro', contact: 'Mathilde Garnier', email: 'cabinet@kine-plateau.example', phone: '04 65 71 72 26', address: '8 boulevard des Martyrs', zip: '04300', city: 'Forcalquier', since: C.addDays(mAgo(5), 12), status: 'actif', notes: 'Site sur hébergement mutualisé (pas de serveur dédié).' },
    { id: 'c_ocre', name: 'Atelier Ocre & Bois', activity: 'Menuiserie artisanale', type: 'pro', contact: 'Paul Esposito', email: 'paul@ocre-et-bois.example', phone: '06 39 98 41 07', address: '31 rue Droite', zip: '04200', city: 'Sisteron', since: C.addDays(today, -21), status: 'prospect', notes: 'Rencontré au salon des artisans. Veut des cartes NFC en bois.' },
    { id: 'c_kd', name: 'KingDream Digital', activity: 'Infrastructure interne', type: 'interne', internal: true, contact: 'Boris', email: 'contact@kingdream.fr', phone: '', address: '26 rue de la Liberté', zip: '04700', city: 'La Brillanne', since: mAgo(13), status: 'actif', notes: 'Serveurs de l’agence : cockpit et préproduction.' },
  ];
  clients.forEach(c => { c.country = 'France'; c.siren = c.type === 'pro' ? fakeSiren() : ''; c.vatNumber = ''; c.createdAt = c.since + 'T09:00:00.000Z'; });

  /* ---- abonnements (services souscrits) ---- */
  const S = (id, clientId, label, category, priceHT, period, startDate, extra) => Object.assign({
    id, clientId, label, category, priceHT, vatRate: 20, period, startDate,
    renewalDate: (() => { let r = startDate; while (C.diffDays(r, today) <= 0) r = C.addMonths(r, 12); return r; })(),
    status: 'actif',
  }, extra || {});
  const subscriptions = [
    S('s1', 'c_fournil', 'Hébergement et maintenance Essentiel', 'Hébergement', 39, 'mensuel', mAgo(11)),
    S('s2', 'c_fournil', 'Nom de domaine .fr et certificat SSL', 'Domaine', 24, 'annuel', C.addDays(today, 14 - 365)),
    S('s3', 'c_durance', 'Hébergement Pro', 'Hébergement', 59, 'mensuel', mAgo(10)),
    S('s4', 'c_durance', 'Référencement local', 'SEO', 90, 'mensuel', mAgo(8)),
    S('s5', 'c_adret', 'Hébergement Premium', 'Hébergement', 89, 'mensuel', mAgo(11)),
    S('s6', 'c_adret', 'Maintenance et sauvegardes', 'Maintenance', 49, 'mensuel', mAgo(11)),
    S('s7', 'c_sauvan', 'Hébergement boutique en ligne', 'Hébergement', 129, 'mensuel', mAgo(9)),
    S('s8', 'c_sauvan', 'Maintenance et sauvegardes', 'Maintenance', 49, 'mensuel', mAgo(9)),
    S('s9', 'c_quinze', 'Hébergement Essentiel', 'Hébergement', 29, 'mensuel', mAgo(7)),
    S('s10', 'c_clim', 'Hébergement application', 'Hébergement', 79, 'mensuel', mAgo(5)),
    S('s11', 'c_clim', 'Maintenance applicative', 'Maintenance', 59, 'mensuel', mAgo(5)),
    S('s12', 'c_kine', 'Maintenance site vitrine', 'Maintenance', 25, 'mensuel', mAgo(3)),
    S('s13', 'c_durance', 'Nom de domaine .fr et certificat SSL', 'Domaine', 24, 'annuel', C.addDays(today, 39 - 365)),
  ];

  /* ---- serveurs ---- */
  const SV = (id, clientId, name, host, ip, provider, location, os, role, cores, ramGB, diskGB, base, extra) => Object.assign({
    id, clientId, name, host, ip, port: 22, sshUser: 'kdc', provider, location, os, role, cores,
    ramTotal: ramGB * 1073741824, diskTotal: diskGB * 1073741824,
    sites: role === 'web' || role === 'boutique' || role === 'api' || role === 'application' ? [{ id: 'main', name: host.replace(/^[a-z0-9-]+\./, ''), url: 'https://' + host.replace(/^[a-z0-9-]+\./, 'www.') + '/', clientId }] : [],
    keyFingerprint: fp(), hostFingerprint: fp(),
    publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' + b64(43) + ' kingdream-control@' + id,
    keyCreatedAt: C.addDays(clientsById(clientId).since, 2) + 'T10:00:00.000Z',
    base, createdAt: C.addDays(clientsById(clientId).since, 2) + 'T10:00:00.000Z',
  }, extra || {});
  function clientsById(id) { return clients.find(c => c.id === id); }
  const servers = [
    SV('srv_fournil_web', 'c_fournil', 'web-01', 'web-01.fournil-cigales.example', '203.0.113.12', 'OVHcloud VPS', 'Gravelines', 'Debian 12', 'web', 2, 4, 80, { cpu: 18, ram: 46, disk: 41, rx: 180e3, tx: 420e3, users: 9 }),
    SV('srv_durance_web', 'c_durance', 'web-01', 'web-01.durance-auto.example', '203.0.113.27', 'Hetzner Cloud', 'Falkenstein', 'Ubuntu 24.04 LTS', 'web', 2, 4, 80, { cpu: 24, ram: 58, disk: 52, rx: 240e3, tx: 610e3, users: 14 }),
    SV('srv_durance_db', 'c_durance', 'db-01', 'db-01.durance-auto.example', '203.0.113.28', 'Hetzner Cloud', 'Falkenstein', 'Ubuntu 24.04 LTS', 'base de données', 2, 8, 80, { cpu: 21, ram: 71, disk: 87.4, rx: 95e3, tx: 60e3, users: 0 }),
    SV('srv_adret_web', 'c_adret', 'web-01', 'web-01.adret-des-pins.example', '198.51.100.40', 'OVHcloud VPS', 'Strasbourg', 'Debian 12', 'web', 4, 8, 160, { cpu: 31, ram: 52, disk: 38, rx: 520e3, tx: 1.9e6, users: 37 }),
    SV('srv_adret_api', 'c_adret', 'api-resa', 'api-resa.adret-des-pins.example', '198.51.100.41', 'OVHcloud VPS', 'Strasbourg', 'Debian 12', 'api', 4, 8, 80, { cpu: 90, ram: 76, disk: 44, rx: 880e3, tx: 1.2e6, users: 22 }),
    SV('srv_adret_backup', 'c_adret', 'backup-01', 'backup-01.adret-des-pins.example', '198.51.100.42', 'Scaleway', 'Paris', 'Debian 12', 'sauvegarde', 2, 2, 500, { cpu: 6, ram: 31, disk: 63, rx: 40e3, tx: 12e3, users: 0 }),
    SV('srv_sauvan_shop', 'c_sauvan', 'shop-01', 'shop-01.mas-sauvan.example', '198.51.100.23', 'Infomaniak', 'Genève', 'Ubuntu 24.04 LTS', 'boutique', 4, 8, 160, { cpu: 29, ram: 64, disk: 47, rx: 410e3, tx: 1.4e6, users: 26 }),
    SV('srv_sauvan_db', 'c_sauvan', 'db-01', 'db-01.mas-sauvan.example', '198.51.100.24', 'Infomaniak', 'Genève', 'Ubuntu 24.04 LTS', 'base de données', 2, 8, 120, { cpu: 0, ram: 0, disk: 58, rx: 0, tx: 0, users: 0 }, { down: true }),
    SV('srv_quinze_web', 'c_quinze', 'web-01', 'web-01.bistrot-le-quinze.example', '203.0.113.64', 'OVHcloud VPS', 'Gravelines', 'Debian 12', 'web', 2, 4, 40, { cpu: 14, ram: 49, disk: 36, rx: 70e3, tx: 160e3, users: 4 }),
    SV('srv_clim_app', 'c_clim', 'app-01', 'app-01.provence-clim.example', '192.0.2.81', 'Scaleway', 'Paris', 'Debian 12', 'application', 2, 4, 80, { cpu: 22, ram: 61, disk: 33, rx: 150e3, tx: 260e3, users: 11 }),
    SV('srv_kd_control', 'c_kd', 'control-01', 'control.kingdream.example', '192.0.2.10', 'Hetzner Cloud', 'Nuremberg', 'Debian 12', 'cockpit', 2, 4, 40, { cpu: 9, ram: 38, disk: 29, rx: 60e3, tx: 90e3, users: 1 }),
    SV('srv_kd_staging', 'c_kd', 'staging-01', 'staging.kingdream.example', '192.0.2.11', 'Hetzner Cloud', 'Nuremberg', 'Debian 12', 'préproduction', 2, 4, 80, { cpu: 7, ram: 41, disk: 52, rx: 30e3, tx: 40e3, users: 0 }),
  ];
  // serveur partagé : le VPS du Bistrot héberge aussi deux sites de l'agence
  // chaque site a son dossier : le stockage, le CPU et la RAM sont répartis par propriétaire
  const quinze = servers.find(s => s.id === 'srv_quinze_web');
  quinze.sites[0].path = '/var/www/bistrot';
  quinze.sites.push(
    { id: 'q_resa', name: 'app-resa', path: '/var/www/bistrot/app-resa', user: 'resa', clientId: 'c_quinze' },
    { id: 'kd_vitrine', name: 'vitrine.kingdream.example', url: 'https://vitrine.kingdream.example/', path: '/var/www/kingdream/vitrine', clientId: 'c_kd' },
    { id: 'kd_nfc', name: 'cartes-nfc.kingdream.example', url: 'https://cartes-nfc.kingdream.example/', path: '/var/www/kingdream/cartes-nfc', clientId: 'c_kd' });
  quinze.base.disk = 88.6;
  // état + historique (60 mesures)
  servers.forEach(s => {
    const b = s.base;
    const hist = { cpu: [], ram: [], rx: [], tx: [] };
    let cpu = b.cpu, ram = b.ram, rx = b.rx, tx = b.tx;
    for (let i = 0; i < 60; i++) {
      if (s.down) { hist.cpu.push(null); hist.ram.push(null); hist.rx.push(null); hist.tx.push(null); continue; }
      cpu = Math.max(1, Math.min(99, cpu + (R() - 0.5) * 8 + (b.cpu - cpu) * 0.15));
      ram = Math.max(5, Math.min(98, ram + (R() - 0.5) * 2 + (b.ram - ram) * 0.2));
      rx = Math.max(1000, rx * (0.8 + R() * 0.4) + (b.rx - rx) * 0.2);
      tx = Math.max(1000, tx * (0.8 + R() * 0.4) + (b.tx - tx) * 0.2);
      hist.cpu.push(+cpu.toFixed(1)); hist.ram.push(+ram.toFixed(1)); hist.rx.push(Math.round(rx)); hist.tx.push(Math.round(tx));
    }
    if (s.id === 'srv_adret_api') { for (let i = 50; i < 60; i++) hist.cpu[i] = +(88 + R() * 7).toFixed(1); }
    s.history = hist;
    s.metrics = s.down ? {
      cpu: null, ram: null, disk: b.disk, rx: null, tx: null, users: null, ssh: null, load: null,
      uptime: null, lastSeen: new Date(now - 7 * 60000 - 20000).toISOString(), reachable: false, sites: Object.fromEntries(s.sites.map(x => [x.id, { status: 0, ms: 10000, error: 'délai dépassé' }])),
    } : {
      cpu: hist.cpu[59], ram: hist.ram[59], disk: b.disk, rx: hist.rx[59], tx: hist.tx[59], users: b.users, ssh: s.id === 'srv_kd_control' ? 1 : 0,
      load: +(b.cpu / 100 * s.cores * 1.1).toFixed(2), uptime: ri(4, 160) * 86400 + ri(0, 80000),
      lastSeen: new Date(now - ri(5, 50) * 1000).toISOString(), reachable: true, sites: Object.fromEntries(s.sites.map(x => [x.id, { status: 200, ms: ri(90, 320) }])),
    };
    delete s.base; s._base = b;
    if (s.id === 'srv_quinze_web') {
      const G = 1e9;
      s.metrics.sizes = { main: { path: '/var/www/bistrot', bytes: 21.4 * G }, q_resa: { path: '/var/www/bistrot/app-resa', bytes: 13.8 * G }, kd_vitrine: { path: '/var/www/kingdream/vitrine', bytes: 1.9 * G }, kd_nfc: { path: '/var/www/kingdream/cartes-nfc', bytes: 0.7 * G } };
      s.metrics.sizesAt = now - 4 * 60000;
      s.metrics.usage = { bySite: { main: { cpu: 3.1, ram: 310e6, procs: 6 }, q_resa: { cpu: 7.4, ram: 690e6, procs: 3 }, kd_vitrine: { cpu: 0.6, ram: 70e6, procs: 2 }, kd_nfc: { cpu: 0.4, ram: 55e6, procs: 2 } }, other: { cpu: 2.5, ram: 380e6, procs: 74 } };
    }
  });

  /* ---- alertes ---- */
  const minsAgo = m => new Date(now - m * 60000).toISOString();
  const alerts = [
    { id: 'al_1', serverId: 'srv_sauvan_db', clientId: 'c_sauvan', level: 'crit', code: 'unreachable', title: 'Serveur injoignable', message: 'Aucune réponse SSH (port 22) depuis 7 min. La boutique shop-01 ne peut plus lire les commandes.', openedAt: minsAgo(7), resolvedAt: null, ackAt: null },
    { id: 'al_2', serverId: 'srv_adret_api', clientId: 'c_adret', level: 'warn', code: 'cpu', title: 'Processeur saturé', message: 'CPU au-dessus de 85 % depuis 6 min (php-fpm atteint pm.max_children).', openedAt: minsAgo(6), resolvedAt: null, ackAt: null },
    { id: 'al_3', serverId: 'srv_durance_db', clientId: 'c_durance', level: 'warn', code: 'disk', title: 'Disque presque plein', message: 'Partition / remplie à 87 % (seuil d’alerte 85 %). Environ 10 Go libres.', openedAt: minsAgo(60 * 26), resolvedAt: null, ackAt: null },
    { id: 'al_4', serverId: 'srv_fournil_web', clientId: 'c_fournil', level: 'warn', code: 'http:main', title: 'Site lent', message: 'Temps de réponse HTTP > 2 s pendant 4 min.', openedAt: minsAgo(60 * 30), resolvedAt: minsAgo(60 * 30 - 4), ackAt: null },
    { id: 'al_6', serverId: 'srv_quinze_web', clientId: 'c_quinze', level: 'warn', code: 'disk', title: 'Disque presque plein', message: 'Partition / remplie à 89 % (seuil d’alerte 85 %). Environ 4,6 Go libres.', openedAt: minsAgo(52), resolvedAt: null, ackAt: null },
    { id: 'al_5', serverId: 'srv_kd_control', clientId: 'c_kd', level: 'info', code: 'ssh', title: 'Tentatives SSH bloquées', message: '6 tentatives refusées depuis 203.0.113.77, adresse bannie 24 h.', openedAt: minsAgo(60 * 4 + 12), resolvedAt: minsAgo(60 * 4 + 11), ackAt: null },
  ];

  /* ---- catalogue ---- */
  const K = (id, name, unit, price, category, description) => ({ id, name, unit, unitPrice: price, vatRate: 20, category, description: description || '' });
  const catalog = [
    K('k1', 'Site vitrine', 'forfait', 1290, 'Création', 'Jusqu’à 6 pages, design sur mesure, responsive, formulaire de contact'),
    K('k2', 'Boutique en ligne', 'forfait', 4900, 'Création', 'Catalogue, paiement en ligne, gestion des commandes'),
    K('k3', 'Développement application web ou mobile', 'jour', 450, 'Création', ''),
    K('k4', 'Audit SEO et technique', 'forfait', 450, 'Audit', 'Rapport détaillé et plan d’action priorisé'),
    K('k5', 'Référencement local', 'mois', 90, 'SEO', 'Fiche établissement, contenus locaux, suivi de positions'),
    K('k6', 'Hébergement et maintenance Essentiel', 'mois', 39, 'Hébergement', ''),
    K('k7', 'Hébergement Pro', 'mois', 59, 'Hébergement', ''),
    K('k8', 'Hébergement Premium', 'mois', 89, 'Hébergement', 'Serveur dédié au client, supervision 24/7'),
    K('k9', 'Maintenance et sauvegardes', 'mois', 49, 'Maintenance', 'Mises à jour, sauvegardes quotidiennes, restauration'),
    K('k10', 'Automatisation de tâches', 'jour', 400, 'Création', ''),
    K('k11', 'Tableau de bord sur mesure', 'forfait', 1900, 'Création', ''),
    K('k12', 'Carte de visite NFC — PVC', 'u', 25, 'NFC', 'Personnalisée recto-verso, puce NTAG215'),
    K('k13', 'Carte de visite NFC — bois', 'u', 35, 'NFC', 'Gravure laser'),
    K('k14', 'Carte de visite NFC — métal', 'u', 59, 'NFC', ''),
    K('k15', 'Plaque NFC avis Google', 'u', 49, 'NFC', 'Plaque de comptoir, lien direct vers les avis'),
    K('k16', 'Nom de domaine .fr et certificat SSL', 'an', 24, 'Domaine', ''),
    K('k17', 'Mise en place de la facturation électronique', 'forfait', 350, 'Conseil', 'Choix de la plateforme agréée, paramétrage, formation'),
  ];

  /* ---- documents ---- */
  const docs = [];
  const L = (description, qty, unit, unitPrice, details, vat) => ({ id: C.uid('l'), description, details: details || '', qty, unit, unitPrice, vatRate: vat === undefined ? 20 : vat, discount: 0 });
  function mk(kind, clientId, issueDate, lines, extra) {
    const d = C.blankDocument(kind, company, issueDate, clientId);
    d.lines = lines;
    d.createdAt = issueDate + 'T08:' + C.pad(ri(0, 59)) + ':00.000Z';
    d.updatedAt = d.createdAt;
    Object.assign(d, extra || {});
    docs.push(d);
    return d;
  }
  function pay(d, date, amountCents, method) {
    d.payments.push({ id: C.uid('p'), date, amount: amountCents / 100, method: method || 'Virement', note: '' });
  }
  function settle(d, date, method) {
    const t = C.computeTotals(d, company);
    pay(d, date, t.due, method);
    d.status = 'paid'; d.paidAt = date;
  }
  const sentAt = d => { d.sentAt = d.issueDate + 'T09:' + C.pad(ri(10, 59)) + ':00.000Z'; };

  // Devis acceptés → factures projet
  const q1 = mk('quote', 'c_fournil', C.addDays(mAgo(12), 8), [L('Site vitrine', 1, 'forfait', 1290, '6 pages, design sur mesure, formulaire de contact'), L('Séance photo produits', 1, 'forfait', 180)], { status: 'invoiced', acceptedAt: C.addDays(mAgo(12), 12) });
  const f1 = mk('invoice', 'c_fournil', C.addDays(mAgo(12), 28), C.cloneLines(q1.lines), { fromQuoteId: q1.id, serviceDate: C.addDays(mAgo(12), 27) });
  sentAt(f1); settle(f1, C.addDays(f1.issueDate, 13));

  const q2 = mk('quote', 'c_adret', C.addDays(mAgo(12), 14), [L('Refonte du site', 1, 'forfait', 2600, 'Multilingue FR / EN / DE'), L('Module de réservation en ligne', 1, 'forfait', 1300, 'Synchronisation des disponibilités, paiement d’acompte')], { status: 'invoiced', acceptedAt: C.addDays(mAgo(12), 20) });
  const f2 = mk('invoice', 'c_adret', C.addDays(mAgo(11), 24), C.cloneLines(q2.lines), { fromQuoteId: q2.id });
  sentAt(f2); pay(f2, C.addDays(f2.issueDate, 3), 140400, 'Virement'); settle(f2, C.addDays(mAgo(9), 14), 'Virement');

  const q3 = mk('quote', 'c_durance', C.addDays(mAgo(11), 9), [L('Site vitrine avec prise de rendez-vous', 1, 'forfait', 2400, 'Agenda en ligne connecté, rappels SMS')], { status: 'invoiced', acceptedAt: C.addDays(mAgo(11), 15) });
  const f3 = mk('invoice', 'c_durance', C.addDays(mAgo(10), 11), C.cloneLines(q3.lines), { fromQuoteId: q3.id });
  sentAt(f3); settle(f3, C.addDays(f3.issueDate, 34), 'Chèque');

  const f4 = mk('invoice', 'c_fournil', C.addDays(mAgo(10), 4), [L('Plaque NFC avis Google', 2, 'u', 49, 'Comptoir et vitrine')], { category: 'goods' });
  sentAt(f4); settle(f4, C.addDays(f4.issueDate, 6), 'Carte bancaire');

  const q4 = mk('quote', 'c_sauvan', C.addDays(mAgo(10), 1), [L('Boutique en ligne', 1, 'forfait', 4900, 'Catalogue de 60 vins, paiement en ligne, expédition'), L('Reprise des fiches produits', 1, 'forfait', 700)], { status: 'invoiced', acceptedAt: C.addDays(mAgo(10), 6) });
  const f5 = mk('invoice', 'c_sauvan', C.addDays(mAgo(9), 8), C.cloneLines(q4.lines), { fromQuoteId: q4.id });
  sentAt(f5); settle(f5, C.addDays(f5.issueDate, 27), 'Virement');

  const f6 = mk('invoice', 'c_quinze', C.addDays(mAgo(7), 19), [L('Site vitrine', 1, 'forfait', 990, 'Menu, réservation, galerie'), L('Menus NFC de table', 12, 'u', 15, 'Support bois gravé')], { category: 'mixed' });
  sentAt(f6); pay(f6, C.addDays(f6.issueDate, 4), 81000, 'Virement'); settle(f6, C.addDays(f6.issueDate, 33), 'Virement');

  const q5 = mk('quote', 'c_clim', C.addDays(mAgo(7), 9), [L('Application de planning des interventions', 1, 'forfait', 6800, 'Web + mobile, 14 techniciens, notifications')], { status: 'invoiced', acceptedAt: C.addDays(mAgo(7), 16) });
  const f7 = mk('invoice', 'c_clim', C.addDays(mAgo(6), 1), [L('Acompte 40 % — application de planning', 1, 'forfait', 2720)], { fromQuoteId: q5.id });
  sentAt(f7); settle(f7, C.addDays(f7.issueDate, 9), 'Virement');
  const f8 = mk('invoice', 'c_clim', C.addDays(mAgo(4), 14), [L('Solde — application de planning', 1, 'forfait', 4080, 'Livrée et recettée')], { fromQuoteId: q5.id });
  sentAt(f8); settle(f8, C.addDays(f8.issueDate, 24), 'Virement');

  const q6 = mk('quote', 'c_quinze', C.addDays(mAgo(5), 3), [L('Refonte du logo', 1, 'forfait', 390)], { status: 'refused' });
  sentAt(q6);

  const f9 = mk('invoice', 'c_kine', C.addDays(mAgo(4), 25), [L('Site vitrine', 1, 'forfait', 990), L('Carte de visite NFC — PVC', 4, 'u', 25)], { category: 'mixed' });
  sentAt(f9); settle(f9, C.addDays(f9.issueDate, 7), 'Virement');

  const f10 = mk('invoice', 'c_durance', C.addDays(mAgo(2), 19), [L('Audit SEO et technique', 1, 'forfait', 450, 'Rapport et plan d’action')]);
  f10.status = 'sent'; sentAt(f10); // en retard

  // facture émise par erreur puis annulée par avoir
  const f11 = mk('invoice', 'c_quinze', C.addDays(mAgo(3), 2), [L('Hébergement Essentiel', 1, 'mois', 29, 'Doublon de facturation')]);
  sentAt(f11); f11.status = 'cancelled'; f11.cancelledAt = C.addDays(mAgo(3), 5);
  const av1 = C.invoiceToCredit(f11, company, C.addDays(mAgo(3), 5));
  av1.status = 'sent'; av1.createdAt = av1.issueDate + 'T10:00:00.000Z'; sentAt(av1);
  docs.push(av1);

  // Devis en cours
  const q7 = mk('quote', 'c_ocre', C.addDays(today, -12), [L('Site vitrine', 1, 'forfait', 1290, 'Portfolio des réalisations, demande de devis en ligne'), L('Carte de visite NFC — bois', 3, 'u', 35, 'Gravure du logo de l’atelier'), L('Nom de domaine .fr et certificat SSL', 1, 'an', 24)], { status: 'accepted', acceptedAt: C.addDays(today, -4) });
  sentAt(q7);
  const q8 = mk('quote', 'c_sauvan', C.addDays(today, -28), [L('Programme de fidélité boutique', 1, 'forfait', 1800, 'Points, codes promo, relance panier abandonné')], { status: 'sent' });
  q8.validUntil = C.addDays(today, 2); sentAt(q8);
  const q9 = mk('quote', 'c_adret', C.addDays(today, -6), [L('Application mobile de réservation', 18, 'jour', 450), L('Publication sur les stores', 1, 'forfait', 250)], { status: 'sent' });
  sentAt(q9);
  mk('quote', 'c_clim', C.addDays(today, -1), [L('Module de devis terrain', 6, 'jour', 450, 'Signature électronique du client'), L('Formation des techniciens', 1, 'jour', 400)], { status: 'draft' });

  // Abonnements : une facture par client et par mois
  const subsByClient = {};
  subscriptions.filter(s => s.period === 'mensuel').forEach(s => { (subsByClient[s.clientId] = subsByClient[s.clientId] || []).push(s); });
  for (const cid of Object.keys(subsByClient)) {
    const subs = subsByClient[cid];
    const first = subs.reduce((m, s) => (s.startDate < m ? s.startDate : m), '9999');
    for (let i = 0; i < 13; i++) {
      const issue = C.addMonths(C.ym(first) + '-01', i);
      if (C.diffDays(issue, monthStart) > 0) break;
      const active = subs.filter(s => s.startDate <= issue);
      if (!active.length) continue;
      const inv = C.subscriptionInvoice(cid, active, company, issue);
      inv.lines.forEach(l => { l.details = 'Période : ' + C.monthLabel(C.ym(issue), true); });
      inv.createdAt = issue + 'T07:30:00.000Z';
      const age = C.diffDays(monthStart, issue); // 0 = mois courant
      if (age === 0) {
        if (cid === 'c_adret' || cid === 'c_clim') { inv.status = 'draft'; }
        else { inv.status = 'sent'; sentAt(inv); }
      } else {
        inv.status = 'sent'; sentAt(inv);
        const late = (cid === 'c_durance' && age <= 62) || (cid === 'c_quinze' && age > 0 && age <= 31);
        if (!late) settle(inv, C.addDays(issue, ri(2, 21)), cid === 'c_adret' || cid === 'c_sauvan' ? 'Prélèvement SEPA' : pick(['Virement', 'Virement', 'Prélèvement SEPA']));
      }
      docs.push(inv);
    }
  }
  // Abonnements annuels (noms de domaine)
  subscriptions.filter(s => s.period === 'annuel').forEach(s => {
    const issue = C.addMonths(s.renewalDate, -12);
    if (C.diffDays(issue, clientsById(s.clientId).since) < 0) return;
    const inv = C.subscriptionInvoice(s.clientId, [Object.assign({}, s, { renewalDate: issue })], company, issue);
    inv.createdAt = issue + 'T07:30:00.000Z'; inv.status = 'sent'; sentAt(inv);
    settle(inv, C.addDays(issue, ri(3, 12)), 'Virement');
    docs.push(inv);
  });

  // numérotation chronologique par type et par année
  for (const kind of ['invoice', 'quote', 'credit']) {
    const issued = docs.filter(d => d.kind === kind && d.status !== 'draft').sort((a, b) => (a.issueDate + a.createdAt).localeCompare(b.issueDate + b.createdAt));
    const seq = {};
    issued.forEach(d => {
      const y = C.parseISO(d.issueDate).getFullYear();
      seq[y] = (seq[y] || 0) + 1;
      d.number = C.formatNumber(C.prefixFor(kind, company), y, seq[y]);
      if (!d.dueDate && kind === 'invoice') d.dueDate = C.addDays(d.issueDate, 30);
    });
  }
  docs.forEach(d => {
    if (d.fromQuoteId) { const q = docs.find(x => x.id === d.fromQuoteId); d.fromQuoteNumber = q && q.number; }
    if (d.relatedInvoiceId) { const f = docs.find(x => x.id === d.relatedInvoiceId); d.relatedInvoiceNumber = f && f.number; d.notes = 'Avoir annulant la facture ' + (f && f.number) + ' du ' + C.fmtDate(f.issueDate) + '.'; }
    if (d.kind === 'invoice' && d.status === 'paid' && !d.paidAt) d.paidAt = d.payments.length ? d.payments[d.payments.length - 1].date : d.issueDate;
  });

  /* ---- sessions & journal ---- */
  const sessions = [
    { id: 'sess_current', device: 'Ce navigateur', ip: '198.51.100.7', createdAt: new Date(now - 42 * 60000).toISOString(), lastSeen: new Date(now).toISOString(), current: true },
    { id: 'sess_phone', device: 'Safari · iPhone', ip: '198.51.100.7', createdAt: new Date(now - 26 * 3600000).toISOString(), lastSeen: new Date(now - 3 * 3600000).toISOString(), current: false },
  ];
  const lastIssued = docs.filter(d => d.kind === 'invoice' && d.number).sort((a, b) => b.number.localeCompare(a.number));
  const lastPaid = docs.filter(d => d.kind === 'invoice' && d.status === 'paid').sort((a, b) => (b.paidAt || '').localeCompare(a.paidAt || ''))[0];
  const A = (minAgo, action, label, target, clientId, ip, extra) => ({
    id: C.uid('au'), ts: new Date(now - minAgo * 60000).toISOString(), actor: 'admin', ip: ip || '198.51.100.7',
    action, label, target: target || '', clientId: clientId || null, details: extra || null,
  });
  const audit = [
    A(60 * 72, 'auth.login', 'Connexion réussie (mot de passe + code 2FA)'),
    A(60 * 71, 'server.key_rotate', 'Rotation de la clé SSH', 'web-01 · Bistrot Le Quinze', 'c_quinze'),
    A(60 * 49, 'doc.issue', 'Facture émise', lastIssued[3] && lastIssued[3].number, lastIssued[3] && lastIssued[3].clientId),
    A(60 * 49 - 1, 'doc.send', 'Facture envoyée par email', lastIssued[3] && lastIssued[3].number, lastIssued[3] && lastIssued[3].clientId),
    A(60 * 30, 'server.console_open', 'Console ouverte', 'web-01 · Fournil des Cigales', 'c_fournil', null, { duration: '6 min' }),
    A(60 * 29 - 54, 'server.console_close', 'Console fermée (6 min)', 'web-01 · Fournil des Cigales', 'c_fournil'),
    A(60 * 26, 'alert.ack', 'Alerte prise en compte : disque presque plein', 'db-01 · Durance Auto Services', 'c_durance'),
    A(60 * 24, 'client.update', 'Fiche client modifiée (téléphone)', 'Provence Clim Énergie', 'c_clim'),
    A(60 * 22, 'payment.add', 'Paiement enregistré', lastPaid && lastPaid.number, lastPaid && lastPaid.clientId),
    A(60 * 4 + 14, 'auth.login_failed', 'Échec de connexion (mot de passe incorrect)', 'admin', null, '203.0.113.77'),
    A(60 * 4 + 13, 'auth.login_failed', 'Échec de connexion (mot de passe incorrect)', 'admin', null, '203.0.113.77'),
    A(60 * 4 + 12, 'auth.blocked', 'Adresse IP bloquée 15 min après 5 échecs', '203.0.113.77', null, '203.0.113.77'),
    A(42, 'auth.login', 'Connexion réussie (mot de passe + code 2FA)'),
    A(40, 'quote.accept', 'Devis marqué accepté', q7.number, 'c_ocre'),
    A(12, 'settings.update', 'Modèle d’email de relance modifié', 'Réglages'),
  ];

  return {
    version: 4, seededAt: today,
    company, clients, subscriptions, servers, alerts, catalog, docs, sessions, audit,
    me: { name: 'Bob', email: 'contact@kingdream.fr', role: 'Administrateur', twoFactor: true, recoveryLeft: 8, passwordChangedAt: C.addDays(today, -64) },
    backups: { last: new Date(now - 9 * 86400000).toISOString() },
  };
}

function luhnOk(digits) {
  const s = String(digits).replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = +s[s.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return s.length > 0 && sum % 10 === 0;
}

/* ---- journaux & processus simulés (servent à la console de démo et à l’onglet Logs) ---- */
function demoLogs(server) {
  const now = Date.now();
  const R = mulberry32(server.id.length * 7919 + Math.floor(now / 60000));
  const lines = [];
  const add = (minAgo, level, source, message) => lines.push({ ts: new Date(now - minAgo * 60000 - Math.floor(R() * 50000)).toISOString(), level, source, message });
  if (server.metrics && server.metrics.reachable === false) {
    add(7.2, 'crit', 'kdc-collector', 'ssh: connect to host ' + server.ip + ' port 22: Connection timed out (3 essais)');
    add(7.5, 'error', 'postgresql', 'FATAL: could not write to file "pg_wal/xlogtemp.1874": No space left on device');
    add(8.1, 'warning', 'postgresql', 'checkpoints are occurring too frequently (12 seconds apart)');
    add(11, 'warning', 'kernel', 'EXT4-fs warning (device sda1): ext4_dx_add_entry: Directory index full!');
    add(24, 'info', 'systemd', 'Started Daily apt download activities.');
    add(65, 'info', 'sshd', 'Accepted publickey for kdc from 192.0.2.10 port 51122 ssh2: ED25519');
    return lines.sort((a, b) => b.ts.localeCompare(a.ts));
  }
  add(0.3, 'info', 'kdc-collector', 'métriques collectées en ' + (180 + Math.floor(R() * 200)) + ' ms');
  if (server.id === 'srv_adret_api') {
    add(2, 'warning', 'php-fpm', '[pool www] server reached pm.max_children setting (12), consider raising it');
    add(3, 'error', 'nginx', 'upstream timed out (110: Connection timed out) while reading response header from upstream, request: "POST /api/availability HTTP/2.0"');
    add(5, 'warning', 'php-fpm', '[pool www] seems busy (you may need to increase pm.start_servers), spawning 8 children');
    add(6, 'crit', 'kernel', 'Out of memory: Killed process 23140 (php-fpm8.2) total-vm:612480kB');
  }
  if (server.id === 'srv_durance_db') {
    add(4, 'warning', 'kdc-collector', 'disque / à 87 % (seuil 85 %)');
    add(90, 'info', 'mysqld', 'InnoDB: Buffer pool(s) load completed');
    add(180, 'warning', 'mysqld', 'Aborted connection 812 to db: \'garage\' user: \'app\' (Got timeout reading communication packets)');
  }
  add(9, 'warning', 'sshd', 'Invalid user admin from 203.0.113.77 port ' + (40000 + Math.floor(R() * 9999)));
  add(9, 'info', 'fail2ban', 'Ban 203.0.113.77');
  add(14, 'info', 'sshd', 'Accepted publickey for kdc from 192.0.2.10 port ' + (50000 + Math.floor(R() * 9999)) + ' ssh2: ED25519 ' + server.keyFingerprint.slice(0, 22) + '…');
  add(31, 'info', 'nginx', 'signal process started');
  add(58, 'info', 'certbot', 'Certificate not yet due for renewal; no action taken.');
  add(122, 'info', 'systemd', 'Starting Daily apt upgrade and clean activities…');
  add(240, 'info', 'backup', 'Sauvegarde terminée : ' + (1 + R() * 3).toFixed(1).replace('.', ',') + ' Go en ' + Math.floor(120 + R() * 300) + ' s');
  add(360, 'warning', 'nginx', 'client intended to send too large body: 12582912 bytes');
  add(600, 'info', 'systemd', 'Finished Rotate log files.');
  return lines.sort((a, b) => b.ts.localeCompare(a.ts));
}
function demoProcesses(server) {
  const m = server.metrics || {};
  if (!m.reachable) return [];
  const base = server.role === 'base de données'
    ? [['mysqld', 'mysql'], ['kdc-agent', 'kdc'], ['sshd', 'root'], ['systemd-journald', 'root'], ['cron', 'root']]
    : server.role === 'sauvegarde' ? [['restic', 'backup'], ['sshd', 'root'], ['systemd', 'root'], ['cron', 'root'], ['rsync', 'backup']]
    : [['php-fpm8.2', 'www-data'], ['nginx', 'www-data'], ['node', 'app'], ['redis-server', 'redis'], ['sshd', 'root'], ['systemd', 'root']];
  const R = mulberry32(server.id.length * 31 + Math.floor(Date.now() / 5000));
  let left = m.cpu || 5;
  return base.map(([cmd, user], i) => {
    const cpu = i === base.length - 1 ? Math.max(0.1, left) : Math.max(0.1, left * (0.35 + R() * 0.3));
    left = Math.max(0.1, left - cpu);
    return { pid: 800 + Math.floor(R() * 30000), user, cpu: +cpu.toFixed(1), mem: +(R() * 9 + (i === 0 ? 6 : 0.4)).toFixed(1), cmd };
  });
}

/* ---------- assistant Kingo (démo) ---------- */
function demoSpace(s) {
  const R = mulberry32([...s.id].reduce((t, ch) => t + ch.charCodeAt(0), 0) * 97 + 7);
  const big = s.metrics && s.metrics.disk >= 80;
  return {
    journal: Math.round((big ? 2.6e9 : 0.6e9) * (0.7 + R() * 0.6)),
    apt: Math.round((big ? 0.9e9 : 0.2e9) * (0.6 + R() * 0.8)),
    oldlogs: Math.round((big ? 3.1e9 : 0.3e9) * (0.6 + R() * 0.8)),
    tmp: Math.round(0.15e9 * (0.5 + R())),
    docker: s.role === 'api' || s.role === 'application' || big ? Math.round((big ? 4.2e9 : 1.1e9) * (0.6 + R() * 0.8)) : undefined,
  };
}
function demoDiagnosis(s, topic) {
  const m = s.metrics || {};
  const services = ['cron.service', 'ssh.service', 'systemd-journald.service', 'fail2ban.service']
    .concat(s.role === 'base de données' ? ['mariadb.service'] : s.role === 'sauvegarde' ? ['restic-backup.service'] : ['nginx.service', 'php8.2-fpm.service', 'redis-server.service'])
    .concat(C.serverSites(s).filter(x => x.path && /app|api|resa/.test(x.path)).map(x => 'node-' + x.path.split('/').pop() + '.service'));
  if (topic === 'unreachable' || m.reachable === false) {
    return { topic: 'unreachable', host: s.ip, dns: s.ip, ports: [{ port: s.port || 22, open: false, error: 'délai dépassé' }, { port: 80, open: false, error: 'délai dépassé' }, { port: 443, open: false, error: 'délai dépassé' }], actions: [], sshError: m.reachable === false ? 'Le serveur ne répond pas (délai dépassé).' : undefined };
  }
  const helper = 'ok';
  const total = s.diskTotal, used = total * (m.disk || 0) / 100;
  const res = { topic, helper, disk: { total, used, avail: total - used, pct: m.disk }, services, failed: [], installCommand: '(démo)' };
  if (topic === 'disk') {
    const sp = s._space || (s._space = demoSpace(s));
    res.space = Object.assign({}, sp);
    const tops = [];
    const b = C.serverBreakdown(s);
    b.rows.forEach(r => { if (r.totalBytes) tops.push({ path: r.site.path, bytes: r.totalBytes }); });
    const rest = Math.max(0, used - tops.filter(t => !b.rows.find(r => r.site.path === t.path && r.parent)).reduce((t, x) => t + x.bytes, 0));
    tops.push({ path: '/var/log', bytes: sp.journal + sp.oldlogs + 0.2e9 }, { path: '/var/lib/' + (s.role === 'base de données' ? 'mysql' : sp.docker ? 'docker' : 'php'), bytes: Math.max(0.3e9, rest * 0.45) }, { path: '/usr', bytes: 2.4e9 }, { path: '/var/cache/apt', bytes: sp.apt + 0.05e9 });
    res.top = tops.sort((a, b2) => b2.bytes - a.bytes).slice(0, 10);
    res.actions = [['clean-journal', 'journal', 'Réduire le journal système aux 14 derniers jours'], ['clean-apt', 'apt', 'Vider le cache des paquets téléchargés (apt)'], ['clean-logs', 'oldlogs', 'Supprimer les anciens journaux archivés (plus de 14 jours)'], ['clean-tmp', 'tmp', 'Supprimer les fichiers temporaires inutilisés depuis 7 jours'], ['docker-prune', 'docker', 'Supprimer les images et conteneurs Docker inutilisés depuis 7 jours']]
      .filter(a => sp[a[1]] !== undefined && sp[a[1]] > 5e6).map(a => ({ id: a[0], label: a[2], gain: a[0] === 'clean-journal' ? Math.round(sp.journal * 0.82) : sp[a[1]], available: true }));
  } else {
    const usage = (m.usage && m.usage.bySite) || {};
    const procs = demoProcesses(s).map((p, i) => ({ pid: p.pid, user: p.user, cpu: p.cpu, ram: Math.round(p.mem / 100 * s.ramTotal), cmd: p.cmd, siteId: null }));
    C.serverSites(s).filter(x => x.path && usage[x.id] && usage[x.id].cpu > 0.5).forEach(x => procs.push({ pid: 4100 + x.id.length * 13, user: x.user || 'www-data', cpu: usage[x.id].cpu, ram: usage[x.id].ram, cmd: (/app|api|resa/.test(x.path) ? 'node ' + x.path + '/server.js' : 'php-fpm: pool ' + (x.user || x.name)), siteId: x.id }));
    res.procsCpu = procs.slice().sort((a, b2) => b2.cpu - a.cpu).slice(0, 8);
    res.procsRam = procs.slice().sort((a, b2) => b2.ram - a.ram).slice(0, 8);
    if (topic === 'site') res.weblog = ['== /var/log/nginx/error.log', '2026/10/06 18:41:07 [error] 912#912: *4182 upstream timed out (110: Connection timed out) while reading response header from upstream, client: 203.0.113.90, server: ' + s.host, '2026/10/06 18:41:12 [error] 912#912: *4190 connect() to unix:/run/php/php8.2-fpm.sock failed (11: Resource temporarily unavailable)'];
    res.actions = services.filter(x => /^(nginx|php|mariadb|mysql|redis|node-)/.test(x)).map(u => ({ id: 'restart', arg: u, label: 'Redémarrer ' + u.replace(/\.service$/, ''), available: true }));
  }
  return res;
}

/* ---- js/store.js ---- */
/* ===== État de l’application + actions (démo locale ou API sécurisée) ===== */
const API = {
  csrf: null,
  async req(method, url, body, retried) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['X-KDC-CSRF'] = API.csrf || '';
    let res;
    try {
      res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      throw Object.assign(new Error('Serveur injoignable. Vérifie ta connexion.'), { code: 'network' });
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* réponse vide */ }
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      if (window.App) App.sessionExpired();
      throw Object.assign(new Error('Session expirée.'), { code: 'unauthenticated' });
    }
    if (res.status === 403 && data && data.error === 'step_up_required' && !retried) {
      const ok = await StepUp.prompt(data.message);
      if (!ok) throw Object.assign(new Error('Action annulée.'), { code: 'cancelled' });
      return API.req(method, url, body, true);
    }
    if (!res.ok) throw Object.assign(new Error((data && data.message) || ('Erreur ' + res.status)), { status: res.status, code: data && data.error, data });
    return data;
  },
  get: u => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b || {}),
  put: (u, b) => API.req('PUT', u, b || {}),
  del: u => API.req('DELETE', u),
};

async function sha256hex(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}
function auditPayload(e) { return [e.ts, e.actor, e.ip, e.action, e.label, e.target || '', e.clientId || ''].join('|'); }

const Store = {
  state: null,
  today: todayISO(),
  _ls: new Set(),
  on(fn) { this._ls.add(fn); return () => this._ls.delete(fn); },
  emit(type, payload) { for (const fn of this._ls) { try { fn(type, payload); } catch (e) { console.error(e); } } },
  changed(what, payload) {
    if (!LIVE) this.persist();
    this.emit('change', Object.assign({ what }, payload || {}));
  },

  /* ---------- initialisation ---------- */
  async init(boot) {
    if (LIVE) {
      this.state = boot;
      this.state.sessions = this.state.sessions || [];
      return;
    }
    let s = store_local.get('kdc-demo-v4', null);
    if (!s || s.version !== 4 || Math.abs(C.diffDays(this.today, s.seededAt || '2000-01-01')) > 6) s = null;
    if (!s) {
      s = buildDemoState();
      let prev = '';
      for (const e of s.audit) { e.prevHash = prev; e.hash = await sha256hex(prev + '|' + auditPayload(e)); prev = e.hash; }
    } else {
      const now = Date.now();
      s.servers.forEach(sv => { if (sv.metrics && sv.metrics.reachable) sv.metrics.lastSeen = new Date(now - 8000).toISOString(); });
    }
    this.state = s;
    this.persist();
  },
  persist: debounce(function () { if (!LIVE && Store.state) store_local.set('kdc-demo-v4', Store.state); }, 400),
  resetDemo() { store_local.del('kdc-demo-v4'); location.reload(); },

  /* ---------- sélecteurs ---------- */
  get company() { return this.state.company; },
  client(id) { return this.state.clients.find(c => c.id === id) || null; },
  clientName(id) { const c = this.client(id); return c ? c.name : 'Client supprimé'; },
  realClients() { return this.state.clients.filter(c => !c.internal); },
  server(id) { return this.state.servers.find(s => s.id === id) || null; },
  serversFor(cid) { return this.state.servers.filter(s => s.clientId === cid); },
  /** Serveurs d'autres propriétaires où ce client a au moins un site. */
  hostedFor(cid) { return this.state.servers.filter(s => s.clientId !== cid && C.serverSites(s).some(x => x.clientId === cid)); },
  sitesOf(s, cid) { return C.serverSites(s).filter(x => !cid || x.clientId === cid); },
  siteState(s, site) { return C.siteState(s.metrics, site); },
  /** État vu depuis un client : uniquement ses sites sur un serveur partagé (plus la disponibilité du serveur). */
  hostedStatus(s, cid) {
    const m = s.metrics;
    if (!m || !m.lastSeen) return 'unknown';
    if (m.reachable === false) return 'crit';
    const st = this.sitesOf(s, cid).map(x => this.siteState(s, x).state).filter(x => x !== 'none');
    return st.includes('crit') ? 'crit' : st.includes('warn') ? 'warn' : st.length && st.every(x => x === 'unknown') ? 'unknown' : 'ok';
  },
  internalClient() { return this.state.clients.find(c => c.internal) || null; },
  /** Fiche « KingDream Digital (interne) » qui porte tes propres serveurs et sites ; créée au besoin. */
  async ensureInternalClient() {
    const have = this.internalClient(); if (have) return have;
    const co = this.company || {};
    return this.saveClient({ id: C.uid('c'), name: co.tradeName || 'Mon entreprise', activity: 'Infrastructure interne', type: 'interne', internal: true, contact: co.legalName || '', email: co.email || '', phone: co.phone || '', address: co.address || '', zip: co.zip || '', city: co.city || '', country: 'France', siren: '', vatNumber: '', status: 'actif', since: this.today, notes: 'Tes propres serveurs et sites.' });
  },
  subsFor(cid) { return this.state.subscriptions.filter(s => s.clientId === cid); },
  doc(id) { return this.state.docs.find(d => d.id === id) || null; },
  docsFor(cid) { return this.state.docs.filter(d => d.clientId === cid); },
  totals(doc) { return C.computeTotals(doc, this.company); },
  status(doc) { return C.docStatus(doc, this.today); },
  openAlerts() {
    const rank = { crit: 0, warn: 1, info: 2 };
    return this.state.alerts.filter(a => !a.resolvedAt).sort((a, b) => (rank[a.level] - rank[b.level]) || b.openedAt.localeCompare(a.openedAt));
  },
  serverStatus(s) {
    if (s.status && LIVE) return s.status;
    const m = s.metrics;
    if (!m || !m.lastSeen) return 'unknown';
    if (m.reachable === false) return 'crit';
    const sites = C.serverSites(s).map(x => C.siteState(m, x).state);
    if (sites.includes('crit')) return 'crit';
    if (m.disk >= 95 || m.ram >= 97) return 'crit';
    if (m.cpu >= 85 || m.ram >= 90 || m.disk >= 85 || sites.includes('warn')) return 'warn';
    return 'ok';
  },
  worstStatus(list) {
    const order = ['crit', 'warn', 'unknown', 'ok'];
    let w = 'ok';
    for (const s of list) { const st = this.serverStatus(s); if (order.indexOf(st) < order.indexOf(w)) w = st; }
    return list.length ? w : 'none';
  },
  mrr(cid) {
    return this.state.subscriptions.filter(s => !cid || s.clientId === cid).reduce((t, s) => t + C.monthlyEquivalent(s), 0);
  },
  clientBalance(cid) {
    let invoiced = 0, paid = 0, due = 0, overdue = 0;
    for (const d of this.docsFor(cid)) {
      if (d.kind !== 'invoice' || d.status === 'draft' || d.status === 'cancelled') continue;
      const t = this.totals(d);
      invoiced += t.totalTTC; paid += t.paid; due += t.due;
      if (this.status(d) === 'overdue') overdue += t.due;
    }
    return { invoiced, paid, due, overdue };
  },
  nextRenewal(cid) {
    const subs = this.subsFor(cid).filter(s => s.status === 'actif').sort((a, b) => a.renewalDate.localeCompare(b.renewalDate));
    return subs[0] || null;
  },
  kpis() {
    const t = this.today, year = t.slice(0, 4);
    const k = { revenue: 0, revenueMonth: 0, paidCount: 0, paidAmount: 0, pendingCount: 0, pendingAmount: 0, overdueCount: 0, overdueAmount: 0, oldestOverdue: 0, drafts: 0 };
    for (const d of this.state.docs) {
      if (d.kind === 'quote') continue;
      if (d.status === 'draft') { if (d.kind === 'invoice') k.drafts++; continue; }
      const tt = this.totals(d);
      if (d.issueDate.slice(0, 4) === year) {
        k.revenue += C.sign(d) * tt.totalHT;
        if (C.ym(d.issueDate) === C.ym(t)) k.revenueMonth += C.sign(d) * tt.totalHT;
      }
      if (d.kind !== 'invoice' || d.status === 'cancelled') continue;
      const st = this.status(d);
      if (st === 'paid' && (d.paidAt || d.issueDate).slice(0, 4) === year) { k.paidCount++; k.paidAmount += tt.totalTTC; }
      if (st === 'sent') { k.pendingCount++; k.pendingAmount += tt.due; }
      if (st === 'overdue') { k.overdueCount++; k.overdueAmount += tt.due; k.oldestOverdue = Math.max(k.oldestOverdue, C.diffDays(t, d.dueDate)); }
    }
    const real = this.realClients();
    k.clients = real.filter(c => c.status === 'actif').length;
    k.prospects = real.filter(c => c.status === 'prospect').length;
    const sv = this.state.servers;
    k.servers = sv.length;
    k.serversOk = sv.filter(s => this.serverStatus(s) === 'ok').length;
    k.serversWarn = sv.filter(s => this.serverStatus(s) === 'warn').length;
    k.serversCrit = sv.filter(s => this.serverStatus(s) === 'crit').length;
    const al = this.openAlerts();
    k.alerts = al.length; k.alertsCrit = al.filter(a => a.level === 'crit').length; k.alertsWarn = al.filter(a => a.level === 'warn').length;
    k.mrr = this.mrr();
    return k;
  },
  revenue(months) { return C.monthlyRevenue(this.state.docs, this.company, this.today, months || 12); },
  renewals(days) {
    const out = [];
    for (const s of this.state.subscriptions) {
      if (s.status !== 'actif') continue;
      const d = C.diffDays(s.renewalDate, this.today);
      if (d >= 0 && d <= days) out.push(Object.assign({ inDays: d }, s));
    }
    return out.sort((a, b) => a.inDays - b.inDays);
  },

  /* ---------- journal d’audit ---------- */
  async log(action, label, target, clientId, details) {
    if (LIVE) return; // le serveur journalise lui-même chaque action
    const a = this.state.audit;
    const prev = a.length ? a[a.length - 1].hash : '';
    const e = { id: C.uid('au'), ts: new Date().toISOString(), actor: 'admin', ip: '198.51.100.7', action, label, target: target || '', clientId: clientId || null, details: details || null, prevHash: prev };
    e.hash = await sha256hex(prev + '|' + auditPayload(e));
    a.push(e);
    this.changed('audit');
  },
  async auditList() {
    if (LIVE) { const r = await API.get('/api/audit?limit=500'); return r.entries; }
    return this.state.audit.slice().reverse();
  },
  async verifyAudit() {
    if (LIVE) return API.get('/api/audit/verify');
    let prev = '', i = 0;
    for (const e of this.state.audit) {
      i++;
      if (e.prevHash !== prev) return { ok: false, count: i, brokenAt: e.id };
      const h = await sha256hex(prev + '|' + auditPayload(e));
      if (h !== e.hash) return { ok: false, count: i, brokenAt: e.id };
      prev = h;
    }
    return { ok: true, count: i, head: prev };
  },

  /* ---------- clients ---------- */
  async saveClient(c) {
    const isNew = !this.state.clients.some(x => x.id === c.id);
    if (LIVE) {
      const r = isNew ? await API.post('/api/clients', c) : await API.put('/api/clients/' + encodeURIComponent(c.id), c);
      upsert(this.state.clients, r.client);
      this.changed('clients'); return r.client;
    }
    c.updatedAt = new Date().toISOString();
    if (isNew) c.createdAt = c.updatedAt;
    upsert(this.state.clients, c);
    this.log(isNew ? 'client.create' : 'client.update', isNew ? 'Client créé' : 'Fiche client modifiée', c.name, c.id);
    this.changed('clients');
    return c;
  },
  async deleteClient(id) {
    const c = this.client(id);
    if (LIVE) { const r = await API.del('/api/clients/' + encodeURIComponent(id)); if (r.archived) { upsert(this.state.clients, r.client); } else { remove(this.state.clients, id); } this.changed('clients'); return r; }
    const hasIssued = this.docsFor(id).some(d => d.status !== 'draft');
    if (hasIssued) {
      c.status = 'archivé';
      this.log('client.archive', 'Client archivé (documents émis conservés)', c.name, id);
      this.changed('clients');
      return { archived: true };
    }
    this.state.docs = this.state.docs.filter(d => d.clientId !== id);
    this.state.subscriptions = this.state.subscriptions.filter(s => s.clientId !== id);
    this.state.servers = this.state.servers.filter(s => s.clientId !== id);
    for (const s of this.state.servers) if (Array.isArray(s.sites)) s.sites = s.sites.filter(x => x.clientId !== id);
    this.state.alerts = this.state.alerts.filter(a => a.clientId !== id);
    remove(this.state.clients, id);
    this.log('client.delete', 'Client supprimé', c.name, null);
    this.changed('clients');
    return { archived: false };
  },
  async saveSub(s) {
    const isNew = !this.state.subscriptions.some(x => x.id === s.id);
    if (LIVE) { const r = isNew ? await API.post('/api/subscriptions', s) : await API.put('/api/subscriptions/' + encodeURIComponent(s.id), s); upsert(this.state.subscriptions, r.subscription); this.changed('subscriptions'); return r.subscription; }
    upsert(this.state.subscriptions, s);
    this.log(isNew ? 'subscription.create' : 'subscription.update', isNew ? 'Service ajouté' : 'Service modifié', s.label, s.clientId);
    this.changed('subscriptions');
    return s;
  },
  async deleteSub(id) {
    const s = this.state.subscriptions.find(x => x.id === id);
    if (LIVE) await API.del('/api/subscriptions/' + encodeURIComponent(id));
    remove(this.state.subscriptions, id);
    if (!LIVE) this.log('subscription.delete', 'Service supprimé', s && s.label, s && s.clientId);
    this.changed('subscriptions');
  },
  async saveCatalog(k) {
    const isNew = !this.state.catalog.some(x => x.id === k.id);
    if (LIVE) { const r = isNew ? await API.post('/api/catalog', k) : await API.put('/api/catalog/' + encodeURIComponent(k.id), k); upsert(this.state.catalog, r.item); this.changed('catalog'); return r.item; }
    upsert(this.state.catalog, k);
    this.log(isNew ? 'catalog.create' : 'catalog.update', isNew ? 'Article ajouté au catalogue' : 'Article du catalogue modifié', k.name);
    this.changed('catalog');
    return k;
  },
  async deleteCatalog(id) {
    const k = this.state.catalog.find(x => x.id === id);
    if (LIVE) await API.del('/api/catalog/' + encodeURIComponent(id));
    remove(this.state.catalog, id);
    if (!LIVE) this.log('catalog.delete', 'Article retiré du catalogue', k && k.name);
    this.changed('catalog');
  },

  /* ---------- documents ---------- */
  async saveDoc(d) {
    const isNew = !this.state.docs.some(x => x.id === d.id);
    const existing = this.doc(d.id);
    if (existing && existing.status !== 'draft') throw new Error('Ce document est émis : il ne peut plus être modifié. Crée un avoir pour le corriger.');
    if (LIVE) {
      const r = isNew ? await API.post('/api/documents', d) : await API.put('/api/documents/' + encodeURIComponent(d.id), d);
      upsert(this.state.docs, r.document); this.changed('docs'); return r.document;
    }
    d.updatedAt = new Date().toISOString();
    upsert(this.state.docs, JSON.parse(JSON.stringify(d)));
    if (isNew) this.log('doc.create', C.KIND_LABELS[d.kind] + ' créé' + (d.kind === 'invoice' ? 'e' : '') + ' (brouillon)', this.clientName(d.clientId), d.clientId);
    this.changed('docs', { id: d.id });
    return this.doc(d.id);
  },
  async deleteDoc(id) {
    const d = this.doc(id);
    if (!d) return;
    if (d.status !== 'draft') throw new Error('Seuls les brouillons peuvent être supprimés.');
    if (LIVE) await API.del('/api/documents/' + encodeURIComponent(id));
    remove(this.state.docs, id);
    if (!LIVE) this.log('doc.delete', 'Brouillon supprimé', this.clientName(d.clientId), d.clientId);
    this.changed('docs');
  },
  /** Émet le document : numéro définitif (suite continue), verrouillage, statut « envoyé ». */
  async issueDoc(id) {
    const d = this.doc(id);
    const errs = C.validateDocument(d);
    if (errs.length) throw new Error(errs[0]);
    if (LIVE) { const r = await API.post('/api/documents/' + encodeURIComponent(id) + '/issue'); upsert(this.state.docs, r.document); this.changed('docs', { id }); return r.document; }
    if (d.status !== 'draft') return d;
    // la date d’émission ne peut pas précéder celle du dernier document émis du même type
    d.number = C.nextNumber(this.state.docs, d.kind, this.company, d.issueDate);
    d.status = 'sent';
    d.issuedAt = new Date().toISOString();
    if (d.kind === 'invoice' && !d.dueDate) d.dueDate = C.addDays(d.issueDate, this.company.paymentTermsDays || 30);
    this.log('doc.issue', C.KIND_LABELS[d.kind] + ' émis' + (d.kind === 'invoice' ? 'e' : '') + ' — numéro attribué', d.number, d.clientId);
    this.changed('docs', { id });
    return d;
  },
  async sendDoc(id, mail) {
    const d = this.doc(id);
    if (d.status === 'draft') await this.issueDoc(id);
    if (LIVE) { const r = await API.post('/api/documents/' + encodeURIComponent(id) + '/send', mail); upsert(this.state.docs, r.document); this.changed('docs', { id }); return r; }
    await sleep(900);
    d.sentAt = new Date().toISOString();
    d.lastEmail = { to: mail.to, at: d.sentAt, reminder: !!mail.reminder };
    this.log(mail.reminder ? 'doc.remind' : 'doc.send', mail.reminder ? 'Relance envoyée par email' : C.KIND_LABELS[d.kind] + ' envoyé' + (d.kind === 'invoice' ? 'e' : '') + ' par email', d.number + ' → ' + mail.to, d.clientId);
    this.changed('docs', { id });
    return { ok: true, demo: true };
  },
  async setDocStatus(id, status) {
    const d = this.doc(id);
    if (LIVE) { const r = await API.post('/api/documents/' + encodeURIComponent(id) + '/status', { status }); upsert(this.state.docs, r.document); this.changed('docs', { id }); return r.document; }
    d.status = status;
    if (status === 'accepted') d.acceptedAt = this.today;
    if (status === 'refused') d.refusedAt = this.today;
    if (status === 'cancelled') d.cancelledAt = this.today;
    const labels = { accepted: 'Devis marqué accepté', refused: 'Devis marqué refusé', cancelled: 'Facture annulée', sent: 'Statut remis à « envoyé »' };
    this.log('doc.status', labels[status] || ('Statut : ' + status), d.number, d.clientId);
    this.changed('docs', { id });
    return d;
  },
  async convertQuote(id) {
    const q = this.doc(id);
    if (LIVE) { const r = await API.post('/api/documents/' + encodeURIComponent(id) + '/convert'); upsert(this.state.docs, r.quote); upsert(this.state.docs, r.invoice); this.changed('docs'); return r.invoice; }
    const inv = C.quoteToInvoice(q, this.company, this.today);
    this.state.docs.push(inv);
    q.status = 'invoiced'; q.invoiceId = inv.id;
    this.log('quote.convert', 'Devis transformé en facture (brouillon)', q.number, q.clientId);
    this.changed('docs');
    return inv;
  },
  async creditInvoice(id) {
    const inv = this.doc(id);
    if (LIVE) { const r = await API.post('/api/documents/' + encodeURIComponent(id) + '/credit'); upsert(this.state.docs, r.invoice); upsert(this.state.docs, r.credit); this.changed('docs'); return r.credit; }
    const av = C.invoiceToCredit(inv, this.company, this.today);
    this.state.docs.push(av);
    inv.status = 'cancelled'; inv.cancelledAt = this.today; inv.creditId = av.id;
    this.log('doc.credit', 'Avoir créé pour annuler la facture', inv.number, inv.clientId);
    this.changed('docs');
    return av;
  },
  async addPayment(docId, p) {
    const d = this.doc(docId);
    if (LIVE) { const r = await API.post('/api/documents/' + encodeURIComponent(docId) + '/payments', p); upsert(this.state.docs, r.document); this.changed('docs', { id: docId, payment: true, paidInFull: r.document.status === 'paid' }); return r.document; }
    d.payments.push(Object.assign({ id: C.uid('p') }, p));
    const t = this.totals(d);
    if (t.due === 0) { d.status = 'paid'; d.paidAt = p.date; }
    this.log('payment.add', 'Paiement enregistré : ' + C.fmtEUR(C.cents(p.amount)) + ' (' + p.method + ')', d.number, d.clientId);
    this.changed('docs', { id: docId, payment: true, paidInFull: t.due === 0 });
    return d;
  },
  async deletePayment(docId, pid) {
    const d = this.doc(docId);
    if (LIVE) { const r = await API.del('/api/documents/' + encodeURIComponent(docId) + '/payments/' + encodeURIComponent(pid)); upsert(this.state.docs, r.document); this.changed('docs'); return; }
    d.payments = d.payments.filter(p => p.id !== pid);
    if (d.status === 'paid') { d.status = 'sent'; d.paidAt = null; }
    this.log('payment.delete', 'Paiement supprimé', d.number, d.clientId);
    this.changed('docs');
  },
  async invoiceSubscriptions(clientId, subIds) {
    const subs = this.state.subscriptions.filter(s => s.clientId === clientId && (!subIds || subIds.includes(s.id)));
    const inv = C.subscriptionInvoice(clientId, subs, this.company, this.today);
    return this.saveDoc(inv);
  },

  /* ---------- serveurs ---------- */
  async saveServer(s) {
    const isNew = !this.state.servers.some(x => x.id === s.id);
    const dropRemovedSites = sv => {
      const keep = new Set(C.serverSites(sv).map(x => 'http:' + x.id));
      this.state.alerts.forEach(a => { if (a.serverId === sv.id && !a.resolvedAt && /^http/.test(a.code) && !keep.has(a.code)) a.resolvedAt = new Date().toISOString(); });
    };
    if (LIVE) {
      const r = isNew ? await API.post('/api/servers', s) : await API.put('/api/servers/' + encodeURIComponent(s.id), s);
      upsert(this.state.servers, r.server); dropRemovedSites(r.server); this.changed('servers'); return r.server;
    }
    if (Array.isArray(s.sites)) delete s.healthUrl;
    dropRemovedSites(s);
    if (isNew) {
      s.createdAt = new Date().toISOString();
      s.keyFingerprint = 'SHA256:' + C.uid('').slice(1) + C.uid('').slice(1) + 'q8Zk2LwPm0aT9vXy';
      s.publicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' + (C.uid('').slice(1) + C.uid('').slice(1) + C.uid('').slice(1)).slice(0, 43) + ' kingdream-control@' + s.id;
      s.keyCreatedAt = s.createdAt;
      s.hostFingerprint = null;
      s.metrics = null;
      s.history = { cpu: [], ram: [], rx: [], tx: [] };
      s._base = { cpu: 15, ram: 40, disk: 25, rx: 60e3, tx: 90e3, users: 3 };
      s._pending = true;
    }
    upsert(this.state.servers, s);
    this.log(isNew ? 'server.create' : 'server.update', isNew ? 'Serveur ajouté — paire de clés SSH générée côté serveur' : 'Serveur modifié', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
    this.changed('servers');
    return s;
  },
  async deleteServer(id) {
    const s = this.server(id);
    if (LIVE) await API.del('/api/servers/' + encodeURIComponent(id));
    remove(this.state.servers, id);
    this.state.alerts = this.state.alerts.filter(a => a.serverId !== id);
    if (!LIVE) this.log('server.delete', 'Serveur supprimé et clé détruite', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
    this.changed('servers');
  },
  async testServer(id) {
    const s = this.server(id);
    if (LIVE) { const r = await API.post('/api/servers/' + encodeURIComponent(id) + '/test'); upsert(this.state.servers, r.server); if (r.alerts) this.state.alerts = r.alerts; this.changed('servers'); return r; }
    await sleep(1600 + Math.random() * 800);
    if (s._pending) {
      s._pending = false;
      s.hostFingerprint = 'SHA256:' + (C.uid('') + C.uid('') + C.uid('')).replace(/_/g, '').slice(0, 43);
    }
    if (s.down || s._pending || !s.metrics || s.metrics.reachable === false || !s.metrics.lastSeen) {
      s.down = false;
      const b = s._base;
      s.metrics = { cpu: b.cpu || 12, ram: b.ram || 40, disk: b.disk || 30, rx: b.rx || 50e3, tx: b.tx || 60e3, users: b.users || 2, ssh: 0, load: 0.4, uptime: 95, lastSeen: new Date().toISOString(), reachable: true, sites: Object.fromEntries(C.serverSites(s).map(x => [x.id, { status: 200, ms: 210 }])) };
      if (s.id === 'srv_sauvan_db') { s.metrics.disk = 61; s.metrics.ram = 58; s.metrics.cpu = 34; }
      ['cpu', 'ram', 'rx', 'tx'].forEach(k => { s.history[k] = s.history[k].map(v => v); s.history[k].push(s.metrics[k]); if (s.history[k].length > 60) s.history[k].shift(); });
      this.state.alerts.filter(a => a.serverId === id && !a.resolvedAt && a.code === 'unreachable').forEach(a => { a.resolvedAt = new Date().toISOString(); });
      this.log('server.test', 'Test de connexion réussi — serveur de nouveau joignable', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
      this.changed('servers', { recovered: id });
      return { ok: true, recovered: true, ms: 214 };
    }
    s.metrics.lastSeen = new Date().toISOString();
    this.log('server.test', 'Test de connexion réussi', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
    this.changed('servers');
    return { ok: true, ms: 180 + Math.round(Math.random() * 120) };
  },
  async ackAlert(id) {
    const a = this.state.alerts.find(x => x.id === id);
    if (LIVE) { const r = await API.post('/api/alerts/' + encodeURIComponent(id) + '/ack'); Object.assign(a, r.alert); this.changed('alerts'); return; }
    a.ackAt = new Date().toISOString();
    const s = this.server(a.serverId);
    this.log('alert.ack', 'Alerte prise en compte : ' + a.title.toLowerCase(), s ? s.name + ' · ' + this.clientName(s.clientId) : '', a.clientId);
    this.changed('alerts');
  },
  async fetchLogs(id) {
    if (LIVE) { const r = await API.get('/api/servers/' + encodeURIComponent(id) + '/logs'); return r.lines; }
    await sleep(350);
    return demoLogs(this.server(id));
  },
  /* ---------- assistant Kingo ---------- */
  async assistDiagnose(id, topic) {
    if (LIVE) { const r = await API.post('/api/servers/' + encodeURIComponent(id) + '/assist/diagnose', { topic }); return r.diagnosis; }
    await sleep(topic === 'disk' ? 1500 : 1100);
    return demoDiagnosis(this.server(id), topic);
  },
  async assistRun(id, action, arg) {
    if (LIVE) {
      const r = await API.post('/api/servers/' + encodeURIComponent(id) + '/assist/run', { action, arg });
      upsert(this.state.servers, r.server); if (r.alerts) this.state.alerts = r.alerts;
      this.changed('servers'); return r.result;
    }
    if (!(await stepUpDemo('Kingo va agir sur le serveur.'))) throw Object.assign(new Error('Action annulée.'), { code: 'cancelled' });
    await sleep(action === 'restart' ? 1400 : 1900);
    const s = this.server(id), m = s.metrics;
    const sp = s._space || (s._space = demoSpace(s));
    const key = { 'clean-journal': 'journal', 'clean-apt': 'apt', 'clean-logs': 'oldlogs', 'clean-tmp': 'tmp', 'docker-prune': 'docker' }[action];
    const total = s.diskTotal, before = total * m.disk / 100;
    let freed = 0, output = '';
    if (key) { freed = Math.round(sp[key] * (key === 'journal' ? 0.82 : 1)); sp[key] -= freed; output = key === 'journal' ? 'Vacuuming done, freed ' + fmt.bytes(freed) + ' of archived journals.' : key === 'apt' ? 'Cache apt vidé.' : key === 'docker' ? 'Total reclaimed space: ' + fmt.bytes(freed) : Math.round(freed / 4e6) + ' fichiers supprimés.'; }
    else if (action === 'restart') { output = 'active'; if (s._base && s.id === 'srv_adret_api') { s._base.cpu = 34; m.cpu = 41; } }
    if (freed) { m.disk = Math.round(10 * Math.max(5, (before - freed) / total * 100)) / 10; if (s._base) s._base.disk = m.disk; }
    const st = this.serverStatus(s);
    this.state.alerts.filter(a => a.serverId === id && !a.resolvedAt && ((a.code === 'disk' && m.disk < 85) || (a.code === 'cpu' && m.cpu < 85))).forEach(a => { a.resolvedAt = new Date().toISOString(); });
    const label = action === 'restart' ? 'Service redémarré : ' + arg : ({ 'clean-journal': 'Réduire le journal système aux 14 derniers jours', 'clean-apt': 'Vider le cache des paquets téléchargés (apt)', 'clean-logs': 'Supprimer les anciens journaux archivés (plus de 14 jours)', 'clean-tmp': 'Supprimer les fichiers temporaires inutilisés depuis 7 jours', 'docker-prune': 'Supprimer les images et conteneurs Docker inutilisés depuis 7 jours' })[action];
    this.log('assist.run', label, s.name + ' · ' + this.clientName(s.clientId), s.clientId);
    this.changed('servers', { status: st });
    return { ok: true, rc: 0, helper: 'ok', output, freed, before: { pct: Math.round(1000 * before / total) / 10, used: before, total }, after: { pct: m.disk, used: total * m.disk / 100, total } };
  },
  async fetchProcesses(id) {
    if (LIVE) { const r = await API.get('/api/servers/' + encodeURIComponent(id) + '/processes'); return r.processes; }
    await sleep(250);
    return demoProcesses(this.server(id));
  },
  async rotateKey(id) {
    const s = this.server(id);
    if (LIVE) { const r = await API.post('/api/servers/' + encodeURIComponent(id) + '/rotate-key'); upsert(this.state.servers, r.server); this.changed('servers'); return r; }
    s.pendingPublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' + (C.uid('') + C.uid('') + C.uid('')).replace(/_/g, '').slice(0, 43) + ' kingdream-control@' + s.id;
    this.log('server.key_rotate_start', 'Nouvelle clé SSH générée (en attente d’installation)', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
    this.changed('servers');
    return { publicKey: s.pendingPublicKey };
  },
  async confirmRotation(id) {
    const s = this.server(id);
    if (LIVE) { const r = await API.post('/api/servers/' + encodeURIComponent(id) + '/rotate-key/confirm'); upsert(this.state.servers, r.server); this.changed('servers'); return r; }
    await sleep(900);
    s.publicKey = s.pendingPublicKey; s.pendingPublicKey = null;
    s.keyFingerprint = 'SHA256:' + (C.uid('') + C.uid('') + C.uid('')).replace(/_/g, '').slice(0, 43);
    s.keyCreatedAt = new Date().toISOString();
    this.log('server.key_rotate', 'Rotation de la clé SSH terminée — ancienne clé détruite', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
    this.changed('servers');
    return { ok: true };
  },
  async consoleOpened(id, minutes) {
    const s = this.server(id);
    if (!LIVE) this.log(minutes === undefined ? 'server.console_open' : 'server.console_close', minutes === undefined ? 'Console ouverte' : 'Console fermée (' + minutes + ')', s.name + ' · ' + this.clientName(s.clientId), s.clientId);
  },

  /* ---------- réglages & sécurité ---------- */
  async saveCompany(c) {
    if (LIVE) { const r = await API.put('/api/company', c); this.state.company = r.company; this.changed('company'); return r.company; }
    this.state.company = c;
    this.log('settings.update', 'Réglages de l’entreprise modifiés', 'Réglages');
    this.changed('company');
    return c;
  },
  async sessions() {
    if (LIVE) { const r = await API.get('/api/auth/sessions'); return r.sessions; }
    return this.state.sessions;
  },
  async revokeSession(id) {
    if (LIVE) { await API.del('/api/auth/sessions/' + encodeURIComponent(id)); return; }
    this.state.sessions = this.state.sessions.filter(s => s.id !== id);
    this.log('auth.session_revoke', 'Session révoquée', id === 'sess_phone' ? 'Safari · iPhone' : id);
    this.changed('sessions');
  },
  async regenRecoveryCodes() {
    if (LIVE) { const r = await API.post('/api/auth/recovery-codes'); return r.codes; }
    const codes = Array.from({ length: 10 }, () => (C.uid('') + C.uid('')).replace(/_/g, '').slice(0, 10).replace(/(.{5})/, '$1-'));
    this.state.me.recoveryLeft = 10;
    this.log('auth.recovery_regen', 'Codes de secours régénérés', 'Compte administrateur');
    this.changed('me');
    return codes;
  },
  async backupNow() {
    if (LIVE) { const r = await API.post('/api/backup'); this.state.backups = r.backups; this.changed('backups'); return r; }
    await sleep(1400);
    this.state.backups = { last: new Date().toISOString() };
    this.log('backup.create', 'Sauvegarde chiffrée créée', 'kdc-' + this.today + '.db.enc');
    this.changed('backups');
    return { ok: true };
  },
  async exportData() {
    if (LIVE) return API.get('/api/export');
    const s = JSON.parse(JSON.stringify(this.state));
    s.servers.forEach(x => { delete x.history; delete x._base; });
    return { exportedAt: new Date().toISOString(), note: 'Export de démonstration — aucune clé privée n’est jamais exportée.', company: s.company, clients: s.clients, subscriptions: s.subscriptions, documents: s.docs, catalog: s.catalog, servers: s.servers.map(x => ({ id: x.id, clientId: x.clientId, name: x.name, host: x.host, ip: x.ip, provider: x.provider, keyFingerprint: x.keyFingerprint })) };
  },
};

function upsert(arr, item) { const i = arr.findIndex(x => x.id === item.id); if (i >= 0) arr[i] = item; else arr.push(item); }
function remove(arr, id) { const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); }

/* ---------- simulateur de supervision (démo uniquement) ---------- */
const Sim = {
  timer: null,
  start() {
    if (LIVE || this.timer) return;
    this.timer = setInterval(() => this.tick(), 3000);
  },
  tick() {
    const st = Store.state; if (!st) return;
    const now = new Date().toISOString();
    for (const s of st.servers) {
      if (s.down || s._pending || !s.metrics || s.metrics.reachable === false) continue;
      const m = s.metrics, b = s._base || {};
      const drift = (v, base, amp, min, max) => Math.max(min, Math.min(max, v + (Math.random() - 0.5) * amp + (base - v) * 0.18));
      m.cpu = +drift(m.cpu, b.cpu || 15, s.id === 'srv_adret_api' ? 5 : 9, 1, 99).toFixed(1);
      m.ram = +drift(m.ram, b.ram || 40, 1.6, 5, 98).toFixed(1);
      m.rx = Math.round(Math.max(800, m.rx * (0.82 + Math.random() * 0.36) + ((b.rx || 5e4) - m.rx) * 0.2));
      m.tx = Math.round(Math.max(800, m.tx * (0.82 + Math.random() * 0.36) + ((b.tx || 6e4) - m.tx) * 0.2));
      m.users = Math.max(0, Math.round((b.users || 0) + (Math.random() - 0.5) * Math.max(2, (b.users || 0) * 0.4)));
      m.load = +((m.cpu / 100) * (s.cores || 2) * 1.05).toFixed(2);
      m.uptime = (m.uptime || 0) + 3;
      m.lastSeen = now;
      for (const x of C.serverSites(s)) {
        const r = (m.sites = m.sites || {})[x.id] || (m.sites[x.id] = { status: 200, ms: 220 });
        if (r.status === 200) r.ms = Math.round(drift(r.ms, 200, 40, 60, 900));
      }
      for (const k of ['cpu', 'ram', 'rx', 'tx']) { s.history[k].push(m[k]); if (s.history[k].length > 60) s.history[k].shift(); }
    }
    Store.emit('metrics');
  },
};

/* ---- js/charts.js ---- */
/* ===== Graphiques SVG maison (barres groupées, courbes, sparklines) ===== */
function niceScale(max, ticks) {
  ticks = ticks || 4;
  if (!(max > 0)) return { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(+v.toFixed(6));
  return { max: top, step, ticks: out };
}
function barPath(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, h, w / 2);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}
function compactEUR(c) {
  const v = c / 100;
  if (Math.abs(v) >= 1000) return (Math.round(v / 100) / 10).toString().replace('.', ',') + ' k€';
  return Math.round(v) + ' €';
}

/** Barres groupées « facturé / encaissé » par mois, avec infobulle et vue tableau.
    opts.head === false : pas d’en-tête (la carte fournit déjà la légende et le sélecteur). */
function revenueChart(host, data, opts) {
  opts = opts || {};
  const series = [
    { key: 'invoiced', label: 'Facturé HT', color: 'var(--s1)' },
    { key: 'collected', label: 'Encaissé HT', color: 'var(--s2)' },
  ];
  host.innerHTML = `
    ${opts.head === false ? '' : `<div class="chart-head">
      <div class="legend">${series.map(s => `<span class="legend-item"><span class="legend-sw" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('')}</div>
      <div class="seg seg-sm chart-toggle" role="group" aria-label="Affichage"><button type="button" data-mode="chart" aria-pressed="true">Graphique</button><button type="button" data-mode="table" aria-pressed="false">Tableau</button></div>
    </div>`}
    <div class="chart-body" role="img" aria-label="Chiffre d’affaires facturé et encaissé sur 12 mois"></div>
    <div class="chart-table" hidden></div>
    <div class="chart-tip" hidden></div>`;
  const body = host.querySelector('.chart-body');
  const tip = host.querySelector('.chart-tip');
  const tableHost = host.querySelector('.chart-table');
  tableHost.innerHTML = `<div class="table-scroll"><table class="table table-compact"><thead><tr><th>Mois</th>${series.map(s => `<th class="num">${esc(s.label)}</th>`).join('')}</tr></thead><tbody>${data.map(d => `<tr><td>${esc(C.monthLabel(d.ym, true))}</td>${series.map(s => `<td class="num">${fmt.eur(d[s.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  function setMode(mode) {
    const table = mode === 'table';
    body.hidden = table; tableHost.hidden = !table;
    host.querySelectorAll('.chart-toggle [data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  }
  host.querySelectorAll('.chart-toggle [data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const empty = data.every(d => !d.invoiced && !d.collected);
  let first = !reduceMotion();
  function draw() {
    if (empty) { body.innerHTML = '<div class="empty" style="min-height:200px;justify-content:center"><p class="empty-title">Pas encore de revenus</p><p class="empty-text">Les barres apparaîtront dès ta première facture émise et ton premier paiement enregistré.</p></div>'; return; }
    const W = Math.max(280, body.clientWidth || 600), H = opts.height || 248;
    // axe des valeurs à droite, comme les apps Santé et Bourse
    const m = { l: 4, r: 50, t: 14, b: 30 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const maxV = Math.max(1, ...data.map(d => Math.max(d.invoiced, d.collected)));
    const sc = niceScale(maxV, 4);
    const y = v => m.t + ph - (Math.max(0, v) / sc.max) * ph;
    const band = pw / data.length;
    const bw = Math.min(16, Math.max(5, (band - 14) / 2 - 1));
    const step = data.length > 8 && W < 520 ? 2 : 1;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart-svg${first ? ' chart-grow' : ''}">`;
    sc.ticks.forEach(t => {
      const yy = Math.round(y(t)) + .5;
      svg += `<line x1="${m.l}" x2="${W - m.r + 6}" y1="${yy}" y2="${yy}" class="${t === 0 ? 'axis' : 'grid'}"/>`;
      svg += `<text x="${W - m.r + 12}" y="${yy + 4}" text-anchor="start" class="tick">${esc(compactEUR(t))}</text>`;
    });
    // zones de survol d’abord (derrière les barres) : le mois survolé s’éclaire
    data.forEach((d, i) => {
      svg += `<rect x="${(m.l + band * i + 2).toFixed(1)}" y="${m.t - 6}" width="${(band - 4).toFixed(1)}" height="${ph + 6}" rx="10" fill="transparent" class="hit" data-i="${i}" tabindex="0" aria-label="${esc(C.monthLabel(d.ym, true))} : facturé ${esc(fmt.eur(d.invoiced))}, encaissé ${esc(fmt.eur(d.collected))}"/>`;
    });
    data.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const x0 = cx - bw - 1;
      series.forEach((s, j) => {
        const v = d[s.key];
        const top = y(v);
        svg += `<path d="${barPath(x0 + j * (bw + 2), top, bw, m.t + ph - top, 4)}" fill="${s.color}" class="bar" data-i="${i}" style="--d:${i};pointer-events:none"/>`;
      });
      if (i % step === 0 || i === data.length - 1) svg += `<text x="${cx}" y="${H - 9}" text-anchor="middle" class="tick${i === data.length - 1 ? ' tick-strong' : ''}">${esc(d.label)}</text>`;
    });
    svg += '</svg>';
    body.innerHTML = svg;
    first = false;
    const svgEl = body.querySelector('svg');
    const show = (el) => {
      const i = +el.dataset.i; const d = data[i];
      body.querySelectorAll('.hit').forEach(h => h.classList.toggle('on', h === el));
      svgEl.classList.add('bars-dim');
      body.querySelectorAll('.bar').forEach(b => b.classList.toggle('on', +b.dataset.i === i));
      tip.innerHTML = `<div class="tip-title">${esc(C.monthLabel(d.ym, true))}</div>` + series.map(s => `<div class="tip-row"><span class="tip-key" style="background:${s.color}"></span><strong>${fmt.eur(d[s.key])}</strong><span>${esc(s.label)}</span></div>`).join('');
      tip.hidden = false;
      const r = el.getBoundingClientRect(), hr = host.getBoundingClientRect();
      let left = r.left - hr.left + r.width / 2 - tip.offsetWidth / 2;
      left = Math.max(4, Math.min(hr.width - tip.offsetWidth - 4, left));
      tip.style.left = left + 'px';
      tip.style.top = (body.offsetTop - tip.offsetHeight - 6 > 0 ? body.offsetTop - tip.offsetHeight + 8 : body.offsetTop + 4) + 'px';
    };
    const hide = (el) => { tip.hidden = true; el.classList.remove('on'); svgEl.classList.remove('bars-dim'); };
    body.querySelectorAll('.hit').forEach(h => {
      h.addEventListener('pointerenter', () => show(h));
      h.addEventListener('focus', () => show(h));
      h.addEventListener('pointerleave', () => hide(h));
      h.addEventListener('blur', () => hide(h));
    });
  }
  draw();
  const ro = new ResizeObserver(debounce(draw, 80));
  ro.observe(body);
  return { destroy: () => ro.disconnect(), redraw: draw, setMode };
}

let _sparkN = 0;
/** Sparkline (une série) : aire en dégradé léger, trait 2px, point final cerclé de la surface. */
function sparkline(values, opts) {
  opts = opts || {};
  const W = opts.w || 120, H = opts.h || 32, pad = 4;
  const vals = (values || []).map(v => (v === null || v === undefined) ? null : +v);
  const pts = vals.filter(v => v !== null);
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}" class="spark-empty"/></svg>`;
  const max = opts.max !== undefined ? opts.max : Math.max(...pts) * 1.12 || 1;
  const min = opts.min !== undefined ? opts.min : 0;
  const x = i => pad + (i / (vals.length - 1)) * (W - pad * 2);
  const y = v => H - pad - ((v - min) / ((max - min) || 1)) * (H - pad * 2);
  // courbe lissée (Catmull-Rom → Bézier) pour le rendu « Santé »
  const segs = [];
  let cur = [];
  vals.forEach((v, i) => { if (v === null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
  if (cur.length) segs.push(cur);
  const smooth = p => {
    if (p.length < 3) return p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
    let d = 'M' + p[0][0].toFixed(1) + ' ' + p[0][1].toFixed(1);
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + [c1x, Math.min(H - pad, c1y), c2x, Math.min(H - pad, c2y), p2[0], p2[1]].map(n => n.toFixed(1)).join(' ');
    }
    return d;
  };
  const line = segs.map(smooth).join('');
  const area = segs.filter(p => p.length > 1).map(p => smooth(p) + `L${p[p.length - 1][0].toFixed(1)} ${H - pad}L${p[0][0].toFixed(1)} ${H - pad}Z`).join('');
  const lastI = vals.length - 1 - [...vals].reverse().findIndex(v => v !== null);
  const col = opts.color || 'var(--s1)';
  const gid = opts.id || 'spk' + (++_sparkN);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".22"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="${opts.sw || 2}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(lastI).toFixed(1)}" cy="${y(vals[lastI]).toFixed(1)}" r="4" fill="${col}" stroke="var(--panel)" stroke-width="2"/>
  </svg>`;
}

/** Anneaux concentriques façon Activité : [{ color }], valeurs posées ensuite par setRings. */
function ringsSVG(rings, opts) {
  opts = opts || {};
  const S = opts.size || 148, sw = opts.stroke || 14, gap = 3;
  // décoratif : les valeurs sont écrites dans la légende à côté
  let svg = `<svg class="rings" viewBox="0 0 ${S} ${S}" aria-hidden="true">`;
  rings.forEach((r, i) => {
    const rad = S / 2 - sw / 2 - i * (sw + gap);
    const c = 2 * Math.PI * rad;
    svg += `<circle class="track" cx="${S / 2}" cy="${S / 2}" r="${rad.toFixed(2)}" stroke="${r.color}"/>`;
    svg += `<circle class="arc" data-ring="${i}" cx="${S / 2}" cy="${S / 2}" r="${rad.toFixed(2)}" stroke="${r.color}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-c="${c.toFixed(2)}"/>`;
  });
  return svg + '</svg>';
}
/** Fait tourner les anneaux jusqu’à leur valeur (transition CSS sur stroke-dashoffset). */
function setRings(svgEl, values) {
  svgEl.querySelectorAll('.arc').forEach(a => {
    const v = Math.max(0, Math.min(1, values[+a.dataset.ring] || 0));
    const c = +a.dataset.c;
    a.style.opacity = v > 0 ? '1' : '0';
    a.style.strokeDashoffset = (c * (1 - v)).toFixed(2);
  });
}

/** Courbes multi-séries (métriques serveur) avec réticule et infobulle. */
function lineChart(host, series, opts) {
  opts = opts || {};
  host.classList.add('linechart');
  host.innerHTML = `<div class="chart-head"><div class="legend">${series.map(s => `<span class="legend-item"><span class="legend-line" style="background:${s.color}"></span>${esc(s.label)}</span>`).join('')}</div>${opts.note ? `<span class="chart-note">${esc(opts.note)}</span>` : ''}</div><div class="chart-body"></div><div class="chart-tip" hidden></div>`;
  const body = host.querySelector('.chart-body'), tip = host.querySelector('.chart-tip');
  const fmtV = opts.format || (v => Math.round(v) + ' %');
  function draw() {
    const W = Math.max(260, body.clientWidth || 500), H = opts.height || 170;
    const m = { l: opts.left || 40, r: 10, t: 10, b: 22 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const n = Math.max(...series.map(s => s.values.length));
    const all = series.flatMap(s => s.values.filter(v => v !== null && v !== undefined));
    const sc = opts.max ? { max: opts.max, ticks: opts.ticks || [0, 25, 50, 75, 100] } : niceScale(Math.max(1, ...all) * 1.1, 3);
    const x = i => m.l + (n <= 1 ? 0 : i / (n - 1)) * pw;
    const y = v => m.t + ph - (v / sc.max) * ph;
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="chart-svg">`;
    sc.ticks.forEach(t => { const yy = Math.round(y(t)) + .5; svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" class="${t === 0 ? 'axis' : 'grid'}"/><text x="${m.l - 7}" y="${yy + 4}" text-anchor="end" class="tick">${esc(opts.tickFormat ? opts.tickFormat(t) : fmtV(t))}</text>`; });
    if (opts.threshold) { const ty = Math.round(y(opts.threshold)) + .5; svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${ty}" y2="${ty}" class="threshold"/><text x="${m.l + 6}" y="${ty + 13}" class="tick">seuil ${opts.threshold} %</text>`; }
    svg += `<text x="${m.l}" y="${H - 5}" class="tick">−${n - 1} mesures</text><text x="${W - m.r}" y="${H - 5}" text-anchor="end" class="tick tick-strong">maintenant</text>`;
    series.forEach(s => {
      let d = '', on = false, last = -1;
      s.values.forEach((v, i) => { if (v === null || v === undefined) { on = false; return; } d += (on ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); on = true; last = i; });
      if (series.length === 1) { const first = s.values.findIndex(v => v !== null && v !== undefined); if (last > first) svg += `<path d="${d}L${x(last).toFixed(1)} ${m.t + ph}L${x(first).toFixed(1)} ${m.t + ph}Z" fill="${s.color}" opacity=".1"/>`; }
      svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (last >= 0) svg += `<circle cx="${x(last).toFixed(1)}" cy="${y(s.values[last]).toFixed(1)}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>`;
    });
    svg += `<line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" visibility="hidden"/>`;
    svg += `<rect class="hitzone" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
    body.innerHTML = svg;
    const zone = body.querySelector('.hitzone'), cross = body.querySelector('.crosshair');
    zone.addEventListener('pointermove', e => {
      const r = zone.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
      const xx = x(i);
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = `<div class="tip-title">${i === n - 1 ? 'Dernière mesure' : 'Mesure −' + (n - 1 - i)}</div>` + series.map(s => { const v = s.values[i]; return `<div class="tip-row"><span class="tip-key line" style="background:${s.color}"></span><strong>${v === null || v === undefined ? '—' : esc(fmtV(v))}</strong><span>${esc(s.label)}</span></div>`; }).join('');
      tip.hidden = false;
      const hr = host.getBoundingClientRect();
      const px = (xx / W) * body.clientWidth;
      let left = px + 12; if (left + tip.offsetWidth > hr.width - 4) left = px - tip.offsetWidth - 12;
      tip.style.left = Math.max(4, left) + 'px'; tip.style.top = (body.offsetTop + 6) + 'px';
    });
    zone.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
  }
  draw();
  const ro = new ResizeObserver(debounce(draw, 80)); ro.observe(body);
  return { update(newSeries) { series = newSeries; draw(); }, destroy() { ro.disconnect(); } };
}

/* ---- js/kingo.js ---- */
/* ===== Kingo — mini-monstre original de KingDream, dessiné et animé en code (SVG + requestAnimationFrame) =====
   Silhouette en goutte, petites cornes, antenne-témoin reliée aux serveurs, grands yeux qui suivent le curseur,
   une canine, et un écran ventral qui affiche le pouls de l’infrastructure. */
// couleurs de l’antenne et de l’écran : bleu ciel quand tout va bien, orange puis rouge sinon
const KG_TONES = { ok: '#6cc4ff', warn: '#ff9f43', crit: '#ff5c6c', info: '#9ed8ff', sleep: '#8fa9d9', money: '#ffd166' };

const KG_MOODS = {
  calme:     { eye: 1, pupil: 1, happy: 0, browL: 0, browR: 0, browY: 0, mW: 20, mC: -4, mO: 1.5, tongue: 0, side: 0, armL: 0, armR: 0, screen: 'ecg', breath: 1 },
  heureux:   { eye: 1, pupil: 1.05, happy: 1, browL: -5, browR: -5, browY: -3, mW: 28, mC: -8, mO: 11, tongue: .7, side: 0, armL: -22, armR: -22, screen: 'check', breath: 1.2 },
  fier:      { eye: 1, pupil: 1, happy: 1, browL: -7, browR: -7, browY: -5, mW: 30, mC: -9, mO: 13, tongue: .8, side: 0, armL: -125, armR: -125, screen: 'euro', breath: 1.3 },
  salut:     { eye: 1, pupil: 1.05, happy: 1, browL: -4, browR: -4, browY: -3, mW: 26, mC: -7, mO: 9, tongue: .6, side: 0, armL: 0, armR: 'wave', screen: 'check', breath: 1.1 },
  scan:      { eye: .78, pupil: .95, happy: 0, browL: 7, browR: 7, browY: 2, mW: 12, mC: 0, mO: 0, tongue: 0, side: 0, armL: 0, armR: 0, screen: 'scan', breath: .8, saccade: true },
  reflechit: { eye: .9, pupil: 1, happy: 0, browL: -9, browR: 9, browY: -2, mW: 9, mC: 2, mO: 4, tongue: 0, side: 0, armL: 0, armR: -28, screen: 'spin', breath: .8, look: [-.55, -.85] },
  inquiet:   { eye: 1.06, pupil: .84, happy: 0, browL: -15, browR: -15, browY: -3, mW: 18, mC: 4, mO: 5, tongue: 0, side: 0, armL: 0, armR: 0, screen: 'warn', breath: 1.15 },
  panique:   { eye: 1.14, pupil: .64, happy: 0, browL: -19, browR: -19, browY: -6, mW: 22, mC: 6, mO: 15, tongue: .3, side: 0, armL: -150, armR: -150, screen: 'alert', breath: 1.6 },
  dort:      { eye: 0, pupil: 1, happy: 0, browL: 0, browR: 0, browY: 3, mW: 8, mC: 0, mO: 3.5, tongue: 0, side: 0, armL: 4, armR: 4, screen: 'zzz', breath: 1.9, slow: true },
  etourdi:   { eye: .72, pupil: .9, happy: 0, browL: -8, browR: 8, browY: -2, mW: 16, mC: 1, mO: 4, tongue: .4, side: 0, armL: 22, armR: 22, screen: 'spin', breath: 1, roll: true },
  curieux:   { eye: 1.1, pupil: 1.2, happy: 0, browL: -3, browR: -3, browY: -6, mW: 10, mC: 0, mO: 6, tongue: 0, side: 0, armL: 0, armR: 0, screen: 'ecg', breath: 1 },
  concentre: { eye: .66, pupil: 1, happy: 0, browL: 9, browR: 9, browY: 3, mW: 12, mC: 1, mO: 0, tongue: 0, side: 1, armL: 0, armR: 0, screen: 'typing', breath: .9 },
  agace:     { eye: .52, pupil: 1, happy: 0, browL: 11, browR: 11, browY: 4, mW: 16, mC: 2, mO: 0, tongue: 0, side: 0, armL: 0, armR: 0, screen: 'ecg', breath: 1 },
};
const KG_KEYS = ['eye', 'pupil', 'happy', 'browL', 'browR', 'browY', 'mW', 'mC', 'mO', 'tongue', 'side', 'armL', 'armR'];

let _kgCount = 0;
class Kingo {
  constructor() {
    this.id = 'kg' + (++_kgCount);
    this.baseMood = 'calme';
    this.mood = 'calme';
    this.moodUntil = 0;
    this.tone = 'ok';
    this.P = Object.assign({}, KG_MOODS.calme);
    this.look = { x: 0, y: 0, tx: 0, ty: 0 };
    this.lastPointer = 0;
    this.blink = { next: performance.now() + 1500, t: -1 };
    this.hop = { t: -1 };
    this.shakeT = -1;
    this.spring = { x: 0, v: 0, y: 0, vy: 0 };
    this.fx = [];
    this.clicks = [];
    this.visible = true;
    this.el = document.createElement('div');
    this.el.className = 'kingo';
    this.el.innerHTML = this.svg();
    this.svgEl = this.el.querySelector('svg');
    const q = c => this.svgEl.querySelector('.' + c);
    this.n = {
      all: q('kg-all'), body: q('kg-body'), shadow: q('kg-shadow'), stem: q('kg-stem'), bulb: q('kg-bulb'), glow: q('kg-glow'),
      armL: q('kg-arm-l'), armR: q('kg-arm-r'), face: q('kg-face'), browL: q('kg-brow-l'), browR: q('kg-brow-r'),
      eyeL: q('kg-eye-l'), eyeR: q('kg-eye-r'), mouth: q('kg-mouth'), mouthClip: this.svgEl.querySelector('#' + this.id + '-mc path'),
      tongue: q('kg-tongue'), fang: q('kg-fang'), side: q('kg-side'), screen: q('kg-screen-content'), ecg: q('kg-ecg'), fxBack: q('kg-fx-back'), fxFront: q('kg-fx'),
    };
    ['L', 'R'].forEach(s => {
      const e = this.n['eye' + s];
      this.n['eye' + s] = { g: e, sclera: e.querySelector('.kg-sclera'), pupil: e.querySelector('.kg-pupil'), lid: e.querySelector('.kg-lid'), lidLine: e.querySelector('.kg-lidline'), happy: e.querySelector('.kg-happy'), open: e.querySelector('.kg-open') };
    });
    this.screenModes = {};
    this.svgEl.querySelectorAll('[data-screen]').forEach(g => { this.screenModes[g.dataset.screen] = g; });
    this.bind();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.prev = performance.now();
  }

  svg() {
    const id = this.id;
    // eyes: centres (78,100) / (122,100)
    const eye = (side, cx) => `
      <g class="kg-eye kg-eye-${side.toLowerCase()}" transform="translate(${cx} 100)">
        <g class="kg-open">
          <g clip-path="url(#${id}-e${side})">
            <ellipse class="kg-sclera" rx="15.5" ry="17" fill="url(#${id}-eye)"/>
            <g class="kg-pupil">
              <circle r="8.2" fill="#0e1b33"/>
              <circle r="3.3" cx="0" cy="0" fill="#1d3a6e"/>
              <circle r="2.9" cx="3" cy="-3.5" fill="#fff"/>
              <circle r="1.3" cx="-2.8" cy="3" fill="#fff" opacity=".85"/>
            </g>
            <rect class="kg-lid" x="-17" y="-18" width="34" height="0" fill="${side === 'L' ? '#a6cdff' : '#8cbdff'}"/>
            <path class="kg-lidedge" d="M-17 0 H17" stroke="#1b4fa8" stroke-opacity=".4" stroke-width="1.6" opacity="0"/>
          </g>
          <ellipse class="kg-ring" rx="15.5" ry="17" fill="none" stroke="#1b4fa8" stroke-opacity=".3" stroke-width="1.2"/>
        </g>
        <path class="kg-lidline" d="M-11.5 1 Q0 8.5 11.5 1" fill="none" stroke="#12305f" stroke-width="3.6" stroke-linecap="round" opacity="0"/>
        <path class="kg-happy" d="M-11.5 4 Q0 -9.5 11.5 4" fill="none" stroke="#12305f" stroke-width="4.4" stroke-linecap="round" opacity="0"/>
      </g>`;
    let ecg = '';
    for (let k = 0; k < 6; k++) {
      const x = 66 + k * 24;
      ecg += (k ? ' L' : 'M') + `${x} 154 L${x + 6} 154 L${x + 8} 152 L${x + 10} 154 L${x + 12} 154 L${x + 13.5} 146 L${x + 15} 160 L${x + 16.5} 154 L${x + 24} 154`;
    }
    return `
<svg class="kingo-svg" viewBox="-14 -20 228 222" role="img" aria-label="Kingo, la mascotte de KingDream Control">
  <defs>
    <radialGradient id="${id}-body" cx="34%" cy="26%" r="82%">
      <stop offset="0" stop-color="#f4faff"/><stop offset=".36" stop-color="#a9d2ff"/><stop offset=".76" stop-color="#4a97ff"/><stop offset="1" stop-color="#1f6feb"/>
    </radialGradient>
    <linearGradient id="${id}-shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".55" stop-color="#0b3e9e" stop-opacity="0"/><stop offset="1" stop-color="#0b3e9e" stop-opacity=".3"/>
    </linearGradient>
    <linearGradient id="${id}-horn" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#cfe4ff"/><stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <radialGradient id="${id}-eye" cx="42%" cy="34%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dce8f8"/></radialGradient>
    <radialGradient id="${id}-glow"><stop offset="0" stop-color="currentColor" stop-opacity=".75"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}-eL"><ellipse cx="0" cy="0" rx="15.5" ry="17"/></clipPath>
    <clipPath id="${id}-eR"><ellipse cx="0" cy="0" rx="15.5" ry="17"/></clipPath>
    <clipPath id="${id}-mc"><path d=""/></clipPath>
    <clipPath id="${id}-sc"><rect x="83" y="144" width="34" height="20" rx="6"/></clipPath>
  </defs>
  <ellipse class="kg-shadow" cx="100" cy="194" rx="44" ry="6"/>
  <g class="kg-fx-back"></g>
  <g class="kg-all">
    <g class="kg-body">
      <path class="kg-stem" d="M100 52 Q100 34 100 18" fill="none" stroke="#3d8bff" stroke-width="3.4" stroke-linecap="round"/>
      <circle class="kg-glow" cx="100" cy="16" r="15" fill="url(#${id}-glow)"/>
      <circle class="kg-bulb" cx="100" cy="16" r="6.6"/>
      <circle class="kg-bulb-shine" cx="98" cy="13.6" r="2" fill="#fff" opacity=".75"/>
      <path class="kg-horn" d="M64 63 Q54 47 57 31 Q70 41 82 53 Z" fill="url(#${id}-horn)"/>
      <path class="kg-horn" d="M136 63 Q146 47 143 31 Q130 41 118 53 Z" fill="url(#${id}-horn)"/>
      <g class="kg-arm kg-arm-l" transform="translate(43 126)"><rect x="-6.5" y="-3" width="13" height="29" rx="6.5" fill="#3f8cff"/></g>
      <g class="kg-arm kg-arm-r" transform="translate(157 126)"><rect x="-6.5" y="-3" width="13" height="29" rx="6.5" fill="#3f8cff"/></g>
      <ellipse class="kg-foot" cx="79" cy="182" rx="15" ry="8.5" fill="#2471ee"/>
      <ellipse class="kg-foot" cx="121" cy="182" rx="15" ry="8.5" fill="#2471ee"/>
      <path class="kg-torso" d="M100 44 C137 44 161 73 163 112 C166 152 147 184 100 184 C53 184 34 152 37 112 C39 73 63 44 100 44 Z" fill="url(#${id}-body)"/>
      <path d="M100 44 C137 44 161 73 163 112 C166 152 147 184 100 184 C53 184 34 152 37 112 C39 73 63 44 100 44 Z" fill="url(#${id}-shade)"/>
      <ellipse cx="73" cy="70" rx="17" ry="8.5" transform="rotate(-28 73 70)" fill="#fff" opacity=".42"/>
      <circle cx="91" cy="58.5" r="3" fill="#fff" opacity=".55"/>
      <path d="M152 100 C155 113 154 127 149 139" fill="none" stroke="#fff" stroke-opacity=".13" stroke-width="3.5" stroke-linecap="round"/>
      <g class="kg-face">
        <path class="kg-brow-l" d="M-8 0 L8 0" transform="translate(78 78)" stroke="#163a73" stroke-width="4" stroke-linecap="round" opacity=".85"/>
        <path class="kg-brow-r" d="M-8 0 L8 0" transform="translate(122 78)" stroke="#163a73" stroke-width="4" stroke-linecap="round" opacity=".85"/>
        ${eye('L', 78)}${eye('R', 122)}
        <path class="kg-mouth" d="" fill="#12305f" stroke="#12305f" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>
        <g clip-path="url(#${id}-mc)"><ellipse class="kg-tongue" cx="100" cy="134" rx="6" ry="4" fill="#ff8fb8"/></g>
        <path class="kg-fang" d="" fill="#fff"/>
        <ellipse class="kg-side" cx="112" cy="131" rx="3.6" ry="2.8" fill="#ff8fb8" opacity="0"/>
      </g>
      <g class="kg-screen">
        <rect x="82" y="143" width="36" height="22" rx="7" fill="#0e1424"/>
        <g class="kg-screen-content" clip-path="url(#${id}-sc)">
          <g data-screen="ecg"><path class="kg-ecg" d="${ecg}" fill="none" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></g>
          <g data-screen="euro"><text x="100" y="159.5" text-anchor="middle" font-size="15" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif" fill="#ffd166">€</text></g>
          <g data-screen="check"><path d="M92 154 L97.5 159 L108 148.5" fill="none" stroke="#34d399" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></g>
          <g data-screen="warn"><text x="100" y="160" text-anchor="middle" font-size="16" font-weight="800" font-family="-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif" fill="#ff9f43">!</text></g>
          <g data-screen="alert"><text x="100" y="160" text-anchor="middle" font-size="16" font-weight="800" font-family="-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif" fill="#ff5c6c">!!</text></g>
          <g data-screen="zzz"><text x="100" y="158" text-anchor="middle" font-size="10" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif" fill="#8fb8ff" letter-spacing="1">z z</text></g>
          <g data-screen="scan"><rect class="kg-scanbar" x="84" y="145" width="4" height="18" rx="2" fill="#7cc4ff"/><path d="M84 154 H116" stroke="#7cc4ff" stroke-opacity=".3" stroke-width="1"/></g>
          <g data-screen="spin"><path class="kg-spin" d="M100 147.5 A6.5 6.5 0 1 1 93.5 154" fill="none" stroke="#a9ccff" stroke-width="2.2" stroke-linecap="round"/></g>
          <g data-screen="typing"><path d="M87 149.5 H101 M87 154 H109 M87 158.5 H97" stroke="#a9ccff" stroke-opacity=".7" stroke-width="1.6" stroke-linecap="round"/><rect class="kg-caret" x="99" y="156" width="3" height="5" fill="#a9ccff"/></g>
        </g>
        <rect x="82.5" y="143.5" width="35" height="21" rx="6.5" fill="none" stroke="#fff" stroke-opacity=".16"/>
        <path d="M86 146.5 Q92 145 98 145.2" stroke="#fff" stroke-opacity=".18" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      </g>
    </g>
  </g>
  <g class="kg-fx"></g>
</svg>`;
  }

  bind() {
    this.onPointer = e => {
      const r = this.svgEl.getBoundingClientRect();
      if (!r.width) return;
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.48;
      const dx = (e.clientX - cx) / Math.max(260, r.width * 2.2), dy = (e.clientY - cy) / Math.max(260, r.height * 2.2);
      this.look.tx = Math.max(-1, Math.min(1, dx));
      this.look.ty = Math.max(-1, Math.min(1, dy));
      this.lastPointer = performance.now();
      if (this.mood === 'dort' && Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * 0.8 && this.onWake) this.onWake();
    };
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    this.svgEl.addEventListener('pointerenter', () => { if (!this.isBusyMood()) this.setMood('curieux', 1800); });
    this.svgEl.addEventListener('click', () => this.onClick());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.prev = performance.now(); } });
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = null;
    this.loop = () => {};
    window.removeEventListener('pointermove', this.onPointer);
    this.el.remove();
  }
  isBusyMood() { return ['panique', 'fier', 'etourdi', 'salut'].includes(this.mood) && performance.now() < this.moodUntil; }

  onClick() {
    const now = performance.now();
    this.clicks = this.clicks.filter(t => now - t < 2200);
    this.clicks.push(now);
    if (this.clicks.length >= 6) {
      this.clicks = [];
      this.setMood('etourdi', 3200);
      this.burst('stars');
      if (this.onDizzy) this.onDizzy();
      return;
    }
    if (this.clicks.length === 4) this.setMood('agace', 1400);
    else this.react('hop');
    if (this.onPoke) this.onPoke(this.clicks.length);
  }

  /* ---------- API ---------- */
  setBase(mood, tone) {
    this.baseMood = mood;
    if (tone) this.tone = tone;
    if (performance.now() >= this.moodUntil) this.mood = mood;
  }
  setMood(mood, ms) {
    this.mood = mood;
    this.moodUntil = performance.now() + (ms || 2400);
    if (mood === 'salut') this.waveStart = performance.now();
  }
  react(kind) {
    if (reduceMotion() && kind !== 'coin') return;
    const now = performance.now();
    if (kind === 'hop') this.hop.t = now;
    if (kind === 'shake') this.shakeT = now;
    if (kind === 'coin' || kind === 'sparkle' || kind === 'radar' || kind === 'stars' || kind === 'zzz') this.burst(kind);
  }
  mount(container, size) {
    container.appendChild(this.el);
    this.el.style.setProperty('--kg-size', size + 'px');
    this.prev = performance.now();
  }

  /* ---------- particules ---------- */
  burst(kind) {
    const now = performance.now();
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs, front) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      (front === false ? this.n.fxBack : this.n.fxFront).appendChild(e);
      return e;
    };
    const star = (x, y, r) => `M${x} ${y - r} Q${x + r * .22} ${y - r * .22} ${x + r} ${y} Q${x + r * .22} ${y + r * .22} ${x} ${y + r} Q${x - r * .22} ${y + r * .22} ${x - r} ${y} Q${x - r * .22} ${y - r * .22} ${x} ${y - r} Z`;
    if (kind === 'sparkle') {
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i - 3) * 0.42, d = 78 + Math.random() * 18;
        const x = 100 + Math.cos(a) * d, y = 104 + Math.sin(a) * d * .9;
        this.fx.push({ el: mk('path', { d: star(0, 0, 5 + Math.random() * 3), fill: i % 2 ? '#ffc93d' : '#5db0f7' }), t0: now + i * 60, dur: 900, x, y, kind });
      }
    } else if (kind === 'coin') {
      const g = mk('g', {});
      g.innerHTML = '<circle r="9" fill="#ffd166" stroke="#c98500" stroke-width="1.6"/><text y="4" text-anchor="middle" font-size="11" font-weight="800" font-family="-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif" fill="#8a5a00">€</text>';
      this.fx.push({ el: g, t0: now, dur: 1300, x: 100, y: 150, kind });
    } else if (kind === 'radar') {
      for (let i = 0; i < 2; i++) this.fx.push({ el: mk('circle', { r: 8, fill: 'none', stroke: KG_TONES.info, 'stroke-width': 1.6 }, false), t0: now + i * 380, dur: 1200, x: 100, y: 16, kind });
    } else if (kind === 'stars') {
      for (let i = 0; i < 3; i++) this.fx.push({ el: mk('path', { d: star(0, 0, 5.5), fill: '#ffd166' }), t0: now, dur: 3200, phase: i * (Math.PI * 2 / 3), kind });
    } else if (kind === 'zzz') {
      for (let i = 0; i < 3; i++) {
        const t = mk('text', { 'font-size': 12 + i * 3, 'font-weight': 700, 'font-family': '-apple-system, BlinkMacSystemFont, Inter, sans-serif', fill: '#8fb8ff' });
        t.textContent = 'z';
        this.fx.push({ el: t, t0: now + i * 650, dur: 2400, x: 146 + i * 6, y: 46, kind });
      }
    }
  }

  /* ---------- boucle ---------- */
  loop(now) {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.el.isConnected || !this.el.offsetParent) return;
    const dt = Math.min(0.05, (now - this.prev) / 1000);
    this.prev = now;
    const rm = reduceMotion();
    if (now >= this.moodUntil && this.mood !== this.baseMood) this.mood = this.baseMood;
    const T = KG_MOODS[this.mood] || KG_MOODS.calme;
    const k = rm ? 1 : Math.min(1, dt * 9);
    for (const key of KG_KEYS) {
      let target = T[key];
      if (target === 'wave') target = -150 + Math.sin(now / 95) * 28;
      this.P[key] += (target - this.P[key]) * (key === 'armR' && T.armR === 'wave' ? Math.min(1, dt * 18) : k);
    }
    const P = this.P;

    // regard : curseur, ou saccades quand on ne bouge plus
    const idle = now - this.lastPointer > 3500;
    if (T.look) { this.look.tx = T.look[0]; this.look.ty = T.look[1]; }
    else if (T.roll) { this.look.tx = Math.cos(now / 160) * .8; this.look.ty = Math.sin(now / 160) * .8; }
    else if ((idle || T.saccade) && (!this.sacc || now > this.sacc)) {
      this.sacc = now + (T.saccade ? 420 + Math.random() * 300 : 1400 + Math.random() * 2600);
      this.look.tx = T.saccade ? (this.look.tx > 0 ? -.75 : .75) : (Math.random() - 0.5) * 1.2;
      this.look.ty = T.saccade ? .1 : (Math.random() - 0.6) * 0.8;
    }
    const lk = rm ? 1 : Math.min(1, dt * (T.roll ? 30 : 11));
    this.look.x += (this.look.tx - this.look.x) * lk;
    this.look.y += (this.look.ty - this.look.y) * lk;

    // clignement
    let blink = 0;
    if (now > this.blink.next && this.blink.t < 0 && P.happy < .5 && this.mood !== 'dort') this.blink.t = now;
    if (this.blink.t >= 0) {
      const bt = (now - this.blink.t) / 170;
      blink = bt < .45 ? bt / .45 : Math.max(0, 1 - (bt - .45) / .55);
      if (bt >= 1) { this.blink.t = -1; this.blink.next = now + 1800 + Math.random() * 4200; if (Math.random() < .18) this.blink.next = now + 180; }
    }

    // respiration, saut, tremblement
    const period = T.slow ? 4200 : 3000;
    const br = rm ? 0 : Math.sin(now / period * Math.PI * 2) * 0.014 * (T.breath || 1);
    let hopY = 0, sx = 1 - br * .6, sy = 1 + br;
    if (this.hop.t >= 0) {
      const h = (now - this.hop.t) / 520;
      if (h >= 1) this.hop.t = -1;
      else if (h < .18) { const q = h / .18; sy -= .1 * q; sx += .08 * q; }
      else if (h < .72) { const q = (h - .18) / .54; hopY = -Math.sin(q * Math.PI) * 18; sy += .06 * Math.sin(q * Math.PI); sx -= .04 * Math.sin(q * Math.PI); }
      else { const q = (h - .72) / .28; sy -= .08 * Math.sin(q * Math.PI); sx += .06 * Math.sin(q * Math.PI); }
    }
    let shakeX = 0;
    if (this.shakeT >= 0) {
      const s = (now - this.shakeT) / 650;
      if (s >= 1) this.shakeT = -1; else shakeX = Math.sin(s * 40) * 3.2 * (1 - s);
    }
    if (this.mood === 'panique' && !rm) shakeX += Math.sin(now / 28) * 1.1;
    const lean = rm ? 0 : this.look.x * 2.4 + (this.mood === 'dort' ? 4 : 0) + (this.mood === 'etourdi' ? Math.sin(now / 240) * 5 : 0);
    this.n.all.setAttribute('transform', `translate(${shakeX.toFixed(2)} ${hopY.toFixed(2)})`);
    this.n.body.setAttribute('transform', `translate(100 184) rotate(${lean.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(-100 -184)`);
    const sh = 1 + hopY / 60;
    this.n.shadow.setAttribute('rx', (44 * sh).toFixed(1));
    this.n.shadow.setAttribute('opacity', (0.9 * sh).toFixed(2));

    // antenne à ressort
    const sp = this.spring;
    const force = -(lean * 0.35) - (shakeX * 1.6) + (this.hop.t >= 0 ? -hopY * 0.02 : 0);
    sp.v += ((force - sp.x) * 90 - sp.v * 7) * dt;
    sp.x += sp.v * dt;
    sp.vy += ((hopY * -0.12 - sp.y) * 90 - sp.vy * 8) * dt;
    sp.y += sp.vy * dt;
    const bx = 100 + sp.x, by = 16 + sp.y;
    this.n.stem.setAttribute('d', `M100 52 Q${(100 + sp.x * .25).toFixed(2)} 34 ${bx.toFixed(2)} ${(by + 2).toFixed(2)}`);
    const tone = this.mood === 'dort' ? 'sleep' : this.tone;
    const col = KG_TONES[tone] || KG_TONES.ok;
    const pulse = tone === 'crit' ? (Math.sin(now / 140) > 0 ? 1 : .35) : tone === 'warn' ? .65 + .35 * Math.sin(now / 320) : tone === 'sleep' ? .35 : .75 + .25 * Math.sin(now / 900);
    this.n.bulb.setAttribute('cx', bx.toFixed(2)); this.n.bulb.setAttribute('cy', by.toFixed(2));
    this.n.bulb.setAttribute('fill', col);
    this.svgEl.querySelector('.kg-bulb-shine').setAttribute('transform', `translate(${(sp.x).toFixed(2)} ${(sp.y).toFixed(2)})`);
    this.n.glow.setAttribute('cx', bx.toFixed(2)); this.n.glow.setAttribute('cy', by.toFixed(2));
    this.n.glow.style.color = col;
    this.n.glow.setAttribute('opacity', pulse.toFixed(2));

    // bras
    this.n.armL.setAttribute('transform', `translate(43 126) rotate(${(16 - P.armL).toFixed(1)})`);
    this.n.armR.setAttribute('transform', `translate(157 126) rotate(${(-16 + P.armR).toFixed(1)})`);

    // visage (léger parallaxe)
    const fx = this.look.x * 3.2, fy = this.look.y * 2.6;
    this.n.face.setAttribute('transform', `translate(${fx.toFixed(2)} ${fy.toFixed(2)})`);
    this.n.browL.setAttribute('transform', `translate(78 ${(78 + P.browY).toFixed(2)}) rotate(${P.browL.toFixed(1)})`);
    this.n.browR.setAttribute('transform', `translate(122 ${(78 + P.browY).toFixed(2)}) rotate(${(-P.browR).toFixed(1)})`);
    const open = Math.max(0, Math.min(1.2, P.eye)) * (1 - blink);
    for (const s of ['L', 'R']) {
      const e = this.n['eye' + s];
      const wide = Math.max(1, open);
      const o = Math.min(1, open);
      const closedFade = Math.max(0, Math.min(1, (o - 0.04) / 0.22));
      e.open.setAttribute('transform', `scale(${wide.toFixed(3)})`);
      e.open.setAttribute('opacity', ((1 - P.happy) * closedFade).toFixed(2));
      const lidH = (1 - o) * 35;
      e.lid.setAttribute('height', lidH.toFixed(2));
      if (!e.edge) e.edge = e.g.querySelector('.kg-lidedge');
      e.edge.setAttribute('transform', `translate(0 ${(-18 + lidH).toFixed(2)})`);
      e.edge.setAttribute('opacity', o < 0.97 ? '1' : '0');
      const px = this.look.x * 5.6, py = this.look.y * 6.2;
      e.pupil.setAttribute('transform', `translate(${px.toFixed(2)} ${py.toFixed(2)}) scale(${P.pupil.toFixed(3)})`);
      e.happy.setAttribute('opacity', P.happy.toFixed(2));
      e.lidLine.setAttribute('opacity', (P.happy < .5 && o < .08 ? 1 : 0).toFixed(2));
    }

    // bouche
    const cy = 128, w = P.mW, c = P.mC, o = Math.max(0, P.mO);
    const Lx = 100 - w / 2, Rx = 100 + w / 2, Ly = cy + c, Ry = cy + c;
    const uY = cy + (-c) * 0.9 - o * 0.25, lY = uY + o * 2;
    const d = `M${Lx.toFixed(2)} ${Ly.toFixed(2)} Q100 ${uY.toFixed(2)} ${Rx.toFixed(2)} ${Ry.toFixed(2)} Q100 ${lY.toFixed(2)} ${Lx.toFixed(2)} ${Ly.toFixed(2)} Z`;
    this.n.mouth.setAttribute('d', d);
    this.n.mouthClip.setAttribute('d', d);
    const bottom = (Ly + 2 * (lY) + Ly) / 4; // point bas de la lèvre inférieure
    this.n.tongue.setAttribute('cx', (100 + w * 0.08).toFixed(2));
    this.n.tongue.setAttribute('cy', (bottom - 1).toFixed(2));
    this.n.tongue.setAttribute('rx', (w * 0.24).toFixed(2));
    this.n.tongue.setAttribute('ry', (Math.max(0.1, o * 0.42 * P.tongue)).toFixed(2));
    // canine : sur la lèvre supérieure, côté gauche
    const t = 0.3, mt = 1 - t;
    const fxp = mt * mt * Lx + 2 * mt * t * 100 + t * t * Rx;
    const fyp = mt * mt * Ly + 2 * mt * t * uY + t * t * Ry;
    const fangH = 4.6 + Math.min(2, o * 0.25);
    this.n.fang.setAttribute('d', `M${(fxp - 2.6).toFixed(2)} ${(fyp - 0.8).toFixed(2)} L${(fxp + 2.6).toFixed(2)} ${(fyp - 0.4).toFixed(2)} L${(fxp + 0.3).toFixed(2)} ${(fyp + fangH).toFixed(2)} Z`);
    this.n.fang.setAttribute('opacity', this.mood === 'dort' ? '0' : '1');
    this.n.side.setAttribute('cx', (Rx - 1.5).toFixed(2));
    this.n.side.setAttribute('cy', (Ry + 2.4).toFixed(2));
    this.n.side.setAttribute('opacity', P.side.toFixed(2));

    // écran ventral
    for (const m in this.screenModes) this.screenModes[m].style.display = (m === T.screen) ? '' : 'none';
    if (T.screen === 'ecg') {
      this.n.ecg.setAttribute('stroke', col);
      const speed = tone === 'crit' ? 46 : tone === 'warn' ? 30 : 18;
      this.n.ecg.setAttribute('transform', `translate(${rm ? 0 : -((now / 1000 * speed) % 24).toFixed(2)} 0)`);
    } else if (T.screen === 'scan') {
      this.svgEl.querySelector('.kg-scanbar').setAttribute('x', (84 + (Math.sin(now / 260) * .5 + .5) * 28).toFixed(2));
    } else if (T.screen === 'spin') {
      this.svgEl.querySelector('.kg-spin').setAttribute('transform', `rotate(${((now / 3) % 360).toFixed(1)} 100 154)`);
    } else if (T.screen === 'typing') {
      this.svgEl.querySelector('.kg-caret').setAttribute('opacity', Math.sin(now / 160) > 0 ? '1' : '0');
    } else if (T.screen === 'warn' || T.screen === 'alert') {
      this.screenModes[T.screen].setAttribute('opacity', (Math.sin(now / (T.screen === 'alert' ? 110 : 260)) > -0.2 ? 1 : .25).toFixed(2));
    }

    // effets ponctuels
    if (this.mood === 'dort' && !rm && (!this.zzzAt || now - this.zzzAt > 2600)) { this.zzzAt = now; this.burst('zzz'); }
    if ((this.mood === 'inquiet' || this.mood === 'panique') && !rm && (!this.sweatAt || now - this.sweatAt > 2600)) {
      this.sweatAt = now;
      const NS = 'http://www.w3.org/2000/svg';
      const e = document.createElementNS(NS, 'path');
      e.setAttribute('d', 'M0 -6 C2.5 -2 4 0.5 4 2.6 A4 4 0 0 1 -4 2.6 C-4 0.5 -2.5 -2 0 -6 Z');
      e.setAttribute('fill', '#a7dcff');
      this.n.fxFront.appendChild(e);
      this.fx.push({ el: e, t0: now, dur: 1500, x: 151, y: 70, kind: 'sweat' });
    }
    this.fx = this.fx.filter(p => {
      const q = (now - p.t0) / p.dur;
      if (q < 0) { p.el.setAttribute('opacity', '0'); return true; }
      if (q >= 1) { p.el.remove(); return false; }
      let x = p.x, y = p.y, s = 1, op = 1;
      if (p.kind === 'sparkle') { s = Math.sin(q * Math.PI) * 1.2; op = 1 - q * .4; y -= q * 6; }
      if (p.kind === 'coin') { y = 150 - q * 150; x = 100 + Math.sin(q * 9) * 4; s = .7 + q * .6; op = q > .75 ? (1 - q) / .25 : 1; }
      if (p.kind === 'radar') { s = 1 + q * 3.4; op = .7 * (1 - q); p.el.setAttribute('stroke-width', (1.6 / s).toFixed(2)); x = bx; y = by; }
      if (p.kind === 'stars') { const a = p.phase + now / 280; x = 100 + Math.cos(a) * 48; y = 34 + Math.sin(a) * 11; s = .8 + Math.sin(a) * .25; op = q > .85 ? (1 - q) / .15 : 1; }
      if (p.kind === 'zzz') { x = p.x + q * 22; y = p.y - q * 46; op = q < .2 ? q / .2 : 1 - (q - .2) / .8; s = .8 + q * .5; }
      if (p.kind === 'sweat') { y = p.y + q * 18; op = q < .15 ? q / .15 : 1 - Math.max(0, q - .5) * 2; }
      p.el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${Math.max(0.01, s).toFixed(3)})`);
      p.el.setAttribute('opacity', Math.max(0, op).toFixed(2));
      return true;
    });
  }
}

/* ---- js/brief.js ---- */
/* ===== Le cerveau de Kingo : transforme l’état de l’activité en priorités claires ===== */
function greeting() {
  const h = new Date().getHours();
  const name = (Store.state.me && Store.state.me.name) || '';
  if (h >= 23 || h < 5) return 'Encore debout' + (name ? ', ' + name : '') + ' ?';
  if (h >= 18) return 'Bonsoir' + (name ? ' ' + name : '');
  return 'Bonjour' + (name ? ' ' + name : '');
}

function buildBrief() {
  const S = Store, st = S.state, today = S.today;
  const items = [];
  const push = it => items.push(it);

  // 1) serveurs critiques
  for (const s of st.servers) {
    const status = S.serverStatus(s);
    const m = s.metrics || {};
    const where = s.name + ' (' + S.clientName(s.clientId) + ')';
    // un site en panne est annoncé au nom de son propriétaire (serveur partagé)
    const siteBad = level => C.serverSites(s).map(x => [x, C.siteState(m, x)]).find(p => p[1].state === level);
    const siteWho = x => x.name + (x.clientId !== s.clientId ? ' (' + S.clientName(x.clientId) + ', sur ' + s.name + ')' : ' (' + S.clientName(s.clientId) + ')');
    if (status === 'crit' && m.reachable !== false && siteBad('crit') && !(m.disk >= 95 || m.ram >= 97)) {
      const [x, r] = siteBad('crit');
      push({ id: 'crit-' + s.id, level: 'crit', score: 98, icon: 'globe', title: 'Le site ' + siteWho(x) + (r.status ? ' renvoie une erreur HTTP ' + r.status : ' ne répond plus') + '.',
        detail: 'Le serveur répond en SSH : regarde les journaux du serveur web.',
        actions: [{ label: 'Kingo m’aide', icon: 'sparkle', act: 'assist', arg: s.id + '|site' }, { label: 'Voir les logs', act: 'route', arg: 'serveur-' + s.id }] });
    } else if (status === 'crit') {
      const mins = m.lastSeen ? Math.max(1, Math.round((Date.now() - new Date(m.lastSeen).getTime()) / 60000)) : null;
      const why = m.reachable === false ? 'ne répond plus' + (mins ? ' depuis ' + mins + ' min' : '')
        : m.disk >= 95 ? 'a son disque plein à ' + Math.round(m.disk) + ' %'
        : 'sature sa mémoire (' + Math.round(m.ram) + ' %)';
      push({ id: 'crit-' + s.id, level: 'crit', score: 100, icon: 'server', title: where + ' ' + why + '.',
        detail: m.reachable === false ? 'Les connexions SSH échouent. Teste la connexion ou ouvre la console dès qu’il répond.' : 'Intervention conseillée maintenant.',
        actions: [{ label: 'Kingo m’aide', icon: 'sparkle', act: 'assist', arg: s.id }, { label: 'Tester la connexion', icon: 'refresh', act: 'test', arg: s.id }] });
    } else if (status === 'warn') {
      let why = '', icon = 'server';
      if (m.disk >= 85) { why = 'a son disque rempli à ' + Math.round(m.disk) + ' %'; icon = 'disk'; }
      else if (m.cpu >= 85) { why = 'tourne à ' + Math.round(m.cpu) + ' % de processeur'; icon = 'cpu'; }
      else if (m.ram >= 90) { why = 'utilise ' + Math.round(m.ram) + ' % de sa mémoire'; icon = 'ram'; }
      else if (siteBad('warn')) { const [x, r] = siteBad('warn'); why = ': le site ' + siteWho(x) + ' répond lentement (' + (r.ms / 1000).toFixed(1).replace('.', ',') + ' s)'; icon = 'globe'; }
      else why = 'demande ton attention';
      // serveur partagé : qui occupe la place
      const owners = C.ownerTotals(s).owners.filter(o => o.hasSize && o.bytes > 0).sort((a, b) => b.bytes - a.bytes);
      const split = owners.length ? ' Répartition : ' + owners.map(o => S.clientName(o.clientId) + ' ' + fmt.bytes(o.bytes)).join(', ') + '.' : '';
      const topic = m.disk >= 85 ? 'disk' : m.cpu >= 85 ? 'cpu' : m.ram >= 90 ? 'ram' : siteBad('warn') ? 'site' : 'disk';
      push({ id: 'warn-' + s.id, level: 'warn', score: 70 + (m.cpu >= 85 ? 4 : 0), icon, title: where + ' ' + why + '.',
        detail: m.disk >= 85 ? 'Je peux faire le ménage (journaux, caches) sans toucher aux sites.' + split : m.cpu >= 85 ? 'Je peux te montrer qui consomme et redémarrer le service bloqué.' : '',
        actions: [{ label: 'Kingo m’aide', icon: 'sparkle', act: 'assist', arg: s.id + '|' + topic }, { label: 'Voir le serveur', act: 'route', arg: 'serveur-' + s.id }] });
    }
  }

  // 2) impayés
  const overdue = st.docs.filter(d => d.kind === 'invoice' && S.status(d) === 'overdue');
  if (overdue.length) {
    const total = overdue.reduce((t, d) => t + S.totals(d).due, 0);
    const oldest = overdue.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    const late = C.diffDays(today, oldest.dueDate);
    push({ id: 'overdue', level: 'warn', score: 80, icon: 'euro',
      title: (overdue.length > 1 ? overdue.length + ' factures en retard' : '1 facture en retard') + ' pour ' + fmt.eur(total) + '.',
      detail: 'La plus ancienne, ' + oldest.number + ' (' + S.clientName(oldest.clientId) + '), a ' + late + ' jour' + (late > 1 ? 's' : '') + ' de retard.',
      actions: [{ label: 'Relancer ' + oldest.number, icon: 'mail', act: 'remind', arg: oldest.id }, { label: 'Voir les impayés', act: 'route', arg: 'facturation-retard' }] });
  }

  // 3) devis acceptés à facturer
  for (const q of st.docs.filter(d => d.kind === 'quote' && d.status === 'accepted')) {
    push({ id: 'accepted-' + q.id, level: 'info', score: 66, icon: 'convert',
      title: S.clientName(q.clientId) + ' a accepté le devis ' + q.number + ' (' + fmt.eur(S.totals(q).totalHT) + ' HT).',
      detail: 'Transforme-le en facture : les lignes sont reprises telles quelles.',
      actions: [{ label: 'Créer la facture', icon: 'convert', act: 'convert', arg: q.id }] });
  }

  // 4) devis qui expirent bientôt
  for (const q of st.docs.filter(d => d.kind === 'quote' && d.status === 'sent' && d.validUntil)) {
    const left = C.diffDays(q.validUntil, today);
    if (left >= 0 && left <= 3) {
      push({ id: 'expiring-' + q.id, level: 'info', score: 58, icon: 'clock',
        title: 'Le devis ' + q.number + ' pour ' + S.clientName(q.clientId) + (left === 0 ? ' expire aujourd’hui.' : ' expire dans ' + left + ' jour' + (left > 1 ? 's.' : '.')),
        detail: 'Pas encore de réponse. Une relance courte suffit souvent.',
        actions: [{ label: 'Relancer', icon: 'mail', act: 'sendquote', arg: q.id }, { label: 'Ouvrir', act: 'route', arg: 'doc-' + q.id }] });
    }
  }

  // 5) brouillons de factures
  const drafts = st.docs.filter(d => d.kind === 'invoice' && d.status === 'draft');
  if (drafts.length) {
    push({ id: 'drafts', level: 'info', score: 52, icon: 'file',
      title: (drafts.length > 1 ? drafts.length + ' factures attendent' : '1 facture attend') + ' en brouillon.',
      detail: drafts.slice(0, 3).map(d => S.clientName(d.clientId)).join(', ') + '. Vérifie-les puis émets-les : le numéro est attribué à ce moment-là.',
      actions: [{ label: 'Voir les brouillons', act: 'route', arg: 'facturation-brouillons' }] });
  }

  // 6) renouvellements proches
  for (const r of S.renewals(14)) {
    push({ id: 'renew-' + r.id, level: 'info', score: 40 - r.inDays, icon: 'repeat',
      title: r.label + ' — ' + S.clientName(r.clientId) + ' : renouvellement ' + (r.inDays === 0 ? 'aujourd’hui' : 'le ' + fmt.date(r.renewalDate)) + '.',
      detail: fmt.eur(C.cents(r.priceHT)) + ' HT ' + (r.period === 'annuel' ? 'par an' : 'par mois') + '.',
      actions: r.period === 'annuel' ? [{ label: 'Préparer la facture', icon: 'file', act: 'invoicesub', arg: r.id }] : [{ label: 'Voir le client', act: 'route', arg: 'client-' + r.clientId }] });
  }

  // 7) premiers pas et conformité des factures
  const co = st.company;
  if (!co.tradeName && !co.legalName || !co.siret || !co.address) {
    push({ id: 'company', level: 'info', score: 62, icon: 'building', title: 'Complète l’identité de ton entreprise : elle apparaît sur chaque devis et facture.',
      detail: 'Nom, adresse et SIRET sont des mentions obligatoires.', actions: [{ label: 'Ouvrir les réglages', act: 'route', arg: 'reglages' }] });
  }
  if (!st.clients.some(c => !c.internal)) {
    push({ id: 'firstclient', level: 'info', score: 36, icon: 'user', title: 'Ajoute ton premier client pour lui préparer un devis.', detail: '', actions: [{ label: 'Nouveau client', act: 'route', arg: 'clients' }] });
  }
  if (!st.servers.length) {
    push({ id: 'firstserver', level: 'info', score: 26, icon: 'server', title: 'Ajoute un serveur : je le surveille et je te préviens au moindre souci.', detail: 'Une clé SSH dédiée est générée ; tu n’as qu’à installer sa clé publique.', actions: [{ label: 'Ajouter un serveur', act: 'route', arg: 'serveurs' }] });
  }
  if (co.vatRegime !== 'franchise' && !co.vatNumber) {
    push({ id: 'vat', level: 'info', score: 45, icon: 'shield',
      title: 'Ton numéro de TVA n’apparaît pas sur tes factures.',
      detail: 'En micro-entreprise sous le seuil de TVA, active « Franchise en base » : la mention « TVA non applicable, art. 293 B du CGI » sera ajoutée. Sinon, renseigne ton numéro.',
      actions: [{ label: 'Ouvrir les réglages', act: 'route', arg: 'reglages' }] });
  }
  if (!co.iban) {
    push({ id: 'iban', level: 'info', score: 30, icon: 'card', title: 'Ajoute ton IBAN : il s’affichera sur tes factures pour accélérer les virements.', detail: '', actions: [{ label: 'Compléter', act: 'route', arg: 'reglages' }] });
  }

  // 8) sauvegarde
  const lastBackup = st.backups && st.backups.last;
  const bDays = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : 999;
  if (bDays >= 7) {
    push({ id: 'backup', level: 'warn', score: 50, icon: 'disk', title: lastBackup ? 'Dernière sauvegarde du cockpit il y a ' + bDays + ' jours.' : 'Aucune sauvegarde du cockpit pour l’instant.',
      detail: 'Elle contient tes factures et le coffre des clés SSH chiffré.', actions: [{ label: 'Sauvegarder maintenant', icon: 'download', act: 'backup' }] });
  }

  // 9) bonne nouvelle : paiement récent
  let recent = null;
  for (const d of st.docs) {
    if (d.kind !== 'invoice') continue;
    for (const p of d.payments || []) if (C.diffDays(today, p.date) <= 2 && (!recent || p.date > recent.p.date)) recent = { d, p };
  }
  if (recent) {
    push({ id: 'paid-' + recent.p.id, level: 'good', score: 20, icon: 'check',
      title: 'Paiement reçu : ' + fmt.eur(C.cents(recent.p.amount)) + ' de ' + S.clientName(recent.d.clientId) + '.',
      detail: recent.d.number + (recent.d.status === 'paid' ? ' est soldée.' : ' est partiellement réglée.'), actions: [] });
  }

  items.sort((a, b) => b.score - a.score);
  if (!items.some(i => i.level === 'crit' || i.level === 'warn')) {
    const k = S.kpis();
    items.unshift({ id: 'calm', level: 'good', score: 1, icon: 'sparkle', title: 'Tout est calme.',
      detail: k.serversOk + ' serveur' + (k.serversOk > 1 ? 's' : '') + ' sur ' + k.servers + ' répondent et aucune facture n’est en retard.', actions: [] });
  }
  return items;
}

function briefHeadline(items) {
  const crit = items.filter(i => i.level === 'crit').length;
  const warn = items.filter(i => i.level === 'warn').length;
  if (crit) return crit > 1 ? crit + ' urgences, et ' + warn + ' point' + (warn > 1 ? 's' : '') + ' à surveiller.' : 'Une urgence d’abord' + (warn ? ', puis ' + warn + ' point' + (warn > 1 ? 's' : '') + ' à surveiller.' : '.');
  if (warn) return warn > 1 ? warn + ' points méritent ton attention.' : 'Un point mérite ton attention.';
  return 'Rien d’urgent aujourd’hui.';
}

/** Humeur de fond de Kingo selon la situation et l’heure. */
function briefMood(items) {
  const crit = items.some(i => i.level === 'crit');
  const warn = items.some(i => i.level === 'warn');
  const h = new Date().getHours();
  const night = Store.company.nightMode !== false && (h >= 23 || h < 6);
  const idle = App.idleFor() > 180000;
  if (crit) return { mood: 'inquiet', tone: 'crit' };
  if ((night || idle) && !crit) return { mood: 'dort', tone: warn ? 'warn' : 'ok' };
  if (warn) return { mood: 'calme', tone: 'warn' };
  return { mood: 'calme', tone: 'ok' };
}

/** Exécute une action proposée par Kingo. */
async function runBriefAction(a) {
  if (!a) return;
  try {
    switch (a.act) {
      case 'route': App.go(a.arg); break;
      case 'test': await Views.servers.test(a.arg); break;
      case 'assist': { const [sid, topic] = String(a.arg).split('|'); Views.assist.open(sid, topic || undefined); break; }
      case 'console': Views.servers.openConsole(a.arg); break;
      case 'remind': Views.billing.sendDialog(a.arg, { reminder: true }); break;
      case 'sendquote': Views.billing.sendDialog(a.arg, { reminder: true }); break;
      case 'convert': {
        const inv = await Store.convertQuote(a.arg);
        App.kingoSay('Facture préparée en brouillon à partir du devis. Vérifie-la puis émets-la.', { mood: 'heureux' });
        App.go('doc-' + inv.id);
        break;
      }
      case 'invoicesub': {
        const sub = Store.state.subscriptions.find(s => s.id === a.arg);
        const inv = await Store.invoiceSubscriptions(sub.clientId, [sub.id]);
        App.go('doc-' + inv.id);
        break;
      }
      case 'backup': await Views.security.backup(); break;
      default: break;
    }
  } catch (e) {
    if (e && e.code !== 'cancelled') toast(e.message || String(e), { tone: 'crit' });
  }
}

/* ---- js/pdf.js ---- */
/* ===== Mise en page des devis, factures et avoirs : aperçu HTML et PDF (jsPDF) partagent la même vue ===== */
const PDF_TITLES = { invoice: 'Facture', quote: 'Devis', credit: 'Avoir' };

function isEI(co) { return /entrepreneur individuel|micro/i.test(co.legalForm || ''); }

/** Construit la vue normalisée d’un document (utilisée par l’aperçu et par le PDF). */
function docView(doc, opts) {
  opts = opts || {};
  const co = Store.company, cl = Store.client(doc.clientId), t = Store.totals(doc);
  const sign = doc.kind === 'credit' ? -1 : 1;
  const money = c => C.fmtEUR(sign * c, { plain: true });
  const draft = doc.status === 'draft';
  const missing = C.missingMentions(co, cl, doc);

  const seller = {
    brand: co.tradeName || co.legalName || 'Votre entreprise',
    legal: co.legalName ? co.legalName + (isEI(co) ? ' EI' : '') + (co.tradeName && co.legalForm && !isEI(co) ? ' — ' + co.legalForm : '') : '',
    lines: [
      co.address, [co.zip, co.city].filter(Boolean).join(' '),
      co.siret ? 'SIRET ' + co.siret : null,
      co.vatNumber ? 'N° TVA ' + co.vatNumber : null,
      co.rcs || null,
      [co.email, co.phone].filter(Boolean).join(' · ') || null,
      co.website || null,
    ].filter(Boolean),
  };
  const client = cl ? {
    name: cl.name,
    lines: [
      cl.contact ? 'À l’attention de ' + cl.contact : null,
      cl.address, [cl.zip, cl.city].filter(Boolean).join(' '),
      cl.country && cl.country !== 'France' ? cl.country : null,
      cl.siren ? 'SIREN ' + cl.siren : null,
      cl.vatNumber ? 'N° TVA ' + cl.vatNumber : null,
    ].filter(Boolean),
  } : { name: 'Client à choisir', lines: [] };

  const dates = [];
  if (doc.kind === 'quote') {
    dates.push(['Date', C.fmtDate(doc.issueDate)]);
    if (doc.validUntil) dates.push(['Valable jusqu’au', C.fmtDate(doc.validUntil)]);
  } else {
    dates.push(['Date d’émission', C.fmtDate(doc.issueDate)]);
    if (doc.kind === 'invoice' && doc.serviceDate) dates.push(['Date de la prestation', C.fmtDate(doc.serviceDate)]);
    if (doc.kind === 'invoice' && doc.dueDate) dates.push(['Échéance', C.fmtDate(doc.dueDate)]);
    if (doc.kind === 'credit' && doc.relatedInvoiceNumber) dates.push(['Facture d’origine', doc.relatedInvoiceNumber]);
  }

  const meta = [];
  meta.push(['Catégorie de l’opération', C.CATEGORIES[doc.category] || C.CATEGORIES.services]);
  if (doc.fromQuoteNumber) meta.push(['Référence devis', doc.fromQuoteNumber]);
  if (doc.deliveryAddress) meta.push(['Adresse de livraison', doc.deliveryAddress]);
  if (co.vatOnDebits && doc.kind !== 'quote' && co.vatRegime !== 'franchise') meta.push(['TVA', 'Option pour le paiement de la taxe d’après les débits']);

  const lines = (doc.lines || []).map(l => ({
    desc: l.description || '', details: l.details || '',
    qty: C.fmtNum(C.num(l.qty), true), unit: l.unit || '',
    pu: C.fmtEUR(C.cents(l.unitPrice), { plain: true }),
    vat: t.franchise ? '—' : C.fmtRate(C.num(l.vatRate)),
    discount: C.num(l.discount) ? '−' + C.fmtNum(C.num(l.discount), true) + ' %' : '',
    total: money(C.lineTotal(l)),
  }));

  const totals = [];
  if (t.discount) {
    totals.push({ label: 'Sous-total HT', value: money(t.gross) });
    totals.push({ label: 'Remise ' + C.fmtNum(C.num(doc.globalDiscount), true) + ' %', value: C.fmtEUR(-sign * t.discount, { plain: true }) });
  }
  totals.push({ label: 'Total HT', value: money(t.totalHT), strong: !t.discount ? false : true });
  if (!t.franchise) t.bases.forEach(b => totals.push({ label: 'TVA ' + C.fmtRate(b.rate) + (t.bases.length > 1 ? ' sur ' + C.fmtEUR(sign * b.base, { plain: true }) : ''), value: money(b.vat) }));
  totals.push({ label: t.franchise ? (doc.kind === 'credit' ? 'Total de l’avoir' : 'Net à payer') : (doc.kind === 'credit' ? 'Total TTC de l’avoir' : 'Total TTC'), value: money(t.totalTTC), band: true });
  if (doc.kind === 'invoice' && t.paid > 0) {
    totals.push({ label: 'Déjà réglé', value: C.fmtEUR(-t.paid, { plain: true }) });
    totals.push({ label: 'Reste à payer', value: C.fmtEUR(t.due, { plain: true }), strong: true });
  }

  const payment = [];
  if (doc.kind === 'invoice') {
    if (doc.dueDate) payment.push(['Échéance', C.fmtDate(doc.dueDate) + ' (' + Math.max(0, C.diffDays(doc.dueDate, doc.issueDate)) + ' jours)']);
    payment.push(['Règlement', doc.paymentMethod || co.defaultPaymentMethod || 'Virement']);
    if (co.iban) payment.push(['IBAN', co.iban]);
    if (co.bic) payment.push(['BIC', co.bic + (co.bank ? ' — ' + co.bank : '')]);
  } else if (doc.kind === 'quote') {
    payment.push(['Validité', doc.validUntil ? 'jusqu’au ' + C.fmtDate(doc.validUntil) : '30 jours']);
    payment.push(['Règlement', (doc.paymentMethod || 'Virement') + ' à ' + (co.paymentTermsDays || 30) + ' jours, après facturation']);
  } else {
    payment.push(['Imputation', 'À déduire de la facture ' + (doc.relatedInvoiceNumber || '') + ' ou à rembourser']);
  }

  const legal = [];
  if (t.franchise) legal.push('TVA non applicable, art. 293 B du CGI.');
  if (doc.kind !== 'quote') {
    if (co.latePenalty) legal.push(co.latePenalty);
    if (co.recoveryFee && (!cl || cl.type !== 'particulier')) legal.push(co.recoveryFee);
    if (co.discountTerms) legal.push(co.discountTerms);
  }
  if (co.footerNote) legal.push(co.footerNote);

  const footer = [seller.brand, seller.legal, [co.address, co.zip, co.city].filter(Boolean).join(' '), co.siret ? 'SIRET ' + co.siret : null].filter(Boolean).join(' — ');

  return {
    kind: doc.kind, title: PDF_TITLES[doc.kind], number: draft ? null : doc.number, draft,
    color: co.docColor || '#0058d0', logo: co.logo, logoW: co.logoW, logoH: co.logoH,
    seller, client, dates, meta, lines, totals, payment, legal, footer,
    notes: doc.notes || '', signature: doc.kind === 'quote',
    missing, demo: !LIVE && !opts.noDemo,
    filename: (draft ? 'brouillon-' + (PDF_TITLES[doc.kind] || 'document').toLowerCase() : doc.number) + '.pdf',
  };
}

/* ---------- aperçu HTML (format A4 réel, mis à l’échelle) ---------- */
function previewHTML(v) {
  const miss = name => v.missing.includes(name);
  const ph = label => `<span class="inv-missing" title="Mention obligatoire manquante">${esc(label)}</span>`;
  const sellerLines = v.seller.lines.map(esc);
  if (miss('SIRET de l’entreprise')) sellerLines.push(ph('SIRET manquant'));
  if (miss('N° de TVA intracommunautaire')) sellerLines.push(ph('N° TVA ou franchise à préciser'));
  const clientLines = v.client.lines.map(esc);
  if (miss('Adresse du client')) clientLines.push(ph('Adresse du client'));
  if (miss('SIREN du client')) clientLines.push(ph('SIREN du client'));
  return `
<div class="inv-sheet" style="--doc:${esc(v.color)}">
  ${v.draft ? '<div class="inv-watermark">Brouillon</div>' : ''}
  <div class="inv-topline"></div>
  <header class="inv-head">
    <div class="inv-seller">
      ${v.logo ? `<img class="inv-logo" src="${esc(v.logo)}" alt="">` : `<div class="inv-brand"><svg viewBox="0 0 24 24" class="inv-crown" aria-hidden="true">${ICONS.crown}</svg>${esc(v.seller.brand)}</div>`}
      ${v.seller.legal ? `<div class="inv-legal">${esc(v.seller.legal)}</div>` : ''}
      <div class="inv-small">${sellerLines.join('<br>')}</div>
    </div>
    <div class="inv-docid">
      <div class="inv-title">${esc(v.title)}</div>
      <div class="inv-number">${v.number ? 'N° ' + esc(v.number) : '<span class="inv-draftnum">Numéro attribué à l’émission</span>'}</div>
      <table class="inv-dates">${v.dates.map(d => `<tr><td>${esc(d[0])}</td><td>${esc(d[1])}</td></tr>`).join('')}</table>
    </div>
  </header>
  <section class="inv-parties">
    <div class="inv-meta">${v.meta.map(m => `<div><span>${esc(m[0])}</span><strong>${esc(m[1])}</strong></div>`).join('')}</div>
    <div class="inv-client">
      <div class="inv-label">${v.kind === 'quote' ? 'Client' : v.kind === 'credit' ? 'Avoir au profit de' : 'Facturé à'}</div>
      <div class="inv-client-name">${miss('Client') ? ph('Choisis un client') : esc(v.client.name)}</div>
      <div class="inv-small">${clientLines.join('<br>')}</div>
    </div>
  </section>
  <table class="inv-lines">
    <thead><tr><th class="c-desc">Désignation</th><th class="c-num">Qté</th><th>Unité</th><th class="c-num">PU HT</th><th class="c-num">TVA</th><th class="c-num">Total HT</th></tr></thead>
    <tbody>${v.lines.length ? v.lines.map(l => `<tr><td class="c-desc"><div class="inv-desc">${esc(l.desc) || '<span class="inv-muted">Désignation</span>'}</div>${l.details ? `<div class="inv-details">${nl2br(l.details)}</div>` : ''}${l.discount ? `<div class="inv-details">Remise ${esc(l.discount)}</div>` : ''}</td><td class="c-num">${esc(l.qty)}</td><td>${esc(l.unit)}</td><td class="c-num">${esc(l.pu)}</td><td class="c-num">${esc(l.vat)}</td><td class="c-num">${esc(l.total)}</td></tr>`).join('') : `<tr><td colspan="6" class="inv-empty">Ajoute une première ligne pour voir le détail ici.</td></tr>`}</tbody>
  </table>
  <section class="inv-bottom">
    <div class="inv-pay">
      ${v.payment.map(p => `<div class="inv-payrow"><span>${esc(p[0])}</span><strong>${esc(p[1])}</strong></div>`).join('')}
      ${v.notes ? `<div class="inv-notes">${nl2br(v.notes)}</div>` : ''}
      ${v.signature ? '<div class="inv-sign"><span>Bon pour accord</span><small>Date, signature et cachet du client</small></div>' : ''}
    </div>
    <div class="inv-totals">${v.totals.map(t => `<div class="inv-trow${t.band ? ' band' : ''}${t.strong ? ' strong' : ''}"><span>${esc(t.label)}</span><span>${esc(t.value)}</span></div>`).join('')}</div>
  </section>
  <footer class="inv-foot">
    ${v.legal.length ? `<div class="inv-mentions">${v.legal.map(esc).join('<br>')}</div>` : ''}
    <div class="inv-footline"><span>${esc(v.footer)}</span><span>Page 1/1</span></div>
    ${v.demo ? '<div class="inv-demo">Document de démonstration — sans valeur</div>' : ''}
  </footer>
</div>`;
}

/** Monte un aperçu A4 mis à l’échelle dans `host` et renvoie une fonction de mise à jour. */
function mountPreview(host) {
  host.classList.add('inv-frame');
  host.innerHTML = '<div class="inv-scale"></div>';
  const scaleEl = host.firstChild;
  let raf = 0;
  const fit = () => {
    const sheet = scaleEl.firstElementChild; if (!sheet) return;
    const w = host.clientWidth; if (!w) return;
    const s = Math.min(1.2, w / 793.7);
    scaleEl.style.transform = `scale(${s})`;
    host.style.height = Math.ceil(sheet.offsetHeight * s) + 'px';
  };
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
  ro.observe(host);
  return {
    render(doc) { scaleEl.innerHTML = previewHTML(docView(doc)); fit(); },
    renderEmpty(text) { scaleEl.innerHTML = '<div class="inv-sheet inv-sheet-empty"><p>' + esc(text) + '</p></div>'; fit(); },
    destroy() { ro.disconnect(); },
  };
}

/* ---------- PDF ---------- */
async function ensureJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
  await loadScript(CFG.vendor.jspdf);
  return window.jspdf.jsPDF;
}
function hexRgb(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 88, 208];
}
function mix(rgb, w, t) { return rgb.map((c, i) => Math.round(c + (w[i] - c) * t)); }

async function buildPDF(doc) {
  const jsPDF = await ensureJsPDF();
  const v = docView(doc);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 16, R = W - M;
  const ink = [29, 29, 31], grey = [94, 101, 115], light = [138, 144, 155], rule = [228, 231, 236];
  const col = hexRgb(v.color), tint = mix(col, [255, 255, 255], 0.9);
  const clean = s => String(s || '').replace(/[ ]/g, ' ').replace(/−/g, '-');
  pdf.setProperties({ title: v.title + (v.number ? ' ' + v.number : ' (brouillon)'), subject: v.title, author: v.seller.brand, creator: 'KingDream Control' });
  const txt = (s, x, y, o) => pdf.text(clean(s), x, y, o);
  const font = (style, size, color) => { pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...(color || ink)); };
  const lh = size => size * 0.3528 * 1.32; // hauteur de ligne en mm

  function pageChrome(first) {
    pdf.setFillColor(...col); pdf.rect(0, 0, W, 2.2, 'F');
    if (v.draft) {
      pdf.saveGraphicsState();
      pdf.setGState(new pdf.GState({ opacity: 0.07 }));
      font('bold', 92, col); txt('BROUILLON', W / 2, H / 2 + 20, { align: 'center', angle: 32 });
      pdf.restoreGraphicsState();
    }
    if (!first) { font('bold', 9, grey); txt(v.title + (v.number ? ' ' + v.number : '') + ' (suite)', M, 12); }
  }

  /* -- en-tête -- */
  pageChrome(true);
  let y = M + 2;
  if (v.logo) {
    try {
      const ratio = (v.logoW && v.logoH) ? v.logoW / v.logoH : 3;
      const hh = Math.min(16, 38 / ratio), ww = hh * ratio;
      pdf.addImage(v.logo, M, y - 2, ww, hh);
      y += hh + 2;
    } catch (e) { font('bold', 15, ink); txt(v.seller.brand, M, y + 4); y += 8; }
  } else {
    pdf.setDrawColor(...col); pdf.setLineWidth(0.5); pdf.setLineJoin('round'); pdf.setLineCap('round');
    // couronne (même tracé que l’icône de l’interface)
    const u = 0.38, ox = M - 3.5 * u, oy = (y + 4.4 - 1.85) - 13.25 * u;
    pdf.lines([[4.2, 3.6], [4.3, -6.6], [4.3, 6.6], [4.2, -3.6], [-1.6, 9.5], [-13.8, 0]], ox + 3.5 * u, oy + 8.5 * u, [u, u], 'S', true);
    pdf.line(ox + 5.5 * u, oy + 21 * u, ox + 18.5 * u, oy + 21 * u);
    font('bold', 15, ink); txt(v.seller.brand, M + 17 * u + 3, y + 4.4);
    y += 9;
  }
  if (v.seller.legal) { font('bold', 8.5, ink); txt(v.seller.legal, M, y); y += lh(8.5); }
  font('normal', 8.5, grey);
  v.seller.lines.forEach(l => { txt(l, M, y); y += lh(8.5); });
  const sellerBottom = y;

  // bloc document (droite)
  let ry = M + 4.6;
  font('bold', 22, col); txt(v.title.toUpperCase(), R, ry, { align: 'right' }); ry += 7.5;
  font('bold', 10.5, ink); txt(v.number ? 'N° ' + v.number : 'Brouillon (non numéroté)', R, ry, { align: 'right' }); ry += 6;
  v.dates.forEach(d => {
    font('normal', 8.5, grey); txt(d[0], R - 26, ry, { align: 'right' });
    font('bold', 8.5, ink); txt(d[1], R, ry, { align: 'right' });
    ry += lh(8.5) + 0.4;
  });

  /* -- parties -- */
  y = Math.max(sellerBottom, ry) + 7;
  const boxX = 112, boxW = R - boxX;
  const clientLines = [v.client.name].concat(v.client.lines);
  const boxH = 9 + clientLines.length * lh(9) + 2;
  pdf.setFillColor(...tint); pdf.roundedRect(boxX, y, boxW, boxH, 2.2, 2.2, 'F');
  font('normal', 7.5, col); txt(v.kind === 'quote' ? 'Client' : v.kind === 'credit' ? 'Avoir au profit de' : 'Facturé à', boxX + 5, y + 5.5);
  font('bold', 10.5, ink); txt(v.client.name, boxX + 5, y + 10.6);
  font('normal', 8.8, grey);
  let cy2 = y + 10.6 + lh(10.5);
  v.client.lines.forEach(l => { pdf.splitTextToSize(clean(l), boxW - 10).forEach(p => { txt(p, boxX + 5, cy2); cy2 += lh(8.8); }); });
  let my = y + 5.5;
  v.meta.forEach(m => {
    font('normal', 7.5, light); txt(m[0], M, my); my += lh(7.5);
    font('bold', 9, ink); pdf.splitTextToSize(clean(m[1]), boxX - M - 8).forEach(p => { txt(p, M, my); my += lh(9); });
    my += 1.6;
  });
  y = Math.max(y + boxH, cy2, my) + 8;

  /* -- tableau des lignes -- */
  const cols = [
    { k: 'desc', x: M + 3, w: 84, align: 'left', label: 'Désignation' },
    { k: 'qty', x: 118, align: 'right', label: 'Qté' },
    { k: 'unit', x: 121, align: 'left', label: 'Unité' },
    { k: 'pu', x: 157, align: 'right', label: 'PU HT' },
    { k: 'vat', x: 172, align: 'right', label: 'TVA' },
    { k: 'total', x: R - 3, align: 'right', label: 'Total HT' },
  ];
  const bottomLimit = H - 30;
  function tableHeader() {
    pdf.setFillColor(...tint); pdf.rect(M, y, R - M, 8, 'F');
    font('bold', 8, col);
    cols.forEach(c => txt(c.label, c.x, y + 5.3, { align: c.align }));
    y += 8;
  }
  tableHeader();
  v.lines.forEach(l => {
    font('normal', 9.4, ink);
    const dl = pdf.splitTextToSize(clean(l.desc), cols[0].w);
    font('normal', 8, grey);
    const det = l.details ? pdf.splitTextToSize(clean(l.details), cols[0].w) : [];
    if (l.discount) det.push('Remise ' + l.discount);
    const rowH = 3.4 + dl.length * lh(9.4) + det.length * lh(8) + 2.2;
    if (y + rowH > bottomLimit) { pdf.addPage(); pageChrome(false); y = M + 2; tableHeader(); }
    let ty = y + 3.4 + 2.4;
    font('normal', 9.4, ink); dl.forEach(p => { txt(p, cols[0].x, ty); ty += lh(9.4); });
    font('normal', 8, grey); det.forEach(p => { txt(p, cols[0].x, ty); ty += lh(8); });
    const vy = y + 3.4 + 2.4;
    font('normal', 9.2, ink);
    txt(l.qty, cols[1].x, vy, { align: 'right' }); txt(l.unit, cols[2].x, vy);
    txt(l.pu, cols[3].x, vy, { align: 'right' }); txt(l.vat, cols[4].x, vy, { align: 'right' });
    font('bold', 9.2, ink); txt(l.total, cols[5].x, vy, { align: 'right' });
    y += rowH;
    pdf.setDrawColor(...rule); pdf.setLineWidth(0.25); pdf.line(M, y, R, y);
  });

  /* -- totaux + règlement -- */
  const totalsH = v.totals.length * 7 + 6;
  const payH = v.payment.length * 9 + (v.notes ? 18 : 0) + (v.signature ? 32 : 0);
  if (y + Math.max(totalsH, payH) + 6 > bottomLimit) { pdf.addPage(); pageChrome(false); y = M + 4; }
  y += 6;
  const tx = 122, tw = R - tx;
  let ty = y;
  v.totals.forEach(t => {
    if (t.band) {
      pdf.setFillColor(...col); pdf.roundedRect(tx, ty - 1, tw, 9, 1.6, 1.6, 'F');
      font('bold', 10.5, [255, 255, 255]); txt(t.label, tx + 4, ty + 5); txt(t.value, R - 4, ty + 5, { align: 'right' });
      ty += 11;
    } else {
      font(t.strong ? 'bold' : 'normal', 9, t.strong ? ink : grey); txt(t.label, tx + 4, ty + 4);
      font(t.strong ? 'bold' : 'normal', 9, ink); txt(t.value, R - 4, ty + 4, { align: 'right' });
      ty += 6.4;
    }
  });
  let py = y;
  v.payment.forEach(p => {
    font('normal', 7.5, light); txt(p[0], M, py + 3); py += lh(7.5);
    font('bold', 9, ink); pdf.splitTextToSize(clean(p[1]), tx - M - 10).forEach(s => { txt(s, M, py + 3); py += lh(9); });
    py += 1.8;
  });
  if (v.notes) {
    py += 2; font('normal', 8.5, grey);
    pdf.splitTextToSize(clean(v.notes), tx - M - 10).forEach(s => { txt(s, M, py + 3); py += lh(8.5); });
  }
  if (v.signature) {
    py += 4;
    pdf.setDrawColor(...rule); pdf.setLineWidth(0.35); pdf.roundedRect(M, py, 78, 28, 2, 2, 'S');
    font('bold', 8.5, ink); txt('Bon pour accord', M + 4, py + 6);
    font('normal', 7.5, light); txt('Date, signature et cachet du client', M + 4, py + 10.5);
  }

  /* -- pied de page sur chaque page -- */
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    let fy = H - 12;
    if (v.legal.length && i === pages) {
      font('normal', 7, light);
      const leg = pdf.splitTextToSize(clean(v.legal.join(' ')), R - M);
      fy = H - 12 - leg.length * lh(7) - 1;
      leg.forEach((s, k) => txt(s, M, fy + k * lh(7)));
      fy = H - 12;
    }
    pdf.setDrawColor(...rule); pdf.setLineWidth(0.25); pdf.line(M, H - 9.5, R, H - 9.5);
    font('normal', 6.8, light);
    const fl = pdf.splitTextToSize(clean(v.footer), R - M - 22)[0];
    txt(fl, M, H - 5.8);
    txt('Page ' + i + '/' + pages, R, H - 5.8, { align: 'right' });
    if (v.demo) { font('italic', 6.5, light); txt('Document de démonstration — sans valeur', W / 2, H - 2.6, { align: 'center' }); }
  }
  return { pdf, view: v };
}

async function pdfBlob(doc) { const { pdf } = await buildPDF(doc); return pdf.output('blob'); }
async function pdfBase64(doc) { const { pdf } = await buildPDF(doc); return pdf.output('datauristring').split(',')[1]; }
async function downloadPDF(doc) {
  try {
    const { pdf, view } = await buildPDF(doc);
    await offerDownload(view.filename, pdf.output('blob'));
  } catch (e) {
    toast('Le PDF n’a pas pu être généré : ' + (e.message || e), { tone: 'crit' });
  }
}

/* ---- js/app.js ---- */
/* ===== Coquille de l’application : navigation, barre du haut, recherche, Kingo, verrouillage ===== */
const Views = {};
const ROUTES = [
  { key: 'accueil', label: 'Tableau de bord', icon: 'dashboard', view: 'dashboard', group: 'Pilotage' },
  { key: 'serveurs', label: 'Serveurs', icon: 'server', view: 'servers', group: 'Pilotage' },
  { key: 'clients', label: 'Clients', icon: 'users', view: 'clients', group: 'Pilotage' },
  { key: 'facturation', label: 'Facturation', icon: 'file', view: 'billing', group: 'Pilotage' },
  { key: 'securite', label: 'Sécurité', icon: 'shield', view: 'security', group: 'Compte' },
  { key: 'reglages', label: 'Réglages', icon: 'sliders', view: 'settings', group: 'Compte' },
];

const App = {
  view: null, route: null, lastActivity: Date.now(), kingo: null, brief: [],
  idleFor() { return Date.now() - this.lastActivity; },

  async start() {
    applyTheme(store_local.get('kdc-theme', 'light'));
    if (LIVE) {
      let sess;
      try { sess = await API.get('/api/session'); } catch (e) { return Auth.renderError(e); }
      API.csrf = sess.csrf;
      if (!sess.authenticated) return Auth.render(sess);
      return this.boot();
    }
    await this.boot();
  },

  async boot() {
    let bootData = null;
    if (LIVE) {
      bootData = await API.get('/api/bootstrap');
      API.csrf = bootData.csrf || API.csrf;
    }
    await Store.init(bootData);
    this.renderShell();
    if (this.kingo) this.kingo.destroy();
    this.kingo = new Kingo();
    this.kingo.onWake = () => { this.lastActivity = Date.now(); this.kingo.setMood('salut', 1800); this.refreshBrief(); };
    this.kingo.onDizzy = () => this.kingoSay('Doucement… je vois des étoiles.', { mood: 'etourdi', duration: 3200 });
    this.kingo.onPoke = n => { if (this.kingoHome === 'hero') Views.dashboard.nextTalk(); else if (n === 1) this.toggleBriefPanel(); };
    this._critSig = undefined;
    this.refreshBrief();
    if (!this._wired) {
      // écouteurs globaux posés une seule fois, même après une reconnexion
      this._wired = true;
      window.addEventListener('hashchange', () => { if (Store.state) this.navigate(); });
      ['pointerdown', 'keydown', 'wheel'].forEach(ev => window.addEventListener(ev, () => {
        const wasIdle = this.idleFor() > 180000;
        this.lastActivity = Date.now();
        if (wasIdle && this.kingo) this.refreshBrief();
      }, { passive: true }));
      window.addEventListener('pointermove', throttle(() => { this.lastActivity = Date.now(); }, 2000), { passive: true });
      // barre du haut en verre dès que la page défile (le grand titre se réduit)
      let raf = 0;
      window.addEventListener('scroll', () => {
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; const tb = $('.topbar'); if (tb) tb.classList.toggle('scrolled', window.scrollY > 8); });
      }, { passive: true });
      document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && $('#page')) { e.preventDefault(); Search.open(); }
      });
      Store.on((type, p) => this.onStore(type, p));
      setInterval(() => {
        Store.today = todayISO();
        if (LIVE && Store.state && this.idleFor() > 30 * 60000) { Auth.lock(true); return; } // verrouillage auto après 30 min
        if ($('#page')) this.refreshBrief();
      }, 30000);
    }
    this.view = null;
    this.navigate();
    if (LIVE) Live.connect(); else Sim.start();
    if (!LIVE) setTimeout(() => this.kingo.setMood('salut', 2200), 600);
    else this.kingo.setMood('salut', 2200);
    this.ownerCheck();
  },

  /** Aperçu réservé au propriétaire : si la visionneuse indique un autre visiteur, on masque tout.
      La version de présentation (données fictives, faite pour être montrée aux clients) n’a pas ce verrou. */
  async ownerCheck() {
    if (LIVE || CFG.presentation || !window.claude || !window.claude.use) return;
    try {
      const user = await window.claude.use('user');
      if (user && !(await user.isOwner())) {
        document.body.innerHTML = '<div class="owner-lock"><div class="owner-lock-card">' + icon('lock') + '<h1>Accès réservé</h1><p>KingDream Control n’est consultable que par son propriétaire.</p></div></div>';
      }
    } catch (e) { /* visionneuse indisponible : aperçu normal */ }
  },

  renderShell() {
    const me = Store.state.me || {};
    document.body.classList.add('kdc');
    const root = document.getElementById('app');
    root.className = 'app';
    root.innerHTML = `
      <aside class="rail" aria-label="Navigation principale">
        <a class="brand" href="#accueil" aria-label="KingDream Control, tableau de bord">
          <span class="brand-mark">${icon('crown')}</span>
          <span class="brand-text"><span class="brand-name">King<b>Dream</b></span><span class="brand-sub">Control</span></span>
        </a>
        <nav class="nav">${ROUTES.map((r, i) => (i === 0 || ROUTES[i - 1].group !== r.group ? `<p class="nav-group">${r.group}</p>` : '') + `<a href="#${r.key}" data-nav="${r.key}" class="nav-item" title="${r.label}">${icon(r.icon)}<span class="nav-label">${r.label}</span><b class="nav-badge" hidden></b></a>`).join('')}</nav>
        <div class="rail-foot">
          ${LIVE ? '' : CFG.presentation ? '<div class="demo-note"><strong>Démonstration</strong><span>Clients, serveurs et montants sont fictifs. La version installée se connecte aux vrais serveurs.</span></div>' : '<div class="demo-note"><strong>Mode démo</strong><span>Données fictives. La version installée se connecte à tes vrais serveurs.</span></div>'}
          <div class="me">${avatar(me.name || 'Admin', 214)}<div class="me-text"><strong>${esc(me.name || 'Administrateur')}</strong><span>${me.twoFactor ? icon('shield', 'i-xs') + ' 2FA active' : 'Administrateur'}</span></div>
            <div class="rail-actions">
              <button class="icon-btn icon-btn-sm" type="button" data-act="theme" aria-label="Changer de thème" title="Thème clair ou sombre">${icon(document.documentElement.getAttribute('data-kdc-theme') === 'dark' ? 'sun' : 'moon')}</button>
              <button class="icon-btn icon-btn-sm" type="button" data-act="lock" aria-label="Verrouiller la session" title="Verrouiller">${icon('lock')}</button>
            </div></div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <a class="topbar-brand" href="#accueil" aria-label="Tableau de bord">${icon('crown')}</a>
          <h1 class="page-title" id="pageTitle">Tableau de bord</h1>
          <div class="topbar-tools">
            <button class="search-trigger" type="button" data-act="search">${icon('search')}<span>Rechercher</span><kbd>${/Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent) ? '⌘ K' : 'Ctrl K'}</kbd></button>
            <div class="menu-wrap">
              <button class="btn btn-primary btn-new" type="button" data-act="new" aria-haspopup="true" aria-expanded="false">${icon('plus')}<span>Nouveau</span></button>
              <div class="menu" id="newMenu" role="menu" hidden>
                <button role="menuitem" data-new="invoice">${icon('file')}Facture</button>
                <button role="menuitem" data-new="quote">${icon('quote')}Devis</button>
                <button role="menuitem" data-new="payment">${icon('card')}Paiement reçu</button>
                <hr>
                <button role="menuitem" data-new="client">${icon('user')}Client</button>
                <button role="menuitem" data-new="server">${icon('server')}Serveur</button>
              </div>
            </div>
            <div class="menu-wrap">
              <button class="icon-btn bell" type="button" data-act="bell" aria-label="Alertes" aria-haspopup="true">${icon('bell')}<b class="bell-badge" hidden></b></button>
              <div class="menu menu-wide" id="bellMenu" hidden></div>
            </div>
          </div>
        </header>
        <main class="page" id="page" tabindex="-1"></main>
      </div>
      <nav class="tabbar" aria-label="Navigation">
        ${['accueil', 'serveurs', 'clients', 'facturation'].map(k => { const r = ROUTES.find(x => x.key === k); return `<a href="#${k}" data-nav="${k}" class="tab">${icon(r.icon)}<span>${k === 'accueil' ? 'Accueil' : k === 'facturation' ? 'Factures' : r.label}</span><b class="nav-badge" hidden></b></a>`; }).join('')}
        <button class="tab" type="button" data-act="more">${icon('menu')}<span>Plus</span></button>
      </nav>
      <div class="kingo-dock" id="kingoDock">
        <div class="dock-bubble" id="dockBubble" hidden></div>
        <div class="dock-panel" id="dockPanel" hidden></div>
        <div class="dock-kingo" id="dockKingo"><b class="dock-count" hidden></b></div>
      </div>`;
    root.addEventListener('click', e => this.onClick(e));
    document.addEventListener('click', e => {
      if (!e.target.closest('.menu-wrap')) $$('.menu').forEach(m => { m.hidden = true; });
      if (!e.target.closest('.kingo-dock')) { const p = $('#dockPanel'); if (p) p.hidden = true; }
    });
  },

  onClick(e) {
    const a = e.target.closest('[data-act]');
    const n = e.target.closest('[data-new]');
    if (n) { $('#newMenu').hidden = true; return this.create(n.dataset.new); }
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'theme') { const next = document.documentElement.getAttribute('data-kdc-theme') === 'dark' ? 'light' : 'dark'; applyTheme(next); store_local.set('kdc-theme', next); }
    if (act === 'lock') Auth.lock();
    if (act === 'search') Search.open();
    if (act === 'new') { const m = $('#newMenu'); m.hidden = !m.hidden; a.setAttribute('aria-expanded', String(!m.hidden)); $('#bellMenu').hidden = true; }
    if (act === 'bell') { const m = $('#bellMenu'); this.renderBell(); m.hidden = !m.hidden; $('#newMenu').hidden = true; }
    if (act === 'more') this.moreSheet();
  },

  create(kind) {
    if (kind === 'invoice' || kind === 'quote') return this.go('nouveau-' + (kind === 'invoice' ? 'facture' : 'devis'));
    if (kind === 'client') return Views.clients.editDialog(null);
    if (kind === 'server') return Views.servers.editDialog(null);
    if (kind === 'payment') return Views.billing.paymentPicker();
  },

  moreSheet() {
    const d = dialog({
      title: 'Plus', className: 'dialog-sheet',
      body: `<div class="sheet-links">
        <a href="#securite" class="sheet-link">${icon('shield')}<span>Sécurité<small>2FA, sessions, clés SSH, journal</small></span></a>
        <a href="#reglages" class="sheet-link">${icon('sliders')}<span>Réglages<small>Entreprise, TVA, numérotation, emails</small></span></a>
        <a href="#devis" class="sheet-link">${icon('quote')}<span>Devis</span></a>
        <a href="#paiements" class="sheet-link">${icon('card')}<span>Paiements</span></a>
        <a href="#catalogue" class="sheet-link">${icon('box')}<span>Catalogue</span></a>
        <button class="sheet-link" type="button" data-sheet="search">${icon('search')}<span>Rechercher</span></button>
        <button class="sheet-link" type="button" data-sheet="theme">${icon('moon')}<span>Changer de thème</span></button>
        <button class="sheet-link" type="button" data-sheet="lock">${icon('lock')}<span>Verrouiller</span></button>
      </div>`,
    });
    d.el.addEventListener('click', e => {
      const l = e.target.closest('.sheet-link'); if (!l) return;
      d.close();
      const s = l.dataset.sheet;
      if (s === 'search') Search.open();
      if (s === 'theme') $('[data-act="theme"]').click();
      if (s === 'lock') Auth.lock();
    });
  },

  go(route) {
    if (('#' + route) === location.hash) this.navigate();
    else location.hash = route;
  },

  navigate() {
    const h = decodeURIComponent((location.hash || '').slice(1)) || 'accueil';
    closeAllLayers();
    let view = 'dashboard', params = {}, nav = 'accueil', title = 'Tableau de bord';
    let m;
    if (h === 'accueil') { /* défaut */ }
    else if (h === 'serveurs' || (m = /^serveur-(.+)$/.exec(h))) { view = 'servers'; nav = 'serveurs'; title = 'Serveurs'; if (m) params.open = m[1]; }
    else if (h === 'clients') { view = 'clients'; nav = 'clients'; title = 'Clients'; }
    else if ((m = /^client-(.+)$/.exec(h))) { view = 'clients'; nav = 'clients'; title = 'Fiche client'; params.id = m[1]; }
    else if ((m = /^(facturation|devis|avoirs|paiements|catalogue)(?:-(.+))?$/.exec(h))) {
      view = 'billing'; nav = 'facturation'; title = 'Facturation';
      params.tab = m[1] === 'facturation' ? 'invoice' : m[1] === 'devis' ? 'quote' : m[1] === 'avoirs' ? 'credit' : m[1] === 'paiements' ? 'payments' : 'catalog';
      params.filter = m[2] || null;
    }
    else if ((m = /^doc-(.+)$/.exec(h))) { view = 'editor'; nav = 'facturation'; title = 'Facturation'; params.id = m[1]; }
    else if ((m = /^nouveau-(facture|devis|avoir)(?:-(.+))?$/.exec(h))) { view = 'editor'; nav = 'facturation'; title = 'Facturation'; params.kind = m[1] === 'facture' ? 'invoice' : m[1] === 'devis' ? 'quote' : 'credit'; params.clientId = m[2] || null; }
    else if (h === 'securite') { view = 'security'; nav = 'securite'; title = 'Sécurité'; }
    else if ((m = /^reglages(?:-(.+))?$/.exec(h))) { view = 'settings'; nav = 'reglages'; title = 'Réglages'; params.section = m && m[1]; }
    if (this.view && this.view.destroy) this.view.destroy();
    // nouvel élément à chaque navigation : les écouteurs de la vue précédente disparaissent avec lui
    const old = $('#page');
    const page = old.cloneNode(false);
    old.replaceWith(page);
    page.className = 'page page-' + view;
    $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    $('#pageTitle').textContent = title;
    document.title = (title === 'Tableau de bord' ? '' : title + ' — ') + 'KingDream Control';
    this.route = { view, params, hash: h };
    this.view = Views[view];
    try {
      this.view.render(page, params);
    } catch (e) {
      console.error(e);
      page.innerHTML = emptyState('Cette page n’a pas pu s’afficher.', e.message);
    }
    this.placeKingo();
    this.updateBadges();
    if (!this._firstNav) { this._firstNav = true; } else { page.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  },

  onStore(type, p) {
    if (type === 'change' || type === 'metrics' || type === 'alerts') {
      this.updateBadges();
      if (this.view && this.view.update) this.view.update(type, p || {});
      if (type !== 'metrics') this.refreshBrief();
      else this.refreshBriefSoft();
    }
    if (type === 'change' && p) {
      if (p.recovered) { const s = Store.server(p.recovered); this.kingoSay(s.name + ' (' + Store.clientName(s.clientId) + ') répond de nouveau. Ouf !', { mood: 'fier', fx: 'sparkle' }); }
      if (p.payment && p.paidInFull) { this.kingo.react('coin'); this.kingoSay('Facture soldée, bien joué !', { mood: 'fier', fx: 'sparkle' }); }
      else if (p.payment) { this.kingo.react('coin'); }
    }
  },
  refreshBriefSoft: throttle(function () { App.refreshBrief(); }, 9000),

  updateBadges() {
    const k = Store.kpis();
    const set = (key, n, tone) => $$(`[data-nav="${key}"] .nav-badge`).forEach(b => { b.hidden = !n; b.textContent = n; b.className = 'nav-badge' + (tone ? ' nav-badge-' + tone : ''); });
    set('serveurs', k.serversCrit + k.serversWarn, k.serversCrit ? 'crit' : 'warn');
    set('facturation', k.overdueCount, 'crit');
    const bb = $('.bell-badge'); if (bb) { bb.hidden = !k.alerts; bb.textContent = k.alerts; }
  },

  renderBell() {
    const al = Store.openAlerts();
    const m = $('#bellMenu');
    m.innerHTML = `<div class="menu-head"><strong>Alertes techniques</strong><span>${al.length ? fmt.plural(al.length, 'ouverte') : 'Aucune'}</span></div>` +
      (al.length ? al.map(a => { const s = Store.server(a.serverId); return `<a class="alert-item" href="#serveur-${esc(a.serverId)}"><span class="sev sev-${a.level}">${icon(a.level === 'info' ? 'info' : 'alert')}</span><span class="alert-text"><strong>${esc(a.title)}</strong><span>${esc(s ? s.name + ' · ' + Store.clientName(a.clientId || s.clientId) : '')} · ${esc(fmt.rel(a.openedAt))}</span></span></a>`; }).join('') : '<p class="menu-empty">Tout est calme sur tes serveurs.</p>') +
      `<a class="menu-foot" href="#serveurs">Voir tous les serveurs</a>`;
  },

  /* ---------- Kingo ---------- */
  placeKingo() {
    if (!this.kingo) return;
    const enabled = Store.company.mascotEnabled !== false;
    const hero = $('#heroKingo');
    const dock = $('#kingoDock');
    if (hero && enabled) {
      this.kingo.mount(hero, 184);
      this.kingoHome = 'hero';
      dock.classList.add('dock-hidden');
    } else {
      this.kingo.mount($('#dockKingo'), 76);
      this.kingoHome = 'dock';
      dock.classList.toggle('dock-hidden', !enabled);
    }
    const ctx = this.route && this.route.view === 'editor' ? 'concentre' : null;
    if (ctx) this.kingo.setMood(ctx, 4000);
  },

  refreshBrief() {
    if (!this.kingo) return;
    this.brief = buildBrief();
    const mood = briefMood(this.brief);
    this.kingo.setBase(mood.mood, mood.tone);
    const urgent = this.brief.filter(i => i.level === 'crit' || i.level === 'warn').length;
    const c = $('.dock-count');
    if (c) { c.hidden = !urgent; c.textContent = urgent; c.className = 'dock-count' + (this.brief.some(i => i.level === 'crit') ? ' crit' : ''); }
    if (this.route && this.route.view === 'dashboard' && Views.dashboard.renderTalk) Views.dashboard.renderTalk();
    const panel = $('#dockPanel'); if (panel && !panel.hidden) this.renderBriefPanel();
    const sig = this.brief.filter(i => i.level === 'crit').map(i => i.id).join(',');
    if (this._critSig !== undefined && sig && sig !== this._critSig) { this.kingo.react('shake'); this.kingo.setMood('panique', 2600); this.kingoSay(this.brief[0].title, { tone: 'crit' }); }
    this._critSig = sig;
  },

  toggleBriefPanel() {
    const p = $('#dockPanel');
    p.hidden = !p.hidden;
    $('#dockBubble').hidden = true;
    if (!p.hidden) this.renderBriefPanel();
  },
  renderBriefPanel() {
    const p = $('#dockPanel');
    const name = Store.company.mascotName || 'Kingo';
    p.innerHTML = `<div class="dock-panel-head"><div><strong>${esc(name)}</strong><span>${esc(greeting())} — ${esc(briefHeadline(this.brief))}</span></div><button class="icon-btn" type="button" data-close aria-label="Fermer">${icon('x')}</button></div>
      <ol class="brief-list">${this.brief.map((it, i) => briefItemHTML(it, i)).join('')}</ol>`;
    p.querySelector('[data-close]').addEventListener('click', () => { p.hidden = true; });
    bindBriefActions(p, this.brief);
  },

  kingoSay(text, opts) {
    opts = opts || {};
    if (!this.kingo) return;
    if (opts.mood) this.kingo.setMood(opts.mood, opts.duration || 3200);
    if (opts.fx) this.kingo.react(opts.fx);
    else this.kingo.react('hop');
    if (this.kingoHome === 'hero' && Views.dashboard.flash) { Views.dashboard.flash(text, opts); return; }
    const b = $('#dockBubble');
    if (!b) return;
    b.textContent = text;
    b.className = 'dock-bubble' + (opts.tone ? ' tone-' + opts.tone : '');
    b.hidden = false;
    $('#dockPanel').hidden = true;
    clearTimeout(this._bubbleT);
    this._bubbleT = setTimeout(() => { b.hidden = true; }, opts.duration || 5200);
  },

  sessionExpired() { Auth.lock(true); },
};

function briefItemHTML(it, i) {
  return `<li class="brief-item lvl-${it.level}">
    <span class="brief-ico">${icon(it.icon || 'info')}</span>
    <div class="brief-body"><p class="brief-title">${esc(it.title)}</p>${it.detail ? `<p class="brief-detail">${esc(it.detail)}</p>` : ''}
    ${it.actions && it.actions.length ? `<div class="brief-actions">${it.actions.map((a, j) => `<button type="button" class="btn btn-sm ${j === 0 ? 'btn-soft' : 'btn-ghost'}" data-brief="${i}:${j}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('')}</div>` : ''}</div></li>`;
}
function bindBriefActions(root, items) {
  root.querySelectorAll('[data-brief]').forEach(b => b.addEventListener('click', () => {
    const [i, j] = b.dataset.brief.split(':').map(Number);
    runBriefAction(items[i].actions[j]);
  }));
}

/** Thème : clair (par défaut, blanc et bleu clair KingDream), sombre graphite, ou comme l’appareil.
    Attribut propre à l’application : le thème de la page qui l’affiche ne le change pas. */
const _darkMQ = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let _themePref = 'light';
function applyTheme(t) {
  _themePref = t === 'dark' || t === 'system' ? t : 'light';
  const dark = _themePref === 'dark' || (_themePref === 'system' && !!_darkMQ && _darkMQ.matches);
  document.documentElement.setAttribute('data-kdc-theme', dark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b0b0d' : '#f3f6fb');
  $$('[data-act="theme"]').forEach(b => { b.innerHTML = icon(dark ? 'sun' : 'moon'); });
}
if (_darkMQ && _darkMQ.addEventListener) _darkMQ.addEventListener('change', () => { if (_themePref === 'system') applyTheme('system'); });

/* ---------- recherche globale (Ctrl K) ---------- */
const Search = {
  open() {
    const d = dialog({
      title: 'Rechercher', className: 'dialog-search',
      body: `<div class="search-box">${icon('search')}<input id="searchInput" type="search" placeholder="Client, facture, serveur, adresse IP…" autocomplete="off" aria-label="Rechercher"></div><div class="search-results" id="searchResults" role="listbox"></div>`,
    });
    const input = $('#searchInput', d.el), out = $('#searchResults', d.el);
    let sel = 0, results = [];
    const run = () => {
      const q = input.value.trim().toLowerCase();
      if (App.kingo && q) App.kingo.setMood('scan', 1500);
      results = Search.find(q);
      sel = 0;
      out.innerHTML = results.length ? results.map((r, i) => `<a role="option" class="search-item${i === 0 ? ' sel' : ''}" href="#${esc(r.route)}" data-i="${i}">${icon(r.icon)}<span><strong>${esc(r.title)}</strong><small>${esc(r.sub || '')}</small></span><em>${esc(r.type)}</em></a>`).join('')
        : `<p class="search-empty">${q ? 'Aucun résultat pour « ' + esc(q) + ' ».' : 'Tape un nom de client, un numéro de facture (F-2026-…) ou un serveur.'}</p>`;
    };
    input.addEventListener('input', run);
    input.addEventListener('keydown', e => {
      const items = $$('.search-item', out);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach((it, i) => it.classList.toggle('sel', i === sel));
        if (items[sel]) items[sel].scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter' && results[sel]) { e.preventDefault(); d.close(); App.go(results[sel].route); }
    });
    out.addEventListener('click', e => { if (e.target.closest('.search-item')) d.close(); });
    run();
  },
  find(q) {
    const S = Store, out = [];
    const has = (...v) => v.some(x => x && String(x).toLowerCase().includes(q));
    if (!q) {
      return ROUTES.map(r => ({ type: 'Page', title: r.label, route: r.key, icon: r.icon }));
    }
    ROUTES.forEach(r => { if (has(r.label)) out.push({ type: 'Page', title: r.label, route: r.key, icon: r.icon }); });
    S.state.clients.forEach(c => { if (has(c.name, c.contact, c.email, c.city, c.activity)) out.push({ type: 'Client', title: c.name, sub: [c.contact, c.city].filter(Boolean).join(' · '), route: 'client-' + c.id, icon: c.internal ? 'crown' : 'user' }); });
    S.state.servers.forEach(s => { if (has(s.name, s.host, s.ip, s.provider)) out.push({ type: 'Serveur', title: s.name + ' — ' + S.clientName(s.clientId), sub: s.host + ' · ' + s.ip, route: 'serveur-' + s.id, icon: 'server' }); });
    S.state.docs.forEach(d => {
      const cn = S.clientName(d.clientId);
      if (has(d.number, cn, ...(d.lines || []).map(l => l.description))) out.push({ type: C.KIND_LABELS[d.kind], title: (d.number || 'Brouillon') + ' — ' + cn, sub: C.statusLabel(d, S.today) + ' · ' + fmt.eur(S.totals(d).totalTTC), route: 'doc-' + d.id, icon: d.kind === 'quote' ? 'quote' : d.kind === 'credit' ? 'credit' : 'file' });
    });
    return out.slice(0, 40);
  },
};

/* ---------- confirmation 2FA renforcée (actions sensibles) ---------- */
const StepUp = {
  prompt(message) {
    return new Promise(resolve => {
      let done = false;
      const d = dialog({
        title: 'Confirme avec ton code 2FA',
        subtitle: message || 'Action sensible : saisis le code à 6 chiffres de ton application d’authentification.',
        body: `<form id="stepForm" class="otp-form"><label class="field"><span>Code de vérification</span><input id="stepCode" class="otp-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label><p class="field-error" id="stepErr" hidden></p></form>`,
        actions: [
          { label: 'Annuler', run: (close) => { close(); return false; } },
          { label: 'Confirmer', tone: 'primary', run: async () => {
            const code = $('#stepCode').value.trim();
            const err = $('#stepErr');
            if (!/^\d{6}$/.test(code)) { err.textContent = 'Le code contient 6 chiffres.'; err.hidden = false; return false; }
            try {
              if (LIVE) await API.req('POST', '/api/auth/step-up', { code }, true);
              done = true; resolve(true); return true;
            } catch (e) { err.textContent = e.message; err.hidden = false; return false; }
          } },
        ],
        onClose: () => { if (!done) resolve(false); },
      });
      d.el.querySelector('#stepForm').addEventListener('submit', e => { e.preventDefault(); d.el.querySelector('.btn-primary').click(); });
    });
  },
};

/* ---------- flux temps réel (version installée) ---------- */
const Live = {
  es: null,
  connect() {
    if (!LIVE || this.es) return;
    try {
      this.es = new EventSource('/api/events');
      this.es.addEventListener('metrics', e => {
        const data = JSON.parse(e.data);
        for (const u of data.servers || []) {
          const s = Store.server(u.id); if (!s) continue;
          s.metrics = u.metrics; s.status = u.status;
          if (u.point) for (const k of ['cpu', 'ram', 'rx', 'tx']) { s.history[k].push(u.point[k]); if (s.history[k].length > 60) s.history[k].shift(); }
        }
        Store.emit('metrics');
      });
      this.es.addEventListener('alerts', e => { Store.state.alerts = JSON.parse(e.data).alerts; Store.emit('change', { what: 'alerts' }); });
      this.es.addEventListener('doc', e => { const d = JSON.parse(e.data).document; upsert(Store.state.docs, d); Store.emit('change', { what: 'docs' }); });
      this.es.addEventListener('audit', e => {
        const a = JSON.parse(e.data);
        const list = Store.state.audit || (Store.state.audit = []);
        if (!list.some(x => x.id === a.id)) { list.push(a); if (list.length > 60) list.shift(); }
        if (App.route && App.route.view === 'dashboard') Views.dashboard.renderActivity();
      });
      this.es.onerror = () => { /* reconnexion automatique du navigateur */ };
    } catch (e) { console.warn(e); }
  },
};

window.App = App;

/* ---- js/views/dashboard.js ---- */
/* ===== Tableau de bord =====
   En haut : le point de Kingo et trois anneaux « en un coup d’œil ». Puis huit widgets (finances, activité),
   les revenus sur 12 mois, ce qui attend une action (factures, alertes, renouvellements), le parc et le journal. */
// grands chiffres : l'espace fine des milliers disparaît avec l'approche serrée, on garde une espace insécable normale
const bigEur = v => fmt.eur0(v).replace(/\u202f/g, '\u00a0');
Views.dashboard = {
  talkIndex: 0,
  revMode: 'chart',
  render(page) {
    const today = new Date();
    const dateLabel = today.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    page.classList.add('is-entering');
    clearTimeout(this._enterT);
    this._enterT = setTimeout(() => page.classList.remove('is-entering'), 1400);
    page.innerHTML = `
      <section class="hero" id="hero" aria-label="Le point de Kingo">
        <div class="hero-sky" aria-hidden="true"></div>
        <div class="hero-kingo" id="heroKingo"></div>
        <div class="hero-talk">
          <div class="hero-hello"><span class="hero-date">${esc(dateLabel)}</span><h2 id="heroHello"></h2></div>
          <div class="bubble" id="heroBubble" aria-live="polite"></div>
        </div>
        <div class="next-list" id="heroNext"></div>
      </section>
      <section class="widgets" aria-label="Indicateurs">
        <section class="widget widget-xl pulse" aria-labelledby="pulseTitle">
          <div class="w-head"><span class="w-ico">${icon('pulse')}</span><span class="w-label" id="pulseTitle">En un coup d’œil</span><span class="w-flag live">En direct</span></div>
          <div class="pulse-body" id="pulse"></div>
        </section>
        <div class="ledger" id="ledger"></div>
      </section>
      <div class="dash-grid">
        <div class="dash-col">
          <section class="panel" aria-labelledby="revTitle">
            <div class="panel-head"><span class="ph-ico">${icon('euro')}</span><h2 id="revTitle">Revenus</h2><span class="sub">12 derniers mois, hors taxes</span><span class="spacer"></span>
              <div class="seg seg-sm" role="group" aria-label="Affichage des revenus" id="revMode"><button type="button" data-rev="chart" aria-pressed="${this.revMode === 'chart'}">Graphique</button><button type="button" data-rev="table" aria-pressed="${this.revMode === 'table'}">Tableau</button></div></div>
            <div class="rev-summary" id="revSummary"></div>
            <div class="panel-body chart-wrap" id="revChart"></div>
          </section>
          <section class="panel" aria-labelledby="fuTitle">
            <div class="panel-head"><span class="ph-ico">${icon('file')}</span><h2 id="fuTitle">Factures à suivre</h2><span class="sub" id="fuSub"></span><span class="spacer"></span><a class="link" href="#facturation">Toute la facturation ${icon('chevronRight')}</a></div>
            <div class="panel-body" id="followUp"></div>
          </section>
          <section class="panel" aria-labelledby="rnTitle">
            <div class="panel-head"><span class="ph-ico">${icon('repeat')}</span><h2 id="rnTitle">Renouvellements</h2><span class="sub">45 prochains jours</span></div>
            <div class="panel-body" id="renewals"></div>
          </section>
        </div>
        <div class="dash-col">
          <section class="panel" aria-labelledby="alTitle">
            <div class="panel-head"><span class="ph-ico">${icon('bell')}</span><h2 id="alTitle">Alertes techniques</h2><span class="sub" id="alSub"></span></div>
            <div class="panel-body" id="alerts"></div>
          </section>
          <section class="panel" aria-labelledby="fleetTitle">
            <div class="panel-head"><span class="ph-ico">${icon('server')}</span><h2 id="fleetTitle">Parc serveurs</h2><span class="sub" id="fleetSub"></span><span class="spacer"></span><a class="link" href="#serveurs">Détails ${icon('chevronRight')}</a></div>
            <div class="panel-body" id="fleet"></div>
          </section>
        </div>
      </div>
      <section class="panel activity-card" aria-labelledby="acTitle">
        <div class="panel-head"><span class="ph-ico">${icon('history')}</span><h2 id="acTitle">Activité récente</h2><span class="sub">journal infalsifiable, chaîné par empreintes</span><span class="spacer"></span><a class="link" href="#securite">Journal complet ${icon('chevronRight')}</a></div>
        <div class="panel-body" id="activity"></div>
      </section>`;
    this.chart = revenueChart($('#revChart'), Store.revenue(12), { head: false });
    this.chart.setMode(this.revMode);
    this.renderTalk();
    this.renderAll(true);
    page.addEventListener('click', e => this.onClick(e));
  },
  destroy() {
    if (this.chart) this.chart.destroy();
    this.chart = null; clearTimeout(this._flashT); clearTimeout(this._enterT); this._flash = null;
    (this._counters || []).forEach(cancelAnimationFrame); this._counters = [];
  },

  update(type, p) {
    if (type === 'metrics') { this.renderFleet(); this.renderLedger(); this.renderPulse(); return; }
    this.renderAll();
    if (p && p.what === 'docs' && this.chart) { this.chart.destroy(); this.chart = revenueChart($('#revChart'), Store.revenue(12), { head: false }); this.chart.setMode(this.revMode); }
  },
  renderAll(first) { this.renderPulse(first); this.renderLedger(first); this.renderRevenue(); this.renderFollowUp(); this.renderFleet(); this.renderAlerts(); this.renderRenewals(); this.renderActivity(); },

  /* ---- Kingo parle ---- */
  renderTalk() {
    const hello = $('#heroHello'); if (!hello) return;
    const items = App.brief || [];
    hello.textContent = greeting() + '.';
    const hero = $('#hero');
    hero.dataset.tone = items.some(i => i.level === 'crit') ? 'crit' : items.some(i => i.level === 'warn') ? 'warn' : 'ok';
    if (this._flash) return;
    if (this.talkIndex >= items.length) this.talkIndex = 0;
    const it = items[this.talkIndex];
    const b = $('#heroBubble');
    if (!it) { b.innerHTML = ''; return; }
    const tag = { crit: 'Urgent', warn: 'À surveiller', info: 'À faire', good: 'Bonne nouvelle' }[it.level];
    b.className = 'bubble lvl-' + it.level;
    if (this._shown !== it.id) { this._shown = it.id; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }
    b.innerHTML = `<div class="bubble-top"><span class="bubble-tag">${icon(it.level === 'crit' || it.level === 'warn' ? 'alert' : it.level === 'good' ? 'check' : 'sparkle')}${tag}</span>${items.length > 1 ? `<span class="bubble-step">${this.talkIndex + 1} sur ${items.length}</span><button class="icon-btn icon-btn-sm" type="button" data-talk="next" aria-label="Point suivant">${icon('chevronRight')}</button>` : ''}</div>
      <p class="bubble-head">${esc(this.talkIndex === 0 ? briefHeadline(items) + ' ' : '')}${esc(it.title)}</p>
      ${it.detail ? `<p class="bubble-detail">${esc(it.detail)}</p>` : ''}
      ${it.actions && it.actions.length ? `<div class="bubble-actions">${it.actions.map((a, j) => `<button type="button" class="btn btn-sm ${j === 0 ? 'btn-primary' : 'btn-ghost'}" data-brief="${this.talkIndex}:${j}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('')}</div>` : ''}`;
    bindBriefActions(b, items);
    const rest = items.filter((_, i) => i !== this.talkIndex).slice(0, 4);
    $('#heroNext').innerHTML = rest.length ? `<p class="next-label">Ensuite</p>` + rest.map(r => {
      const i = items.indexOf(r);
      const a = r.actions && r.actions[0];
      return `<div class="next-item"><span class="sev sev-${r.level === 'good' ? 'ok' : r.level}">${icon(r.icon || 'info')}</span><span class="next-text">${esc(r.title)}${a ? `<button type="button" class="link next-act" data-brief="${i}:0">${esc(a.label)}${icon('chevronRight')}</button>` : ''}</span></div>`;
    }).join('') + (items.length > 5 ? `<button type="button" class="link" data-talk="all">Voir les ${items.length} points ${icon('chevronRight')}</button>` : '') : '';
    bindBriefActions($('#heroNext'), items);
  },
  nextTalk() {
    const n = (App.brief || []).length; if (!n) return;
    this._flash = null;
    this.talkIndex = (this.talkIndex + 1) % n;
    this.renderTalk();
  },
  flash(text, opts) {
    const b = $('#heroBubble'); if (!b) return;
    this._flash = text;
    b.className = 'bubble lvl-' + (opts.tone === 'crit' ? 'crit' : 'good');
    b.innerHTML = `<div class="bubble-top"><span class="bubble-tag">${icon(opts.tone === 'crit' ? 'alert' : 'sparkle')}${opts.tone === 'crit' ? 'Urgent' : esc(Store.company.mascotName || 'Kingo')}</span></div><p class="bubble-head">${esc(text)}</p>`;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { this._flash = null; this.renderTalk(); }, opts.duration || 5200);
  },

  onClick(e) {
    const t = e.target.closest('[data-talk]');
    if (t) { if (t.dataset.talk === 'next') this.nextTalk(); else App.toggleBriefPanel(); return; }
    const rv = e.target.closest('[data-rev]');
    if (rv) {
      this.revMode = rv.dataset.rev;
      $$('#revMode [data-rev]').forEach(x => x.setAttribute('aria-pressed', String(x === rv)));
      if (this.chart) this.chart.setMode(this.revMode);
      return;
    }
    const as = e.target.closest('[data-dact="assist"]');
    if (as) { Views.assist.open(as.dataset.id, as.dataset.topic || undefined); return; }
    const chip = e.target.closest('[data-srv]');
    if (chip) { App.go('serveur-' + chip.dataset.srv); return; }
    const a = e.target.closest('[data-dact]');
    if (!a) return;
    const id = a.dataset.id;
    if (a.dataset.dact === 'remind') Views.billing.sendDialog(id, { reminder: true });
    if (a.dataset.dact === 'pay') Views.billing.paymentDialog(id);
    if (a.dataset.dact === 'ack') Store.ackAlert(id).then(() => toast('Alerte prise en compte.'));
    if (a.dataset.dact === 'invoicesub') runBriefAction({ act: 'invoicesub', arg: id });
    if (a.dataset.dact === 'open') App.go('doc-' + id);
  },

  /* ---- anneaux : disponibilité du parc, sites en ligne, factures réglées ---- */
  pulseData() {
    const S = Store, k = S.kpis();
    let sites = 0, sitesUp = 0, last = 0;
    for (const s of S.state.servers) {
      const m = s.metrics || {};
      if (m.lastSeen && m.reachable !== false) last = Math.max(last, new Date(m.lastSeen).getTime());
      for (const x of C.serverSites(s)) {
        if (!x.url) continue;
        sites++;
        const st = S.siteState(s, x).state;
        if (st === 'ok' || st === 'warn') sitesUp++;
      }
    }
    const billed = k.paidAmount + k.pendingAmount + k.overdueAmount;
    return {
      last,
      rings: [
        { label: 'Serveurs opérationnels', value: k.servers ? k.serversOk / k.servers : 0, color: 'var(--s1)', main: k.serversOk, of: '/ ' + k.servers, sub: !k.servers ? 'aucun serveur supervisé' : k.serversCrit || k.serversWarn ? [k.serversCrit ? k.serversCrit + ' critique' + (k.serversCrit > 1 ? 's' : '') : '', k.serversWarn ? k.serversWarn + ' à surveiller' : ''].filter(Boolean).join(', ') : 'tous répondent' },
        { label: 'Sites en ligne', value: sites ? sitesUp / sites : 0, color: 'var(--s2)', main: sitesUp, of: '/ ' + sites, sub: sites ? (sitesUp === sites ? 'tous répondent' : fmt.plural(sites - sitesUp, 'site') + ' hors ligne') : 'aucun site déclaré' },
        { label: 'Factures ' + S.today.slice(0, 4) + ' réglées', value: billed ? k.paidAmount / billed : 0, color: 'var(--s3)', main: billed ? Math.round(100 * k.paidAmount / billed) : 0, of: '%', sub: fmt.eur0(k.paidAmount) + ' sur ' + fmt.eur0(billed) + ' TTC' },
      ],
    };
  },
  renderPulse(first) {
    const el = $('#pulse'); if (!el) return;
    const d = this.pulseData();
    const legend = d.rings.map(r => `<li><span class="rk" style="--c:${r.color}"></span><strong>${esc(String(r.main))}<small> ${esc(r.of)}</small></strong><span class="rl">${esc(r.label)}</span><span class="rs">${esc(r.sub)}</span></li>`).join('');
    const foot = `${icon('signal')}<span>${d.last ? 'Dernière mesure ' + esc(fmt.rel(new Date(d.last).toISOString())) + ' · une toutes les ' + (LIVE ? '60' : '3') + ' s' : 'En attente de la première mesure'}</span>`;
    let svg = el.querySelector('.rings');
    if (!svg) {
      el.innerHTML = `<div class="rings-wrap">${ringsSVG(d.rings, { size: 192, stroke: 17 })}<ul class="rings-legend">${legend}</ul></div><div class="pulse-foot">${foot}</div>`;
      svg = el.querySelector('.rings');
      const values = d.rings.map(r => r.value);
      if (first && !reduceMotion()) requestAnimationFrame(() => requestAnimationFrame(() => setRings(svg, values)));
      else setRings(svg, values);
      return;
    }
    el.querySelector('.rings-legend').innerHTML = legend;
    el.querySelector('.pulse-foot').innerHTML = foot;
    setRings(svg, d.rings.map(r => r.value));
  },

  /* ---- widgets ---- */
  renderLedger(first) {
    const el = $('#ledger'); if (!el) return;
    const S = Store, k = S.kpis(), st = S.state;
    const rev = S.revenue(12);
    const year = S.today.slice(0, 4);
    const monthName = C.monthLabel(C.ym(S.today), true).split(' ')[0];
    const subsActive = st.subscriptions.filter(s => s.status === 'actif');
    const mrrHist = rev.map(r => st.subscriptions.filter(s => String(s.startDate).slice(0, 7) <= r.ym).reduce((t, s) => t + C.monthlyEquivalent(s), 0));
    const toCollect = k.pendingAmount + k.overdueAmount;
    const quotes = st.docs.filter(d => d.kind === 'quote');
    const qOpen = quotes.filter(q => S.status(q) === 'sent'), qAcc = quotes.filter(q => S.status(q) === 'accepted');
    const qIssued = quotes.filter(q => q.status !== 'draft').length, qWon = quotes.filter(q => ['accepted', 'invoiced'].includes(q.status)).length;
    const qAmount = [...qOpen, ...qAcc].reduce((t, q) => t + S.totals(q).totalHT, 0);
    const active = S.realClients().filter(c => c.status === 'actif');
    const weekAgo = Date.now() - 7 * 86400000;
    const refused = (st.audit || []).filter(a => (a.action === 'auth.login_failed' || a.action === 'auth.blocked') && new Date(a.ts).getTime() >= weekAgo).length;
    const lastBackup = st.backups && st.backups.last;
    const bDays = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86400000) : null;
    const me = st.me || {};

    const num = (n, f) => `<span class="w-num" data-to="${n}" data-fmt="${f}">${f === 'eur' ? esc(bigEur(n)) : esc(String(n))}</span>`;
    const w = (o) => `<a class="widget" href="#${o.href}" data-w="${o.key}">
        <div class="w-head"><span class="w-ico">${icon(o.icon)}</span><span class="w-label">${esc(o.label)}</span>${o.flag ? `<span class="w-flag">${o.flag}</span>` : ''}</div>
        <div class="w-value">${o.value}</div>
        <div class="w-ctx">${o.ctx}</div>
        ${o.viz ? `<div class="w-viz">${o.viz}</div>` : ''}
      </a>`;
    const split = (parts) => `<div class="splitbar" role="img" aria-label="${esc(parts.map(p => p.label + ' ' + fmt.eur0(p.v)).join(', '))}">${parts.filter(p => p.v > 0).map(p => `<span style="flex:${p.v} 1 0;background:${p.c}"></span>`).join('')}</div>
      <div class="mini-legend">${parts.map(p => `<span><i style="background:${p.c}"></i><b>${esc(fmt.eur0(p.v))}</b> ${esc(p.label)}</span>`).join('')}</div>`;
    const line = (ok, text, tone) => `<li>${icon(ok ? 'check' : 'alert', tone || (ok ? 'ok' : 'warn'))}<span>${esc(text)}</span></li>`;

    const html = [
      w({ key: 'ca', href: 'facturation', icon: 'euro', label: 'Chiffre d’affaires ' + year, value: num(k.revenue, 'eur') + '<small>HT</small>',
        ctx: esc('dont ' + fmt.eur0(k.revenueMonth) + ' en ' + monthName), viz: sparkline(rev.map(r => r.invoiced), { w: 240, h: 44, id: 'spk-ca' }) }),
      w({ key: 'mrr', href: 'clients', icon: 'repeat', label: 'Revenus récurrents', value: num(k.mrr, 'eur') + '<small>/mois</small>',
        ctx: esc(subsActive.length ? fmt.plural(subsActive.length, 'abonnement actif', 'abonnements actifs') + ' · ' + fmt.eur0(k.mrr * 12) + ' par an' : 'Aucun abonnement actif'), viz: sparkline(mrrHist, { w: 240, h: 44, id: 'spk-mrr' }) }),
      w({ key: 'paid', href: 'facturation-payees', icon: 'check', label: 'Factures payées', value: num(k.paidAmount, 'eur') + '<small>TTC</small>',
        ctx: esc(k.paidCount ? fmt.plural(k.paidCount, 'facture réglée', 'factures réglées') + ' en ' + year : 'Aucune facture réglée en ' + year), viz: sparkline(rev.map(r => r.collected), { w: 240, h: 44, id: 'spk-paid' }) }),
      w({ key: 'due', href: k.overdueCount ? 'facturation-retard' : 'facturation-attente', icon: 'clock', label: 'À encaisser', value: num(toCollect, 'eur') + '<small>TTC</small>',
        flag: k.overdueCount ? statusPill('crit', k.overdueCount + ' en retard') : '',
        ctx: esc(k.overdueCount ? 'Retard maximal : ' + k.oldestOverdue + ' jours' : toCollect ? 'Aucun retard de paiement' : 'Tout est encaissé'),
        viz: toCollect ? split([{ v: k.pendingAmount, c: 'var(--s1)', label: 'à échéance' }, { v: k.overdueAmount, c: 'var(--crit-fill)', label: 'en retard' }]) : '' }),
      w({ key: 'quotes', href: 'devis', icon: 'quote', label: 'Devis ouverts', value: num(qAmount, 'eur') + '<small>HT</small>',
        flag: qAcc.length ? statusPill('ok', fmt.plural(qAcc.length, 'accepté')) : '',
        ctx: esc(qIssued ? 'Taux de signature : ' + Math.round(100 * qWon / qIssued) + ' %' : 'Aucun devis émis'),
        viz: qAmount ? split([{ v: qAcc.reduce((t, q) => t + S.totals(q).totalHT, 0), c: 'var(--s3)', label: 'accepté' }, { v: qOpen.reduce((t, q) => t + S.totals(q).totalHT, 0), c: 'var(--s2)', label: 'en attente' }]) : '' }),
      w({ key: 'clients', href: 'clients', icon: 'users', label: 'Clients', value: num(k.clients, 'int') + '<small>actifs</small>',
        ctx: esc(k.prospects ? '+ ' + fmt.plural(k.prospects, 'prospect') + ' en cours' : 'aucun prospect en cours'),
        viz: `<div class="avatars">${active.slice(0, 6).map(c => avatar(c.name)).join('')}${active.length > 6 ? `<span class="avatar avatar-more">+${active.length - 6}</span>` : ''}</div>` }),
      w({ key: 'servers', href: 'serveurs', icon: 'server', label: 'Serveurs', value: num(k.serversOk, 'int') + '<small>/ ' + k.servers + '</small>',
        flag: k.serversCrit ? statusPill('crit', k.serversCrit + ' critique' + (k.serversCrit > 1 ? 's' : '')) : k.serversWarn ? statusPill('warn', k.serversWarn + ' à voir') : '',
        ctx: esc('opérationnels · ' + (k.alerts ? fmt.plural(k.alerts, 'alerte') + ' ouverte' + (k.alerts > 1 ? 's' : '') : 'aucune alerte')),
        viz: k.servers ? `<div class="splitbar" role="img" aria-label="${esc(k.serversOk + ' opérationnels, ' + k.serversWarn + ' à surveiller, ' + k.serversCrit + ' critiques')}">${[[k.serversOk, 'var(--ok-fill)'], [k.serversWarn, 'var(--warn-fill)'], [k.serversCrit, 'var(--crit-fill)'], [k.servers - k.serversOk - k.serversWarn - k.serversCrit, 'var(--ink-4)']].filter(x => x[0] > 0).map(x => `<span style="flex:${x[0]} 1 0;background:${x[1]}"></span>`).join('')}</div>
          <div class="mini-legend">${[['ok', k.serversOk, 'opérationnel'], ['warn', k.serversWarn, 'à surveiller'], ['crit', k.serversCrit, 'critique']].filter(x => x[1]).map(x => `<span>${serverDot(x[0])}<b>${x[1]}</b> ${esc(x[0] === 'warn' || x[1] < 2 ? x[2] : x[2] + 's')}</span>`).join('')}</div>` : '' }),
      w({ key: 'sec', href: 'securite', icon: 'shield', label: 'Sécurité', value: num(refused, 'int') + '<small>tentative' + (refused > 1 ? 's' : '') + '</small>',
        flag: bDays !== null && bDays < 7 ? '' : statusPill('warn', 'Sauvegarde'),
        ctx: 'Connexions refusées en 7 jours',
        viz: `<ul class="w-lines">${line(!!me.twoFactor, me.twoFactor ? 'Double authentification active' : 'Double authentification à activer', me.twoFactor ? 'ok' : 'crit')}${line(bDays !== null && bDays < 7, bDays === null ? 'Aucune sauvegarde du cockpit' : 'Dernière sauvegarde ' + (bDays === 0 ? 'aujourd’hui' : 'il y a ' + bDays + ' j'))}</ul>` }),
    ];
    // mise à jour widget par widget : rien ne bouge sous le pointeur quand les mesures arrivent
    const prev = el._html || [];
    if (first || prev.length !== html.length) el.innerHTML = html.join('');
    else html.forEach((h, i) => { if (h !== prev[i]) { const old = el.children[i]; if (old) old.outerHTML = h; } });
    el._html = html;
    if (first && !reduceMotion()) this.countUp(el);
  },
  /** Les chiffres montent jusqu’à leur valeur à l’ouverture (une fois, moins d’une seconde). */
  countUp(root) {
    this._counters = this._counters || [];
    root.querySelectorAll('.w-num').forEach(n => {
      const to = +n.dataset.to, f = n.dataset.fmt;
      if (!to) return;
      const t0 = performance.now(), dur = 950;
      const out = v => f === 'eur' ? bigEur(v) : String(Math.round(v));
      const tick = now => {
        const q = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - q, 4);
        n.textContent = out(f === 'eur' ? Math.round(to * e / 100) * 100 : to * e);
        if (q < 1 && n.isConnected) this._counters.push(requestAnimationFrame(tick));
        else n.textContent = out(to);
      };
      n.textContent = out(0);
      this._counters.push(requestAnimationFrame(tick));
    });
  },

  renderRevenue() {
    const el = $('#revSummary'); if (!el) return;
    const rev = Store.revenue(12);
    const inv = rev.reduce((t, r) => t + r.invoiced, 0), col = rev.reduce((t, r) => t + r.collected, 0);
    const last = rev[rev.length - 1], prev = rev[rev.length - 2];
    el.innerHTML = `<div><span><i class="sw" style="background:var(--s1)"></i>Facturé sur 12 mois</span><strong>${esc(fmt.eur0(inv))}</strong></div><div><span><i class="sw" style="background:var(--s2)"></i>Encaissé sur 12 mois</span><strong>${esc(fmt.eur0(col))}</strong></div><div><span>Encaissé en ${esc(C.monthLabel(last.ym, true).split(' ')[0])}</span><strong>${esc(fmt.eur0(last.collected))}</strong></div><div><span>Encaissé en ${esc(C.monthLabel(prev.ym, true).split(' ')[0])}</span><strong>${esc(fmt.eur0(prev.collected))}</strong></div>`;
  },

  renderFollowUp() {
    const el = $('#followUp'); if (!el) return;
    const S = Store;
    const list = S.state.docs.filter(d => d.kind === 'invoice' && ['overdue', 'sent'].includes(S.status(d)));
    list.sort((a, b) => { const sa = S.status(a), sb = S.status(b); if (sa !== sb) return sa === 'overdue' ? -1 : 1; return a.dueDate.localeCompare(b.dueDate); });
    $('#fuSub').textContent = list.length ? fmt.plural(list.length, 'facture') + ' ouvertes' : '';
    if (!list.length) { el.innerHTML = emptyState('Aucune facture en attente.', 'Les factures envoyées et non réglées apparaîtront ici.'); return; }
    el.innerHTML = `<div class="table-scroll"><table class="table table-cards"><thead><tr><th>Facture</th><th>Échéance</th><th class="num">Reste dû</th><th>Statut</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.slice(0, 7).map(d => {
      const t = S.totals(d), st = S.status(d), late = C.diffDays(S.today, d.dueDate);
      return `<tr class="clickable" data-dact="open" data-id="${esc(d.id)}">
        <td class="c-main"><div class="cell-main"><strong class="doc-num">${esc(d.number)}</strong><span>${esc(S.clientName(d.clientId))}</span></div></td>
        <td class="c-end nowrap">${esc(fmt.date(d.dueDate))}${st === 'overdue' ? `<br><span class="late">${late} j de retard</span>` : ''}</td>
        <td class="num c-main amount-strong">${esc(fmt.eur(t.due))}</td>
        <td class="c-end">${docPill(d, S.today)}</td>
        <td class="c-full"><div class="row-actions">${st === 'overdue' ? `<button class="btn btn-sm btn-soft" type="button" data-dact="remind" data-id="${esc(d.id)}">${icon('mail')}<span>Relancer</span></button>` : ''}<button class="icon-btn icon-btn-sm" type="button" data-dact="pay" data-id="${esc(d.id)}" title="Enregistrer un paiement" aria-label="Enregistrer un paiement pour ${esc(d.number)}">${icon('card')}</button></div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  },

  renderFleet() {
    const el = $('#fleet'); if (!el) return;
    const S = Store, k = S.kpis();
    $('#fleetSub').textContent = k.serversOk + ' sur ' + k.servers + ' opérationnels';
    const o = ['crit', 'warn', 'unknown', 'ok'];
    const worst = c => { const st = [S.worstStatus(S.serversFor(c.id)), ...S.hostedFor(c.id).map(s => S.hostedStatus(s, c.id))]; return o.find(x => st.includes(x)) || 'ok'; };
    const groups = S.state.clients.filter(c => S.serversFor(c.id).length || S.hostedFor(c.id).length)
      .sort((a, b) => o.indexOf(worst(a)) - o.indexOf(worst(b)) || (a.internal ? 1 : 0) - (b.internal ? 1 : 0));
    el.innerHTML = groups.map(c => {
      const sv = S.serversFor(c.id), hosted = S.hostedFor(c.id);
      const nSites = hosted.reduce((t, s) => t + S.sitesOf(s, c.id).length, 0);
      return `<div class="fleet-row"><div class="fleet-client">${c.internal ? icon('crown', 'i-xs') : ''}<a href="#client-${esc(c.id)}">${esc(c.name)}</a><span class="fleet-count">${[sv.length ? fmt.plural(sv.length, 'serveur') : '', nSites ? fmt.plural(nSites, 'site') + ' partagé' + (nSites > 1 ? 's' : '') : ''].filter(Boolean).join(' + ')}</span></div>
        <div class="fleet-chips">${sv.map(s => { const st = S.serverStatus(s); const m = s.metrics || {}; return `<button type="button" class="chip-srv" data-srv="${esc(s.id)}" title="${esc(SERVER_STATUS[st].label + ' — ' + s.host + (C.isSharedServer(s) ? ' (partagé)' : ''))}">${serverDot(st)}<span class="mono">${esc(s.name)}</span><em>${m.reachable === false ? 'hors ligne' : m.cpu === null || m.cpu === undefined ? '—' : 'CPU ' + Math.round(m.cpu) + ' %'}</em></button>`; }).join('')}${hosted.map(s => S.sitesOf(s, c.id).map(x => { const r = S.siteState(s, x); const st = s.metrics && s.metrics.reachable === false ? 'crit' : r.state === 'none' ? S.hostedStatus(s, c.id) : r.state; return `<button type="button" class="chip-srv" data-srv="${esc(s.id)}" title="${esc('Hébergé sur ' + s.name + ', serveur de ' + S.clientName(s.clientId))}">${serverDot(st)}${icon('globe', 'i-xs')}<span>${esc(x.name)}</span><em>sur ${esc(s.name)}</em></button>`; }).join('')).join('')}</div></div>`;
    }).join('') || emptyState('Aucun serveur supervisé.', 'Ajoute un serveur depuis la page Serveurs.');
  },

  renderAlerts() {
    const el = $('#alerts'); if (!el) return;
    const al = Store.openAlerts();
    $('#alSub').textContent = al.length ? fmt.plural(al.length, 'ouverte') : '';
    el.innerHTML = al.length ? `<ul class="notif-list">${al.map(a => {
      const s = Store.server(a.serverId);
      const topic = ({ disk: 'disk', cpu: 'cpu', ram: 'ram', unreachable: 'unreachable', auth: 'unreachable', hostkey: 'unreachable' })[a.code] || (/^http/.test(a.code) ? 'site' : '');
      return `<li class="notif${a.ackAt ? ' is-ack' : ''}"><span class="sev sev-${a.level}">${icon(a.level === 'info' ? 'info' : 'alert')}</span><div class="notif-body">
        <div class="notif-top"><strong>${esc(a.title)}</strong><time datetime="${esc(a.openedAt)}">${esc(fmt.rel(a.openedAt))}</time></div>
        <span class="notif-meta">${esc(s ? s.name + ' · ' + Store.clientName(a.clientId || s.clientId) : '')}${a.ackAt ? ' · pris en compte' : ''}</span>
        <p class="notif-msg">${esc(a.message)}</p>
        <div class="notif-actions">${a.level !== 'info' && s ? `<button class="btn btn-sm btn-primary" type="button" data-dact="assist" data-id="${esc(a.serverId)}" data-topic="${esc(topic)}">${icon('sparkle')}<span>Kingo m’aide</span></button>` : ''}<button class="btn btn-sm btn-soft" type="button" data-srv="${esc(a.serverId)}" title="Voir le serveur">${icon('server')}<span>Voir le serveur</span></button>${a.ackAt ? '' : `<button class="icon-btn icon-btn-sm" type="button" data-dact="ack" data-id="${esc(a.id)}" title="Marquer comme pris en compte" aria-label="Marquer « ${esc(a.title)} » comme pris en compte">${icon('check')}</button>`}</div>
      </div></li>`;
    }).join('')}</ul>` : emptyState('Aucune alerte ouverte.', 'Kingo te préviendra dès qu’un serveur décroche.');
  },

  renderRenewals() {
    const el = $('#renewals'); if (!el) return;
    const list = Store.renewals(45);
    el.innerHTML = list.length ? list.map(r => {
      const d = C.parseISO(r.renewalDate);
      return `<div class="renew-row"><div class="renew-date"><strong>${d.getDate()}</strong><span>${esc(C.MONTHS_SHORT[d.getMonth()])}</span></div><div class="renew-text"><strong>${esc(r.label)}</strong><span>${esc(Store.clientName(r.clientId))} · ${esc(fmt.eur(C.cents(r.priceHT)))} HT ${r.period === 'annuel' ? '/an' : '/mois'} · ${r.inDays === 0 ? 'aujourd’hui' : 'dans ' + r.inDays + ' j'}</span></div>${r.period === 'annuel' ? `<button class="btn btn-sm btn-soft" type="button" data-dact="invoicesub" data-id="${esc(r.id)}">Facturer</button>` : ''}</div>`;
    }).join('') : emptyState('Aucun renouvellement proche.', '');
  },

  renderActivity() {
    const el = $('#activity'); if (!el) return;
    const items = (Store.state.audit || []).slice(-7).reverse();
    const ico = a => a.startsWith('auth') ? 'lock' : a.startsWith('server') ? 'server' : a.startsWith('payment') ? 'card' : a.startsWith('doc') || a.startsWith('quote') ? 'file' : a.startsWith('client') ? 'user' : a.startsWith('alert') ? 'alert' : 'history';
    el.innerHTML = items.length ? items.map(a => `<div class="act-row"><span class="act-ico">${icon(ico(a.action))}</span><div class="act-text"><strong>${esc(a.label)}</strong><span>${esc(a.target || '')}${a.ip && a.action.startsWith('auth') && a.ip !== a.target ? ' · ' + esc(a.ip) : ''}</span></div><span class="act-time">${esc(fmt.rel(a.ts))}</span></div>`).join('') : emptyState('Aucune activité.', '');
  },
};

/* ---- js/views/servers.js ---- */
/* ===== Serveurs : supervision par client, détail, logs, accès SSH, console ===== */
const ROLES = ['web', 'base de données', 'api', 'application', 'boutique', 'sauvegarde', 'mail', 'préproduction', 'cockpit', 'autre'];

Views.servers = {
  filter: 'all', q: '',
  render(page, params) {
    page.innerHTML = `
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Filtrer par état" id="srvSeg"></div>
        <label class="search-inline">${icon('search')}<input class="input" id="srvQ" type="search" placeholder="Nom, IP, hébergeur, client…" aria-label="Filtrer les serveurs" value="${esc(this.q)}"></label>
        <span class="grow"></span>
        <button class="btn btn-primary" type="button" data-sact="add">${icon('plus')}<span>Ajouter un serveur</span></button>
      </div>
      <div class="note">${icon('key')}<span>Chaque serveur a sa propre clé SSH, générée et chiffrée par KingDream Control. Ton navigateur ne voit jamais de clé privée : la console passe par le serveur sécurisé et chaque session est journalisée.</span></div>
      <div id="srvGroups" style="display:flex;flex-direction:column;gap:16px"></div>`;
    $('#srvQ').addEventListener('input', debounce(e => { this.q = e.target.value.trim().toLowerCase(); this.renderGroups(); }, 120));
    page.addEventListener('click', e => this.onClick(e));
    this.renderGroups();
    if (params.open) setTimeout(() => this.openDetail(params.open), 30);
  },
  destroy() { this.closeDetail(true); },

  counts() {
    const c = { all: 0, ok: 0, warn: 0, crit: 0, unknown: 0 };
    for (const s of Store.state.servers) { c.all++; c[Store.serverStatus(s)]++; }
    return c;
  },
  renderSeg() {
    const c = this.counts();
    const opts = [['all', 'Tous', null], ['ok', 'Opérationnels', 'ok'], ['warn', 'Attention', 'warn'], ['crit', 'Critiques', 'crit'], ['unknown', 'En attente', 'unknown']];
    $('#srvSeg').innerHTML = opts.filter(o => o[0] !== 'unknown' || c.unknown).map(o => `<button type="button" data-filter="${o[0]}" aria-pressed="${this.filter === o[0]}">${o[2] ? serverDot(o[2]) : ''}${o[1]} <span class="count">${c[o[0]]}</span></button>`).join('');
  },
  matches(s) {
    if (this.filter !== 'all' && Store.serverStatus(s) !== this.filter) return false;
    if (!this.q) return true;
    const hay = [s.name, s.host, s.ip, s.provider, s.location, s.role, ...C.serverClientIds(s).map(id => Store.clientName(id)), ...C.serverSites(s).map(x => x.name + ' ' + x.url)].join(' ').toLowerCase();
    return hay.includes(this.q);
  },
  renderGroups() {
    const host = $('#srvGroups'); if (!host) return;
    this.renderSeg();
    const S = Store;
    const order = ['crit', 'warn', 'unknown', 'ok', 'none'];
    const worst = c => { const st = [S.worstStatus(S.serversFor(c.id)), ...S.hostedFor(c.id).map(s => S.hostedStatus(s, c.id))]; return order.find(o => st.includes(o)) || 'ok'; };
    const clients = S.state.clients.filter(c => S.serversFor(c.id).some(s => this.matches(s)) || S.hostedFor(c.id).some(s => this.matches(s)))
      .sort((a, b) => order.indexOf(worst(a)) - order.indexOf(worst(b)) || (a.internal ? 1 : 0) - (b.internal ? 1 : 0) || a.name.localeCompare(b.name));
    if (!clients.length) {
      host.innerHTML = S.state.servers.length ? emptyState('Aucun serveur ne correspond.', 'Change le filtre ou la recherche.') : emptyState('Aucun serveur supervisé.', 'Ajoute le premier : KingDream Control génère sa clé SSH et t’indique comment l’installer.', `<button class="btn btn-primary" type="button" data-sact="add">${icon('plus')}<span>Ajouter un serveur</span></button>`);
      return;
    }
    host.innerHTML = clients.map(c => {
      const sv = S.serversFor(c.id).filter(s => this.matches(s));
      const hosted = S.hostedFor(c.id).filter(s => this.matches(s));
      const n = S.serversFor(c.id).length, h = S.hostedFor(c.id).length;
      const sub = [c.activity, n ? fmt.plural(n, 'serveur') : '', h ? fmt.plural(S.hostedFor(c.id).reduce((t, s) => t + S.sitesOf(s, c.id).length, 0), 'site') + ' sur un serveur partagé' : ''].filter(Boolean).join(' · ');
      return `<section class="client-group" aria-label="${esc(c.name)}">
        <header class="client-group-head">${serverDot(worst(c))}<h3><a href="#client-${esc(c.id)}">${c.internal ? icon('crown', 'i-xs') + ' ' : ''}${esc(c.name)}</a></h3><span class="sub">${esc(sub)}</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" data-sact="add" data-client="${esc(c.id)}">${icon('plus')}<span>Serveur</span></button></header>
        ${sv.map(s => `<div class="srv-row" data-id="${esc(s.id)}">${this.rowHTML(s)}</div>`).join('')}
        ${hosted.map(s => `<div class="srv-row srv-row-hosted" data-id="${esc(s.id)}" data-for="${esc(c.id)}">${this.hostedRowHTML(s, c.id)}</div>`).join('')}
      </section>`;
    }).join('');
  },
  rowHTML(s) {
    return `<div class="srv-id" data-sact="open" role="button" tabindex="0" aria-label="Détails de ${esc(s.name)}">${this.idHTML(s)}</div>${this.metricsHTML(s)}
      <div class="srv-actions"><button class="btn btn-sm btn-soft" type="button" data-sact="console" title="Ouvrir la console">${icon('terminal')}<span>Console</span></button><button class="icon-btn icon-btn-sm" type="button" data-sact="logs" aria-label="Logs de ${esc(s.name)}" title="Logs">${icon('logs')}</button><button class="icon-btn icon-btn-sm" type="button" data-sact="open" aria-label="Détails de ${esc(s.name)}" title="Détails">${icon('chevronRight')}</button></div>`;
  },
  idHTML(s) {
    const others = C.serverClientIds(s).slice(1);
    const tag = others.length ? `<span class="srv-tag" title="${esc('Héberge aussi des sites de : ' + others.map(id => Store.clientName(id)).join(', '))}">${icon('share', 'i-xs')}partagé</span>` : '';
    return `${serverDot(Store.serverStatus(s))}<div class="srv-id-text"><strong>${esc(s.name)}${tag}</strong><span>${esc(s.ip)} · ${esc(s.provider)}${s.location ? ', ' + esc(s.location) : ''}</span></div>`;
  },
  siteChips(s, cid) {
    const b = C.serverBreakdown(s);
    return Store.sitesOf(s, cid).map(x => {
      const r = Store.siteState(s, x), u = b.rows.find(y => y.site.id === x.id);
      const st = r.state === 'none' ? Store.hostedStatus(s, cid) : r.state;
      const bits = [r.state === 'crit' ? (r.status ? 'HTTP ' + r.status : 'hors ligne') : r.ms ? r.ms + ' ms' : '', u && u.bytes !== null ? fmt.bytes(u.bytes) : '', u && u.cpu !== null && u.cpu >= 0.5 ? 'CPU ' + fmt.pct(u.cpu) : ''].filter(Boolean);
      return `<span class="site-chip" title="${esc([x.url, x.path].filter(Boolean).join(' · '))}">${serverDot(st)}<span>${esc(x.name)}</span><em>${esc(bits.join(' · ') || '—')}</em></span>`;
    }).join('');
  },
  hostedRowHTML(s, cid) {
    return `<div class="srv-id" data-sact="open" role="button" tabindex="0" aria-label="Détails de ${esc(s.name)}">${serverDot(Store.hostedStatus(s, cid))}<div class="srv-id-text"><strong>${esc(s.name)}</strong><span>serveur de ${esc(Store.clientName(s.clientId))}</span></div></div>
      <div class="srv-hosted" data-part="hosted">${this.siteChips(s, cid)}</div>
      <div class="srv-actions"><button class="icon-btn icon-btn-sm" type="button" data-sact="open" aria-label="Détails de ${esc(s.name)}" title="Détails">${icon('chevronRight')}</button></div>`;
  },
  metricsHTML(s) {
    const m = s.metrics;
    const st = Store.serverStatus(s);
    if (!m || !m.lastSeen) return `<div class="srv-pending" data-part="metrics">${icon('key', 'i-xs')} Clé publique à installer sur le serveur, puis lance un test de connexion.</div>`;
    if (m.reachable === false) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(m.lastSeen).getTime()) / 60000));
      return `<div class="srv-down" data-part="metrics">${icon('alert')}<span>Injoignable depuis ${mins} min — dernière réponse à ${esc(fmt.time(m.lastSeen))}.</span><span class="grow"></span><button class="btn btn-sm btn-ghost" type="button" data-sact="test">${icon('refresh')}<span>Tester</span></button></div>`;
    }
    return `<div class="srv-metrics-m" data-part="metrics">
        <div class="srv-metric"><span>CPU</span>${meter(m.cpu, { label: 'CPU', warn: 85, crit: 95 })}</div>
        <div class="srv-metric"><span>RAM</span>${meter(m.ram, { label: 'Mémoire', warn: 90, crit: 97 })}</div>
        <div class="srv-metric"><span>Disque</span>${meter(m.disk, { label: 'Disque', warn: 85, crit: 95 })}</div>
      </div>
      <div class="srv-net" data-part="net" title="Débit réseau (entrant / sortant)"><div class="srv-net-vals"><span>↓ ${esc(fmt.rate(m.rx))}</span><span>↑ ${esc(fmt.rate(m.tx))}</span></div>${sparkline(s.history.rx, { w: 70, h: 26 })}</div>
      <div class="srv-users" data-part="users" title="Connexions web actives (ports 80/443)"><strong>${m.users === null || m.users === undefined ? '—' : m.users}</strong>connectés</div>`;
  },
  update(type) {
    if (!$('#srvGroups')) return;
    if (type === 'metrics') {
      this.renderSeg();
      $$('.srv-row').forEach(row => {
        const s = Store.server(row.dataset.id); if (!s) return;
        if (row.dataset.for) { row.innerHTML = this.hostedRowHTML(s, row.dataset.for); return; }
        const idEl = row.querySelector('.srv-id'); if (idEl) idEl.innerHTML = this.idHTML(s);
        row.querySelectorAll('[data-part]').forEach(p => p.remove());
        idEl.insertAdjacentHTML('afterend', this.metricsHTML(s));
      });
      this.refreshDetail();
      return;
    }
    this.renderGroups();
    this.refreshDetail(true);
  },

  onClick(e) {
    const f = e.target.closest('[data-filter]');
    if (f) { this.filter = f.dataset.filter; this.renderGroups(); return; }
    const a = e.target.closest('[data-sact]');
    if (!a) return;
    const row = a.closest('.srv-row');
    const id = row ? row.dataset.id : a.dataset.id;
    switch (a.dataset.sact) {
      case 'add': this.editDialog(null, a.dataset.client); break;
      case 'open': this.openDetail(id); break;
      case 'logs': this.openDetail(id, 'logs'); break;
      case 'console': this.openConsole(id); break;
      case 'test': this.test(id); break;
    }
  },

  async test(id) {
    const s = Store.server(id);
    if (App.kingo) { App.kingo.setMood('scan', 2600); App.kingo.react('radar'); }
    toast('Test de connexion vers ' + s.name + '…');
    try {
      const r = await Store.testServer(id);
      if (r && r.ok && !r.recovered) toast(s.name + ' répond en ' + r.ms + ' ms.');
      if (r && r.ok === false) toast(r.message || 'Connexion impossible.', { tone: 'crit' });
    } catch (e) { toast(e.message, { tone: 'crit' }); }
  },

  /* ---------- tiroir de détail ---------- */
  openDetail(id, tab) {
    const s = Store.server(id);
    if (!s) { toast('Ce serveur n’existe plus.', { tone: 'warn' }); return; }
    this.closeDetail(true);
    this.detail = { id, tab: tab || 'overview', charts: [] };
    const d = drawer({ label: 'Serveur ' + s.name, wide: true, onClose: () => { this.detail && this.detail.charts.forEach(c => c.destroy()); this.detail = null; if (location.hash.startsWith('#serveur-')) history.replaceState(null, '', '#serveurs'); } });
    this.detail.drawer = d;
    if (location.hash !== '#serveur-' + id) history.replaceState(null, '', '#serveur-' + id);
    d.content.addEventListener('click', e => this.onDetailClick(e));
    this.renderDetail();
  },
  closeDetail(silent) { if (this.detail && this.detail.drawer) { const dd = this.detail.drawer; this.detail.charts.forEach(c => c.destroy()); this.detail = null; dd.close(); } },
  refreshDetail(full) {
    if (!this.detail) return;
    const s = Store.server(this.detail.id);
    if (!s) return this.closeDetail();
    if (full || this.detail.tab !== 'overview') { if (full) this.renderDetail(); return; }
    const head = this.detail.drawer.content.querySelector('.dr-status'); if (head) head.innerHTML = this.statusLine(s);
    const st = this.detail.drawer.content.querySelector('#drStats'); if (st) st.innerHTML = this.statsHTML(s);
    const si = this.detail.drawer.content.querySelector('#drSites'); if (si) si.innerHTML = this.sitesTableHTML(s);
    if (this.detail.charts.length === 2 && s.metrics && s.metrics.reachable !== false) {
      this.detail.charts[0].update([{ label: 'CPU', color: 'var(--s1)', values: s.history.cpu }, { label: 'RAM', color: 'var(--s2)', values: s.history.ram }]);
      this.detail.charts[1].update([{ label: 'Entrant', color: 'var(--s1)', values: s.history.rx }, { label: 'Sortant', color: 'var(--s2)', values: s.history.tx }]);
    }
  },
  statusLine(s) {
    const st = Store.serverStatus(s), m = s.metrics || {};
    return `${statusPill(SERVER_STATUS[st].tone, SERVER_STATUS[st].label)}<span class="muted">${m.lastSeen ? (m.reachable === false ? 'Dernière réponse ' + fmt.rel(m.lastSeen) : 'Mesuré ' + fmt.rel(m.lastSeen)) : 'Jamais connecté'}</span>`;
  },
  renderDetail() {
    const s = Store.server(this.detail.id);
    const c = Store.client(s.clientId);
    const tabs = [['overview', 'Vue d’ensemble'], ['logs', 'Logs'], ['processes', 'Processus'], ['alerts', 'Alertes'], ['access', 'Accès SSH']];
    this.detail.charts.forEach(ch => ch.destroy()); this.detail.charts = [];
    this.detail.drawer.content.innerHTML = `
      <div class="dr-head">
        <div class="dr-title">${serverDot(Store.serverStatus(s))}<div><h2>${esc(s.name)}</h2><div class="sub"><a class="link" href="#client-${esc(c.id)}">${esc(c.name)}</a> · <span class="mono">${esc(s.host)}</span>${C.isSharedServer(s) ? ' · partagé avec ' + C.serverClientIds(s).slice(1).map(id => `<a class="link" href="#client-${esc(id)}">${esc(Store.clientName(id))}</a>`).join(', ') : ''}</div></div><span class="spacer"></span><button class="icon-btn" type="button" data-dr="close" aria-label="Fermer">${icon('x')}</button></div>
        <div class="toolbar dr-status">${this.statusLine(s)}</div>
        <div class="dr-actions">
          <button class="btn btn-primary" type="button" data-dr="console">${icon('terminal')}<span>Ouvrir la console</span></button>
          <button class="btn ${Store.serverStatus(s) === 'ok' || Store.serverStatus(s) === 'unknown' ? 'btn-soft' : 'btn-primary'}" type="button" data-dr="assist">${icon('sparkle')}<span>Kingo m’aide</span></button>
          <button class="btn" type="button" data-dr="test">${icon('refresh')}<span>Tester la connexion</span></button>
          <button class="btn btn-ghost" type="button" data-dr="edit">${icon('edit')}<span>Modifier</span></button>
          <button class="btn btn-ghost" type="button" data-dr="delete">${icon('trash')}<span>Supprimer</span></button>
        </div>
      </div>
      <div class="tabs dr-tabs" role="tablist">${tabs.map(t => `<button class="tab-btn" role="tab" type="button" data-tab="${t[0]}" aria-selected="${this.detail.tab === t[0]}">${t[1]}${t[0] === 'alerts' ? (() => { const n = Store.openAlerts().filter(a => a.serverId === s.id).length; return n ? ` <span class="count">${n}</span>` : ''; })() : ''}</button>`).join('')}</div>
      <div class="dr-body" id="drBody"></div>`;
    this.renderTab();
  },
  statsHTML(s) {
    const m = s.metrics || {};
    const up = m.reachable !== false && m.lastSeen;
    const v = (x, f) => (up && x !== null && x !== undefined) ? f(x) : '—';
    const pct = x => Math.round(x) + ' %';
    return `
      <div class="stat"><span>${icon('cpu')}Processeur</span><strong>${v(m.cpu, pct)}</strong><small>charge ${v(m.load, x => String(x).replace('.', ','))} · ${s.cores || '?'} cœurs</small></div>
      <div class="stat"><span>${icon('ram')}Mémoire</span><strong>${v(m.ram, pct)}</strong><small>${up && m.ram !== null ? fmt.bytes(s.ramTotal * m.ram / 100) + ' sur ' + fmt.bytes(s.ramTotal) : '—'}</small></div>
      <div class="stat"><span>${icon('disk')}Stockage</span><strong>${m.disk !== null && m.disk !== undefined ? pct(m.disk) : '—'}</strong><small>${m.disk !== null && m.disk !== undefined ? fmt.bytes(s.diskTotal * m.disk / 100) + ' sur ' + fmt.bytes(s.diskTotal) : '—'}</small></div>
      <div class="stat"><span>${icon('net')}Réseau</span><strong>${v(m.rx, fmt.rate)}</strong><small>↑ ${v(m.tx, fmt.rate)}</small></div>
      <div class="stat"><span>${icon('signal')}Connectés</span><strong>${v(m.users, x => x)}</strong><small>sessions SSH : ${v(m.ssh, x => x)}</small></div>
      <div class="stat"><span>${icon('clock')}En ligne depuis</span><strong>${v(m.uptime, fmt.uptime)}</strong><small>${esc(s.os || '')}</small></div>
      ${(() => { const sites = C.serverSites(s).filter(x => x.url), st = sites.map(x => Store.siteState(s, x).state), okN = st.filter(x => x === 'ok').length; return `<div class="stat"><span>${icon('globe')}Sites</span><strong>${sites.length ? okN + '<small> / ' + sites.length + '</small>' : 'Aucun'}</strong><small>${!sites.length ? 'ajoute les sites à surveiller' : st.includes('crit') ? 'un site ne répond pas' : st.includes('warn') ? 'un site est lent' : okN === sites.length ? 'tous répondent' : 'en attente de mesure'}</small></div>`; })()}
      <div class="stat"><span>${icon('pulse')}Rôle</span><strong style="font-size:15px">${esc(s.role || '—')}</strong><small>${esc(s.provider || '')}</small></div>`;
  },
  sitesTableHTML(s) {
    const sites = C.serverSites(s);
    if (!sites.length) return `<p class="muted">Rien de déclaré. « Modifier » permet d’ajouter les sites, dossiers et applications hébergés ici, avec leur propriétaire : je mesure alors le stockage, le CPU et la RAM de chacun.</p>`;
    const b = C.serverBreakdown(s), m = s.metrics || {};
    const row = id => b.rows.find(r => r.site.id === id);
    const tot = C.ownerTotals(s);
    const usedTotal = b.diskUsed;
    const owners = tot.owners.filter(o => o.hasSize).sort((x, y) => y.bytes - x.bytes);
    const bar = usedTotal && owners.length ? `<div class="disk-bar" role="img" aria-label="Répartition du disque par propriétaire">${owners.map((o, i) => `<span class="seg seg-${i % 4}" style="width:${Math.max(0.8, 100 * o.bytes / s.diskTotal).toFixed(2)}%" title="${esc(Store.clientName(o.clientId) + ' : ' + fmt.bytes(o.bytes))}"></span>`).join('')}${tot.systemBytes ? `<span class="seg seg-sys" style="width:${(100 * tot.systemBytes / s.diskTotal).toFixed(2)}%" title="${esc('Système et autres : ' + fmt.bytes(tot.systemBytes))}"></span>` : ''}</div>
      <ul class="disk-legend">${owners.map((o, i) => `<li><span class="sw seg-${i % 4}"></span>${esc(Store.clientName(o.clientId))}<strong>${esc(fmt.bytes(o.bytes))}</strong>${o.hasUsage ? `<em>CPU ${esc(fmt.pct(o.cpu))} · ${esc(fmt.bytes(o.ram))}</em>` : ''}</li>`).join('')}<li><span class="sw seg-sys"></span>Système et autres<strong>${tot.systemBytes !== null ? esc(fmt.bytes(tot.systemBytes)) : '—'}</strong>${tot.otherCpu !== null ? `<em>CPU ${esc(fmt.pct(tot.otherCpu))} · ${esc(fmt.bytes(tot.otherRam))}</em>` : ''}</li><li><span class="sw seg-free"></span>Libre<strong>${esc(fmt.bytes(s.diskTotal - usedTotal))}</strong></li></ul>` : '';
    const ordered = [];
    const add = (x, depth) => { ordered.push([x, depth]); b.rows.filter(r => r.parent === x.id).forEach(r => add(r.site, depth + 1)); };
    sites.filter(x => !(row(x.id) && row(x.id).parent)).forEach(x => add(x, 0));
    return `${bar}<div class="table-scroll"><table class="table site-table"><thead><tr><th>Site ou dossier</th><th>Propriétaire</th><th class="num">Stockage</th><th class="num">CPU</th><th class="num">RAM</th><th>Site web</th></tr></thead><tbody>${ordered.map(([x, depth]) => {
      const r = Store.siteState(s, x), u = row(x.id);
      const lab = { ok: 'En ligne', warn: 'Lent', crit: r.status ? 'Erreur HTTP ' + r.status : 'Ne répond pas', unknown: 'En attente', none: '' }[r.state];
      const own = Store.client(x.clientId);
      return `<tr${depth ? ' class="sub-row"' : ''}>
      <td><div class="cell-main" style="padding-left:${depth * 18}px"><strong>${depth ? '↳ ' : ''}${esc(x.name)}</strong><span class="mono">${esc([x.path, x.user ? 'utilisateur ' + x.user : '', !x.path && x.url ? x.url : ''].filter(Boolean).join(' · '))}</span></div></td>
      <td><a class="link" href="#client-${esc(x.clientId)}">${own && own.internal ? icon('crown', 'i-xs') + ' ' : ''}${esc(Store.clientName(x.clientId))}</a></td>
      <td class="num">${u && u.missing ? '<span class="muted" title="Dossier introuvable sur le serveur">introuvable</span>' : u && u.bytes !== null ? esc(fmt.bytes(u.bytes)) + (u.partial ? ' <span class="muted" title="Certains fichiers ne sont pas lisibles par l’utilisateur SSH : installe l’assistant Kingo pour une mesure complète.">≥</span>' : '') : '—'}</td>
      <td class="num">${u && u.cpu !== null && m.reachable !== false ? esc(fmt.pct(u.cpu)) : '—'}</td>
      <td class="num">${u && u.ram !== null && m.reachable !== false ? esc(fmt.bytes(u.ram)) : '—'}</td>
      <td>${x.url ? statusPill(SERVER_STATUS[r.state] ? SERVER_STATUS[r.state].tone : 'muted', lab + (r.ms && r.state !== 'crit' ? ' · ' + r.ms + ' ms' : '')) : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>
      ${b.measuredAt ? `<p class="muted" style="font-size:12px;margin-top:6px">Stockage mesuré ${esc(fmt.rel(new Date(b.measuredAt).toISOString()))} (toutes les 10 min) ; CPU et RAM à chaque passage.</p>` : ''}`;
  },
  async renderTab() {
    const s = Store.server(this.detail.id);
    const body = $('#drBody', this.detail.drawer.content);
    const tab = this.detail.tab;
    $$('[data-tab]', this.detail.drawer.content).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    this.detail.charts.forEach(ch => ch.destroy()); this.detail.charts = [];
    if (tab === 'overview') {
      const m = s.metrics || {};
      body.innerHTML = `
        ${m.reachable === false ? `<div class="note note-crit">${icon('alert')}<span>Le serveur ne répond plus en SSH depuis ${esc(fmt.rel(m.lastSeen).replace('il y a ', ''))}. Vérifie son état chez ${esc(s.provider)} (console de secours, redémarrage), puis relance un test.</span></div>` : ''}
        ${!m.lastSeen ? `<div class="note note-warn">${icon('key')}<span>Installe la clé publique (onglet Accès SSH), puis clique sur « Tester la connexion ».</span></div>` : ''}
        <div class="stat-grid" id="drStats">${this.statsHTML(s)}</div>
        <section><h3 style="font-size:14.5px;margin-bottom:8px">Sites et dossiers hébergés</h3><div id="drSites">${this.sitesTableHTML(s)}</div></section>
        <section><h3 style="font-size:14.5px;margin-bottom:8px">Processeur et mémoire</h3><div id="chCpu"></div></section>
        <section><h3 style="font-size:14.5px;margin-bottom:8px">Trafic réseau</h3><div id="chNet"></div></section>
        <dl class="kv">
          <dt>Hôte</dt><dd class="mono">${esc(s.host)}</dd>
          <dt>Adresse IP</dt><dd class="mono">${esc(s.ip)} : ${esc(s.port)}</dd>
          <dt>Utilisateur SSH</dt><dd class="mono">${esc(s.sshUser)}</dd>
          <dt>Hébergeur</dt><dd>${esc(s.provider)}${s.location ? ' — ' + esc(s.location) : ''}</dd>
          <dt>Système</dt><dd>${esc(s.os || '—')}</dd>
          <dt>Ajouté le</dt><dd>${esc(fmt.date(C.isoDate(new Date(s.createdAt))))}</dd>
        </dl>`;
      if (m.lastSeen && m.reachable !== false) {
        this.detail.charts.push(lineChart($('#chCpu', body), [{ label: 'CPU', color: 'var(--s1)', values: s.history.cpu }, { label: 'RAM', color: 'var(--s2)', values: s.history.ram }], { max: 100, threshold: 85, note: 'Une mesure toutes les ' + (LIVE ? '60' : '3') + ' s' }));
        this.detail.charts.push(lineChart($('#chNet', body), [{ label: 'Entrant', color: 'var(--s1)', values: s.history.rx }, { label: 'Sortant', color: 'var(--s2)', values: s.history.tx }], { format: v => fmt.rate(v), tickFormat: v => fmt.rate(v), left: 62 }));
      } else {
        $('#chCpu', body).innerHTML = '<p class="muted">Pas de mesure récente.</p>';
        $('#chNet', body).innerHTML = '<p class="muted">Pas de mesure récente.</p>';
      }
    } else if (tab === 'logs') {
      body.innerHTML = `<div class="toolbar"><div class="seg" id="logSeg"><button type="button" data-lv="all" aria-pressed="true">Tout</button><button type="button" data-lv="error" aria-pressed="false">Erreurs</button><button type="button" data-lv="warning" aria-pressed="false">Avertissements</button><button type="button" data-lv="info" aria-pressed="false">Infos</button></div><span class="grow"></span><button class="btn btn-sm" type="button" data-dr="reloadlogs">${icon('refresh')}<span>Actualiser</span></button></div><div class="logs" id="logBox"><p class="muted" style="padding:14px">Lecture des journaux…</p></div><p class="muted" style="font-size:12.5px">Source : journalctl (avertissements et plus) et les fichiers de logs déclarés. Les lignes sont lues à la demande, sans être stockées.</p>`;
      if (App.kingo) App.kingo.setMood('scan', 1500);
      try { this.detail.logs = await Store.fetchLogs(s.id); this.paintLogs('all'); }
      catch (e) { $('#logBox', body).innerHTML = `<p style="padding:14px" class="field-error">${esc(e.message)}</p>`; }
    } else if (tab === 'processes') {
      body.innerHTML = '<p class="muted">Lecture des processus…</p>';
      try {
        const ps = await Store.fetchProcesses(s.id);
        body.innerHTML = ps.length ? `<div class="table-scroll"><table class="table table-compact"><thead><tr><th>PID</th><th>Utilisateur</th><th class="num">CPU</th><th class="num">Mémoire</th><th>Commande</th></tr></thead><tbody>${ps.map(p => `<tr><td class="mono">${esc(p.pid)}</td><td>${esc(p.user)}</td><td class="num">${esc(String(p.cpu).replace('.', ','))} %</td><td class="num">${esc(String(p.mem).replace('.', ','))} %</td><td class="mono">${esc(p.cmd)}</td></tr>`).join('')}</tbody></table></div><p class="muted" style="font-size:12.5px">Les 10 processus les plus gourmands en processeur (ps).</p>`
          : emptyState('Aucun processus lisible.', 'Le serveur ne répond pas.');
      } catch (e) { body.innerHTML = `<p class="field-error">${esc(e.message)}</p>`; }
    } else if (tab === 'alerts') {
      const al = Store.state.alerts.filter(a => a.serverId === s.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
      body.innerHTML = al.length ? `<ul class="list-plain">${al.map(a => `<li class="alert-row"><span class="sev sev-${a.resolvedAt ? 'ok' : a.level}">${icon(a.resolvedAt ? 'check' : 'alert')}</span><div class="alert-text"><strong>${esc(a.title)}</strong><span class="meta">Ouverte ${esc(fmt.rel(a.openedAt))}${a.resolvedAt ? ' · résolue ' + esc(fmt.rel(a.resolvedAt)) : a.ackAt ? ' · prise en compte' : ''}</span><span class="msg">${esc(a.message)}</span>${!a.resolvedAt && !a.ackAt ? `<div class="btns"><button class="btn btn-sm btn-ghost" type="button" data-dr="ack" data-id="${esc(a.id)}">${icon('check')}<span>Prise en compte</span></button></div>` : ''}</div></li>`).join('')}</ul>`
        : emptyState('Aucune alerte pour ce serveur.', 'Seuils : CPU 85 %, mémoire 90 %, disque 85 % (critique à 95 %), site plus lent que 2 s.');
    } else if (tab === 'access') {
      body.innerHTML = this.accessHTML(s);
    }
  },
  paintLogs(lv) {
    const box = $('#logBox'); if (!box || !this.detail) return;
    $$('#logSeg [data-lv]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lv === lv)));
    const lines = (this.detail.logs || []).filter(l => lv === 'all' || (lv === 'error' ? ['error', 'crit'].includes(l.level) : l.level === lv));
    box.innerHTML = lines.length ? lines.map(l => `<div class="log-line"><span class="log-ts">${esc(fmt.time(l.ts))}</span><span class="lv lv-${esc(l.level)}">${esc(l.level === 'crit' ? 'CRIT' : l.level === 'error' ? 'ERREUR' : l.level === 'warning' ? 'AVERT.' : 'INFO')}</span><span class="log-src">${esc(l.source)}</span><span class="log-msg">${esc(l.message)}</span></div>`).join('')
      : '<p class="muted" style="padding:14px">Aucune ligne pour ce filtre.</p>';
  },
  installCommand(s, key) {
    const u = s.sshUser || 'kdc';
    return `sudo adduser --disabled-password --gecos "" ${u} 2>/dev/null; sudo install -d -m 700 -o ${u} -g ${u} /home/${u}/.ssh && echo "${key}" | sudo tee -a /home/${u}/.ssh/authorized_keys >/dev/null && sudo chmod 600 /home/${u}/.ssh/authorized_keys && sudo chown ${u}:${u} /home/${u}/.ssh/authorized_keys`;
  },
  accessHTML(s) {
    return `
      <div class="note">${icon('shield')}<span>La clé privée de ce serveur est générée et chiffrée (AES-256-GCM, clé dérivée propre au client ${esc(Store.clientName(s.clientId))}) sur le serveur KingDream Control. Elle n’est jamais envoyée à ton navigateur.</span></div>
      <dl class="kv">
        <dt>Empreinte de la clé</dt><dd class="mono">${esc(s.keyFingerprint || '—')}</dd>
        <dt>Créée le</dt><dd>${s.keyCreatedAt ? esc(fmt.dateTime(s.keyCreatedAt)) : '—'}</dd>
        <dt>Empreinte de l’hôte</dt><dd><span class="mono">${esc(s.hostFingerprint || 'enregistrée à la première connexion')}</span><br><small class="muted">Si elle change, KingDream Control refuse la connexion et lève une alerte critique.</small>${LIVE && s.hostFingerprint ? `<br><button class="btn btn-sm btn-ghost" type="button" data-dr="resethost" style="margin-top:6px">${icon('refresh')}<span>Réinitialiser après une réinstallation</span></button>` : ''}</dd>
      </dl>
      <section><h3 style="font-size:14.5px;margin-bottom:8px">Clé publique à autoriser</h3>
        <div class="codebox" id="pubKey">${esc(s.publicKey || '')}<button class="icon-btn icon-btn-sm copy" type="button" data-copy="pubKey" aria-label="Copier la clé publique">${icon('copy')}</button></div></section>
      <section><h3 style="font-size:14.5px;margin-bottom:8px">Installation sur le serveur du client</h3>
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px;color:var(--ink-2)">
          <li>Connecte-toi une fois au serveur avec ton accès habituel (ou la console de l’hébergeur).</li>
          <li>Colle cette commande : elle crée l’utilisateur <span class="mono">${esc(s.sshUser)}</span> et autorise la clé.
            <div class="codebox" id="instCmd" style="margin-top:8px">${esc(this.installCommand(s, s.publicKey || ''))}<button class="icon-btn icon-btn-sm copy" type="button" data-copy="instCmd" aria-label="Copier la commande">${icon('copy')}</button></div></li>
          <li>Reviens ici et clique sur « Tester la connexion ».</li>
          <li class="muted">Pas d’accès root (hébergement cPanel) ? Importe la clé publique dans cPanel → Accès SSH → Gérer les clés SSH, autorise-la, puis mets ton identifiant cPanel comme utilisateur SSH. Certains hébergeurs exigent aussi d’autoriser l’adresse IP du cockpit pour le SSH.</li>
        </ol></section>
      ${s.pendingPublicKey ? `<div class="note note-warn">${icon('key')}<span>Nouvelle clé en attente : installe-la comme ci-dessus, puis confirme la rotation. L’ancienne clé sera détruite.</span></div>
        <div class="codebox" id="newKey">${esc(s.pendingPublicKey)}<button class="icon-btn icon-btn-sm copy" type="button" data-copy="newKey" aria-label="Copier la nouvelle clé">${icon('copy')}</button></div>
        <div class="toolbar"><button class="btn btn-primary" type="button" data-dr="confirmrotate">${icon('check')}<span>Nouvelle clé installée, confirmer</span></button></div>`
        : `<div class="toolbar"><button class="btn" type="button" data-dr="rotate">${icon('repeat')}<span>Générer une nouvelle clé (rotation)</span></button><span class="muted" style="font-size:12.5px">Conseillé une fois par an ou si un accès a pu fuiter.</span></div>`}`;
  },
  async onDetailClick(e) {
    const t = e.target.closest('[data-tab]');
    if (t) { this.detail.tab = t.dataset.tab; this.renderTab(); return; }
    const lv = e.target.closest('[data-lv]');
    if (lv) { this.paintLogs(lv.dataset.lv); return; }
    const cp = e.target.closest('[data-copy]');
    if (cp) { const el = $('#' + cp.dataset.copy); const txt = el.firstChild.textContent; copyText(txt, el); return; }
    const a = e.target.closest('[data-dr]');
    if (!a) return;
    const id = this.detail.id, s = Store.server(id);
    switch (a.dataset.dr) {
      case 'close': this.closeDetail(); break;
      case 'console': this.openConsole(id); break;
      case 'test': this.test(id); break;
      case 'assist': Views.assist.open(id); break;
      case 'edit': this.editDialog(id); break;
      case 'delete': {
        const ok = await confirmDialog({ title: 'Supprimer ' + s.name + ' ?', message: 'La supervision s’arrête et la clé SSH de ce serveur est détruite. Pense à retirer la clé publique du fichier authorized_keys côté client.', confirmLabel: 'Supprimer le serveur', danger: true, icon: 'trash' });
        if (!ok) return;
        if (!(await stepUpDemo('Supprimer un serveur détruit sa clé SSH.'))) return;
        try { await Store.deleteServer(id); this.closeDetail(); toast('Serveur supprimé, clé détruite.'); } catch (err) { toast(err.message, { tone: 'crit' }); }
        break;
      }
      case 'reloadlogs': this.renderTab(); break;
      case 'ack': await Store.ackAlert(a.dataset.id); this.renderTab(); break;
      case 'rotate': {
        if (!(await stepUpDemo('La rotation remplace la clé SSH de ce serveur.'))) return;
        try { await Store.rotateKey(id); this.renderTab(); toast('Nouvelle clé générée. Installe-la puis confirme.'); } catch (err) { if (err.code !== 'cancelled') toast(err.message, { tone: 'crit' }); }
        break;
      }
      case 'resethost': {
        const ok = await confirmDialog({ title: 'Réinitialiser l’empreinte d’hôte ?', message: 'À faire uniquement si le serveur a été réinstallé : la prochaine connexion enregistrera la nouvelle empreinte. En cas de doute, vérifie-la d’abord dans la console de l’hébergeur (ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub).', confirmLabel: 'Réinitialiser', danger: true });
        if (!ok) return;
        try { const r = await API.post('/api/servers/' + encodeURIComponent(id) + '/reset-hostkey'); upsert(Store.state.servers, r.server); Store.changed('servers'); this.renderTab(); toast('Empreinte réinitialisée. Lance un test de connexion.'); } catch (err) { if (err.code !== 'cancelled') toast(err.message, { tone: 'crit' }); }
        break;
      }
      case 'confirmrotate': {
        try { a.disabled = true; await Store.confirmRotation(id); this.renderTab(); toast('Rotation terminée, ancienne clé détruite.'); } catch (err) { a.disabled = false; toast(err.message, { tone: 'crit' }); }
        break;
      }
    }
  },

  /* ---------- ajout / modification ---------- */
  editDialog(id, clientId) {
    const s = id ? Store.server(id) : null;
    const v = s || { id: C.uid('srv'), clientId: clientId || '', name: '', host: '', ip: '', port: 22, sshUser: 'kdc', provider: '', location: '', os: 'Debian 12', role: 'web', sites: [], cores: 2, ramTotal: 4 * 1073741824, diskTotal: 80 * 1073741824 };
    const clients = Store.state.clients.filter(c => c.status !== 'archivé' && !c.internal);
    const me = Store.internalClient();
    const SELF = me ? me.id : '__self';
    const selfLabel = 'Moi — ' + ((me && me.name) || (Store.company && Store.company.tradeName) || 'mon entreprise');
    const ownerOptions = (sel, withBlank) => (withBlank ? '<option value="">Choisir…</option>' : '') + `<option value="${esc(SELF)}"${sel === SELF ? ' selected' : ''}>${esc(selfLabel)}</option>` + clients.map(c => `<option value="${esc(c.id)}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
    const siteRow = x => `<div class="site-edit" data-site="${esc(x.id || C.uid('site'))}">
        <label class="field se-f-name"><span>Nom</span><input class="se-name" value="${esc(x.name || '')}" placeholder="Deep Clean, app de réservation…"></label>
        <label class="field se-f-owner"><span>Appartient à</span><select class="se-owner">${ownerOptions(x.clientId || '', false)}</select></label>
        <button class="icon-btn icon-btn-sm se-del" type="button" aria-label="Retirer cette ligne" title="Retirer">${icon('trash')}</button>
        <label class="field se-f-path"><span>Dossier sur le serveur</span><input class="se-path mono" value="${esc(x.path || '')}" placeholder="/var/www/deepclean" autocomplete="off" spellcheck="false"></label>
        <label class="field se-f-url"><span>Adresse web à surveiller</span><input class="se-url" value="${esc(x.url || '')}" placeholder="https://www.exemple.fr/ (facultatif)" inputmode="url"></label>
        <label class="field se-f-user"><span>Utilisateur Linux</span><input class="se-user mono" value="${esc(x.user || '')}" placeholder="facultatif" autocomplete="off" spellcheck="false"></label></div>`;
    const d = dialog({
      title: s ? 'Modifier ' + s.name : 'Ajouter un serveur', wide: true,
      subtitle: s ? '' : 'KingDream Control génère une clé SSH dédiée à ce serveur. Tu n’auras qu’à installer sa clé publique.',
      body: `<form id="srvForm" class="form-grid" novalidate>
        <label class="field span-2"><span>Propriétaire du serveur</span><select id="sf-client" required${s ? ' disabled' : ''}>${ownerOptions(v.clientId, true)}</select><small>${s ? 'Le propriétaire ne change pas : la clé SSH du serveur est chiffrée pour lui.' : 'Celui qui loue ou paie le serveur. Ses sites et ceux des autres se déclarent plus bas.'}</small></label>
        <label class="field"><span>Nom court</span><input id="sf-name" value="${esc(v.name)}" placeholder="web-01" required></label>
        <label class="field"><span>Rôle</span><select id="sf-role">${ROLES.map(r => `<option${r === v.role ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="field"><span>Nom d’hôte</span><input id="sf-host" value="${esc(v.host)}" placeholder="web-01.client.fr" required></label>
        <label class="field"><span>Adresse IP</span><input id="sf-ip" value="${esc(v.ip)}" placeholder="51.83.12.34" inputmode="decimal"></label>
        <label class="field"><span>Port SSH</span><input id="sf-port" value="${esc(v.port)}" inputmode="numeric"></label>
        <label class="field"><span>Utilisateur SSH</span><input id="sf-user" value="${esc(v.sshUser)}" autocomplete="off"><small>Un compte dédié, par exemple « kdc ».</small></label>
        <label class="field"><span>Hébergeur</span><input id="sf-provider" value="${esc(v.provider)}" placeholder="OVHcloud, Hetzner, Scaleway…"></label>
        <label class="field"><span>Localisation</span><input id="sf-location" value="${esc(v.location)}" placeholder="Gravelines"></label>
        <label class="field"><span>Système</span><input id="sf-os" value="${esc(v.os)}"></label>
        <label class="field"><span>Cœurs / RAM (Go) / disque (Go)</span><input id="sf-spec" value="${esc((v.cores || 2) + ' / ' + Math.round((v.ramTotal || 0) / 1073741824) + ' / ' + Math.round((v.diskTotal || 0) / 1073741824))}" placeholder="2 / 4 / 80"></label>
        <fieldset class="span-2 site-fieldset"><legend>Sites et dossiers hébergés</legend>
          <p class="muted">Une ligne par site, dossier ou application, avec son propriétaire. Avec le dossier, je mesure son stockage ; le CPU et la RAM sont rattachés aux programmes lancés depuis ce dossier ou par l’utilisateur Linux indiqué. Un sous-dossier (l’app du client dans son dossier) est compté à part.</p>
          <div id="sf-sites">${C.serverSites(v).map(siteRow).join('')}</div>
          <button class="btn btn-sm btn-ghost" type="button" id="sf-addsite">${icon('plus')}<span>Ajouter un site ou un dossier</span></button>
        </fieldset>
        <p class="field-error span-2" id="sf-err" hidden></p>
      </form>`,
      actions: [
        { label: 'Annuler' },
        { label: s ? 'Enregistrer' : 'Ajouter et générer la clé', tone: 'primary', icon: s ? 'check' : 'key', run: async (close) => {
          const g = k => $('#sf-' + k).value.trim();
          const err = $('#sf-err');
          const spec = g('spec').split('/').map(x => parseFloat(x.replace(',', '.')));
          const val = (r, c) => r.querySelector(c).value.trim();
          const sites = $$('#sf-sites .site-edit').map(r => ({ id: r.dataset.site, name: val(r, '.se-name'), url: val(r, '.se-url'), path: val(r, '.se-path').replace(/\/+$/, '') || (val(r, '.se-path') === '/' ? '/' : ''), user: val(r, '.se-user'), clientId: r.querySelector('.se-owner').value })).filter(x => x.url || x.path || x.user);
          sites.forEach(x => {
            if (x.url && !/^https?:\/\//i.test(x.url) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(x.url)) x.url = 'https://' + x.url;
            if (!x.name) x.name = x.url ? C.siteHost(x.url) : x.path ? (x.path.split('/').filter(Boolean).pop() || x.path) : x.user;
            ['url', 'path', 'user'].forEach(k => { if (!x[k]) delete x[k]; });
          });
          const next = Object.assign({}, v, { clientId: s ? v.clientId : g('client'), name: g('name'), role: g('role'), host: g('host'), ip: g('ip'), port: parseInt(g('port'), 10) || 22, sshUser: g('user') || 'kdc', provider: g('provider'), location: g('location'), os: g('os'), sites, cores: spec[0] || v.cores, ramTotal: (spec[1] || 0) * 1073741824 || v.ramTotal, diskTotal: (spec[2] || 0) * 1073741824 || v.diskTotal });
          delete next.healthUrl;
          const problems = [];
          if (!next.clientId) problems.push('choisis le propriétaire du serveur');
          if (!/^[a-z0-9][a-z0-9._-]{0,40}$/i.test(next.name)) problems.push('nom court invalide (lettres, chiffres, tirets)');
          if (!next.host && !next.ip) problems.push('indique un nom d’hôte ou une adresse IP');
          if (sites.some(x => x.url && !/^https?:\/\/[^\s/]+/i.test(x.url))) problems.push('une adresse web doit commencer par https://');
          if (sites.some(x => x.path && (!/^\/[A-Za-z0-9._@+\/ -]*$/.test(x.path) || /(^|\/)\.\.(\/|$)/.test(x.path)))) problems.push('un dossier doit être un chemin absolu (ex. /var/www/deepclean), sans « .. » ni guillemets');
          if (sites.some(x => x.user && !/^[a-z_][a-z0-9_.-]{0,31}$/i.test(x.user))) problems.push('utilisateur Linux invalide');
          if (problems.length) { err.textContent = 'À corriger : ' + problems.join(', ') + '.'; err.hidden = false; return false; }
          if (!next.host) next.host = next.ip;
          try {
            // « Moi » : la fiche interne de l'agence est créée la première fois
            if (next.clientId === '__self' || sites.some(x => x.clientId === '__self')) {
              const own = await Store.ensureInternalClient();
              if (next.clientId === '__self') next.clientId = own.id;
              sites.forEach(x => { if (x.clientId === '__self') x.clientId = own.id; });
            }
            const saved = await Store.saveServer(next);
            close();
            if (!s) this.keyDialog(saved.id); else toast('Serveur enregistré.');
          } catch (e) { err.textContent = e.message; err.hidden = false; }
          return false;
        } },
      ],
      onOpen: (wrap) => {
        const box = $('#sf-sites', wrap);
        const ownerSel = $('#sf-client', wrap);
        $('#sf-addsite', wrap).addEventListener('click', () => {
          box.insertAdjacentHTML('beforeend', siteRow({ clientId: ownerSel.value || SELF }));
          box.lastElementChild.querySelector('.se-name').focus();
        });
        box.addEventListener('click', e => { const del = e.target.closest('.se-del'); if (del) del.closest('.site-edit').remove(); });
      },
    });
    return d;
  },
  keyDialog(id) {
    const s = Store.server(id);
    dialog({
      title: 'Clé générée pour ' + s.name, wide: true,
      subtitle: 'Autorise cette clé publique sur le serveur, puis teste la connexion.',
      body: `<div class="note">${icon('shield')}<span>La clé privée correspondante reste chiffrée sur le serveur KingDream Control. Elle n’apparaîtra jamais ici.</span></div>
        <div class="field"><span class="field-label">Commande à coller sur le serveur du client</span><div class="codebox" id="kdCmd">${esc(this.installCommand(s, s.publicKey))}<button class="icon-btn icon-btn-sm copy" type="button" aria-label="Copier la commande">${icon('copy')}</button></div></div>
        <div class="field"><span class="field-label">Clé publique seule</span><div class="codebox" id="kdKey">${esc(s.publicKey)}<button class="icon-btn icon-btn-sm copy" type="button" aria-label="Copier la clé">${icon('copy')}</button></div></div>`,
      actions: [{ label: 'Plus tard' }, { label: 'Tester la connexion', tone: 'primary', icon: 'refresh', run: (close) => { close(); App.go('serveur-' + id); this.test(id); return false; } }],
      onOpen: el => el.querySelectorAll('.copy').forEach(b => b.addEventListener('click', () => { const box = b.parentElement; copyText(box.firstChild.textContent, box); })),
    });
  },

  /* ---------- console ---------- */
  async openConsole(id) {
    const s = Store.server(id);
    if (!s) return;
    if (!LIVE && !(await stepUpDemo('Ouvrir une console donne un accès complet à ' + s.name + '.'))) return;
    let ticket = null;
    if (LIVE) {
      try { ticket = (await API.post('/api/servers/' + encodeURIComponent(id) + '/console', {})).ticket; }
      catch (e) { if (e.code !== 'cancelled') toast(e.message, { tone: 'crit' }); return; }
    }
    const started = Date.now();
    let term = null, fit = null, ws = null, ro = null;
    const d = dialog({
      title: 'Console ' + s.name, className: 'dialog-console',
      body: `<div class="console-wrap"><div class="console-bar"><span class="traffic"><button type="button" class="tl-close" data-tl="close" aria-label="Fermer la console" title="Fermer"></button><span class="tl-min" aria-hidden="true"></span><button type="button" class="tl-zoom" data-tl="zoom" aria-label="Agrandir la console" title="Agrandir"></button></span><strong>${esc(s.sshUser)}@${esc(s.name)}</strong><span>${esc(s.ip)}:${esc(s.port)} · ${esc(Store.clientName(s.clientId))}</span><span class="rec">Session journalisée</span><span class="spacer"></span><span class="mono" title="Empreinte de la clé utilisée">${esc((s.keyFingerprint || '').slice(0, 19))}…</span><button class="btn btn-sm btn-ghost" type="button" data-close-console>${icon('x')}<span>Fermer</span></button></div><div class="console-term" id="termHost"></div></div>`,
      onClose: () => {
        try { if (ws) ws.close(); } catch (e) { /* */ }
        if (ro) ro.disconnect();
        if (term) term.dispose();
        const mins = Math.max(1, Math.round((Date.now() - started) / 60000));
        Store.consoleOpened(id, mins + ' min');
      },
    });
    d.el.querySelector('[data-close-console]').addEventListener('click', () => d.close());
    d.el.querySelector('[data-tl="close"]').addEventListener('click', () => d.close());
    d.el.querySelector('[data-tl="zoom"]').addEventListener('click', () => { d.el.querySelector('.dialog').classList.toggle('is-max'); if (term) setTimeout(() => { try { fit.fit(); } catch (e) { /* */ } term.focus(); }, 60); });
    Store.consoleOpened(id);
    try {
      await loadScript(CFG.vendor.xterm);
      await loadScript(CFG.vendor.fit);
      try { await document.fonts.load('13px "JetBrains Mono"'); } catch (e) { /* */ }
    } catch (e) {
      $('#termHost', d.el).innerHTML = `<p style="color:#d70015;padding:12px">Le terminal n’a pas pu se charger : ${esc(e.message)}</p>`;
      return;
    }
    term = new window.Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: true, convertEol: false, scrollback: 3000,
      // fenêtre Terminal claire : fond blanc, curseur bleu KingDream
      theme: { background: '#ffffff', foreground: '#1d1d1f', cursor: '#0a63e6', cursorAccent: '#ffffff', selectionBackground: 'rgba(10,99,230,.18)', black: '#1d1d1f', red: '#c4161c', green: '#1e7f36', yellow: '#9a5b00', blue: '#0a5fdb', magenta: '#a23fc4', cyan: '#0b7c93', white: '#6e7480', brightBlack: '#8a909b', brightRed: '#e0262d', brightGreen: '#25963f', brightYellow: '#b26b00', brightBlue: '#2f7df4', brightMagenta: '#b555d6', brightCyan: '#1491ab', brightWhite: '#3a3f4a' },
    });
    fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    const hostEl = $('#termHost', d.el);
    term.open(hostEl);
    try { fit.fit(); } catch (e) { /* */ }
    ro = new ResizeObserver(debounce(() => { try { fit.fit(); } catch (e) { /* */ } }, 60));
    ro.observe(hostEl);
    term.focus();
    if (LIVE) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(proto + '://' + location.host + '/ws/console?ticket=' + encodeURIComponent(ticket));
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
      ws.onmessage = ev => term.write(typeof ev.data === 'string' ? ev.data : new Uint8Array(ev.data));
      ws.onclose = ev => term.write('\r\n\x1b[38;5;245m[session fermée' + (ev.reason ? ' : ' + ev.reason : '') + ']\x1b[0m\r\n');
      term.onData(data => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'in', d: data })); });
      term.onResize(({ cols, rows }) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'resize', cols, rows })); });
    } else {
      DemoShell.attach(term, s);
    }
  },
};

/** En démo, l’étape 2FA est simulée (n’importe quel code à 6 chiffres) ; mémorisée 10 minutes. */
let _stepUpUntil = 0;
async function stepUpDemo(message) {
  if (LIVE) return true;
  if (Date.now() < _stepUpUntil) return true;
  const ok = await StepUp.prompt((message ? message + ' ' : '') + 'Démo : n’importe quel code à 6 chiffres convient.');
  if (ok) _stepUpUntil = Date.now() + 10 * 60000;
  return ok;
}

/* ---------- terminal de démonstration ---------- */
const DemoShell = {
  attach(term, s) {
    const m = s.metrics || {};
    const user = s.sshUser || 'kdc';
    const prompt = () => term.write('\x1b[38;5;26m' + user + '@' + s.name + '\x1b[0m:\x1b[38;5;32m~\x1b[0m$ ');
    const w = (t) => term.write(t.replace(/\n/g, '\r\n'));
    if (m.reachable === false || !m.lastSeen) {
      w('Connexion à ' + s.ip + ':' + s.port + ' (clé ' + (s.keyFingerprint || '').slice(0, 19) + '…)\n');
      setTimeout(() => {
        w('\x1b[31mssh: connect to host ' + s.ip + ' port ' + s.port + ': Connection timed out\x1b[0m\n');
        w('\x1b[38;5;245mLe serveur ne répond pas. Vérifie son état chez ' + s.provider + ' puis relance un test de connexion.\x1b[0m\n');
      }, 1400);
      return;
    }
    w('\x1b[38;5;245mConnexion établie via le relais KingDream Control (clé ed25519, hôte vérifié).\x1b[0m\n');
    w('\x1b[38;5;245mMode démo : terminal simulé. Tape « help » pour voir les commandes.\x1b[0m\n\n');
    w('Linux ' + s.name + ' 6.1.0-26-amd64 #1 SMP x86_64\n\nDernière connexion : ' + new Date(Date.now() - 86400000 * 2).toLocaleString('fr-FR') + ' depuis 192.0.2.10\n');
    prompt();
    let line = '', hist = [], hi = 0, closed = false;
    const pct = v => (v === null || v === undefined) ? '?' : Math.round(v);
    const gb = b => (b / 1073741824).toFixed(1).replace('.', ',') + 'G';
    const cmds = {
      help: () => 'Commandes disponibles : uptime, df -h, free -h, top, ps, who, uname -a, hostname, whoami, date,\nsystemctl status nginx, journalctl -p err, tail /var/log/nginx/error.log, cat /etc/os-release, clear, exit',
      whoami: () => user,
      hostname: () => s.host,
      date: () => new Date().toString(),
      'uname -a': () => 'Linux ' + s.name + ' 6.1.0-26-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.1.112-1 x86_64 GNU/Linux',
      uptime: () => ' ' + new Date().toTimeString().slice(0, 8) + ' up ' + fmt.uptime(m.uptime) + ',  ' + (m.ssh || 1) + ' user,  load average: ' + [m.load, m.load * .9, m.load * .8].map(x => (x || 0).toFixed(2)).join(', '),
      'df -h': () => 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        ' + gb(s.diskTotal).padStart(5) + '  ' + gb(s.diskTotal * m.disk / 100).padStart(5) + ' ' + gb(s.diskTotal * (1 - m.disk / 100)).padStart(5) + '  ' + pct(m.disk) + '% /\ntmpfs            1,9G     0  1,9G   0% /dev/shm',
      'free -h': () => '               total        used        free      shared  buff/cache   available\nMem:           ' + gb(s.ramTotal) + '        ' + gb(s.ramTotal * m.ram / 100) + '        ' + gb(s.ramTotal * (1 - m.ram / 100) * .4) + '        42M        ' + gb(s.ramTotal * (1 - m.ram / 100) * .6) + '        ' + gb(s.ramTotal * (1 - m.ram / 100)) + '\nSwap:          1,0G          0B        1,0G',
      who: () => user + '     pts/0        ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' (192.0.2.10)',
      'cat /etc/os-release': () => 'PRETTY_NAME="' + (s.os || 'Debian GNU/Linux 12 (bookworm)') + '"\nID=debian\nVERSION_ID="12"',
      'systemctl status nginx': () => '\x1b[32m●\x1b[0m nginx.service - A high performance web server and a reverse proxy server\n     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)\n     Active: \x1b[32mactive (running)\x1b[0m since ' + new Date(Date.now() - (m.uptime || 3600) * 1000).toLocaleString('fr-FR') + '\n   Main PID: 812 (nginx)\n      Tasks: 3 (limit: 4652)\n     Memory: 18.4M',
      'journalctl -p err': () => demoLogs(s).filter(l => ['error', 'crit'].includes(l.level)).map(l => fmt.dateTime(l.ts) + ' ' + s.name + ' ' + l.source + ': ' + l.message).join('\n') || '-- No entries --',
      'tail /var/log/nginx/error.log': () => demoLogs(s).filter(l => l.source === 'nginx').map(l => new Date(l.ts).toISOString().replace('T', ' ').slice(0, 19) + ' [' + (l.level === 'info' ? 'notice' : l.level === 'warning' ? 'warn' : 'error') + '] ' + l.message).join('\n') || '(fichier vide)',
      ps: () => '    PID USER     %CPU %MEM COMMAND\n' + demoProcesses(s).map(p => String(p.pid).padStart(7) + ' ' + p.user.padEnd(8) + ' ' + String(p.cpu).padStart(4) + ' ' + String(p.mem).padStart(4) + ' ' + p.cmd).join('\n'),
      top: () => 'top - ' + new Date().toTimeString().slice(0, 8) + ' up ' + fmt.uptime(m.uptime) + ', load average: ' + (m.load || 0).toFixed(2) + '\n%Cpu(s): ' + (m.cpu || 0).toFixed(1) + ' us   MiB Mem: ' + Math.round(s.ramTotal / 1048576) + ' total, ' + Math.round(s.ramTotal * m.ram / 104857600) + ' used\n\n' + cmds.ps() + '\n\x1b[38;5;245m(instantané — démo)\x1b[0m',
      ls: () => 'backups  deploy.sh  logs  www',
      pwd: () => '/home/' + user,
    };
    term.onData(data => {
      if (closed) return;
      if (data.charCodeAt(0) === 27) {
        if ((data === '\x1b[A' || data === '\x1b[B') && hist.length) {
          hi = Math.max(0, Math.min(hist.length, hi + (data === '\x1b[A' ? -1 : 1)));
          term.write('\b \b'.repeat(line.length));
          line = hist[hi] || '';
          term.write(line);
        }
        return;
      }
      for (const ch of data) {
        const code = ch.charCodeAt(0);
        if (ch === '\r') {
          term.write('\r\n');
          const cmd = line.trim();
          if (cmd) { hist.push(cmd); hi = hist.length; }
          line = '';
          if (cmd === 'clear') { term.clear(); prompt(); continue; }
          if (cmd === 'exit' || cmd === 'logout') { closed = true; w('déconnexion\n\x1b[38;5;245m[session fermée — journalisée]\x1b[0m\n'); return; }
          if (cmd) {
            let out;
            if (cmds[cmd]) out = cmds[cmd]();
            else if (cmd.startsWith('sudo')) out = '[sudo] mot de passe de ' + user + ' : \x1b[38;5;245m(démo : non exécuté)\x1b[0m';
            else if (cmd.startsWith('cd')) out = '';
            else out = cmd.split(' ')[0] + ' : commande introuvable (démo — tape « help »)';
            if (out) w(out + '\n');
          }
          prompt();
        } else if (code === 127) { if (line.length) { line = line.slice(0, -1); term.write('\b \b'); } }
        else if (code === 3) { term.write('^C\r\n'); line = ''; prompt(); }
        else if (code === 12) { term.clear(); }
        else if (code >= 32) { line += ch; term.write(ch); }
      }
    });
  },
};

/* ---- js/views/clients.js ---- */
/* ===== Clients : liste, fiche, services souscrits, historique ===== */
const SUB_CATEGORIES = ['Hébergement', 'Maintenance', 'SEO', 'Domaine', 'Application', 'NFC', 'Autre'];

Views.clients = {
  filter: 'actif', q: '',
  render(page, params) {
    this.page = page;
    page.onclick = e => this.onClick(e);
    if (params.id) { this.id = params.id; this.renderDetail(); } else { this.id = null; this.renderList(); }
  },
  update() { if (!this.page || !this.page.isConnected) return; if (this.id) this.renderDetail(); else this.renderTable(); },

  /* ---------- liste ---------- */
  renderList() {
    this.page.innerHTML = `
      <div class="toolbar">
        <div class="seg" id="cliSeg" role="group" aria-label="Filtrer les clients"></div>
        <label class="search-inline">${icon('search')}<input class="input" id="cliQ" type="search" placeholder="Nom, contact, ville…" aria-label="Rechercher un client" value="${esc(this.q)}"></label>
        <span class="grow"></span>
        <button class="btn btn-primary" type="button" data-cact="new">${icon('plus')}<span>Nouveau client</span></button>
      </div>
      <section class="panel"><div class="table-scroll" id="cliTable"></div></section>`;
    $('#cliQ').addEventListener('input', debounce(e => { this.q = e.target.value.trim().toLowerCase(); this.renderTable(); }, 120));
    this.renderTable();
  },
  renderTable() {
    const host = $('#cliTable'); if (!host) return;
    const S = Store;
    const all = S.state.clients;
    const cnt = { actif: 0, prospect: 0, 'archivé': 0, all: all.length };
    all.forEach(c => { cnt[c.status] = (cnt[c.status] || 0) + 1; });
    $('#cliSeg').innerHTML = [['actif', 'Actifs'], ['prospect', 'Prospects'], ['archivé', 'Archivés'], ['all', 'Tous']].map(o => `<button type="button" data-cfilter="${o[0]}" aria-pressed="${this.filter === o[0]}">${o[1]} <span class="count">${cnt[o[0]] || 0}</span></button>`).join('');
    const list = all.filter(c => (this.filter === 'all' || c.status === this.filter) && (!this.q || [c.name, c.contact, c.email, c.city, c.activity].join(' ').toLowerCase().includes(this.q)))
      .sort((a, b) => (a.internal ? 1 : 0) - (b.internal ? 1 : 0) || a.name.localeCompare(b.name));
    if (!list.length) { host.innerHTML = emptyState(this.q ? 'Aucun client ne correspond.' : 'Aucun client ici.', 'Crée une fiche pour suivre ses services, ses serveurs et ses factures.', `<button class="btn btn-primary" type="button" data-cact="new">${icon('plus')}<span>Nouveau client</span></button>`); return; }
    host.innerHTML = `<table class="table table-cards"><thead><tr><th>Client</th><th>Contact</th><th class="num">Abonnement</th><th>Serveurs</th><th>Renouvellement</th><th class="num">Reste dû</th><th>Statut</th></tr></thead><tbody>${list.map(c => {
      const sv = S.serversFor(c.id), subs = S.subsFor(c.id).filter(s => s.status === 'actif'), bal = S.clientBalance(c.id), nr = S.nextRenewal(c.id);
      return `<tr class="clickable" data-open="${esc(c.id)}">
        <td class="c-main"><div class="cell-flex">${avatar(c.name)}<div class="cell-main"><strong>${esc(c.name)}</strong><span>${esc([c.activity, c.city].filter(Boolean).join(' · '))}</span></div></div></td>
        <td data-hide-m><div class="cell-main"><strong style="font-weight:500">${esc(c.contact || '—')}</strong><span>${esc(c.email || '')}</span></div></td>
        <td class="num c-end"><div class="cell-main" style="align-items:flex-end"><strong>${c.internal ? '—' : esc(fmt.eur(S.mrr(c.id)))}</strong><span>${c.internal ? 'interne' : fmt.plural(subs.length, 'service') + ' /mois'}</span></div></td>
        <td data-hide-m>${sv.length ? `<span class="status-dots" title="${esc(sv.map(s => s.name + ' : ' + SERVER_STATUS[S.serverStatus(s)].label).join(', '))}">${sv.map(s => serverDot(S.serverStatus(s))).join('')}</span> <span class="muted" style="font-size:12.5px">${sv.length}</span>` : ''}${S.hostedFor(c.id).length ? `<span class="muted" style="font-size:12.5px"${sv.length ? ' ' : ''} title="${esc(S.hostedFor(c.id).map(s => 'hébergé sur ' + s.name + ' (' + S.clientName(s.clientId) + ')').join(', '))}">${sv.length ? ' + ' : ''}${S.hostedFor(c.id).map(s => serverDot(S.hostedStatus(s, c.id))).join('')} partagé</span>` : ''}${!sv.length && !S.hostedFor(c.id).length ? '<span class="muted">—</span>' : ''}</td>
        <td data-hide-m>${nr ? esc(fmt.date(nr.renewalDate)) : '<span class="muted">—</span>'}</td>
        <td class="num c-main">${bal.due ? `<span class="${bal.overdue ? 'late' : ''}" style="font-size:13.5px">${esc(fmt.eur(bal.due))}</span>` : '<span class="muted">0,00 €</span>'}</td>
        <td class="c-end">${c.status === 'actif' ? statusPill('ok', 'Actif') : c.status === 'prospect' ? statusPill('info', 'Prospect') : statusPill('muted', 'Archivé')}</td></tr>`;
    }).join('')}</tbody></table>`;
  },

  /* ---------- fiche ---------- */
  renderDetail() {
    const S = Store, c = S.client(this.id);
    if (!c) { this.page.innerHTML = `<a class="back" href="#clients">${icon('arrowLeft')}Clients</a>` + emptyState('Ce client n’existe plus.', ''); return; }
    $('#pageTitle').textContent = c.name;
    const bal = S.clientBalance(c.id), subs = S.subsFor(c.id), sv = S.serversFor(c.id), hosted = S.hostedFor(c.id);
    const docs = S.docsFor(c.id).slice().sort((a, b) => (b.issueDate + b.createdAt).localeCompare(a.issueDate + a.createdAt));
    const pays = [];
    docs.filter(d => d.kind === 'invoice').forEach(d => (d.payments || []).forEach(p => pays.push({ p, d })));
    pays.sort((a, b) => b.p.date.localeCompare(a.p.date));
    const audit = (S.state.audit || []).filter(a => a.clientId === c.id).slice(-8).reverse();
    const firstSub = subs.reduce((m, s) => (!m || s.startDate < m ? s.startDate : m), null);
    this.page.innerHTML = `
      <a class="back" href="#clients">${icon('arrowLeft')}Clients</a>
      <div class="client-hero">${avatar(c.name)}<div style="min-width:0"><h2>${esc(c.name)}</h2><div class="sub"><span>${esc([c.activity, c.city].filter(Boolean).join(' · '))}</span>${c.status === 'actif' ? statusPill('ok', 'Actif') : c.status === 'prospect' ? statusPill('info', 'Prospect') : statusPill('muted', 'Archivé')}<span>Client depuis le ${esc(fmt.date(c.since))}</span></div></div>
        <span class="spacer"></span>
        <div class="toolbar">
          ${c.internal ? '' : `<button class="btn btn-soft" type="button" data-cact="quote">${icon('quote')}<span>Nouveau devis</span></button><button class="btn btn-primary" type="button" data-cact="invoice">${icon('file')}<span>Nouvelle facture</span></button>`}
          <button class="btn btn-ghost" type="button" data-cact="edit">${icon('edit')}<span>Modifier</span></button>
          <div class="menu-wrap"><button class="icon-btn" type="button" data-cact="more" aria-label="Plus d’actions" aria-haspopup="true">${icon('more')}</button>
            <div class="menu" id="cliMenu" hidden>
              ${subs.some(s => s.status === 'actif' && s.period === 'mensuel') ? `<button type="button" data-cact="billsubs">${icon('repeat')}Facturer l’abonnement du mois</button>` : ''}
              <button type="button" data-cact="export">${icon('download')}Exporter les données de ce client</button>
              <hr><button type="button" data-cact="delete">${icon('trash')}${S.docsFor(c.id).some(d => d.status !== 'draft') ? 'Archiver le client' : 'Supprimer le client'}</button>
            </div></div>
        </div>
      </div>
      ${c.internal ? '' : `<div class="sum-strip" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="sum-cell"><span>${icon('repeat', 'i-xs')}Abonnement mensuel</span><strong>${esc(fmt.eur(S.mrr(c.id)))}</strong><small>HT${firstSub ? ' · depuis le ' + esc(fmt.date(firstSub)) : ''}</small></div>
        <div class="sum-cell"><span>Total facturé</span><strong>${esc(fmt.eur(bal.invoiced))}</strong><small>TTC, factures émises</small></div>
        <div class="sum-cell"><span>Encaissé</span><strong>${esc(fmt.eur(bal.paid))}</strong><small>${fmt.plural(pays.length, 'paiement')}</small></div>
        <div class="sum-cell"><span>Reste dû</span><strong>${esc(fmt.eur(bal.due))}</strong><small>${bal.overdue ? '<span class="late">dont ' + esc(fmt.eur(bal.overdue)) + ' en retard</span>' : 'aucun retard'}</small></div>
      </div>`}
      <div class="client-grid">
        <div class="dash-col">
          <section class="panel"><div class="panel-head"><h2>Coordonnées</h2></div><div class="panel-body"><div class="contact-list">
            ${this.contactItem('user', 'Contact', c.contact)}
            ${this.contactItem('mail', 'Email', c.email, true)}
            ${this.contactItem('phone', 'Téléphone', c.phone)}
            ${this.contactItem('pin', 'Adresse', [c.address, [c.zip, c.city].filter(Boolean).join(' '), c.country !== 'France' ? c.country : ''].filter(Boolean).join(', '))}
            ${c.type === 'pro' ? this.contactItem('building', 'SIREN', c.siren || 'à compléter (obligatoire sur les factures depuis le 1er septembre 2026)') : ''}
            ${c.vatNumber ? this.contactItem('hash', 'N° TVA', c.vatNumber) : ''}
            ${c.notes ? this.contactItem('info', 'Notes', c.notes) : ''}
          </div></div></section>
          <section class="panel"><div class="panel-head"><h2>Serveurs</h2><span class="sub">${fmt.plural(sv.length, 'serveur')}${hosted.length ? ' · ' + fmt.plural(hosted.reduce((t, s) => t + S.sitesOf(s, c.id).length, 0), 'site') + ' hébergé' + (hosted.reduce((t, s) => t + S.sitesOf(s, c.id).length, 0) > 1 ? 's' : '') + ' ailleurs' : ''}</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" data-cact="addserver">${icon('plus')}<span>Ajouter</span></button></div><div class="panel-body">
            ${sv.length ? sv.map(s => { const st = S.serverStatus(s), m = s.metrics || {}; const others = C.serverClientIds(s).slice(1); return `<a class="renew-row" href="#serveur-${esc(s.id)}">${serverDot(st)}<div class="renew-text"><strong class="mono">${esc(s.name)}</strong><span>${esc(s.ip)} · ${esc(s.provider)} · ${esc(SERVER_STATUS[st].label)}${m.reachable !== false && m.cpu !== null && m.cpu !== undefined ? ' · CPU ' + Math.round(m.cpu) + ' %' : ''}${others.length ? ' · héberge aussi ' + esc(others.map(id => S.clientName(id)).join(', ')) : ''}</span></div>${icon('chevronRight')}</a>`; }).join('') : ''}
            ${hosted.map(s => { const st = S.hostedStatus(s, c.id), mine = S.sitesOf(s, c.id); const o = C.ownerTotals(s).owners.find(x => x.clientId === c.id); const use = o ? [o.hasSize ? fmt.bytes(o.bytes) : '', o.hasUsage ? 'CPU ' + fmt.pct(o.cpu) + ' · RAM ' + fmt.bytes(o.ram) : ''].filter(Boolean).join(' · ') : ''; return `<a class="renew-row" href="#serveur-${esc(s.id)}">${serverDot(st)}<div class="renew-text"><strong>${esc(mine.map(x => x.name).join(', '))}</strong><span>hébergé sur ${esc(s.name)}, serveur de ${esc(S.clientName(s.clientId))} · ${esc(SERVER_STATUS[st].label)}${use ? ' · ' + esc(use) : ''}</span></div>${icon('chevronRight')}</a>`; }).join('')}
            ${!sv.length && !hosted.length ? `<p class="muted">Aucun serveur supervisé${c.notes && /mutualisé/.test(c.notes) ? ' (hébergement mutualisé)' : ''}.</p>` : ''}
          </div></section>
          <section class="panel"><div class="panel-head"><h2>Données isolées</h2></div><div class="panel-body"><div class="note">${icon('shield')}<span>Les secrets de ce client (clés SSH) sont chiffrés avec une clé dérivée qui lui est propre et liés à ses serveurs : ils ne peuvent pas être déchiffrés dans le contexte d’un autre client. Chaque action le concernant est tracée dans le journal.</span></div></div></section>
        </div>
        <div class="dash-col">
          <section class="panel"><div class="panel-head"><h2>Services souscrits</h2><span class="sub">${fmt.plural(subs.filter(s => s.status === 'actif').length, 'actif')}</span><span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" data-cact="addsub">${icon('plus')}<span>Ajouter un service</span></button></div>
            <div class="panel-body">${subs.length ? `<div class="table-scroll"><table class="table table-cards"><thead><tr><th>Service</th><th class="num">Prix HT</th><th>Début</th><th>Renouvellement</th><th>Statut</th><th></th></tr></thead><tbody>${subs.map(s => `<tr>
              <td class="c-main"><div class="cell-main"><strong>${esc(s.label)}</strong><span>${esc(s.category)} · facturé ${s.period === 'annuel' ? 'chaque année' : 'chaque mois'}</span></div></td>
              <td class="num c-end amount-strong">${esc(fmt.eur(C.cents(s.priceHT)))}<span class="muted" style="font-weight:400"> /${s.period === 'annuel' ? 'an' : 'mois'}</span></td>
              <td class="c-main">${esc(fmt.date(s.startDate))}</td>
              <td class="c-end">${esc(fmt.date(s.renewalDate))}</td>
              <td class="c-main">${s.status === 'actif' ? statusPill('ok', 'Actif') : s.status === 'suspendu' ? statusPill('warn', 'Suspendu') : statusPill('muted', 'Résilié')}</td>
              <td class="c-end"><button class="icon-btn icon-btn-sm" type="button" data-cact="editsub" data-id="${esc(s.id)}" aria-label="Modifier ${esc(s.label)}">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div>`
              : `<p class="muted">Aucun service souscrit pour l’instant.</p>`}</div></section>
          <section class="panel"><div class="panel-head"><h2>Factures et devis</h2><span class="sub">${fmt.plural(docs.length, 'document')}</span></div>
            <div class="panel-body">${docs.length ? `<div class="table-scroll"><table class="table table-cards"><thead><tr><th>Document</th><th>Date</th><th class="num">Montant TTC</th><th>Statut</th></tr></thead><tbody>${docs.slice(0, 14).map(d => { const t = S.totals(d); return `<tr class="clickable" data-doc="${esc(d.id)}">
              <td class="c-main"><div class="cell-main"><strong class="doc-num${d.number ? '' : ' draft'}">${esc(d.number || 'Brouillon')}</strong><span>${esc(C.KIND_LABELS[d.kind])}${d.lines[0] ? ' · ' + esc(d.lines[0].description) : ''}</span></div></td>
              <td class="c-full" data-hide-m>${esc(fmt.date(d.issueDate))}</td>
              <td class="num c-end amount-strong">${esc(fmt.eur(C.sign(d) * t.totalTTC))}</td>
              <td class="c-end">${docPill(d, S.today)}</td></tr>`; }).join('')}</tbody></table></div>${docs.length > 14 ? `<p class="muted" style="margin-top:8px">${fmt.plural(docs.length - 14, 'document plus ancien', 'documents plus anciens')} dans <a class="link" href="#facturation">Facturation</a>.</p>` : ''}`
              : `<p class="muted">Aucun document pour ce client.</p>`}</div></section>
          <section class="panel"><div class="panel-head"><h2>Paiements reçus</h2><span class="sub">${fmt.plural(pays.length, 'paiement')}</span></div>
            <div class="panel-body">${pays.length ? `<div class="pay-list">${pays.slice(0, 8).map(x => `<div class="pay-item"><span class="sev sev-ok">${icon('card')}</span><div class="grow"><strong>${esc(fmt.eur(C.cents(x.p.amount)))}</strong><span>${esc(fmt.date(x.p.date))} · ${esc(x.p.method)} · ${esc(x.d.number)}</span></div></div>`).join('')}</div>` : '<p class="muted">Aucun paiement enregistré.</p>'}</div></section>
          <section class="panel"><div class="panel-head"><h2>Journal</h2><span class="sub">actions sur ce client</span></div>
            <div class="panel-body">${audit.length ? audit.map(a => `<div class="act-row"><span class="act-ico">${icon('history')}</span><div class="act-text"><strong>${esc(a.label)}</strong><span>${esc(a.target || '')}</span></div><span class="act-time">${esc(fmt.rel(a.ts))}</span></div>`).join('') : '<p class="muted">Aucune action récente.</p>'}</div></section>
        </div>
      </div>`;
  },
  contactItem(ic, label, value, copy) {
    if (!value) return '';
    return `<div class="contact-item">${icon(ic)}<div><span>${esc(label)}</span><strong style="font-weight:500">${esc(value)}</strong></div>${copy ? `<button class="icon-btn icon-btn-sm" type="button" data-copytext="${esc(value)}" aria-label="Copier ${esc(label)}" style="margin-left:auto">${icon('copy')}</button>` : ''}</div>`;
  },

  async onClick(e) {
    const f = e.target.closest('[data-cfilter]');
    if (f) { this.filter = f.dataset.cfilter; this.renderTable(); return; }
    const cp = e.target.closest('[data-copytext]');
    if (cp) { copyText(cp.dataset.copytext); return; }
    const a = e.target.closest('[data-cact]');
    if (!a) {
      const row = e.target.closest('[data-open]'); if (row) { App.go('client-' + row.dataset.open); return; }
      const doc = e.target.closest('[data-doc]'); if (doc) { App.go('doc-' + doc.dataset.doc); return; }
      return;
    }
    const c = this.id ? Store.client(this.id) : null;
    switch (a.dataset.cact) {
      case 'new': this.editDialog(null); break;
      case 'edit': this.editDialog(this.id); break;
      case 'quote': App.go('nouveau-devis-' + this.id); break;
      case 'invoice': App.go('nouveau-facture-' + this.id); break;
      case 'addserver': Views.servers.editDialog(null, this.id); break;
      case 'addsub': this.subDialog(null); break;
      case 'editsub': this.subDialog(a.dataset.id); break;
      case 'more': { const m = $('#cliMenu'); m.hidden = !m.hidden; break; }
      case 'billsubs': {
        $('#cliMenu').hidden = true;
        const ids = Store.subsFor(this.id).filter(s => s.status === 'actif' && s.period === 'mensuel').map(s => s.id);
        const inv = await Store.invoiceSubscriptions(this.id, ids);
        App.go('doc-' + inv.id);
        break;
      }
      case 'export': {
        $('#cliMenu').hidden = true;
        const S = Store;
        let data;
        if (LIVE) { data = await API.get('/api/clients/' + encodeURIComponent(c.id) + '/export'); delete data.ok; }
        else {
          if (!(await stepUpDemo('L’export contient toutes les données de ce client.'))) return;
          data = { exportedAt: new Date().toISOString(), client: c, subscriptions: S.subsFor(c.id), documents: S.docsFor(c.id), servers: S.serversFor(c.id).map(s => ({ id: s.id, name: s.name, host: s.host, ip: s.ip, provider: s.provider, keyFingerprint: s.keyFingerprint })), hostedSites: S.hostedFor(c.id).flatMap(s => S.sitesOf(s, c.id).map(x => ({ name: x.name, url: x.url, server: s.name }))), note: 'Aucune clé privée n’est exportée.' };
          Store.log('client.export', 'Données du client exportées', c.name, c.id);
        }
        offerDownload('client-' + c.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.json', JSON.stringify(data, null, 2));
        break;
      }
      case 'delete': {
        $('#cliMenu').hidden = true;
        const issued = Store.docsFor(c.id).some(d => d.status !== 'draft');
        const ok = await confirmDialog({ title: (issued ? 'Archiver ' : 'Supprimer ') + c.name + ' ?', message: issued ? 'Ce client a des factures émises : elles doivent être conservées 10 ans. Il sera archivé, pas supprimé.' : 'La fiche, ses brouillons, ses services et ses serveurs seront supprimés.', confirmLabel: issued ? 'Archiver' : 'Supprimer', danger: !issued });
        if (!ok) return;
        if (!(await stepUpDemo())) return;
        try { const r = await Store.deleteClient(c.id); toast(r.archived ? 'Client archivé.' : 'Client supprimé.'); if (!r.archived) App.go('clients'); } catch (err) { toast(err.message, { tone: 'crit' }); }
        break;
      }
    }
  },

  editDialog(id) {
    const c = id ? Store.client(id) : null;
    const v = c || { id: C.uid('c'), name: '', activity: '', type: 'pro', contact: '', email: '', phone: '', address: '', zip: '', city: '', country: 'France', siren: '', vatNumber: '', status: 'actif', since: Store.today, notes: '' };
    dialog({
      title: c ? 'Modifier ' + c.name : 'Nouveau client', wide: true,
      body: `<form class="form-grid" id="cfForm" novalidate>
        <div class="field span-2"${v.internal ? ' hidden' : ''}><span>Type</span><div class="seg" id="cf-type"><button type="button" data-type="pro" aria-pressed="${v.type !== 'particulier'}">${icon('building')}Professionnel</button><button type="button" data-type="particulier" aria-pressed="${v.type === 'particulier'}">${icon('user')}Particulier</button></div></div>
        <label class="field"><span>Nom ou raison sociale</span><input id="cf-name" value="${esc(v.name)}" required></label>
        <label class="field"><span>Activité</span><input id="cf-activity" value="${esc(v.activity)}" placeholder="Boulangerie, garage…"></label>
        <label class="field"><span>Contact</span><input id="cf-contact" value="${esc(v.contact)}" autocomplete="off"></label>
        <label class="field"><span>Email</span><input id="cf-email" type="email" value="${esc(v.email)}" autocomplete="off"></label>
        <label class="field"><span>Téléphone</span><input id="cf-phone" value="${esc(v.phone)}" inputmode="tel" autocomplete="off"></label>
        <label class="field"><span>Statut</span><select id="cf-status">${[['actif', 'Actif'], ['prospect', 'Prospect'], ['archivé', 'Archivé']].map(o => `<option value="${o[0]}"${o[0] === v.status ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <label class="field span-2"><span>Adresse</span><input id="cf-address" value="${esc(v.address)}"></label>
        <label class="field"><span>Code postal</span><input id="cf-zip" value="${esc(v.zip)}" inputmode="numeric"></label>
        <label class="field"><span>Ville</span><input id="cf-city" value="${esc(v.city)}"></label>
        <label class="field pro-only"><span>SIREN</span><input id="cf-siren" value="${esc(v.siren)}" inputmode="numeric" placeholder="9 chiffres"><small>Obligatoire sur les factures aux professionnels depuis le 1er septembre 2026.</small></label>
        <label class="field pro-only"><span>N° TVA intracommunautaire</span><input id="cf-vat" value="${esc(v.vatNumber)}" placeholder="FR…"></label>
        <label class="field"><span>Client depuis</span><input id="cf-since" type="date" value="${esc(v.since)}"></label>
        <label class="field span-2"><span>Notes internes</span><textarea id="cf-notes">${esc(v.notes)}</textarea></label>
        <p class="field-error span-2" id="cf-err" hidden></p>
      </form>`,
      onOpen: el => {
        const sync = () => { const pro = $('#cf-type [aria-pressed="true"]', el).dataset.type === 'pro'; $$('.pro-only', el).forEach(x => { x.hidden = !pro; }); };
        $('#cf-type', el).addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (!b) return; $$('#cf-type button', el).forEach(x => x.setAttribute('aria-pressed', String(x === b))); sync(); });
        sync();
      },
      actions: [{ label: 'Annuler' }, { label: c ? 'Enregistrer' : 'Créer le client', tone: 'primary', icon: 'check', run: async (close, el) => {
        const g = k => $('#cf-' + k, el).value.trim();
        const err = $('#cf-err', el);
        const type = v.internal ? 'interne' : $('#cf-type [aria-pressed="true"]', el).dataset.type;
        const next = Object.assign({}, v, { type, name: g('name'), activity: g('activity'), contact: g('contact'), email: g('email'), phone: g('phone'), status: g('status'), address: g('address'), zip: g('zip'), city: g('city'), siren: type === 'pro' ? g('siren') : '', vatNumber: type === 'pro' ? g('vat') : '', since: g('since') || Store.today, notes: g('notes') });
        const p = [];
        if (!next.name) p.push('le nom');
        if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) p.push('un email valide');
        if (next.siren && !/^\d{9}$/.test(next.siren.replace(/\s/g, ''))) p.push('un SIREN à 9 chiffres');
        if (p.length) { err.textContent = 'Indique ' + p.join(', ') + '.'; err.hidden = false; return false; }
        try { const saved = await Store.saveClient(next); close(); toast(c ? 'Fiche enregistrée.' : 'Client créé.'); if (!c) App.go('client-' + saved.id); } catch (e) { err.textContent = e.message; err.hidden = false; }
        return false;
      } }],
    });
  },

  subDialog(id) {
    const s = id ? Store.state.subscriptions.find(x => x.id === id) : null;
    const v = s || { id: C.uid('s'), clientId: this.id, label: '', category: 'Hébergement', priceHT: 39, vatRate: Store.company.defaultVatRate || 20, period: 'mensuel', startDate: Store.today, renewalDate: C.addMonths(Store.today, 12), status: 'actif' };
    const cat = Store.state.catalog.filter(k => ['mois', 'an'].includes(k.unit));
    dialog({
      title: s ? 'Modifier le service' : 'Ajouter un service', wide: true,
      body: `<form class="form-grid" novalidate>
        <label class="field span-2"><span>Service</span><input id="sb-label" list="sb-cat" value="${esc(v.label)}" placeholder="Hébergement et maintenance…"><datalist id="sb-cat">${cat.map(k => `<option value="${esc(k.name)}">`).join('')}</datalist></label>
        <label class="field"><span>Catégorie</span><select id="sb-category">${SUB_CATEGORIES.map(x => `<option${x === v.category ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="field"><span>Facturation</span><select id="sb-period"><option value="mensuel"${v.period === 'mensuel' ? ' selected' : ''}>Mensuelle</option><option value="annuel"${v.period === 'annuel' ? ' selected' : ''}>Annuelle</option></select></label>
        <label class="field"><span>Prix HT</span><input id="sb-price" value="${esc(String(v.priceHT).replace('.', ','))}" inputmode="decimal"></label>
        <label class="field"><span>TVA</span><select id="sb-vat">${C.VAT_RATES.map(r => `<option value="${r}"${r === C.num(v.vatRate) ? ' selected' : ''}>${C.fmtRate(r)}</option>`).join('')}</select></label>
        <label class="field"><span>Date de début</span><input id="sb-start" type="date" value="${esc(v.startDate)}"></label>
        <label class="field"><span>Renouvellement</span><input id="sb-renew" type="date" value="${esc(v.renewalDate)}"><small>Échéance du contrat, rappelée par Kingo 14 jours avant.</small></label>
        <label class="field"><span>Statut</span><select id="sb-status">${[['actif', 'Actif'], ['suspendu', 'Suspendu'], ['résilié', 'Résilié']].map(o => `<option value="${o[0]}"${o[0] === v.status ? ' selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <p class="field-error span-2" id="sb-err" hidden></p>
      </form>`,
      onOpen: el => {
        $('#sb-label', el).addEventListener('change', e => { const k = cat.find(x => x.name === e.target.value); if (k) { $('#sb-price', el).value = String(k.unitPrice).replace('.', ','); $('#sb-period', el).value = k.unit === 'an' ? 'annuel' : 'mensuel'; const m = SUB_CATEGORIES.find(x => x === k.category); if (m) $('#sb-category', el).value = m; } });
        $('#sb-start', el).addEventListener('change', e => { if (!s && e.target.value) $('#sb-renew', el).value = C.addMonths(e.target.value, 12); });
      },
      actions: [
        ...(s ? [{ label: 'Supprimer', tone: 'danger', run: async (close) => { const ok = await confirmDialog({ title: 'Supprimer ce service ?', message: 'Les factures déjà émises ne changent pas.', confirmLabel: 'Supprimer', danger: true }); if (ok) { await Store.deleteSub(s.id); close(); toast('Service supprimé.'); } return false; } }] : []),
        { label: 'Annuler' },
        { label: 'Enregistrer', tone: 'primary', icon: 'check', run: async (close, el) => {
          const g = k => $('#sb-' + k, el).value.trim();
          const next = Object.assign({}, v, { label: g('label'), category: g('category'), period: g('period'), priceHT: C.num(g('price')), vatRate: C.num(g('vat')), startDate: g('start'), renewalDate: g('renew'), status: g('status') });
          const err = $('#sb-err', el);
          if (!next.label || !(next.priceHT >= 0) || !next.startDate) { err.textContent = 'Indique le service, un prix et une date de début.'; err.hidden = false; return false; }
          try { await Store.saveSub(next); close(); toast('Service enregistré.'); } catch (e) { err.textContent = e.message; err.hidden = false; }
          return false;
        } },
      ],
    });
  },
};

/* ---- js/views/billing.js ---- */
/* ===== Facturation : listes, aperçu au survol, paiements, catalogue, envoi par email ===== */
const ROUTE_FILTERS = { retard: 'overdue', brouillons: 'draft', payees: 'paid', attente: 'sent', acceptes: 'accepted' };
const STATUS_FILTERS = {
  invoice: [['all', 'Toutes'], ['draft', 'Brouillons'], ['sent', 'Envoyées'], ['overdue', 'En retard'], ['paid', 'Payées'], ['cancelled', 'Annulées']],
  quote: [['all', 'Tous'], ['draft', 'Brouillons'], ['sent', 'Envoyés'], ['accepted', 'Acceptés'], ['expired', 'Expirés'], ['refused', 'Refusés'], ['invoiced', 'Facturés']],
  credit: [['all', 'Tous'], ['draft', 'Brouillons'], ['sent', 'Émis']],
};
const PERIODS = [['all', 'Toutes les dates'], ['month', 'Ce mois-ci'], ['last', 'Mois dernier'], ['year', 'Cette année'], ['12m', '12 derniers mois']];

Views.billing = {
  tab: 'invoice', status: 'all', client: '', period: 'all', q: '',
  render(page, params) {
    this.page = page;
    this.limit = 25;
    if (params.tab !== this.tab) { this.status = 'all'; }
    this.tab = params.tab || 'invoice';
    if (params.filter && ROUTE_FILTERS[params.filter]) this.status = ROUTE_FILTERS[params.filter];
    const S = Store;
    const n = k => S.state.docs.filter(d => d.kind === k).length;
    const tabs = [['invoice', 'Factures', 'facturation', n('invoice')], ['quote', 'Devis', 'devis', n('quote')], ['credit', 'Avoirs', 'avoirs', n('credit')], ['payments', 'Paiements', 'paiements', null], ['catalog', 'Catalogue', 'catalogue', S.state.catalog.length]];
    page.innerHTML = `
      <div class="tabs" role="tablist">${tabs.map(t => `<a class="tab-btn" role="tab" href="#${t[2]}" aria-selected="${this.tab === t[0]}">${t[1]}${t[3] !== null ? ` <span class="count">${t[3]}</span>` : ''}</a>`).join('')}</div>
      <div id="billSum"></div>
      <div id="billBody" style="display:flex;flex-direction:column;gap:16px"></div>`;
    page.addEventListener('click', e => this.onClick(e));
    this.renderBody();
  },
  destroy() { if (this.preview) this.preview.destroy(); this.preview = null; },
  update() { if (this.page && this.page.isConnected) this.renderBody(true); },

  renderBody(keep) {
    if (this.tab === 'payments') return this.renderPayments();
    if (this.tab === 'catalog') return this.renderCatalog();
    this.renderSummary();
    const body = $('#billBody');
    const clients = Store.state.clients.filter(c => !c.internal);
    const newLabel = this.tab === 'quote' ? 'Nouveau devis' : this.tab === 'credit' ? 'Nouvel avoir' : 'Nouvelle facture';
    if (!keep || !$('#billList')) {
      body.innerHTML = `
        <div class="toolbar">
          <div class="seg" id="stSeg" role="group" aria-label="Filtrer par statut"></div>
        </div>
        <div class="toolbar">
          <select class="select" id="flClient" aria-label="Client" style="width:auto;min-width:180px"><option value="">Tous les clients</option>${clients.map(c => `<option value="${esc(c.id)}"${c.id === this.client ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <select class="select" id="flPeriod" aria-label="Période" style="width:auto">${PERIODS.map(p => `<option value="${p[0]}"${p[0] === this.period ? ' selected' : ''}>${p[1]}</option>`).join('')}</select>
          <label class="search-inline">${icon('search')}<input class="input" id="flQ" type="search" placeholder="Numéro, client, prestation…" aria-label="Rechercher" value="${esc(this.q)}"></label>
          <span class="grow"></span>
          ${this.tab === 'credit' ? '' : `<a class="btn btn-primary" href="#nouveau-${this.tab === 'quote' ? 'devis' : 'facture'}">${icon('plus')}<span>${newLabel}</span></a>`}
        </div>
        <div class="split">
          <section class="panel" id="billList" aria-label="Liste des documents"></section>
          <aside class="split-preview" id="billPreview" aria-label="Aperçu"><div class="preview-head" id="pvHead"></div><div id="pvSheet"></div></aside>
        </div>`;
      $('#flClient').addEventListener('change', e => { this.client = e.target.value; this.limit = 25; this.renderList(); });
      $('#flPeriod').addEventListener('change', e => { this.period = e.target.value; this.limit = 25; this.renderList(); });
      $('#flQ').addEventListener('input', debounce(e => { this.q = e.target.value.trim().toLowerCase(); this.limit = 25; this.renderList(); }, 120));
      if (this.preview) this.preview.destroy();
      this.preview = mountPreview($('#pvSheet'));
    }
    this.renderList();
  },

  renderSummary() {
    const el = $('#billSum'); if (!el) return;
    const S = Store, k = S.kpis(), year = S.today.slice(0, 4);
    if (this.tab === 'invoice') {
      let collected = 0;
      S.state.docs.forEach(d => { if (d.kind === 'invoice') (d.payments || []).forEach(p => { if (p.date.slice(0, 4) === year) collected += C.cents(p.amount); }); });
      el.innerHTML = `<div class="sum-strip">
        <button class="sum-cell" type="button" data-sum="all"><span>Chiffre d’affaires ${year}</span><strong>${esc(fmt.eur0(k.revenue))}</strong><small>HT, avoirs déduits</small></button>
        <button class="sum-cell" type="button" data-sum="paid"><span>${icon('check', 'i-xs')}Encaissé ${year}</span><strong>${esc(fmt.eur0(collected))}</strong><small>TTC · ${fmt.plural(k.paidCount, 'facture')} payées</small></button>
        <button class="sum-cell" type="button" data-sum="sent"><span>${icon('clock', 'i-xs')}En attente</span><strong>${esc(fmt.eur0(k.pendingAmount))}</strong><small>${fmt.plural(k.pendingCount, 'facture')}</small></button>
        <button class="sum-cell" type="button" data-sum="overdue"><span>${icon('alert', 'i-xs')}En retard</span><strong>${esc(fmt.eur0(k.overdueAmount))}</strong><small>${k.overdueCount ? fmt.plural(k.overdueCount, 'facture') + ', jusqu’à ' + k.oldestOverdue + ' j' : 'aucune'}</small></button>
        <button class="sum-cell" type="button" data-sum="draft"><span>${icon('edit', 'i-xs')}Brouillons</span><strong>${k.drafts}</strong><small>à émettre</small></button>
      </div>`;
    } else if (this.tab === 'quote') {
      const qs = S.state.docs.filter(d => d.kind === 'quote');
      const st = q => S.status(q);
      const open = qs.filter(q => st(q) === 'sent'), acc = qs.filter(q => st(q) === 'accepted'), issued = qs.filter(q => q.status !== 'draft');
      const won = qs.filter(q => ['accepted', 'invoiced'].includes(q.status)).length;
      const sum = l => l.reduce((t, q) => t + S.totals(q).totalHT, 0);
      el.innerHTML = `<div class="sum-strip">
        <button class="sum-cell" type="button" data-sum="sent"><span>En attente de réponse</span><strong>${esc(fmt.eur0(sum(open)))}</strong><small>HT · ${fmt.plural(open.length, 'devis', 'devis')}</small></button>
        <button class="sum-cell" type="button" data-sum="accepted"><span>${icon('check', 'i-xs')}Acceptés à facturer</span><strong>${esc(fmt.eur0(sum(acc)))}</strong><small>${fmt.plural(acc.length, 'devis', 'devis')}</small></button>
        <div class="sum-cell"><span>Taux de transformation</span><strong>${issued.length ? Math.round(won / issued.length * 100) + ' %' : '—'}</strong><small>${won} sur ${issued.length} émis</small></div>
        <button class="sum-cell" type="button" data-sum="expired"><span>${icon('clock', 'i-xs')}Expirés</span><strong>${qs.filter(q => st(q) === 'expired').length}</strong><small>à relancer ou clore</small></button>
        <button class="sum-cell" type="button" data-sum="draft"><span>${icon('edit', 'i-xs')}Brouillons</span><strong>${qs.filter(q => q.status === 'draft').length}</strong><small>à envoyer</small></button>
      </div>`;
    } else el.innerHTML = '';
  },

  inPeriod(d) {
    const t = Store.today, iso = d.issueDate;
    switch (this.period) {
      case 'month': return C.ym(iso) === C.ym(t);
      case 'last': return C.ym(iso) === C.ym(C.addMonths(C.ym(t) + '-01', -1));
      case 'year': return iso.slice(0, 4) === t.slice(0, 4);
      case '12m': return C.diffDays(t, iso) <= 365;
      default: return true;
    }
  },
  filtered() {
    const S = Store;
    return S.state.docs.filter(d => d.kind === this.tab
      && (this.status === 'all' || S.status(d) === this.status)
      && (!this.client || d.clientId === this.client)
      && this.inPeriod(d)
      && (!this.q || [d.number, S.clientName(d.clientId), ...(d.lines || []).map(l => l.description)].join(' ').toLowerCase().includes(this.q)))
      .sort((a, b) => (a.status === 'draft' ? 0 : 1) - (b.status === 'draft' ? 0 : 1) || (b.issueDate + (b.number || '')).localeCompare(a.issueDate + (a.number || '')));
  },
  renderList() {
    const S = Store, host = $('#billList'); if (!host) return;
    const counts = {};
    S.state.docs.filter(d => d.kind === this.tab).forEach(d => { const s = S.status(d); counts[s] = (counts[s] || 0) + 1; counts.all = (counts.all || 0) + 1; });
    $('#stSeg').innerHTML = STATUS_FILTERS[this.tab].map(o => `<button type="button" data-status="${o[0]}" aria-pressed="${this.status === o[0]}">${o[1]} <span class="count">${counts[o[0]] || 0}</span></button>`).join('');
    const list = this.filtered();
    this.list = list;
    if (!list.length) {
      host.innerHTML = emptyState('Aucun document ne correspond.', 'Change les filtres, ou crée un nouveau document.');
      this.showPreview(null);
      return;
    }
    const head = this.tab === 'quote' ? '<th>Devis</th><th>Date</th><th>Validité</th><th class="num">Montant HT</th><th>Statut</th>'
      : this.tab === 'credit' ? '<th>Avoir</th><th>Date</th><th>Facture</th><th class="num">Montant TTC</th><th>Statut</th>'
      : '<th>Facture</th><th>Émise le</th><th>Échéance</th><th class="num">Montant TTC</th><th>Statut</th>';
    const limit = this.limit || 25;
    const shown = list.slice(0, limit);
    host.innerHTML = `<div class="table-scroll"><table class="table table-cards"><thead><tr>${head}</tr></thead><tbody>${shown.map(d => {
      const t = S.totals(d), st = S.status(d);
      const num = `<div class="cell-main"><strong class="doc-num${d.number ? '' : ' draft'}">${esc(d.number || 'Brouillon')}</strong><span>${esc(S.clientName(d.clientId))}</span></div>`;
      let c3 = '', amount = '';
      if (this.tab === 'quote') { c3 = d.validUntil ? esc(fmt.date(d.validUntil)) : '—'; amount = fmt.eur(t.totalHT); }
      else if (this.tab === 'credit') { c3 = esc(d.relatedInvoiceNumber || '—'); amount = fmt.eur(-t.totalTTC); }
      else { c3 = d.dueDate ? esc(fmt.date(d.dueDate)) + (st === 'overdue' ? ` <span class="late">+${C.diffDays(S.today, d.dueDate)} j</span>` : '') : '—'; amount = fmt.eur(t.totalTTC); }
      const partial = this.tab === 'invoice' && t.partial ? `<div class="progress" style="margin-top:6px;width:90px;margin-left:auto" title="Réglé à ${Math.round(t.paid / t.totalTTC * 100)} %"><span style="width:${(t.paid / t.totalTTC * 100).toFixed(0)}%"></span></div>` : '';
      return `<tr class="clickable${this.selected === d.id ? ' sel' : ''}" data-doc="${esc(d.id)}" tabindex="0">
        <td class="c-main">${num}</td>
        <td class="c-full" data-hide-m>${esc(fmt.date(d.issueDate))}</td>
        <td class="c-main" data-label="Échéance">${c3}</td>
        <td class="num c-end amount-strong">${esc(amount)}${partial}</td>
        <td class="c-end">${docPill(d, S.today)}</td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="panel-foot" style="justify-content:space-between;align-items:center;gap:12px;color:var(--ink-3);font-size:12.5px;flex-wrap:wrap"><span>${shown.length < list.length ? shown.length + ' sur ' : ''}${fmt.plural(list.length, 'document')}</span>${shown.length < list.length ? `<button class="btn btn-sm" type="button" data-more="1">Afficher 25 de plus</button>` : ''}<span>Total ${esc(fmt.eur(list.reduce((s, d) => s + C.sign(d) * S.totals(d).totalTTC, 0)))} TTC</span></div>`;
    $$('tr[data-doc]', host).forEach(tr => {
      tr.addEventListener('pointerenter', () => this.showPreview(tr.dataset.doc));
      tr.addEventListener('focus', () => this.showPreview(tr.dataset.doc));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') App.go('doc-' + tr.dataset.doc); });
    });
    const keepSel = this.selected && list.some(d => d.id === this.selected);
    this.showPreview(keepSel ? this.selected : list[0].id);
  },
  showPreview(id) {
    const head = $('#pvHead'); if (!head || !this.preview) return;
    if (!id) { head.innerHTML = ''; this.preview.renderEmpty('Survole un document pour le prévisualiser ici.'); return; }
    if (this.selected === id && head.dataset.id === id) return;
    this.selected = id;
    $$('#billList tr[data-doc]').forEach(tr => tr.classList.toggle('sel', tr.dataset.doc === id));
    const d = Store.doc(id); if (!d) return;
    head.dataset.id = id;
    head.innerHTML = `<h3>${esc(d.number || 'Brouillon')} <span class="muted" style="font-weight:400">· ${esc(Store.clientName(d.clientId))}</span></h3>
      <button class="btn btn-sm btn-ghost" type="button" data-bact="pdf" data-id="${esc(id)}">${icon('download')}<span>PDF</span></button>
      ${d.kind !== 'credit' && d.status !== 'cancelled' ? `<button class="btn btn-sm btn-ghost" type="button" data-bact="send" data-id="${esc(id)}">${icon('send')}<span>Envoyer</span></button>` : ''}
      <a class="btn btn-sm btn-soft" href="#doc-${esc(id)}">${icon(d.status === 'draft' ? 'edit' : 'eye')}<span>${d.status === 'draft' ? 'Modifier' : 'Ouvrir'}</span></a>`;
    this.preview.render(d);
  },

  async onClick(e) {
    const st = e.target.closest('[data-status]');
    if (st) { this.status = st.dataset.status; this.limit = 25; this.renderList(); return; }
    const sum = e.target.closest('[data-sum]');
    if (sum) { this.status = sum.dataset.sum; this.limit = 25; this.renderList(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { this.limit = (this.limit || 25) + 25; this.renderList(); return; }
    const a = e.target.closest('[data-bact]');
    if (a) {
      e.stopPropagation();
      const id = a.dataset.id;
      if (a.dataset.bact === 'pdf') return downloadPDF(Store.doc(id));
      if (a.dataset.bact === 'send') return this.sendDialog(id);
      if (a.dataset.bact === 'pay') return this.paymentDialog(id);
      if (a.dataset.bact === 'delpay') return this.deletePayment(a.dataset.doc, a.dataset.pid);
      if (a.dataset.bact === 'addpay') return this.paymentPicker();
      if (a.dataset.bact === 'addcat') return this.catalogDialog(null);
      if (a.dataset.bact === 'editcat') return this.catalogDialog(id);
      return;
    }
    const row = e.target.closest('tr[data-doc]');
    if (row) App.go('doc-' + row.dataset.doc);
  },

  /* ---------- paiements ---------- */
  renderPayments() {
    $('#billSum').innerHTML = '';
    const S = Store, year = S.today.slice(0, 4), month = C.ym(S.today);
    const rows = [];
    S.state.docs.forEach(d => { if (d.kind === 'invoice') (d.payments || []).forEach(p => rows.push({ p, d })); });
    rows.sort((a, b) => b.p.date.localeCompare(a.p.date));
    const sum = f => rows.filter(f).reduce((t, r) => t + C.cents(r.p.amount), 0);
    const byMethod = {};
    rows.filter(r => r.p.date.slice(0, 4) === year).forEach(r => { byMethod[r.p.method] = (byMethod[r.p.method] || 0) + C.cents(r.p.amount); });
    const top = Object.entries(byMethod).sort((a, b) => b[1] - a[1])[0];
    const k = S.kpis();
    $('#billBody').innerHTML = `
      <div class="sum-strip" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="sum-cell"><span>Encaissé en ${esc(C.monthLabel(month, true).split(' ')[0])}</span><strong>${esc(fmt.eur(sum(r => C.ym(r.p.date) === month)))}</strong><small>${fmt.plural(rows.filter(r => C.ym(r.p.date) === month).length, 'paiement')}</small></div>
        <div class="sum-cell"><span>Encaissé en ${year}</span><strong>${esc(fmt.eur0(sum(r => r.p.date.slice(0, 4) === year)))}</strong><small>TTC</small></div>
        <div class="sum-cell"><span>Reste à encaisser</span><strong>${esc(fmt.eur0(k.pendingAmount + k.overdueAmount))}</strong><small>dont ${esc(fmt.eur0(k.overdueAmount))} en retard</small></div>
        <div class="sum-cell"><span>Moyen le plus utilisé</span><strong style="font-size:16px">${top ? esc(top[0]) : '—'}</strong><small>${top ? esc(fmt.eur0(top[1])) + ' en ' + year : ''}</small></div>
      </div>
      <div class="toolbar"><span class="grow"></span><button class="btn btn-primary" type="button" data-bact="addpay">${icon('plus')}<span>Enregistrer un paiement</span></button></div>
      <section class="panel"><div class="table-scroll">${rows.length ? `<table class="table table-cards"><thead><tr><th>Date</th><th>Facture</th><th>Moyen</th><th class="num">Montant</th><th></th></tr></thead><tbody>${rows.map(r => `<tr class="clickable" data-doc="${esc(r.d.id)}">
        <td class="c-main">${esc(fmt.date(r.p.date))}</td>
        <td class="c-full"><div class="cell-main"><strong class="doc-num">${esc(r.d.number)}</strong><span>${esc(S.clientName(r.d.clientId))}</span></div></td>
        <td class="c-main" data-hide-m>${esc(r.p.method)}</td>
        <td class="num c-end amount-strong">${esc(fmt.eur(C.cents(r.p.amount)))}</td>
        <td class="c-end"><button class="icon-btn icon-btn-sm" type="button" data-bact="delpay" data-doc="${esc(r.d.id)}" data-pid="${esc(r.p.id)}" aria-label="Supprimer ce paiement">${icon('trash')}</button></td></tr>`).join('')}</tbody></table>` : emptyState('Aucun paiement enregistré.', 'Enregistre les règlements reçus pour suivre les impayés.')}</div></section>`;
  },
  async deletePayment(docId, pid) {
    const ok = await confirmDialog({ title: 'Supprimer ce paiement ?', message: 'La facture repassera « envoyée » si elle n’est plus soldée.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try { await Store.deletePayment(docId, pid); toast('Paiement supprimé.'); } catch (e) { toast(e.message, { tone: 'crit' }); }
  },
  paymentDialog(docId) {
    const d = Store.doc(docId), t = Store.totals(d);
    if (!d.number) { toast('Émets la facture avant d’enregistrer un paiement.', { tone: 'warn' }); return; }
    dialog({
      title: 'Paiement reçu', subtitle: d.number + ' · ' + Store.clientName(d.clientId) + ' · reste dû ' + fmt.eur(t.due),
      body: `<form class="form-grid" novalidate>
        <label class="field"><span>Date</span><input id="py-date" type="date" value="${esc(Store.today)}"></label>
        <label class="field"><span>Montant TTC</span><input id="py-amount" value="${esc((t.due / 100).toFixed(2).replace('.', ','))}" inputmode="decimal"></label>
        <label class="field"><span>Moyen de paiement</span><select id="py-method">${C.PAYMENT_METHODS.map(m => `<option${m === (d.paymentMethod || 'Virement') ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
        <label class="field"><span>Référence (facultatif)</span><input id="py-note" placeholder="N° de virement, chèque…"></label>
        <p class="field-error span-2" id="py-err" hidden></p></form>`,
      actions: [{ label: 'Annuler' }, { label: 'Enregistrer le paiement', tone: 'primary', icon: 'check', run: async (close, el) => {
        const amount = C.num($('#py-amount', el).value);
        const err = $('#py-err', el);
        if (!(amount > 0)) { err.textContent = 'Indique un montant positif.'; err.hidden = false; return false; }
        if (C.cents(amount) > t.due) { err.textContent = 'Le montant dépasse le reste dû (' + fmt.eur(t.due) + ').'; err.hidden = false; return false; }
        try { await Store.addPayment(d.id, { date: $('#py-date', el).value || Store.today, amount, method: $('#py-method', el).value, note: $('#py-note', el).value.trim() }); close(); toast('Paiement enregistré.'); }
        catch (e) { err.textContent = e.message; err.hidden = false; }
        return false;
      } }],
    });
  },
  paymentPicker() {
    const open = Store.state.docs.filter(d => d.kind === 'invoice' && ['sent', 'overdue'].includes(Store.status(d))).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!open.length) { toast('Aucune facture en attente de paiement.'); return; }
    dialog({
      title: 'Quelle facture est réglée ?',
      body: `<div class="search-results">${open.map(d => `<button type="button" class="search-item" data-pick="${esc(d.id)}" style="border:0;background:transparent;text-align:left;cursor:pointer">${icon('file')}<span><strong>${esc(d.number)} — ${esc(Store.clientName(d.clientId))}</strong><small>Reste dû ${esc(fmt.eur(Store.totals(d).due))} · échéance ${esc(fmt.date(d.dueDate))}</small></span>${docPill(d, Store.today)}</button>`).join('')}</div>`,
      onOpen: (el, close) => el.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { close(); this.paymentDialog(b.dataset.pick); } }),
    });
  },

  /* ---------- catalogue ---------- */
  renderCatalog() {
    $('#billSum').innerHTML = '';
    const cat = Store.state.catalog.slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    $('#billBody').innerHTML = `
      <div class="toolbar"><p class="muted">Tes prestations et produits types : ils se retrouvent en un clic dans les devis et factures.</p><span class="grow"></span><button class="btn btn-primary" type="button" data-bact="addcat">${icon('plus')}<span>Ajouter un article</span></button></div>
      <section class="panel"><div class="table-scroll"><table class="table table-cards"><thead><tr><th>Article</th><th>Catégorie</th><th>Unité</th><th class="num">Prix HT</th><th class="num">TVA</th><th></th></tr></thead><tbody>${cat.map(k => `<tr>
        <td class="c-full"><div class="cell-main"><strong>${esc(k.name)}</strong><span>${esc(k.description || '')}</span></div></td>
        <td class="c-main">${esc(k.category)}</td><td class="c-main" data-hide-m>${esc(k.unit)}</td>
        <td class="num c-end amount-strong">${esc(fmt.eur(C.cents(k.unitPrice)))}</td><td class="num" data-hide-m>${esc(C.fmtRate(k.vatRate))}</td>
        <td class="c-end"><button class="icon-btn icon-btn-sm" type="button" data-bact="editcat" data-id="${esc(k.id)}" aria-label="Modifier ${esc(k.name)}">${icon('edit')}</button></td></tr>`).join('')}</tbody></table></div></section>`;
  },
  catalogDialog(id) {
    const k = id ? Store.state.catalog.find(x => x.id === id) : null;
    const v = k || { id: C.uid('k'), name: '', description: '', category: 'Création', unit: 'forfait', unitPrice: 0, vatRate: Store.company.defaultVatRate || 20 };
    dialog({
      title: k ? 'Modifier l’article' : 'Nouvel article', wide: true,
      body: `<form class="form-grid" novalidate>
        <label class="field span-2"><span>Désignation</span><input id="ka-name" value="${esc(v.name)}"></label>
        <label class="field span-2"><span>Description (reprise sous la ligne)</span><input id="ka-desc" value="${esc(v.description)}"></label>
        <label class="field"><span>Catégorie</span><input id="ka-cat" value="${esc(v.category)}" list="ka-cats"><datalist id="ka-cats">${[...new Set(Store.state.catalog.map(x => x.category))].map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <label class="field"><span>Unité</span><select id="ka-unit">${C.UNITS.map(u => `<option${u === v.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="field"><span>Prix unitaire HT</span><input id="ka-price" value="${esc(String(v.unitPrice).replace('.', ','))}" inputmode="decimal"></label>
        <label class="field"><span>TVA</span><select id="ka-vat">${C.VAT_RATES.map(r => `<option value="${r}"${r === C.num(v.vatRate) ? ' selected' : ''}>${C.fmtRate(r)}</option>`).join('')}</select></label>
        <p class="field-error span-2" id="ka-err" hidden></p></form>`,
      actions: [
        ...(k ? [{ label: 'Retirer', tone: 'danger', run: async (close) => { await Store.deleteCatalog(k.id); close(); toast('Article retiré.'); return false; } }] : []),
        { label: 'Annuler' },
        { label: 'Enregistrer', tone: 'primary', icon: 'check', run: async (close, el) => {
          const g = x => $('#ka-' + x, el).value.trim();
          const next = Object.assign({}, v, { name: g('name'), description: g('desc'), category: g('cat') || 'Autre', unit: g('unit'), unitPrice: C.num(g('price')), vatRate: C.num(g('vat')) });
          if (!next.name) { const e = $('#ka-err', el); e.textContent = 'Indique une désignation.'; e.hidden = false; return false; }
          await Store.saveCatalog(next); close(); toast('Article enregistré.'); return false;
        } },
      ],
    });
  },

  /* ---------- envoi par email ---------- */
  fill(tpl, d, extra) {
    const c = Store.client(d.clientId) || {}, t = Store.totals(d), co = Store.company;
    const map = {
      contact: c.contact || c.name || '', client: c.name || '', numero: (extra && extra.number) || d.number || '',
      montant: fmt.eur(d.kind === 'invoice' && t.paid ? t.due : t.totalTTC), echeance: d.dueDate ? fmt.date(d.dueDate) : '',
      validite: d.validUntil ? fmt.date(d.validUntil) : '', signature: co.signature || co.tradeName || '', entreprise: co.tradeName || co.legalName || '',
    };
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m)).replace(/[  ]/g, ' ');
  },
  sendDialog(id, opts) {
    opts = opts || {};
    const d = Store.doc(id), c = Store.client(d.clientId) || {}, co = Store.company;
    const reminder = !!opts.reminder && d.status !== 'draft';
    const number = d.number || C.nextNumber(Store.state.docs, d.kind, co, d.issueDate);
    const tpl = co.emailTemplates || {};
    const kindTpl = reminder ? (d.kind === 'quote' ? 'Bonjour {contact},\n\nJe reviens vers vous au sujet du devis {numero} ({montant}), valable jusqu’au {validite}. Avez-vous pu en prendre connaissance ?\n\nBien cordialement,\n{signature}' : tpl.reminder) : tpl[d.kind];
    const subject = reminder ? (d.kind === 'quote' ? 'Votre devis {numero} — {entreprise}' : 'Relance : facture {numero} échue le {echeance}') : (C.KIND_LABELS[d.kind] + ' {numero} — {entreprise}');
    const errs = C.validateDocument(d);
    if (errs.length) { toast(errs[0], { tone: 'warn' }); App.go('doc-' + id); return; }
    const filename = number + '.pdf';
    dialog({
      title: reminder ? 'Relancer ' + C.KIND_LABELS[d.kind].toLowerCase() + ' ' + number : 'Envoyer ' + (d.kind === 'quote' ? 'le devis' : d.kind === 'credit' ? 'l’avoir' : 'la facture'), wide: true,
      subtitle: c.name,
      body: `${d.status === 'draft' ? `<div class="note note-warn">${icon('info')}<span>Ce brouillon sera émis à l’envoi : il reçoit le numéro définitif <strong>${esc(number)}</strong> et ne pourra plus être modifié.</span></div>` : ''}
        <form class="form-grid" novalidate>
          <label class="field"><span>À</span><input id="ml-to" type="email" value="${esc(c.email || '')}" autocomplete="off"></label>
          <label class="field"><span>Copie (facultatif)</span><input id="ml-cc" type="email" placeholder="${esc(co.email || '')}" autocomplete="off"></label>
          <label class="field span-2"><span>Objet</span><input id="ml-subject" value="${esc(this.fill(subject, d, { number }))}"></label>
          <label class="field span-2"><span>Message</span><textarea id="ml-body" style="min-height:190px">${esc(this.fill(kindTpl, d, { number }))}</textarea></label>
          <div class="span-2 note">${icon('file')}<span>Pièce jointe : <strong class="mono">${esc(filename)}</strong>${LIVE ? ' — une copie du PDF envoyé est archivée sur le serveur.' : ''}</span></div>
          ${LIVE ? '' : `<p class="span-2 muted" style="font-size:12.5px">Mode démo : aucun email n’est réellement envoyé. La version installée envoie via ton serveur SMTP.</p>`}
          <p class="field-error span-2" id="ml-err" hidden></p>
        </form>`,
      actions: [{ label: 'Annuler' }, { label: reminder ? 'Envoyer la relance' : 'Envoyer', tone: 'primary', icon: 'send', run: async (close, el) => {
        const to = $('#ml-to', el).value.trim(), cc = $('#ml-cc', el).value.trim();
        const err = $('#ml-err', el);
        const okMail = x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
        if (!okMail(to) || (cc && !okMail(cc))) { err.textContent = 'Vérifie l’adresse email du destinataire.'; err.hidden = false; return false; }
        try {
          if (App.kingo) App.kingo.setMood('concentre', 3000);
          if (d.status === 'draft') await Store.issueDoc(d.id);
          const fresh = Store.doc(d.id);
          let subj = $('#ml-subject', el).value, body = $('#ml-body', el).value;
          if (fresh.number !== number) { subj = subj.split(number).join(fresh.number); body = body.split(number).join(fresh.number); }
          const payload = { to, cc, subject: subj, body, reminder };
          if (LIVE) payload.pdfBase64 = await pdfBase64(fresh);
          await Store.sendDoc(d.id, payload);
          close();
          App.kingoSay((reminder ? 'Relance envoyée' : C.KIND_LABELS[d.kind] + ' ' + fresh.number + ' envoyé' + (d.kind === 'invoice' ? 'e' : '')) + ' à ' + to + (LIVE ? '.' : ' (démo).'), { mood: 'heureux' });
        } catch (e) { err.textContent = e.message; err.hidden = false; }
        return false;
      } }],
    });
  },
};

/* ---- js/views/editor.js ---- */
/* ===== Éditeur de devis / factures / avoirs, avec aperçu A4 en direct ===== */
Views.editor = {
  render(page, params) {
    this.page = page;
    this.dirty = false;
    const co = Store.company;
    if (params.id) {
      const d = Store.doc(params.id);
      if (!d) { page.innerHTML = `<a class="back" href="#facturation">${icon('arrowLeft')}Facturation</a>` + emptyState('Ce document n’existe plus.', ''); return; }
      this.doc = JSON.parse(JSON.stringify(d));
      this.isNew = false;
    } else {
      this.doc = C.blankDocument(params.kind, co, Store.today, params.clientId && Store.client(params.clientId) ? params.clientId : null);
      this.doc.lines = [this.blankLine()];
      this.isNew = true;
    }
    this.dueAuto = !params.id;
    page.addEventListener('click', e => this.onClick(e));
    if (this.doc.status === 'draft') this.renderEdit(); else this.renderView();
  },
  destroy() {
    if (this.preview) this.preview.destroy();
    this.preview = null;
    const stored = this.doc && Store.doc(this.doc.id);
    if (this.doc && this.doc.status === 'draft' && (!stored || stored.status === 'draft') && this.dirty && this.hasContent()) {
      const d = this.normalized();
      Store.saveDoc(d).then(() => toast('Brouillon enregistré automatiquement.')).catch(() => {});
    }
    this.dirty = false;
  },
  update(type, p) {
    if (type === 'metrics' || !this.page || !this.page.isConnected || !this.doc) return;
    const fresh = Store.doc(this.doc.id);
    if (fresh && fresh.status !== 'draft') {
      // émis ailleurs (envoi, émission) ou mis à jour : on bascule en consultation
      this.doc = JSON.parse(JSON.stringify(fresh));
      this.dirty = false;
      this.renderView();
    } else if (p && (p.what === 'clients' || p.what === 'company')) {
      this.renderClientSelect();
      this.refresh();
    }
  },
  blankLine() { return { id: C.uid('l'), description: '', details: '', qty: 1, unit: 'forfait', unitPrice: 0, vatRate: Store.company.defaultVatRate || 20, discount: 0 }; },
  hasContent() { return !!(this.doc.clientId || this.doc.lines.some(l => String(l.description).trim())); },
  normalized() {
    const d = JSON.parse(JSON.stringify(this.doc));
    d.lines = d.lines.filter(l => String(l.description).trim() || C.num(l.unitPrice)).map(l => Object.assign(l, { qty: C.num(l.qty, 1), unitPrice: C.num(l.unitPrice), vatRate: C.num(l.vatRate), discount: C.num(l.discount) }));
    d.globalDiscount = C.num(d.globalDiscount);
    return d;
  },
  backHref() { return this.doc.kind === 'quote' ? '#devis' : this.doc.kind === 'credit' ? '#avoirs' : '#facturation'; },
  title() {
    const k = C.KIND_LABELS[this.doc.kind];
    if (this.doc.number) return k + ' ' + this.doc.number;
    return this.isNew ? (this.doc.kind === 'invoice' ? 'Nouvelle facture' : this.doc.kind === 'quote' ? 'Nouveau devis' : 'Nouvel avoir') : k + ' en brouillon';
  },

  /* ---------- mode édition ---------- */
  renderEdit() {
    const d = this.doc, co = Store.company;
    const franchise = co.vatRegime === 'franchise';
    this.page.innerHTML = `
      <a class="back" href="${this.backHref()}">${icon('arrowLeft')}${d.kind === 'quote' ? 'Devis' : d.kind === 'credit' ? 'Avoirs' : 'Factures'}</a>
      <div class="editor-head"><h2 id="edTitle">${esc(this.title())}</h2>${statusPill('muted', 'Brouillon')}<span class="spacer"></span>
        <div class="doc-actions">
          ${this.isNew ? '' : `<button class="btn btn-ghost" type="button" data-ed="delete">${icon('trash')}<span>Supprimer</span></button>`}
          <button class="btn" type="button" data-ed="save">${icon('check')}<span>Enregistrer</span></button>
          <div class="menu-wrap"><button class="btn btn-soft" type="button" data-ed="issuemenu" aria-haspopup="true">${icon('chevronDown')}<span>Émettre</span></button>
            <div class="menu" id="issueMenu" hidden><button type="button" data-ed="issue">${icon('hash')}Émettre sans envoyer</button><button type="button" data-ed="pdf">${icon('download')}PDF du brouillon</button></div></div>
          <button class="btn btn-primary" type="button" data-ed="send">${icon('send')}<span>Émettre et envoyer</span></button>
        </div></div>
      <div class="editor">
        <div class="editor-main">
          <section class="section"><h3>${d.kind === 'credit' ? 'Avoir' : 'Client et dates'}</h3>
            <div class="form-grid">
              <label class="field span-2"><span>Client</span><div style="display:flex;gap:8px"><select id="ed-client" style="flex:1"></select><button class="btn btn-ghost" type="button" data-ed="newclient" title="Créer un client">${icon('plus')}<span>Client</span></button></div></label>
              <label class="field"><span>Date d’émission</span><input id="ed-issue" type="date" value="${esc(d.issueDate)}"></label>
              ${d.kind === 'invoice' ? `<label class="field"><span>Date de la prestation</span><input id="ed-service" type="date" value="${esc(d.serviceDate || '')}"></label>
              <label class="field"><span>Échéance</span><input id="ed-due" type="date" value="${esc(d.dueDate || '')}"><small id="ed-due-hint"></small></label>` : ''}
              ${d.kind === 'quote' ? `<label class="field"><span>Valable jusqu’au</span><input id="ed-valid" type="date" value="${esc(d.validUntil || '')}"></label>` : ''}
              ${d.kind === 'credit' ? `<label class="field"><span>Facture d’origine</span><input value="${esc(d.relatedInvoiceNumber || '')}" readonly></label>` : ''}
              <label class="field"><span>Catégorie de l’opération</span><select id="ed-cat">${Object.entries(C.CATEGORIES).map(([k, v]) => `<option value="${k}"${k === d.category ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
              <label class="field"><span>Mode de règlement</span><select id="ed-method">${C.PAYMENT_METHODS.map(m => `<option${m === d.paymentMethod ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
              <label class="field span-2" id="ed-delivery-wrap"${d.category === 'services' ? ' hidden' : ''}><span>Adresse de livraison (si différente de l’adresse du client)</span><input id="ed-delivery" value="${esc(d.deliveryAddress || '')}" placeholder="Laisse vide si identique"></label>
            </div>
          </section>
          <section class="section"><h3>Lignes <span class="sub">prix unitaires hors taxes</span></h3>
            <div class="lines" id="lines"></div>
            <div class="lines-tools">
              <button class="btn btn-sm" type="button" data-ed="addline">${icon('plus')}<span>Ajouter une ligne</span></button>
              <div class="cat-pick"><button class="btn btn-sm btn-soft" type="button" data-ed="catalog" aria-haspopup="true">${icon('box')}<span>Depuis le catalogue</span></button><div class="cat-menu" id="catMenu" hidden></div></div>
              <span class="grow" style="flex:1"></span>
              <label class="field" style="flex-direction:row;align-items:center;gap:8px"><span>Remise globale</span><input id="ed-gdisc" class="input num" style="width:76px" value="${esc(String(d.globalDiscount || 0).replace('.', ','))}" inputmode="decimal"><span>%</span></label>
            </div>
            <div class="totals-box" id="totalsBox"></div>
          </section>
          <section class="section"><h3>Notes <span class="sub">affichées sur le document</span></h3>
            <label class="field"><textarea id="ed-notes" placeholder="${d.kind === 'quote' ? 'Délais, conditions particulières…' : 'Référence de commande, remerciements…'}" aria-label="Notes">${esc(d.notes || '')}</textarea></label>
          </section>
          <section class="section"><h3>Conformité <span class="sub">mentions obligatoires en France</span></h3><div class="mentions" id="mentions"></div></section>
        </div>
        <aside class="editor-side">
          <div class="preview-head"><h3>Aperçu en direct</h3><span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" data-ed="pdf">${icon('download')}<span>PDF</span></button></div>
          <div id="edPreview"></div>
        </aside>
      </div>`;
    this.renderClientSelect();
    this.renderLines();
    this.preview = mountPreview($('#edPreview'));
    this.bindForm();
    this.refresh(true);
    if (franchise) $$('#lines [data-f="vatRate"]').forEach(s => { s.disabled = true; });
  },
  renderClientSelect() {
    const sel = $('#ed-client'); if (!sel) return;
    const clients = Store.state.clients.filter(c => !c.internal && c.status !== 'archivé');
    sel.innerHTML = `<option value="">Choisir un client…</option>` + clients.map(c => `<option value="${esc(c.id)}"${c.id === this.doc.clientId ? ' selected' : ''}>${esc(c.name)}${c.status === 'prospect' ? ' (prospect)' : ''}</option>`).join('');
  },
  lineHTML(l, i) {
    const franchise = Store.company.vatRegime === 'franchise';
    return `<div class="line" data-lid="${esc(l.id)}">
      <div class="line-n">${i + 1}</div>
      <div class="line-desc"><input class="input" data-f="description" value="${esc(l.description)}" placeholder="Désignation" aria-label="Désignation ligne ${i + 1}"><textarea class="input" data-f="details" placeholder="Détails (facultatif)" aria-label="Détails ligne ${i + 1}" rows="1">${esc(l.details || '')}</textarea></div>
      <label class="line-f lf-qty"><span class="line-lbl">Quantité</span><input class="input num" data-f="qty" value="${esc(String(l.qty).replace('.', ','))}" inputmode="decimal"></label>
      <label class="line-f lf-unit"><span class="line-lbl">Unité</span><select class="input" data-f="unit">${C.UNITS.map(u => `<option${u === l.unit ? ' selected' : ''}>${u}</option>`).join('')}</select></label>
      <label class="line-f lf-pu"><span class="line-lbl">Prix HT</span><input class="input num" data-f="unitPrice" value="${esc(String(l.unitPrice).replace('.', ','))}" inputmode="decimal"></label>
      <label class="line-f lf-vat"><span class="line-lbl">TVA</span><select class="input" data-f="vatRate"${franchise ? ' disabled' : ''}>${franchise ? '<option>—</option>' : C.VAT_RATES.map(r => `<option value="${r}"${r === C.num(l.vatRate) ? ' selected' : ''}>${C.fmtRate(r)}</option>`).join('')}</select></label>
      <label class="line-f lf-disc"><span class="line-lbl">Remise %</span><input class="input num" data-f="discount" value="${esc(String(l.discount || 0).replace('.', ','))}" inputmode="decimal"></label>
      <div class="line-total"><span class="line-lbl">Total HT</span><span data-total>${esc(fmt.eur(C.lineTotal(l)))}</span></div>
      <button class="icon-btn icon-btn-sm line-del" type="button" data-ed="delline" aria-label="Supprimer la ligne ${i + 1}">${icon('trash')}</button>
    </div>`;
  },
  renderLines() {
    const host = $('#lines');
    host.innerHTML = this.doc.lines.length ? this.doc.lines.map((l, i) => this.lineHTML(l, i)).join('') : '<p class="muted">Aucune ligne. Ajoute une prestation ou pioche dans le catalogue.</p>';
  },
  bindForm() {
    const d = this.doc;
    const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    on('ed-client', 'change', e => { d.clientId = e.target.value || null; this.touch(); });
    on('ed-issue', 'change', e => {
      d.issueDate = e.target.value || Store.today;
      if (d.kind === 'invoice' && this.dueAuto) { d.dueDate = C.addDays(d.issueDate, Store.company.paymentTermsDays || 30); $('#ed-due').value = d.dueDate; }
      if (d.kind === 'quote') { d.validUntil = C.addDays(d.issueDate, Store.company.quoteValidityDays || 30); $('#ed-valid').value = d.validUntil; }
      this.touch();
    });
    on('ed-service', 'change', e => { d.serviceDate = e.target.value || null; this.touch(); });
    on('ed-due', 'change', e => { d.dueDate = e.target.value || null; this.dueAuto = false; this.touch(); });
    on('ed-valid', 'change', e => { d.validUntil = e.target.value || null; this.touch(); });
    on('ed-cat', 'change', e => { d.category = e.target.value; $('#ed-delivery-wrap').hidden = d.category === 'services'; this.touch(); });
    on('ed-method', 'change', e => { d.paymentMethod = e.target.value; this.touch(); });
    on('ed-delivery', 'input', e => { d.deliveryAddress = e.target.value; this.touch(); });
    on('ed-notes', 'input', e => { d.notes = e.target.value; this.touch(); });
    on('ed-gdisc', 'input', e => { d.globalDiscount = e.target.value; this.touch(); });
    const lines = $('#lines');
    const onLine = e => {
      const f = e.target.dataset.f; if (!f) return;
      const row = e.target.closest('.line'); const l = d.lines.find(x => x.id === row.dataset.lid); if (!l) return;
      l[f] = e.target.value;
      row.querySelector('[data-total]').textContent = fmt.eur(C.lineTotal(l));
      this.touch();
    };
    lines.addEventListener('input', onLine);
    lines.addEventListener('change', onLine);
  },
  touch() {
    this.dirty = true;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.refresh(), 90);
  },
  refresh(first) {
    const d = this.doc;
    if (!$('#totalsBox')) return;
    const t = Store.totals(d);
    const rows = [];
    if (t.discount) { rows.push(['Sous-total HT', fmt.eur(t.gross)]); rows.push(['Remise ' + C.fmtNum(C.num(d.globalDiscount)) + ' %', '−' + fmt.eur(t.discount)]); }
    rows.push(['Total HT', fmt.eur(t.totalHT)]);
    if (t.franchise) rows.push(['TVA', 'non applicable (art. 293 B)']);
    else t.bases.forEach(b => rows.push(['TVA ' + C.fmtRate(b.rate) + (t.bases.length > 1 ? ' sur ' + fmt.eur(b.base) : ''), fmt.eur(b.vat)]));
    $('#totalsBox').innerHTML = rows.map(r => `<span>${esc(r[0])}</span><b>${esc(r[1])}</b>`).join('') + `<span class="grand">${t.franchise ? 'Net à payer' : 'Total TTC'}</span><b class="grand">${esc(fmt.eur(t.totalTTC))}</b>`;
    const hint = $('#ed-due-hint');
    if (hint && d.dueDate) { const n = C.diffDays(d.dueDate, d.issueDate); hint.textContent = n >= 0 ? 'Soit ' + n + ' jours après émission' + (n > 60 ? ' (au-delà du maximum légal de 60 jours)' : '') + '.' : 'L’échéance précède la date d’émission.'; }
    this.renderMentions();
    if (this.preview) this.preview.render(d);
    const title = $('#edTitle'); if (title) title.textContent = this.title();
    if (!first && App.kingo && App.kingo.mood !== 'concentre') App.kingo.setMood('concentre', 2500);
  },
  renderMentions() {
    const d = this.doc, co = Store.company, cl = Store.client(d.clientId);
    const missing = C.missingMentions(co, cl, d);
    const items = [
      ['Identité et adresse de l’entreprise', !missing.includes('Nom de l’entreprise') && !missing.includes('Adresse de l’entreprise'), 'reglages'],
      ['SIRET de l’entreprise', !missing.includes('SIRET de l’entreprise'), 'reglages'],
      [co.vatRegime === 'franchise' ? 'Mention « TVA non applicable, art. 293 B du CGI »' : 'N° de TVA intracommunautaire', !missing.includes('N° de TVA intracommunautaire'), 'reglages'],
      ['Nom et adresse du client', !!cl && !missing.includes('Adresse du client'), null],
      ...(cl && cl.type === 'pro' ? [['SIREN du client (depuis le 1er septembre 2026)', !missing.includes('SIREN du client'), 'client']] : []),
      ['Catégorie de l’opération (vente, prestation ou les deux)', !!d.category, null],
      ['Numéro unique et chronologique', true, null, 'attribué à l’émission'],
      ...(d.kind === 'invoice' ? [['Date d’échéance et conditions de paiement', !!d.dueDate, null], ['Pénalités de retard et indemnité de 40 €', !!(co.latePenalty && co.recoveryFee), 'reglages']] : []),
    ];
    $('#mentions').innerHTML = items.map(([label, ok, fix, note]) => `<div class="mention ${ok ? 'ok' : 'miss'}">${icon(ok ? 'check' : 'alert')}<span>${esc(label)}${note ? ` <span class="muted">— ${esc(note)}</span>` : ''}${!ok && fix === 'reglages' ? ` · <a class="link" href="#reglages">Compléter</a>` : ''}${!ok && fix === 'client' && cl ? ` · <button class="link" type="button" data-ed="editclient">Compléter la fiche</button>` : ''}</span></div>`).join('');
  },

  async save(silent) {
    const d = this.normalized();
    const saved = await Store.saveDoc(d);
    this.doc = JSON.parse(JSON.stringify(saved));
    this.dirty = false;
    if (this.isNew) { this.isNew = false; history.replaceState(null, '', '#doc-' + saved.id); App.route.hash = 'doc-' + saved.id; }
    if (!silent) toast(C.KIND_LABELS[d.kind] + ' enregistré' + (d.kind === 'invoice' ? 'e' : '') + ' en brouillon.');
    return saved;
  },

  async onClick(e) {
    const pick = e.target.closest('[data-cat]');
    if (pick) {
      const k = Store.state.catalog.find(x => x.id === pick.dataset.cat);
      const empty = this.doc.lines.length === 1 && !String(this.doc.lines[0].description).trim() && !C.num(this.doc.lines[0].unitPrice);
      const line = { id: C.uid('l'), description: k.name, details: k.description || '', qty: 1, unit: k.unit, unitPrice: k.unitPrice, vatRate: k.vatRate, discount: 0 };
      if (empty) this.doc.lines = [line]; else this.doc.lines.push(line);
      $('#catMenu').hidden = true;
      this.renderLines(); this.touch();
      return;
    }
    const a = e.target.closest('[data-ed]');
    if (!a) return;
    const act = a.dataset.ed;
    try {
      switch (act) {
        case 'addline': this.doc.lines.push(this.blankLine()); this.renderLines(); this.touch(); { const all = $$('#lines [data-f="description"]'); if (all.length) all[all.length - 1].focus(); } break;
        case 'delline': { const row = a.closest('.line'); this.doc.lines = this.doc.lines.filter(l => l.id !== row.dataset.lid); this.renderLines(); this.touch(); break; }
        case 'catalog': this.toggleCatalog(); break;
        case 'newclient': Views.clients.editDialog(null); break;
        case 'editclient': Views.clients.editDialog(this.doc.clientId); break;
        case 'save': await this.save(); break;
        case 'issuemenu': { const m = $('#issueMenu'); m.hidden = !m.hidden; break; }
        case 'pdf': $('#issueMenu') && ($('#issueMenu').hidden = true); await downloadPDF(this.doc.status === 'draft' ? this.normalized() : this.doc); break;
        case 'issue': {
          $('#issueMenu').hidden = true;
          const errs = C.validateDocument(this.normalized());
          if (errs.length) { toast(errs[0], { tone: 'warn' }); return; }
          const num = C.nextNumber(Store.state.docs, this.doc.kind, Store.company, this.doc.issueDate);
          const ok = await confirmDialog({ title: 'Émettre ' + (this.doc.kind === 'quote' ? 'ce devis' : this.doc.kind === 'credit' ? 'cet avoir' : 'cette facture') + ' ?', message: 'Il reçoit le numéro définitif ' + num + ' et ne pourra plus être modifié. Une correction passera par un avoir.', confirmLabel: 'Émettre ' + num, icon: 'hash' });
          if (!ok) return;
          const saved = await this.save(true);
          const issued = await Store.issueDoc(saved.id);
          this.doc = JSON.parse(JSON.stringify(issued));
          toast(C.KIND_LABELS[issued.kind] + ' ' + issued.number + ' émis' + (issued.kind === 'invoice' ? 'e' : '') + '.');
          this.renderView();
          break;
        }
        case 'send': {
          const errs = C.validateDocument(this.normalized());
          if (errs.length) { toast(errs[0], { tone: 'warn' }); return; }
          const saved = await this.save(true);
          Views.billing.sendDialog(saved.id);
          break;
        }
        case 'delete': {
          const ok = await confirmDialog({ title: 'Supprimer ce brouillon ?', message: 'Il n’a pas de numéro : sa suppression ne crée aucun trou dans la numérotation.', confirmLabel: 'Supprimer', danger: true });
          if (!ok) return;
          this.dirty = false;
          await Store.deleteDoc(this.doc.id);
          toast('Brouillon supprimé.');
          location.hash = this.backHref().slice(1);
          break;
        }
        /* -- mode consultation -- */
        case 'pay': Views.billing.paymentDialog(this.doc.id); break;
        case 'sendv': Views.billing.sendDialog(this.doc.id); break;
        case 'remind': Views.billing.sendDialog(this.doc.id, { reminder: true }); break;
        case 'accept': await Store.setDocStatus(this.doc.id, 'accepted'); App.kingoSay('Devis accepté ! Tu peux le transformer en facture.', { mood: 'heureux', fx: 'sparkle' }); break;
        case 'refuse': await Store.setDocStatus(this.doc.id, 'refused'); toast('Devis marqué refusé.'); break;
        case 'convert': { const inv = await Store.convertQuote(this.doc.id); toast('Facture préparée en brouillon.'); App.go('doc-' + inv.id); break; }
        case 'credit': {
          const ok = await confirmDialog({ title: 'Annuler ' + this.doc.number + ' par un avoir ?', message: 'Une facture émise ne se supprime pas. Un avoir du même montant est préparé en brouillon ; la facture passe « annulée ».', confirmLabel: 'Préparer l’avoir', icon: 'credit' });
          if (!ok) return;
          const av = await Store.creditInvoice(this.doc.id);
          App.go('doc-' + av.id);
          break;
        }
        case 'duplicate': {
          const src = this.doc;
          const copy = C.blankDocument(src.kind === 'credit' ? 'invoice' : src.kind, Store.company, Store.today, src.clientId);
          copy.lines = C.cloneLines(src.lines); copy.category = src.category; copy.globalDiscount = src.globalDiscount || 0; copy.notes = src.notes || ''; copy.paymentMethod = src.paymentMethod;
          const saved = await Store.saveDoc(copy);
          toast('Copie créée en brouillon.');
          App.go('doc-' + saved.id);
          break;
        }
        case 'more': { const m = $('#viewMenu'); m.hidden = !m.hidden; break; }
      }
    } catch (err) {
      if (err && err.code !== 'cancelled') toast(err.message || String(err), { tone: 'crit' });
    }
  },
  toggleCatalog() {
    const m = $('#catMenu');
    if (!m.hidden) { m.hidden = true; return; }
    m.hidden = false;
    m.innerHTML = `<input class="input" id="catQ" placeholder="Rechercher dans le catalogue" aria-label="Rechercher dans le catalogue"><div id="catList"></div>`;
    const paint = q => {
      const list = Store.state.catalog.filter(k => !q || (k.name + ' ' + k.category + ' ' + k.description).toLowerCase().includes(q));
      $('#catList').innerHTML = list.length ? list.map(k => `<button class="cat-item" type="button" data-cat="${esc(k.id)}"><span>${esc(k.name)}<small>${esc(k.category)} · par ${esc(k.unit)}</small></span><b>${esc(fmt.eur(C.cents(k.unitPrice)))}</b></button>`).join('') : '<p class="muted" style="padding:8px">Aucun article. Ajoute-les dans Facturation › Catalogue.</p>';
    };
    paint('');
    const q = $('#catQ'); q.focus();
    q.addEventListener('input', () => paint(q.value.trim().toLowerCase()));
    setTimeout(() => {
      const close = ev => { if (!ev.target.closest('.cat-pick')) { m.hidden = true; document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 0);
  },

  /* ---------- mode consultation (document émis, verrouillé) ---------- */
  renderView() {
    const d = this.doc, S = Store, t = S.totals(d), st = S.status(d), cl = S.client(d.clientId);
    const kindName = C.KIND_LABELS[d.kind];
    const linked = d.fromQuoteId ? S.doc(d.fromQuoteId) : null;
    const credit = d.creditId ? S.doc(d.creditId) : S.state.docs.find(x => x.relatedInvoiceId === d.id);
    const origin = d.relatedInvoiceId ? S.doc(d.relatedInvoiceId) : null;
    const inv = d.invoiceId ? S.doc(d.invoiceId) : null;
    let primary = '', secondary = '', menu = '';
    if (d.kind === 'invoice') {
      if (st === 'sent' || st === 'overdue') {
        primary = `<button class="btn btn-primary" type="button" data-ed="pay">${icon('card')}<span>Enregistrer un paiement</span></button>`;
        secondary = st === 'overdue' ? `<button class="btn btn-soft" type="button" data-ed="remind">${icon('mail')}<span>Relancer</span></button>` : `<button class="btn" type="button" data-ed="sendv">${icon('send')}<span>Envoyer</span></button>`;
        menu = `<button type="button" data-ed="duplicate">${icon('copy')}Dupliquer</button><button type="button" data-ed="credit">${icon('credit')}Annuler par un avoir</button>`;
      } else if (st === 'paid') {
        secondary = `<button class="btn" type="button" data-ed="sendv">${icon('send')}<span>Renvoyer</span></button>`;
        menu = `<button type="button" data-ed="duplicate">${icon('copy')}Dupliquer</button><button type="button" data-ed="credit">${icon('credit')}Créer un avoir</button>`;
      } else if (st === 'cancelled') {
        secondary = credit ? `<a class="btn" href="#doc-${esc(credit.id)}">${icon('credit')}<span>Voir l’avoir</span></a>` : '';
        menu = `<button type="button" data-ed="duplicate">${icon('copy')}Dupliquer</button>`;
      }
    } else if (d.kind === 'quote') {
      if (st === 'sent' || st === 'expired') {
        primary = `<button class="btn btn-primary" type="button" data-ed="accept">${icon('check')}<span>Marquer accepté</span></button>`;
        secondary = `<button class="btn" type="button" data-ed="remind">${icon('mail')}<span>Relancer</span></button><button class="btn btn-ghost" type="button" data-ed="refuse">${icon('x')}<span>Refusé</span></button>`;
      } else if (st === 'accepted') primary = `<button class="btn btn-primary" type="button" data-ed="convert">${icon('convert')}<span>Transformer en facture</span></button>`;
      else if (st === 'invoiced' && inv) secondary = `<a class="btn" href="#doc-${esc(inv.id)}">${icon('file')}<span>Voir la facture</span></a>`;
      menu = `<button type="button" data-ed="duplicate">${icon('copy')}Dupliquer</button>`;
    } else {
      secondary = `<button class="btn" type="button" data-ed="sendv">${icon('send')}<span>Envoyer</span></button>` + (origin ? `<a class="btn btn-ghost" href="#doc-${esc(origin.id)}">${icon('file')}<span>Facture d’origine</span></a>` : '');
    }
    const timeline = [];
    timeline.push(['Créé' + (d.kind === 'invoice' ? 'e' : ''), d.createdAt]);
    if (d.issuedAt || d.number) timeline.push(['Émis' + (d.kind === 'invoice' ? 'e' : '') + ' — numéro ' + d.number, d.issuedAt || (d.issueDate + 'T09:00:00')]);
    if (d.sentAt) timeline.push(['Envoyé' + (d.kind === 'invoice' ? 'e' : '') + ' par email' + (d.lastEmail ? ' à ' + d.lastEmail.to : ''), d.sentAt]);
    if (d.acceptedAt) timeline.push(['Accepté par le client', d.acceptedAt]);
    if (d.refusedAt) timeline.push(['Refusé', d.refusedAt]);
    (d.payments || []).forEach(p => timeline.push(['Paiement de ' + fmt.eur(C.cents(p.amount)) + ' (' + p.method + ')', p.date]));
    if (d.paidAt && d.status === 'paid') timeline.push(['Soldée', d.paidAt]);
    if (d.cancelledAt) timeline.push(['Annulée par avoir', d.cancelledAt]);
    timeline.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    this.page.innerHTML = `
      <a class="back" href="${this.backHref()}">${icon('arrowLeft')}${d.kind === 'quote' ? 'Devis' : d.kind === 'credit' ? 'Avoirs' : 'Factures'}</a>
      <div class="editor-head"><h2>${esc(kindName + ' ' + d.number)}</h2>${docPill(d, S.today)}<span class="spacer"></span>
        <div class="doc-actions">${secondary}<button class="btn btn-ghost" type="button" data-ed="pdf">${icon('download')}<span>PDF</span></button>${primary}
          ${menu ? `<div class="menu-wrap"><button class="icon-btn" type="button" data-ed="more" aria-label="Plus d’actions">${icon('more')}</button><div class="menu" id="viewMenu" hidden>${menu}</div></div>` : ''}</div></div>
      <div class="editor">
        <div class="editor-main">
          <section class="section">
            <div class="stat-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
              <div class="stat"><span>${icon('user')}Client</span><strong style="font-size:15px"><a class="link" href="#client-${esc(d.clientId)}">${esc(cl ? cl.name : '—')}</a></strong><small>${esc(cl ? cl.email || '' : '')}</small></div>
              <div class="stat"><span>${icon('euro')}${d.kind === 'quote' ? 'Montant HT' : 'Montant TTC'}</span><strong>${esc(fmt.eur(C.sign(d) * (d.kind === 'quote' ? t.totalHT : t.totalTTC)))}</strong><small>${d.kind === 'quote' ? esc(fmt.eur(t.totalTTC)) + ' TTC' : 'HT ' + esc(fmt.eur(C.sign(d) * t.totalHT))}</small></div>
              <div class="stat"><span>${icon('calendar')}${d.kind === 'quote' ? 'Validité' : d.kind === 'credit' ? 'Émis le' : 'Échéance'}</span><strong style="font-size:16px">${esc(fmt.date(d.kind === 'quote' ? d.validUntil : d.kind === 'credit' ? d.issueDate : d.dueDate))}</strong><small>${st === 'overdue' ? `<span class="late">${C.diffDays(S.today, d.dueDate)} jours de retard</span>` : 'émis' + (d.kind === 'invoice' ? 'e' : '') + ' le ' + esc(fmt.date(d.issueDate))}</small></div>
            </div>
            ${d.kind === 'invoice' && d.status !== 'cancelled' ? `<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px"><span class="ink2">Réglé ${esc(fmt.eur(t.paid))} sur ${esc(fmt.eur(t.totalTTC))}</span><strong>Reste dû ${esc(fmt.eur(t.due))}</strong></div><div class="progress"><span style="width:${t.totalTTC ? (t.paid / t.totalTTC * 100).toFixed(1) : 0}%"></span></div></div>` : ''}
            ${linked ? `<p class="muted" style="font-size:13px">Issue du devis <a class="link" href="#doc-${esc(linked.id)}">${esc(linked.number)}</a>.</p>` : ''}
            <div class="note">${icon('lock')}<span>Document émis : il est verrouillé pour respecter la numérotation continue. Pour corriger une erreur, annule-le par un avoir puis émets un nouveau document.</span></div>
          </section>
          ${d.kind === 'invoice' ? `<section class="section"><h3>Paiements <span class="sub">${fmt.plural((d.payments || []).length, 'règlement')}</span></h3>
            ${(d.payments || []).length ? `<div class="pay-list">${d.payments.map(p => `<div class="pay-item"><span class="sev sev-ok">${icon('card')}</span><div class="grow"><strong>${esc(fmt.eur(C.cents(p.amount)))}</strong><span>${esc(fmt.date(p.date))} · ${esc(p.method)}${p.note ? ' · ' + esc(p.note) : ''}</span></div><button class="icon-btn icon-btn-sm" type="button" data-bact="delpay" data-doc="${esc(d.id)}" data-pid="${esc(p.id)}" aria-label="Supprimer ce paiement">${icon('trash')}</button></div>`).join('')}</div>` : '<p class="muted">Aucun paiement reçu pour l’instant.</p>'}
          </section>` : ''}
          <section class="section"><h3>Historique</h3>
            ${timeline.map(x => `<div class="act-row"><span class="act-ico">${icon('history')}</span><div class="act-text"><strong>${esc(x[0])}</strong></div><span class="act-time">${esc(String(x[1]).length > 10 ? fmt.dateTime(x[1]) : fmt.date(x[1]))}</span></div>`).join('')}
          </section>
        </div>
        <aside class="editor-side">
          <div class="preview-head"><h3>Document</h3><span class="spacer"></span><button class="btn btn-sm btn-ghost" type="button" data-ed="pdf">${icon('download')}<span>Télécharger le PDF</span></button></div>
          <div id="edPreview"></div>
        </aside>
      </div>`;
    if (this.preview) this.preview.destroy();
    this.preview = mountPreview($('#edPreview'));
    this.preview.render(d);
    $$('[data-bact="delpay"]', this.page).forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); Views.billing.deletePayment(b.dataset.doc, b.dataset.pid); }));
    document.addEventListener('click', ev => { const m = $('#viewMenu'); if (m && !ev.target.closest('.menu-wrap')) m.hidden = true; }, { once: true });
  },
};

/* ---- js/views/security.js ---- */
/* ===== Sécurité : compte admin, 2FA, sessions, coffre SSH, journal d'audit, sauvegardes ===== */
const AUDIT_GROUPS = [['all', 'Tout'], ['auth', 'Connexions'], ['doc', 'Facturation'], ['server', 'Serveurs'], ['client', 'Clients'], ['settings', 'Réglages']];

Views.security = {
  group: 'all', auditClient: '',
  render(page) {
    this.page = page;
    page.innerHTML = `
      <div class="sec-grid">
        <section class="panel"><div class="panel-head"><h2>Accès administrateur</h2></div><div class="panel-body" id="secAccount"></div></section>
        <section class="panel"><div class="panel-head"><h2>Sessions actives</h2><span class="sub">appareils connectés à ton compte</span></div><div class="panel-body" id="secSessions"></div></section>
        <section class="panel wide"><div class="panel-head"><h2>Coffre des clés SSH</h2><span class="sub">les clés privées ne quittent jamais le serveur</span></div><div class="panel-body" id="secVault"></div></section>
        <section class="panel wide"><div class="panel-head"><h2>Journal des actions administratives</h2><span class="sub">chaîné par empreintes SHA-256 : toute modification se détecte</span></div><div class="panel-body" id="secAudit"></div></section>
        <section class="panel"><div class="panel-head"><h2>Sauvegardes</h2></div><div class="panel-body" id="secBackup"></div></section>
        <section class="panel"><div class="panel-head"><h2>Contrôle de sécurité</h2></div><div class="panel-body" id="secChecks"></div></section>
      </div>`;
    page.addEventListener('click', e => this.onClick(e));
    this.renderAll();
  },
  update(type) { if (type !== 'metrics' && this.page && this.page.isConnected) this.renderAll(); },
  renderAll() { this.renderAccount(); this.renderSessions(); this.renderVault(); this.renderAudit(); this.renderBackup(); this.renderChecks(); },

  row(ic, title, sub, right, tone) {
    return `<div class="check-row"><span class="sev sev-${tone || 'ok'}">${icon(ic)}</span><div class="grow"><strong>${title}</strong><span>${sub}</span></div>${right || ''}</div>`;
  },
  renderAccount() {
    const me = Store.state.me || {};
    $('#secAccount').innerHTML =
      this.row('user', esc(me.email || 'Administrateur'), 'Compte administrateur unique. Aucune inscription n’est possible : le compte se crée en ligne de commande sur le serveur.', '', 'info') +
      this.row('key', 'Mot de passe', me.passwordChangedAt ? 'Modifié le ' + esc(fmt.date(me.passwordChangedAt)) + ' · haché avec scrypt' : 'Haché avec scrypt', `<button class="btn btn-sm" type="button" data-sec="password">Changer</button>`) +
      this.row('shield', 'Double authentification (TOTP)', me.twoFactor ? 'Activée et obligatoire · ' + fmt.plural(me.recoveryLeft || 0, 'code de secours restant', 'codes de secours restants') : 'À activer', `<button class="btn btn-sm" type="button" data-sec="codes">Nouveaux codes</button>`, me.twoFactor ? 'ok' : 'crit') +
      this.row('lock', 'Confirmation renforcée', 'Console, suppression, rotation de clés et export redemandent un code 2FA au-delà de 10 minutes.', '') +
      this.row('clock', 'Verrouillage automatique', 'Session fermée après 30 min d’inactivité, 12 h au maximum. 5 échecs de connexion bloquent l’adresse IP 15 min.', `<button class="btn btn-sm btn-ghost" type="button" data-sec="lock">${icon('lock')}<span>Verrouiller</span></button>`);
  },
  async renderSessions() {
    const host = $('#secSessions');
    const list = await Store.sessions();
    host.innerHTML = list.map(s => `<div class="check-row"><span class="sev sev-${s.current ? 'ok' : 'info'}">${icon(/iphone|android|mobile/i.test(s.device) ? 'phone' : 'globe')}</span><div class="grow"><strong>${esc(s.device)}${s.current ? ' <span class="pill pill-ok" style="margin-left:6px">Cette session</span>' : ''}</strong><span>${esc(s.ip)} · ouverte ${esc(fmt.rel(s.createdAt))} · active ${esc(fmt.rel(s.lastSeen))}</span></div>${s.current ? '' : `<button class="btn btn-sm btn-danger" type="button" data-sec="revoke" data-id="${esc(s.id)}">Révoquer</button>`}</div>`).join('') || '<p class="muted">Aucune session.</p>';
  },
  renderVault() {
    const S = Store;
    const rows = S.state.servers.slice().sort((a, b) => S.clientName(a.clientId).localeCompare(S.clientName(b.clientId)));
    $('#secVault').innerHTML = `<div class="note" style="margin-bottom:12px">${icon('shield')}<span>Une paire de clés ed25519 par serveur, générée côté serveur. La clé privée est chiffrée en AES-256-GCM avec une clé dérivée propre à chaque client, liée au serveur concerné. Ton navigateur ne reçoit que les clés publiques et les empreintes ci-dessous.</span></div>
      <div class="table-scroll"><table class="table table-cards"><thead><tr><th>Serveur</th><th>Empreinte de la clé</th><th>Hôte vérifié</th><th>Créée le</th><th></th></tr></thead><tbody>${rows.map(s => `<tr>
        <td class="c-main"><div class="cell-main"><strong class="mono">${esc(s.name)}</strong><span>${esc(S.clientName(s.clientId))}</span></div></td>
        <td class="c-full mono" style="font-size:12px;overflow-wrap:anywhere">${esc(s.keyFingerprint || '—')}</td>
        <td class="c-main">${s.hostFingerprint ? statusPill('ok', 'Oui') : statusPill('warn', 'Pas encore')}</td>
        <td class="c-main" data-hide-m>${s.keyCreatedAt ? esc(fmt.date(C.isoDate(new Date(s.keyCreatedAt)))) : '—'}</td>
        <td class="c-end"><a class="btn btn-sm btn-ghost" href="#serveur-${esc(s.id)}">${icon('repeat')}<span>Rotation</span></a></td></tr>`).join('')}</tbody></table></div>`;
  },
  async renderAudit() {
    const host = $('#secAudit');
    if (!host.dataset.ready) {
      host.dataset.ready = '1';
      host.innerHTML = `<div class="toolbar" style="margin-bottom:10px">
          <div class="seg" id="auSeg">${AUDIT_GROUPS.map(g => `<button type="button" data-au="${g[0]}" aria-pressed="${this.group === g[0]}">${g[1]}</button>`).join('')}</div>
          <select class="select" id="auClient" style="width:auto" aria-label="Client"><option value="">Tous les clients</option>${Store.state.clients.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
          <span class="grow"></span>
          <button class="btn btn-sm" type="button" data-sec="verify">${icon('fingerprint')}<span>Vérifier l’intégrité</span></button>
          <button class="btn btn-sm btn-ghost" type="button" data-sec="csv">${icon('download')}<span>Exporter en CSV</span></button>
        </div><div id="auResult"></div><div class="table-scroll" id="auTable" style="max-height:460px;overflow:auto"></div>`;
      $('#auClient').addEventListener('change', e => { this.auditClient = e.target.value; this.paintAudit(); });
    }
    this.entries = await Store.auditList();
    this.paintAudit();
  },
  auditFiltered() {
    return (this.entries || []).filter(e => (this.group === 'all' || e.action.startsWith(this.group) || (this.group === 'doc' && /^(quote|payment|catalog|subscription)\./.test(e.action))) && (!this.auditClient || e.clientId === this.auditClient));
  },
  paintAudit() {
    $$('#auSeg [data-au]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.au === this.group)));
    const list = this.auditFiltered();
    $('#auTable').innerHTML = list.length ? `<table class="table table-compact table-cards"><thead><tr><th>Date</th><th>Action</th><th>Cible</th><th>Adresse IP</th><th>Empreinte</th></tr></thead><tbody>${list.map(e => `<tr>
      <td class="c-main nowrap">${esc(fmt.dateTime(e.ts))}</td>
      <td class="c-full"><span class="${/failed|blocked/.test(e.action) ? 'late' : ''}" style="font-size:13.5px">${esc(e.label)}</span></td>
      <td class="c-main">${esc(e.target || '—')}</td>
      <td class="c-end mono" style="font-size:12px">${esc(e.ip || '')}</td>
      <td class="mono muted" data-hide-m style="font-size:11.5px">${esc((e.hash || '').slice(0, 12))}…</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Aucune action pour ce filtre.</p>';
  },
  renderBackup() {
    const b = Store.state.backups || {};
    const days = b.last ? Math.floor((Date.now() - new Date(b.last).getTime()) / 86400000) : null;
    $('#secBackup').innerHTML = this.row('disk', b.last ? 'Dernière sauvegarde ' + esc(fmt.rel(b.last)) : 'Aucune sauvegarde', 'Base de données chiffrée (factures, clients, journal, coffre des clés). Garde aussi une copie hors du serveur.', `<button class="btn btn-sm btn-primary" type="button" data-sec="backup">${icon('download')}<span>Sauvegarder</span></button>`, days === null || days >= 7 ? 'warn' : 'ok') +
      this.row('history', 'Conservation légale', 'Les factures émises sont conservées 10 ans (Code de commerce, art. L123-22) : elles ne peuvent pas être supprimées.', '', 'info');
  },
  renderChecks() {
    const S = Store, me = S.state.me || {};
    const b = S.state.backups || {};
    const recent = b.last && (Date.now() - new Date(b.last).getTime()) < 7 * 86400000;
    const hostOk = S.state.servers.every(s => s.hostFingerprint || !(s.metrics && s.metrics.lastSeen));
    const checks = [
      [LIVE ? location.protocol === 'https:' : true, 'HTTPS et HSTS', LIVE ? (location.protocol === 'https:' ? 'Connexion chiffrée.' : 'Active HTTPS (Caddy) avant toute mise en ligne.') : 'Fourni par Caddy dans la version installée.'],
      
      [!!me.twoFactor, '2FA obligatoire', 'Mot de passe + code TOTP à chaque connexion.'],
      [true, 'Politique de sécurité du contenu', 'Scripts limités au serveur lui-même, pas de CDN tiers, cadres interdits.'],
      [true, 'Clés SSH hors du navigateur', 'Chiffrées au repos, console relayée par le serveur.'],
      [hostOk, 'Empreintes d’hôtes enregistrées', 'Protège contre l’usurpation d’un serveur client.'],
      [true, 'Journal chaîné', 'Chaque action admin est horodatée, avec IP et empreinte.'],
      [!!recent, 'Sauvegarde de moins de 7 jours', recent ? 'À jour.' : 'Lance une sauvegarde.'],
    ];
    const score = checks.filter(c => c[0]).length;
    $('#secChecks').innerHTML = `<p style="margin-bottom:6px"><strong style="font-size:20px">${score}/${checks.length}</strong> <span class="muted">contrôles au vert</span></p>` + checks.map(c => this.row(c[0] ? 'check' : 'alert', esc(c[1]), esc(c[2]), '', c[0] ? 'ok' : 'warn')).join('');
  },

  async backup() {
    if (App.kingo) App.kingo.setMood('concentre', 2000);
    try { await Store.backupNow(); toast('Sauvegarde chiffrée créée.'); App.kingoSay('Sauvegarde faite. Je dors mieux.', { mood: 'heureux' }); } catch (e) { if (e.code !== 'cancelled') toast(e.message, { tone: 'crit' }); }
  },

  async onClick(e) {
    const g = e.target.closest('[data-au]');
    if (g) { this.group = g.dataset.au; this.paintAudit(); return; }
    const a = e.target.closest('[data-sec]');
    if (!a) return;
    try {
      switch (a.dataset.sec) {
        case 'lock': Auth.lock(); break;
        case 'revoke': { const ok = await confirmDialog({ title: 'Révoquer cette session ?', message: 'L’appareil devra se reconnecter avec mot de passe et code 2FA.', confirmLabel: 'Révoquer', danger: true }); if (ok) { await Store.revokeSession(a.dataset.id); this.renderSessions(); toast('Session révoquée.'); } break; }
        case 'backup': await this.backup(); this.renderBackup(); this.renderChecks(); break;
        case 'verify': {
          a.disabled = true;
          const r = await Store.verifyAudit();
          a.disabled = false;
          $('#auResult').innerHTML = r.ok ? `<div class="note" style="margin-bottom:10px">${icon('check')}<span>Chaîne intègre : ${r.count} entrées vérifiées, aucune modification ni suppression détectée.</span></div>`
            : `<div class="note note-crit" style="margin-bottom:10px">${icon('alert')}<span>Rupture détectée à l’entrée ${r.count} : le journal a été modifié.</span></div>`;
          break;
        }
        case 'csv': {
          const list = this.auditFiltered();
          const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
          const csv = '﻿date;action;libellé;cible;client;ip;empreinte\n' + list.map(x => [x.ts, x.action, x.label, x.target, x.clientId ? Store.clientName(x.clientId) : '', x.ip, x.hash].map(q).join(';')).join('\n');
          offerDownload('journal-audit-' + Store.today + '.csv', csv);
          break;
        }
        case 'codes': {
          if (!(await stepUpDemo('Les anciens codes de secours seront invalidés.'))) return;
          const codes = await Store.regenRecoveryCodes();
          this.renderAccount();
          dialog({
            title: 'Nouveaux codes de secours', subtitle: 'Chaque code fonctionne une seule fois si tu perds ton téléphone. Range-les hors ligne.',
            body: `<div class="codes">${codes.map(c => `<span>${esc(c)}</span>`).join('')}</div>${LIVE ? '' : '<p class="muted" style="font-size:12.5px">Démo : ces codes ne protègent rien.</p>'}`,
            actions: [{ label: 'Télécharger (.txt)', icon: 'download', run: () => { offerDownload('codes-secours-kingdream.txt', 'KingDream Control — codes de secours\n' + new Date().toLocaleString('fr-FR') + '\n\n' + codes.join('\n') + '\n'); return false; } }, { label: 'Je les ai rangés', tone: 'primary' }],
          });
          break;
        }
        case 'password': this.passwordDialog(); break;
      }
    } catch (err) { if (err.code !== 'cancelled') toast(err.message, { tone: 'crit' }); }
  },
  passwordDialog() {
    dialog({
      title: 'Changer le mot de passe', subtitle: '12 caractères minimum. Les autres sessions seront déconnectées.',
      body: `<form class="form-grid" novalidate>
        <label class="field span-2"><span>Mot de passe actuel</span><input id="pw-cur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>Nouveau mot de passe</span><input id="pw-new" type="password" autocomplete="new-password"></label>
        <label class="field"><span>Confirmation</span><input id="pw-new2" type="password" autocomplete="new-password"></label>
        <label class="field span-2"><span>Code 2FA</span><input id="pw-code" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
        <p class="field-error span-2" id="pw-err" hidden></p></form>`,
      actions: [{ label: 'Annuler' }, { label: 'Changer le mot de passe', tone: 'primary', run: async (close, el) => {
        const cur = $('#pw-cur', el).value, n1 = $('#pw-new', el).value, n2 = $('#pw-new2', el).value, code = $('#pw-code', el).value.trim();
        const err = $('#pw-err', el);
        const fail = m => { err.textContent = m; err.hidden = false; return false; };
        if (n1.length < 12) return fail('Le nouveau mot de passe doit contenir au moins 12 caractères.');
        if (n1 !== n2) return fail('Les deux saisies ne correspondent pas.');
        if (!/^\d{6}$/.test(code)) return fail('Saisis le code à 6 chiffres de ton application.');
        try {
          if (LIVE) await API.post('/api/auth/password', { current: cur, next: n1, code });
          else { await sleep(500); Store.state.me.passwordChangedAt = Store.today; Store.log('auth.password', 'Mot de passe modifié', 'Compte administrateur'); Store.changed('me'); }
          close(); toast('Mot de passe modifié.'); this.renderAccount();
        } catch (e) { return fail(e.message); }
        return false;
      } }],
    });
  },
};

/* ---- js/views/settings.js ---- */
/* ===== Réglages : entreprise, TVA et mentions, numérotation, emails, Kingo, apparence, données ===== */
// le bleu du logo KingDream d’abord, puis un bleu ciel et des teintes sobres qui s’impriment bien
const DOC_COLORS = ['#0058d0', '#2f80f5', '#0f8a5f', '#b8860b', '#cf2540', '#1d1d1f'];
const SMTP_GATE_HINT =  '';

Views.settings = {
  render(page, params) {
    this.page = page;
    this.form = JSON.parse(JSON.stringify(Store.company));
    this.dirty = false;
    const sections = [['entreprise', 'Entreprise'], ['facturation', 'TVA et mentions'], ['numerotation', 'Numérotation'], ['emails', 'Emails'], ['kingo', 'Kingo'], ['apparence', 'Apparence'], ['donnees', 'Données']];
    this.section = sections.some(s => s[0] === params.section) ? params.section : 'entreprise';
    page.innerHTML = `<div class="settings"><nav class="settings-nav" aria-label="Sections des réglages">${sections.map(s => `<a href="#reglages-${s[0]}" data-sec="${s[0]}" class="${s[0] === this.section ? 'active' : ''}">${s[1]}</a>`).join('')}</nav>
      <div class="settings-body"><div id="setBody" style="display:flex;flex-direction:column;gap:18px"></div>
      <div class="save-bar" id="saveBar" hidden><span>Modifications non enregistrées.</span><button class="btn btn-ghost" type="button" data-set="reset">Annuler</button><button class="btn btn-primary" type="button" data-set="save">${icon('check')}<span>Enregistrer</span></button></div></div></div>`;
    page.addEventListener('click', e => this.onClick(e));
    page.addEventListener('input', e => this.onInput(e));
    page.addEventListener('change', e => this.onInput(e));
    this.renderSection();
  },
  destroy() {
    if (this.dirty) { Store.saveCompany(this.form).then(() => toast('Réglages enregistrés.')); this.dirty = false; }
  },
  f(key, label, opts) {
    opts = opts || {};
    const v = key.split('.').reduce((o, k) => (o ? o[k] : ''), this.form);
    const attrs = `data-k="${key}" id="st-${key.replace(/\./g, '-')}"`;
    const input = opts.textarea ? `<textarea ${attrs} rows="${opts.rows || 3}">${esc(v || '')}</textarea>`
      : opts.select ? `<select ${attrs}>${opts.select.map(o => `<option value="${esc(o[0])}"${String(o[0]) === String(v) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`
      : `<input ${attrs} value="${esc(v === undefined || v === null ? '' : v)}"${opts.type ? ` type="${opts.type}"` : ''}${opts.inputmode ? ` inputmode="${opts.inputmode}"` : ''}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>`;
    return `<label class="field${opts.span ? ' span-2' : ''}"><span>${esc(label)}</span>${input}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
  },
  renderSection() {
    const body = $('#setBody'), f = this.form;
    $$('.settings-nav [data-sec]').forEach(a => a.classList.toggle('active', a.dataset.sec === this.section));
    const siretOk = !f.siret || luhnOk(f.siret.replace(/\s/g, '')) && f.siret.replace(/\s/g, '').length === 14;
    switch (this.section) {
      case 'entreprise':
        body.innerHTML = `<section class="section"><h3>Identité de l’entreprise <span class="sub">reprise sur chaque document</span></h3><div class="form-grid">
          ${this.f('tradeName', 'Nom commercial')}${this.f('legalName', 'Nom légal ou dénomination', { hint: 'Pour un entrepreneur individuel, la mention « EI » est ajoutée automatiquement.' })}
          ${this.f('legalForm', 'Forme juridique')}${this.f('siret', 'SIRET', { inputmode: 'numeric', hint: siretOk ? '14 chiffres.' : '<span class="late">Ce SIRET ne passe pas le contrôle de clé : vérifie-le.</span>' })}
          ${this.f('address', 'Adresse', { span: true })}${this.f('zip', 'Code postal', { inputmode: 'numeric' })}${this.f('city', 'Ville')}
          ${this.f('vatNumber', 'N° TVA intracommunautaire', { placeholder: 'FR…', hint: 'Laisse vide si tu es en franchise de TVA.' })}${this.f('rcs', 'Immatriculation (RCS / RM), si concerné', { placeholder: 'RCS Manosque 000 000 000' })}
          ${this.f('email', 'Email', { type: 'email' })}${this.f('phone', 'Téléphone', { inputmode: 'tel' })}${this.f('website', 'Site web')}
          <div class="field span-2"><span>Logo</span><div class="logo-drop">${f.logo ? `<img src="${esc(f.logo)}" alt="Logo actuel">` : `<span class="brand-mark">${icon('crown')}</span>`}<div style="flex:1"><p style="font-size:13px">PNG ou JPEG, 400 Ko maximum. Sans logo, la couronne et le nom commercial sont utilisés.</p></div><label class="btn btn-sm" style="cursor:pointer">${icon('upload')}<span>Choisir</span><input type="file" id="st-logo" accept="image/png,image/jpeg" hidden></label>${f.logo ? `<button class="btn btn-sm btn-ghost" type="button" data-set="nologo">Retirer</button>` : ''}</div></div>
        </div></section>`;
        $('#st-logo').addEventListener('change', e => this.loadLogo(e.target.files[0]));
        break;
      case 'facturation':
        body.innerHTML = `<section class="section"><h3>Régime de TVA</h3>
          <div class="seg" role="group" aria-label="Régime de TVA"><button type="button" data-vat="normal" aria-pressed="${f.vatRegime !== 'franchise'}">Assujetti à la TVA</button><button type="button" data-vat="franchise" aria-pressed="${f.vatRegime === 'franchise'}">Franchise en base (micro-entreprise)</button></div>
          ${f.vatRegime === 'franchise' ? `<div class="note">${icon('info')}<span>Tes documents affichent « TVA non applicable, art. 293 B du CGI » et la TVA est à 0. Si ton chiffre d’affaires dépasse le seuil de franchise, repasse en « Assujetti ».</span></div>`
            : `<div class="form-grid">${this.f('defaultVatRate', 'Taux par défaut', { select: C.VAT_RATES.map(r => [r, C.fmtRate(r)]) })}
              <label class="check" style="align-self:end"><input type="checkbox" data-k="vatOnDebits"${f.vatOnDebits ? ' checked' : ''}><span>Option pour le paiement de la TVA d’après les débits<small>Mention obligatoire sur les factures si tu as opté.</small></span></label></div>`}
          <p class="muted" style="font-size:12.5px">Taux disponibles par ligne : 20 %, 10 %, 5,5 %, 2,1 % et 0 %.</p></section>
          <section class="section"><h3>Paiement</h3><div class="form-grid">
            ${this.f('paymentTermsDays', 'Délai de paiement (jours)', { inputmode: 'numeric', hint: 'Maximum légal : 60 jours après émission.' })}${this.f('defaultPaymentMethod', 'Mode de règlement par défaut', { select: C.PAYMENT_METHODS.map(m => [m, m]) })}
            ${this.f('iban', 'IBAN', { placeholder: 'FR76 …' })}${this.f('bic', 'BIC')}${this.f('bank', 'Banque')}
          </div></section>
          <section class="section"><h3>Mentions légales <span class="sub">pied de page des factures</span></h3><div class="form-grid">
            ${this.f('latePenalty', 'Pénalités de retard', { textarea: true, span: true, rows: 2 })}
            ${this.f('recoveryFee', 'Indemnité forfaitaire de recouvrement (clients professionnels)', { textarea: true, span: true, rows: 2 })}
            ${this.f('discountTerms', 'Escompte', { span: true })}
            ${this.f('footerNote', 'Mention libre (facultatif)', { textarea: true, span: true, rows: 2, hint: 'Par exemple une assurance professionnelle ou un médiateur de la consommation.' })}
          </div></section>
          <section class="section"><h3>Couleur des documents</h3><div class="swatches">${DOC_COLORS.map(c => `<button type="button" class="swatch" data-color="${c}" aria-pressed="${f.docColor === c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('')}<input type="color" data-k="docColor" value="${esc(f.docColor || '#0058d0')}" aria-label="Couleur personnalisée" style="width:42px;height:30px;border:0;background:transparent;padding:0"></div></section>
          <section class="section"><h3>Facturation électronique</h3><div class="note">${icon('info')}<span>Depuis le 1er septembre 2026, toute entreprise doit pouvoir recevoir des factures électroniques via une plateforme agréée. Les TPE et micro-entreprises devront aussi les émettre à partir du 1er septembre 2027. Les PDF générés ici restent valables jusque-là ; les nouvelles mentions (SIREN du client, catégorie de l’opération, option sur les débits, adresse de livraison) y figurent déjà.</span></div></section>`;
        break;
      case 'numerotation': {
        const next = k => C.nextNumber(Store.state.docs, k, this.form, Store.today);
        body.innerHTML = `<section class="section"><h3>Numérotation</h3>
          <div class="note">${icon('hash')}<span>Une suite continue par type de document et par année, sans trou ni doublon. Le numéro est attribué à l’émission : supprimer un brouillon ne crée pas de trou.</span></div>
          <div class="form-grid form-grid-3">${this.f('prefixes.invoice', 'Préfixe des factures', { hint: 'Prochaine : <strong class="mono">' + esc(next('invoice')) + '</strong>' })}${this.f('prefixes.quote', 'Préfixe des devis', { hint: 'Prochain : <strong class="mono">' + esc(next('quote')) + '</strong>' })}${this.f('prefixes.credit', 'Préfixe des avoirs', { hint: 'Prochain : <strong class="mono">' + esc(next('credit')) + '</strong>' })}</div>
          <div class="form-grid">${this.f('quoteValidityDays', 'Validité des devis (jours)', { inputmode: 'numeric' })}</div></section>
          ${LIVE ? `<section class="section"><h3>Reprendre une numérotation existante</h3><p class="ink2" style="font-size:13px">Tu as déjà émis des factures ailleurs cette année ? Indique le dernier numéro utilisé : la suite continuera à partir du suivant. Impossible de revenir en arrière.</p>
            <div class="form-grid form-grid-3"><label class="field"><span>Type</span><select id="seq-kind"><option value="invoice">Factures</option><option value="quote">Devis</option><option value="credit">Avoirs</option></select></label>
            <label class="field"><span>Année</span><input id="seq-year" inputmode="numeric" value="${esc(Store.today.slice(0, 4))}"></label>
            <label class="field"><span>Dernier numéro utilisé</span><input id="seq-value" inputmode="numeric" placeholder="ex. 41"></label></div>
            <div class="toolbar"><button class="btn" type="button" data-set="seq">Appliquer</button></div></section>` : ''}`;
        break;
      }
      case 'emails':
        body.innerHTML = `<section class="section"><h3>Modèles d’emails</h3><p class="muted" style="font-size:13px">Variables : {contact}, {client}, {numero}, {montant}, {echeance}, {validite}, {entreprise}, {signature}.</p><div class="form-grid">
          ${this.f('emailTemplates.invoice', 'Envoi de facture', { textarea: true, span: true, rows: 6 })}
          ${this.f('emailTemplates.quote', 'Envoi de devis', { textarea: true, span: true, rows: 6 })}
          ${this.f('emailTemplates.reminder', 'Relance de facture en retard', { textarea: true, span: true, rows: 6 })}
          ${this.f('emailTemplates.credit', 'Envoi d’avoir', { textarea: true, span: true, rows: 4 })}
          ${this.f('signature', 'Signature', { textarea: true, span: true, rows: 2 })}
        </div></section>
        <section class="section"><h3>Serveur d’envoi (SMTP)</h3>${LIVE ? `<div id="smtpBox"><p class="muted">Chargement…</p></div>` : `<div class="note">${icon('mail')}<span>Dans la version installée, les emails partent de ton propre serveur SMTP (o2switch, OVH, Brevo…), avec le PDF en pièce jointe et une copie archivée. Le mot de passe SMTP est chiffré et n’est jamais renvoyé au navigateur.</span></div>`}</section>`;
        if (LIVE) this.loadSmtp();
        break;
      case 'kingo':
        body.innerHTML = `<section class="section"><h3>Ta mascotte</h3><div class="form-grid">
          ${this.f('mascotName', 'Prénom')}
          <label class="check" style="align-self:end"><input type="checkbox" data-k="mascotEnabled"${f.mascotEnabled !== false ? ' checked' : ''}><span>Afficher la mascotte<small>Sur le tableau de bord et en bas à droite des autres pages.</small></span></label>
          <label class="check"><input type="checkbox" data-k="nightMode"${f.nightMode !== false ? ' checked' : ''}><span>Elle dort la nuit (23 h – 6 h)<small>Sauf urgence sur un serveur : elle se réveille.</small></span></label>
        </div></section>
        <section class="section"><h3>Essayer ses réactions</h3><div class="toolbar">
          ${[['salut', 'Salut', 'wave'], ['heureux', 'Content', 'check'], ['fier', 'Paiement reçu', 'euro'], ['inquiet', 'Inquiet', 'alert'], ['panique', 'Panique', 'zap'], ['reflechit', 'Réfléchit', 'sparkle'], ['scan', 'Inspecte', 'search'], ['dort', 'Dort', 'moon'], ['etourdi', 'Étourdi', 'refresh']].map(m => `<button class="btn btn-sm" type="button" data-mood="${m[0]}">${icon(m[2])}<span>${m[1]}</span></button>`).join('')}
        </div><p class="muted" style="font-size:12.5px">Astuce : clique plusieurs fois très vite sur la mascotte.</p></section>`;
        break;
      case 'apparence': {
        const t = store_local.get('kdc-theme', 'light');
        body.innerHTML = `<section class="section"><h3>Thème</h3><div class="seg" role="group" aria-label="Thème">${[['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Comme l’appareil']].map(o => `<button type="button" data-theme-set="${o[0]}" aria-pressed="${t === o[0]}">${o[1]}</button>`).join('')}</div></section>`;
        break;
      }
      case 'donnees':
        body.innerHTML = `<section class="section"><h3>Export</h3><p class="ink2">Toutes tes données dans un fichier JSON lisible : entreprise, clients, services, documents, paiements, catalogue, serveurs. Les clés privées et mots de passe ne sont jamais exportés.</p><div class="toolbar"><button class="btn btn-primary" type="button" data-set="export">${icon('download')}<span>Exporter (JSON)</span></button></div></section>
          ${LIVE ? '' : `<section class="section"><h3>Démonstration</h3><p class="ink2">Les modifications de la démo restent dans ce navigateur. Tu peux repartir des données d’exemple.</p><div class="toolbar"><button class="btn btn-danger" type="button" data-set="resetdemo">${icon('refresh')}<span>Réinitialiser la démo</span></button></div></section>`}`;
        break;
    }
  },
  onInput(e) {
    const k = e.target.dataset.k; if (!k) return;
    let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (['paymentTermsDays', 'quoteValidityDays', 'defaultVatRate'].includes(k)) v = C.num(v);
    const path = k.split('.');
    let o = this.form;
    for (let i = 0; i < path.length - 1; i++) { o[path[i]] = o[path[i]] || {}; o = o[path[i]]; }
    o[path[path.length - 1]] = v;
    this.markDirty();
    if (k === 'siret' && e.type === 'change') this.renderSection();
  },
  markDirty() { this.dirty = true; $('#saveBar').hidden = false; },
  loadLogo(file) {
    if (!file) return;
    if (file.size > 400 * 1024) { toast('Logo trop lourd : 400 Ko maximum.', { tone: 'warn' }); return; }
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => { this.form.logo = r.result; this.form.logoW = img.naturalWidth; this.form.logoH = img.naturalHeight; this.markDirty(); this.renderSection(); };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  },
  async loadSmtp() {
    try {
      const s = await API.get('/api/settings/smtp');
      $('#smtpBox').innerHTML = `<form class="form-grid" id="smtpForm" novalidate>
        <label class="field"><span>Serveur</span><input id="sm-host" value="${esc(s.host || '')}" placeholder="mail.kingdream.fr"></label>
        <label class="field"><span>Port</span><input id="sm-port" value="${esc(s.port || 465)}" inputmode="numeric"></label>
        <label class="field"><span>Utilisateur</span><input id="sm-user" value="${esc(s.user || '')}" autocomplete="off"></label>
        <label class="field"><span>Mot de passe</span><input id="sm-pass" type="password" placeholder="${s.hasPassword ? '•••••••• (enregistré)' : ''}" autocomplete="new-password"><small>Laisse vide pour garder l’actuel.</small></label>
        <label class="field span-2"><span>Expéditeur</span><input id="sm-from" value="${esc(s.from || '')}" placeholder="KingDream Digital <contact@kingdream.fr>"></label>
        <label class="check span-2"><input type="checkbox" id="sm-alerts"${s.alertEmails ? ' checked' : ''}><span>M’alerter par email quand un serveur passe au rouge<small>${SMTP_GATE_HINT}En plus de Kingo, pour ne rien rater loin du cockpit.</small></span></label>
        <label class="field span-2"><span>Adresse des alertes (facultatif)</span><input id="sm-alertto" type="email" value="${esc(s.alertTo || '')}" placeholder="Par défaut : l’email de l’entreprise"></label>
        <div class="toolbar span-2"><button class="btn btn-primary" type="button" data-set="smtpsave">Enregistrer le SMTP</button><button class="btn" type="button" data-set="smtptest">Envoyer un email de test</button></div></form>`;
    } catch (e) { $('#smtpBox').innerHTML = `<p class="field-error">${esc(e.message)}</p>`; }
  },
  async onClick(e) {
    const sec = e.target.closest('.settings-nav [data-sec]');
    if (sec) { e.preventDefault(); this.section = sec.dataset.sec; history.replaceState(null, '', '#reglages-' + this.section); this.renderSection(); return; }
    const vat = e.target.closest('[data-vat]');
    if (vat) { this.form.vatRegime = vat.dataset.vat; this.markDirty(); this.renderSection(); return; }
    const col = e.target.closest('[data-color]');
    if (col) { this.form.docColor = col.dataset.color; this.markDirty(); this.renderSection(); return; }
    const mood = e.target.closest('[data-mood]');
    if (mood && App.kingo) {
      const m = mood.dataset.mood;
      App.kingo.setMood(m, 3500);
      if (m === 'fier') { App.kingo.react('coin'); App.kingo.react('sparkle'); }
      else if (m === 'panique') App.kingo.react('shake');
      else if (m === 'scan') App.kingo.react('radar');
      else if (m === 'etourdi') App.kingo.react('stars');
      else App.kingo.react('hop');
      return;
    }
    const th = e.target.closest('[data-theme-set]');
    if (th) { store_local.set('kdc-theme', th.dataset.themeSet); applyTheme(th.dataset.themeSet); this.renderSection(); return; }
    const a = e.target.closest('[data-set]');
    if (!a) return;
    try {
      switch (a.dataset.set) {
        case 'save': await Store.saveCompany(this.form); this.form = JSON.parse(JSON.stringify(Store.company)); this.dirty = false; $('#saveBar').hidden = true; toast('Réglages enregistrés.'); App.placeKingo(); this.renderSection(); break;
        case 'reset': this.form = JSON.parse(JSON.stringify(Store.company)); this.dirty = false; $('#saveBar').hidden = true; this.renderSection(); break;
        case 'nologo': this.form.logo = null; this.markDirty(); this.renderSection(); break;
        case 'export': {
          if (!(await stepUpDemo('L’export contient toutes les données de tes clients.'))) return;
          const data = await Store.exportData();
          offerDownload('kingdream-control-export-' + Store.today + '.json', JSON.stringify(data, null, 2));
          if (!LIVE) Store.log('data.export', 'Export complet des données', 'JSON');
          break;
        }
        case 'resetdemo': { const ok = await confirmDialog({ title: 'Réinitialiser la démo ?', message: 'Tes essais seront effacés de ce navigateur.', confirmLabel: 'Réinitialiser', danger: true }); if (ok) Store.resetDemo(); break; }
        case 'smtpsave': {
          const g = k => $('#sm-' + k).value.trim();
          await API.put('/api/settings/smtp', { host: g('host'), port: parseInt(g('port'), 10) || 465, user: g('user'), password: $('#sm-pass').value, from: g('from'), alertEmails: $('#sm-alerts').checked, alertTo: g('alertto') });
          toast('SMTP enregistré.'); this.loadSmtp(); break;
        }
        case 'smtptest': { const r = await API.post('/api/settings/smtp/test'); toast(r.message || 'Email de test envoyé.'); break; }
        case 'seq': {
          const value = parseInt($('#seq-value').value, 10);
          if (!(value >= 0)) { toast('Indique le dernier numéro utilisé.', { tone: 'warn' }); return; }
          await API.put('/api/sequences', { kind: $('#seq-kind').value, year: parseInt($('#seq-year').value, 10), value });
          toast('Numérotation mise à jour : prochain numéro ' + (value + 1) + '.');
          break;
        }
      }
    } catch (err) { if (err.code !== 'cancelled') toast(err.message, { tone: 'crit' }); }
  },
};

/* ---- js/views/auth.js ---- */
/* ===== Authentification : mot de passe + 2FA (TOTP), enrôlement, verrouillage ===== */
const Auth = {
  kingo: null,
  shell(inner) {
    const root = document.getElementById('app');
    root.className = '';
    root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-top"><div id="authKingo"></div><div><h1>KingDream Control</h1><p>Accès réservé à l’administrateur.</p></div></div>${inner}<p class="auth-foot">${icon('lock')}Connexion chiffrée · double authentification obligatoire</p></div></div>`;
    if (!this.kingo) this.kingo = new Kingo();
    this.kingo.mount($('#authKingo'), 86);
    this.kingo.setBase('calme', 'ok');
  },
  render(sess, message) {
    applyTheme(store_local.get('kdc-theme', 'light'));
    if (sess && sess.stage === 'totp') return this.totp();
    if (sess && sess.stage === 'enroll') return this.enroll();
    this.shell(`<form id="loginForm" novalidate>
      ${message ? `<div class="note note-warn">${icon('info')}<span>${esc(message)}</span></div>` : ''}
      <label class="field"><span>Email</span><input id="lg-email" type="email" autocomplete="username" required autofocus></label>
      <label class="field"><span>Mot de passe</span><input id="lg-pass" type="password" autocomplete="current-password" required></label>
      <p class="field-error" id="lg-err" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Continuer</button></form>`);
    const pass = $('#lg-pass');
    pass.addEventListener('focus', () => this.kingo.setMood('dort', 60000));
    pass.addEventListener('blur', () => this.kingo.setMood('curieux', 1200));
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#lg-err'); err.hidden = true;
      const btn = e.target.querySelector('button'); btn.disabled = true;
      try {
        const r = await API.post('/api/auth/login', { email: $('#lg-email').value.trim(), password: pass.value });
        API.csrf = r.csrf || API.csrf;
        this.kingo.setMood('heureux', 1200); this.kingo.react('hop');
        if (r.stage === 'enroll') this.enroll(); else this.totp();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        this.kingo.setMood('inquiet', 2500); this.kingo.react('shake');
      } finally { btn.disabled = false; }
    });
  },
  totp() {
    this.shell(`<form id="totpForm" novalidate>
      <p class="ink2">Saisis le code à 6 chiffres affiché par ton application d’authentification.</p>
      <label class="field" id="codeWrap"><span>Code de vérification</span><input id="tp-code" class="otp-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" autofocus></label>
      <label class="field" id="recWrap" hidden><span>Code de secours</span><input id="tp-rec" autocomplete="off" placeholder="xxxxx-xxxxx"></label>
      <p class="field-error" id="tp-err" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Se connecter</button>
      <button class="link" type="button" id="useRec" style="align-self:center">Utiliser un code de secours</button></form>`);
    $('#useRec').addEventListener('click', () => { const r = $('#recWrap').hidden; $('#recWrap').hidden = !r; $('#codeWrap').hidden = r; $('#useRec').textContent = r ? 'Utiliser l’application' : 'Utiliser un code de secours'; });
    const code = $('#tp-code');
    code.addEventListener('input', () => { if (/^\d{6}$/.test(code.value)) $('#totpForm').requestSubmit(); });
    $('#totpForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#tp-err'); err.hidden = true;
      const useRec = !$('#recWrap').hidden;
      try {
        const r = await API.post('/api/auth/totp', useRec ? { recovery: $('#tp-rec').value.trim() } : { code: code.value.trim() });
        API.csrf = r.csrf || API.csrf;
        this.kingo.setMood('fier', 1500); this.kingo.react('sparkle');
        setTimeout(() => App.boot(), 450);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false; code.value = '';
        this.kingo.setMood('inquiet', 2500); this.kingo.react('shake');
        if (ex.code === 'restart') setTimeout(() => this.render(null, ex.message), 1200);
      }
    });
  },
  async enroll() {
    this.shell(`<div id="enrollBox"><p class="muted">Préparation de la double authentification…</p></div>`);
    let data;
    try { data = await API.get('/api/auth/enroll'); } catch (e) { $('#enrollBox').innerHTML = `<p class="field-error">${esc(e.message)}</p>`; return; }
    $('#enrollBox').innerHTML = `<form id="enrollForm" novalidate style="display:flex;flex-direction:column;gap:14px">
      <p class="ink2">Première connexion : active la double authentification. Scanne ce code avec Google Authenticator, Aegis, 1Password ou Bitwarden.</p>
      <img class="qr" src="${esc(data.qr)}" alt="QR code d’activation 2FA">
      <p class="secret"><span class="muted" style="display:block;font-family:var(--f-ui);font-size:12px">Clé à saisir si le scan ne fonctionne pas</span>${esc(data.secret)}</p>
      <label class="field"><span>Code affiché par l’application</span><input id="en-code" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus></label>
      <p class="field-error" id="en-err" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Activer la 2FA</button></form>`;
    $('#enrollForm').addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('#en-err'); err.hidden = true;
      try {
        const r = await API.post('/api/auth/enroll', { code: $('#en-code').value.trim() });
        API.csrf = r.csrf || API.csrf;
        this.kingo.setMood('fier', 2000); this.kingo.react('sparkle');
        $('#enrollBox').innerHTML = `<div style="display:flex;flex-direction:column;gap:14px"><p><strong>2FA activée.</strong> Voici tes codes de secours, à usage unique. Range-les hors ligne : ils ne seront plus affichés.</p><div class="codes">${r.recoveryCodes.map(c => `<span>${esc(c)}</span>`).join('')}</div>
          <div class="toolbar"><button class="btn" type="button" id="dlCodes">${icon('download')}<span>Télécharger</span></button><span class="grow"></span><button class="btn btn-primary" type="button" id="goApp">Ouvrir le cockpit</button></div></div>`;
        $('#dlCodes').addEventListener('click', () => offerDownload('codes-secours-kingdream.txt', 'KingDream Control — codes de secours\n\n' + r.recoveryCodes.join('\n') + '\n'));
        $('#goApp').addEventListener('click', () => App.boot());
      } catch (ex) { err.textContent = ex.message; err.hidden = false; this.kingo.setMood('inquiet', 2000); }
    });
  },
  renderError(e) {
    const root = document.getElementById('app');
    root.innerHTML = `<div class="auth"><div class="auth-card"><h1>KingDream Control</h1><p class="field-error">${esc(e.message || 'Serveur injoignable.')}</p><button class="btn" type="button" id="retryBoot">Réessayer</button></div></div>`;
    $('#retryBoot').addEventListener('click', () => location.reload());
  },

  /** Verrouille l’interface. En auto-hébergé : déconnexion réelle. En démo : écran de verrouillage simulé. */
  async lock(expired) {
    if (LIVE) {
      if (!expired) { try { await API.post('/api/auth/logout'); } catch (e) { /* déjà déconnecté */ } }
      if (Live.es) { Live.es.close(); Live.es = null; }
      closeAllLayers();
      if (App.kingo) { App.kingo.destroy(); App.kingo = null; }
      if (App.view && App.view.destroy) { try { App.view.destroy(); } catch (e) { /* */ } }
      App.view = null;
      Store.state = null;
      const s = await API.get('/api/session').catch(() => ({}));
      API.csrf = s.csrf;
      this.render(null, expired ? 'Ta session a expiré. Reconnecte-toi.' : 'Session verrouillée.');
      return;
    }
    closeAllLayers();
    const layer = document.createElement('div');
    layer.className = 'lock-layer';
    layer.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-top"><div id="lockKingo"></div><div><h1>Session verrouillée</h1><p>Mot de passe et code 2FA requis.</p></div></div>
      <form id="unlockForm" novalidate>
        <label class="field"><span>Mot de passe</span><input id="ul-pass" type="password" autocomplete="current-password"></label>
        <label class="field"><span>Code de vérification</span><input id="ul-code" class="otp-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label>
        <p class="muted" style="font-size:12.5px">Démo : n’importe quel mot de passe et n’importe quel code à 6 chiffres.</p>
        <p class="field-error" id="ul-err" hidden></p>
        <button class="btn btn-primary btn-lg" type="submit">Déverrouiller</button></form>
      <p class="auth-foot">${icon('lock')}Connexion chiffrée · double authentification obligatoire</p></div></div>`;
    document.body.appendChild(layer);
    const k = new Kingo(); k.mount($('#lockKingo', layer), 86); k.setBase('dort', 'sleep');
    $('#ul-pass', layer).focus();
    $('#unlockForm', layer).addEventListener('submit', e => {
      e.preventDefault();
      const pass = $('#ul-pass', layer).value, code = $('#ul-code', layer).value.trim();
      const err = $('#ul-err', layer);
      if (!pass || !/^\d{6}$/.test(code)) { err.textContent = 'Saisis un mot de passe et un code à 6 chiffres.'; err.hidden = false; k.setMood('inquiet', 1800); k.react('shake'); return; }
      k.setMood('heureux', 1000); k.react('hop');
      Store.log('auth.login', 'Connexion réussie (mot de passe + code 2FA)');
      setTimeout(() => { k.destroy(); layer.remove(); if (App.kingo) App.kingo.setMood('salut', 2000); }, 500);
    });
  },
};

/* ---- js/views/assist.js ---- */
/* ===== Assistant Kingo : diagnostic d'un serveur, explications, réparations en un clic ===== */
const ASSIST_TOPICS = [['disk', 'Stockage', 'disk'], ['cpu', 'Processeur', 'cpu'], ['ram', 'Mémoire', 'ram'], ['site', 'Sites', 'globe'], ['unreachable', 'Connexion', 'signal']];

Views.assist = {
  /** Sujet le plus urgent pour ce serveur. */
  topicFor(s) {
    const m = s.metrics || {};
    if (m.reachable === false) return 'unreachable';
    if (C.serverSites(s).some(x => C.siteState(m, x).state === 'crit')) return 'site';
    if (m.disk >= 85) return 'disk';
    if (m.ram >= 90) return 'ram';
    if (m.cpu >= 85) return 'cpu';
    return 'disk';
  },

  open(serverId, topic) {
    const s = Store.server(serverId);
    if (!s) { toast('Ce serveur n’existe plus.', { tone: 'warn' }); return; }
    if (this.dlg) this.dlg.close();
    this.st = { id: serverId, topic: topic || this.topicFor(s), diag: null, done: {}, busy: false, freedTotal: 0 };
    const d = dialog({
      title: 'Kingo s’occupe de ' + s.name, wide: true, className: 'assist-dialog',
      subtitle: Store.clientName(s.clientId) + (C.isSharedServer(s) ? ' · serveur partagé' : '') + ' · ' + s.host,
      body: `<div class="assist">
        <div class="assist-head"><div class="assist-kingo" id="asKingo"></div><div class="assist-say" id="asSay" aria-live="polite"></div></div>
        <div class="seg assist-topics" role="group" aria-label="Sujet du diagnostic" id="asTopics">${ASSIST_TOPICS.map(t => `<button type="button" data-topic="${t[0]}" aria-pressed="false">${icon(t[2])}${t[1]}</button>`).join('')}</div>
        <div id="asBody" class="assist-body"></div>
      </div>`,
      actions: [{ label: 'Fermer' }, { label: 'Relancer le diagnostic', icon: 'refresh', tone: 'primary', run: () => { this.diagnose(); return false; } }],
      onOpen: (wrap) => {
        this.kg = new Kingo();
        this.kg.mount($('#asKingo', wrap), 76);
        wrap.addEventListener('click', e => this.onClick(e));
      },
      onClose: () => { if (this.kg) { this.kg.destroy(); this.kg = null; } this.dlg = null; this.st = null; },
    });
    this.dlg = d;
    this.diagnose();
  },

  say(text, mood, fx) {
    const el = this.dlg && $('#asSay', this.dlg.el); if (!el) return;
    el.innerHTML = text;
    if (this.kg && mood) { this.kg.setBase(mood); this.kg.setMood(mood, 2600); if (fx) this.kg.react(fx); }
  },

  async diagnose() {
    if (!this.st || this.st.busy) return;
    const st = this.st, s = Store.server(st.id);
    $$('#asTopics [data-topic]', this.dlg.el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.topic === st.topic)));
    const body = $('#asBody', this.dlg.el);
    body.innerHTML = `<div class="assist-wait">${icon('refresh', 'spin')}<span>${esc({ disk: 'Je mesure ce qui remplit le disque…', cpu: 'Je regarde qui fait chauffer le processeur…', ram: 'Je regarde qui occupe la mémoire…', site: 'Je vérifie les sites et les journaux du serveur web…', unreachable: 'Je teste la connexion au serveur…' }[st.topic])}</span></div>`;
    this.say('Une seconde, je regarde sur ' + esc(s.name) + '…', 'scan', 'radar');
    st.busy = true;
    try {
      st.diag = await Store.assistDiagnose(st.id, st.topic);
      if (!this.st) return;
      if (st.diag.topic !== st.topic) { st.topic = st.diag.topic; $$('#asTopics [data-topic]', this.dlg.el).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.topic === st.topic))); }
      this.render();
    } catch (e) {
      if (!this.st) return;
      body.innerHTML = `<div class="note note-crit">${icon('alert')}<span>${esc(e.message)}</span></div>`;
      this.say('Je n’ai pas pu faire le diagnostic.', 'inquiet');
    } finally { if (this.st) this.st.busy = false; }
  },

  /* ---------- rendu ---------- */
  render() {
    const st = this.st, d = st.diag, s = Store.server(st.id);
    const body = $('#asBody', this.dlg.el);
    const parts = [];
    if (d.sshError) parts.push(`<div class="note note-crit">${icon('alert')}<span>Connexion SSH impossible : ${esc(d.sshError)}</span></div>`);
    if (d.topic === 'disk') parts.push(this.diskHTML(s, d));
    else if (d.topic === 'cpu' || d.topic === 'ram') parts.push(this.procsHTML(s, d, d.topic));
    else if (d.topic === 'site') parts.push(this.siteHTML(s, d));
    else parts.push(this.reachHTML(s, d));
    if (d.actions && d.actions.length) parts.push(this.actionsHTML(d));
    if (d.helper && d.helper !== 'ok') parts.push(this.installHTML(d));
    body.innerHTML = parts.join('');
    this.say(this.summary(s, d), this.moodFor(s, d));
  },

  moodFor(s, d) {
    if (d.topic === 'unreachable') return d.ports && d.ports.some(p => p.open) ? 'reflechit' : 'inquiet';
    if (d.topic === 'disk') return d.disk.pct >= 95 ? 'panique' : d.disk.pct >= 85 ? 'inquiet' : 'heureux';
    return Store.serverStatus(s) === 'ok' ? 'heureux' : 'concentre';
  },

  owners(s) {
    const t = C.ownerTotals(s);
    return t.owners.filter(o => o.hasSize).sort((a, b) => b.bytes - a.bytes);
  },

  summary(s, d) {
    const gain = (d.actions || []).filter(a => a.gain).reduce((t, a) => t + a.gain, 0);
    if (d.topic === 'disk') {
      const free = d.disk.total - d.disk.used;
      const owners = this.owners(s);
      let txt = `Le disque est rempli à <strong>${fmt.pct(d.disk.pct)}</strong> (${esc(fmt.bytes(free))} libres).`;
      if (owners.length) txt += ' ' + owners.slice(0, 3).map(o => `${esc(Store.clientName(o.clientId))} occupe ${esc(fmt.bytes(o.bytes))}`).join(', ') + '.';
      if (gain > 0 && d.helper === 'ok') txt += ` Je peux récupérer environ <strong>${esc(fmt.bytes(gain))}</strong> sans toucher aux sites : regarde ci-dessous.`;
      else if (d.helper !== 'ok') txt += ' Installe mon assistant sur ce serveur et je ferai le ménage pour toi.';
      else if (d.disk.pct >= 85) txt += ' Rien de sûr à supprimer de mon côté : il faudra agrandir le disque ou faire du tri dans les dossiers.';
      return txt;
    }
    if (d.topic === 'cpu' || d.topic === 'ram') {
      const list = d.topic === 'cpu' ? d.procsCpu : d.procsRam;
      const p = list && list[0];
      if (!p) return 'Aucun processus lisible.';
      const site = p.siteId && C.serverSites(s).find(x => x.id === p.siteId);
      const who = site ? ` (${esc(site.name)}, ${esc(Store.clientName(site.clientId))})` : '';
      return d.topic === 'cpu'
        ? `Le plus gourmand en ce moment : <strong>${esc(this.short(p.cmd))}</strong>${who}, ${fmt.pct(p.cpu)} du processeur.` + (p.cpu >= 40 ? ' S’il reste bloqué, redémarre son service ci-dessous.' : ' Rien d’anormal.')
        : `Le plus gros en mémoire : <strong>${esc(this.short(p.cmd))}</strong>${who}, ${esc(fmt.bytes(p.ram))}.`;
    }
    if (d.topic === 'site') {
      const bad = C.serverSites(s).filter(x => C.siteState(s.metrics, x).state === 'crit');
      return bad.length ? `${bad.map(x => esc(x.name)).join(', ')} ne répond pas correctement. J’ai lu les dernières erreurs du serveur web ; souvent, redémarrer PHP ou le serveur web suffit.` : 'Tous les sites répondent. J’ai quand même lu les dernières erreurs du serveur web.';
    }
    const open = (d.ports || []).filter(p => p.open).map(p => p.port);
    if (d.dns === false) return 'Le nom d’hôte ne se résout plus : vérifie la zone DNS chez ton registrar.';
    if (!open.length) return `Aucune réponse de ${esc(d.host)} : la machine est probablement arrêtée ou bloquée. Passe par la console de secours de l’hébergeur.`;
    if (!open.includes(s.port || 22)) return `Le serveur répond sur le web (port ${open.join(', ')}) mais pas en SSH : le service SSH ou le pare-feu bloque.`;
    return 'Le port SSH répond : le problème vient sans doute de la clé ou de l’utilisateur. Relance un test de connexion.';
  },
  short(cmd) { const c = String(cmd || ''); return c.length > 60 ? c.slice(0, 58) + '…' : c; },

  diskHTML(s, d) {
    const total = d.disk.total || 1;
    const owners = this.owners(s);
    const sysBytes = Math.max(0, d.disk.used - owners.reduce((t, o) => t + o.bytes, 0));
    const seg = (bytes, cls, label) => bytes > 0 ? `<span class="${cls}" style="width:${Math.max(0.8, 100 * bytes / total).toFixed(2)}%" title="${esc(label + ' : ' + fmt.bytes(bytes))}"></span>` : '';
    const sp = d.space || {};
    const cleanable = [['journal', 'Journal système'], ['oldlogs', 'Anciens journaux archivés'], ['apt', 'Cache des paquets'], ['docker', 'Docker inutilisé'], ['tmp', 'Fichiers temporaires']].filter(([k]) => sp[k]);
    return `<section class="assist-sec"><h3>Ce qui occupe le disque</h3>
      <div class="disk-bar" role="img" aria-label="${esc('Disque rempli à ' + fmt.pct(d.disk.pct))}">${owners.map((o, i) => seg(o.bytes, 'seg seg-' + (i % 4), Store.clientName(o.clientId))).join('')}${seg(sysBytes, 'seg seg-sys', 'Système et autres')}</div>
      <ul class="disk-legend">${owners.map((o, i) => `<li><span class="sw seg-${i % 4}"></span>${esc(Store.clientName(o.clientId))}<strong>${esc(fmt.bytes(o.bytes))}</strong></li>`).join('')}<li><span class="sw seg-sys"></span>Système et autres<strong>${esc(fmt.bytes(sysBytes))}</strong></li><li><span class="sw seg-free"></span>Libre<strong>${esc(fmt.bytes(total - d.disk.used))}</strong></li></ul>
      ${cleanable.length ? `<p class="muted assist-note">Récupérable sans risque : ${cleanable.map(([k, l]) => esc(l) + ' ' + esc(fmt.bytes(sp[k]))).join(' · ')}.</p>` : ''}
      ${d.top && d.top.length ? `<details class="assist-more"><summary>Les plus gros dossiers</summary><ul class="top-dirs">${d.top.slice(0, 10).map(t => `<li><span class="mono">${esc(t.path)}</span><strong>${esc(fmt.bytes(t.bytes))}</strong></li>`).join('')}</ul></details>` : ''}
    </section>`;
  },

  procsHTML(s, d, topic) {
    const list = (topic === 'cpu' ? d.procsCpu : d.procsRam) || [];
    const sites = C.serverSites(s);
    return `<section class="assist-sec"><h3>${topic === 'cpu' ? 'Qui utilise le processeur' : 'Qui utilise la mémoire'}</h3>
      <div class="table-scroll"><table class="table"><thead><tr><th>Processus</th><th>Appartient à</th><th class="num">CPU</th><th class="num">RAM</th></tr></thead><tbody>
      ${list.map(p => { const x = p.siteId && sites.find(y => y.id === p.siteId); return `<tr><td><div class="cell-main"><strong class="mono">${esc(this.short(p.cmd))}</strong><span>${esc(p.user)} · PID ${esc(p.pid)}</span></div></td><td>${x ? esc(x.name) + ' <span class="muted">· ' + esc(Store.clientName(x.clientId)) + '</span>' : '<span class="muted">Système</span>'}</td><td class="num">${esc(fmt.pct(p.cpu))}</td><td class="num">${esc(fmt.bytes(p.ram))}</td></tr>`; }).join('')}
      </tbody></table></div></section>`;
  },

  siteHTML(s, d) {
    const sites = C.serverSites(s).filter(x => x.url);
    return `<section class="assist-sec"><h3>État des sites</h3>
      <ul class="assist-list">${sites.map(x => { const r = C.siteState(s.metrics, x); return `<li>${serverDot(r.state)}<span><strong>${esc(x.name)}</strong> <span class="muted">${esc(Store.clientName(x.clientId))}</span></span><em>${r.state === 'crit' ? (r.status ? 'HTTP ' + r.status : esc(r.error || 'pas de réponse')) : r.ms ? r.ms + ' ms' : '—'}</em></li>`; }).join('') || '<li class="muted">Aucune adresse surveillée sur ce serveur.</li>'}</ul>
      ${d.weblog && d.weblog.length ? `<details class="assist-more" open><summary>Dernières erreurs du serveur web</summary><pre class="assist-log">${esc(d.weblog.join('\n'))}</pre></details>` : ''}</section>`;
  },

  reachHTML(s, d) {
    return `<section class="assist-sec"><h3>Test de connexion depuis le cockpit</h3>
      <ul class="assist-list">${d.dns === false ? `<li>${serverDot('crit')}<span>Nom d’hôte</span><em>introuvable</em></li>` : ''}${(d.ports || []).map(p => `<li>${serverDot(p.open ? 'ok' : 'crit')}<span>Port ${esc(p.port)} ${p.port === (s.port || 22) ? '(SSH)' : p.port === 80 ? '(web)' : p.port === 443 ? '(web sécurisé)' : ''}</span><em>${p.open ? 'répond' + (p.ms ? ' en ' + p.ms + ' ms' : '') : esc(p.error || 'fermé')}</em></li>`).join('')}</ul>
      <ol class="assist-steps"><li>Ouvre l’espace client de ${esc(s.provider || 'l’hébergeur')} et regarde l’état de la machine (arrêtée, en maintenance, quota dépassé).</li><li>Utilise la console de secours (KVM / VNC) pour voir l’écran du serveur ; redémarre-le si besoin.</li><li>Une fois relancé, reviens ici : je relance la supervision.</li></ol>
      <div class="toolbar"><button class="btn btn-soft" type="button" data-as="test">${icon('refresh')}<span>Tester la connexion maintenant</span></button></div></section>`;
  },

  actionsHTML(d) {
    const st = this.st;
    const avail = d.actions.filter(a => a.available);
    const total = avail.filter(a => a.gain && !st.done[this.key(a)]).reduce((t, a) => t + a.gain, 0);
    return `<section class="assist-sec"><h3>${d.topic === 'disk' ? 'Ce que je peux faire' : 'Réparations possibles'}</h3>
      <ul class="fix-list">${d.actions.map(a => { const k = this.key(a), done = st.done[k]; return `<li class="fix${done ? ' fix-done' : ''}" data-key="${esc(k)}">
        <span class="fix-ico">${done ? icon(done.ok ? 'check' : 'alert') : icon(a.id === 'restart' ? 'repeat' : 'trash')}</span>
        <div class="fix-text"><strong>${esc(a.label)}</strong><span>${done ? esc(done.msg) : a.gain ? 'Libère environ ' + esc(fmt.bytes(a.gain)) : a.failed ? 'Ce service est en échec.' : 'Coupure de quelques secondes.'}</span></div>
        ${done ? '' : `<button class="btn btn-sm ${a.failed ? 'btn-primary' : 'btn-soft'}" type="button" data-as="run" data-action="${esc(a.id)}" data-arg="${esc(a.arg || '')}"${a.available ? '' : ' disabled title="Installe d’abord l’assistant sur ce serveur"'}>${a.id === 'restart' ? 'Redémarrer' : 'Nettoyer'}</button>`}
      </li>`; }).join('')}</ul>
      ${d.topic === 'disk' && avail.length > 1 && total > 0 ? `<div class="toolbar"><button class="btn btn-primary" type="button" data-as="all">${icon('sparkle')}<span>Tout nettoyer (≈ ${esc(fmt.bytes(total))})</span></button><span class="muted" style="font-size:12.5px">Tes fichiers et ceux des clients ne sont jamais touchés.</span></div>` : ''}
    </section>`;
  },
  key(a) { return a.id + ':' + (a.arg || ''); },

  installHTML(d) {
    return `<section class="assist-sec"><div class="note note-warn">${icon('key')}<span>${d.helper === 'nosudo' ? 'Mon assistant est présent mais l’autorisation sudo manque.' : 'Pour agir à ta place, installe une fois mon assistant sur ce serveur.'} C’est un petit script qui n’accepte que les actions ci-dessus (nettoyages, redémarrage d’un service) ; rien d’autre ne peut être exécuté.</span></div>
      <div class="field"><span class="field-label">À coller une fois sur le serveur (avec ton accès administrateur)</span><div class="codebox" id="asInstall">${esc(d.installCommand || '')}<button class="icon-btn icon-btn-sm copy" type="button" data-as="copy" aria-label="Copier la commande">${icon('copy')}</button></div></div>
      <div class="toolbar"><button class="btn btn-soft" type="button" data-as="rediag">${icon('refresh')}<span>C’est installé, relancer</span></button></div></section>`;
  },

  /* ---------- actions ---------- */
  async onClick(e) {
    const t = e.target.closest('[data-topic]');
    if (t && this.st && !this.st.busy) { this.st.topic = t.dataset.topic; this.st.done = {}; this.diagnose(); return; }
    const b = e.target.closest('[data-as]'); if (!b || !this.st) return;
    switch (b.dataset.as) {
      case 'run': await this.run(b.dataset.action, b.dataset.arg || null); break;
      case 'all': {
        const list = this.st.diag.actions.filter(a => a.available && a.gain && !this.st.done[this.key(a)]);
        for (const a of list) { if (!this.st) return; const ok = await this.run(a.id, a.arg || null, true); if (ok === 'cancelled') return; }
        if (this.st) this.finish();
        break;
      }
      case 'copy': { const el = $('#asInstall', this.dlg.el); copyText(el.firstChild.textContent, el); break; }
      case 'rediag': this.diagnose(); break;
      case 'test': { await Views.servers.test(this.st.id); if (this.st) { const s = Store.server(this.st.id); if (s.metrics && s.metrics.reachable !== false) { this.st.topic = this.topicFor(s); } this.diagnose(); } break; }
    }
  },

  async run(action, arg, batch) {
    const st = this.st; if (!st || st.busy) return;
    const a = st.diag.actions.find(x => x.id === action && (x.arg || null) === (arg || null)); if (!a) return;
    const k = this.key(a);
    const li = $(`.fix[data-key="${CSS.escape(k)}"]`, this.dlg.el);
    if (li) { const btn = li.querySelector('button'); if (btn) { btn.disabled = true; btn.innerHTML = icon('refresh', 'spin'); } }
    this.say(action === 'restart' ? 'Je redémarre ' + esc(arg.replace(/\.service$/, '')) + '…' : 'Je m’en occupe : ' + esc(a.label.toLowerCase()) + '…', 'concentre');
    st.busy = true;
    try {
      const r = await Store.assistRun(st.id, action, arg);
      if (!this.st) return;
      st.freedTotal += r.freed || 0;
      st.done[k] = { ok: r.ok, msg: r.ok ? (r.freed ? 'Fait : ' + fmt.bytes(r.freed) + ' libérés.' : action === 'restart' ? 'Redémarré, le service tourne.' : 'Fait.') + ' ' : 'Échec : ' + (r.helper !== 'ok' ? 'assistant absent ou sudo refusé.' : (r.output || 'code ' + r.rc).slice(0, 140)) };
      if (r.after && st.diag.disk) { st.diag.disk.used = r.after.used; st.diag.disk.pct = r.after.pct; }
      const spaceKey = { 'clean-journal': 'journal', 'clean-apt': 'apt', 'clean-logs': 'oldlogs', 'clean-tmp': 'tmp', 'docker-prune': 'docker' }[action];
      if (r.ok && spaceKey && st.diag.space) st.diag.space[spaceKey] = 0;
      this.render();
      if (!batch) this.finish(r);
      return r.ok;
    } catch (e) {
      if (!this.st) return;
      if (e.code === 'cancelled') { this.render(); this.say('D’accord, je ne touche à rien.', 'calme'); return 'cancelled'; }
      st.done[k] = { ok: false, msg: 'Échec : ' + e.message };
      this.render();
      this.say('Ça n’a pas marché : ' + esc(e.message), 'inquiet');
      return false;
    } finally { if (this.st) this.st.busy = false; }
  },

  finish() {
    const st = this.st, d = st.diag, s = Store.server(st.id);
    const fails = Object.values(st.done).filter(x => !x.ok).length;
    if (d.topic === 'disk' && st.freedTotal > 0) {
      this.say(`C’est fait : <strong>${esc(fmt.bytes(st.freedTotal))}</strong> libérés, le disque est maintenant à <strong>${esc(fmt.pct(d.disk.pct))}</strong>.` + (d.disk.pct >= 85 ? ' C’est encore haut : pense à agrandir le disque ou à trier les dossiers les plus gros.' : ' On est tranquilles.'), d.disk.pct >= 85 ? 'reflechit' : 'fier', 'sparkle');
    } else if (!fails) this.say('C’est fait. Je garde un œil sur ' + esc(s.name) + '.', 'fier', 'sparkle');
    else this.say('Certaines actions ont échoué : regarde le détail ci-dessous.', 'inquiet');
    if (App.kingo && !fails) App.kingo.react('sparkle');
  },
};

/* ---- js/boot.js ---- */
/* ===== Démarrage (dernier fichier du paquet) ===== */
let _kdcStarted = false;
function startOnce() { if (_kdcStarted) return; _kdcStarted = true; App.start(); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startOnce); else startOnce();

})();
