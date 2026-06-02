/**
 * Afya (عافية) — serveur Express.
 * Plateforme algérienne : prise de RDV médicaux, disponibilité des médicaments
 * et horaires/garde des pharmacies. Bilingue FR/AR (RTL).
 */
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const db = require('./db');
const h = require('./helpers');

// Auto-bootstrap : si la DB vient d'être créée (premier déploiement),
// on lance le seed une seule fois avant le reste du serveur.
if (db.dbIsNew) {
  console.log('→ Base de données vide détectée, initialisation des données réelles…');
  require('./init-bdd.js');
}

// --- Tables additionnelles (avis, notifications, abonnements) --------------
// Créées au démarrage si absentes — pas besoin de relancer init-bdd.
db.exec(`
  CREATE TABLE IF NOT EXISTS avis (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id),
    medecin_id      INTEGER NOT NULL REFERENCES medecins(id),
    rdv_id          INTEGER REFERENCES rendezvous(id),
    note            INTEGER NOT NULL CHECK(note BETWEEN 1 AND 5),
    commentaire     TEXT,
    cree_le         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_avis_medecin ON avis(medecin_id);
  CREATE INDEX IF NOT EXISTS idx_avis_user ON avis(utilisateur_id);

  CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id),
    type            TEXT NOT NULL,
    titre           TEXT NOT NULL,
    message         TEXT,
    url             TEXT,
    lue             INTEGER NOT NULL DEFAULT 0,
    cree_le         TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(utilisateur_id, lue);

  CREATE TABLE IF NOT EXISTS abonnements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id  INTEGER NOT NULL REFERENCES utilisateurs(id),
    plan            TEXT NOT NULL,
    cible_type      TEXT NOT NULL,
    statut          TEXT NOT NULL DEFAULT 'actif',
    debut_le        TEXT NOT NULL DEFAULT (datetime('now')),
    fin_le          TEXT
  );
`);

const app = express();
const PORT = process.env.PORT || 3000;
// Render (et autres PaaS) place l'app derrière un reverse proxy.
// Indispensable pour que `secure: true` sur le cookie marche en HTTPS.
app.set('trust proxy', 1);

// --- Vues / statique --------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'afya-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
    proxy: true,
  })
);

// --- i18n -------------------------------------------------------------------
const locales = {
  fr: require('./locales/fr.json'),
  ar: require('./locales/ar.json'),
};
app.use((req, res, next) => {
  const lang = req.session.lang === 'ar' ? 'ar' : 'fr';
  const dict = locales[lang];
  res.locals.lang = lang;
  res.locals.dir = lang === 'ar' ? 'rtl' : 'ltr';
  res.locals.theme = req.session.theme === 'dark' ? 'dark' : 'light';
  res.locals.t = (key, vars) => {
    let v = dict[key] !== undefined ? dict[key] : locales.fr[key] !== undefined ? locales.fr[key] : key;
    if (typeof v === 'string' && vars) {
      for (const k in vars) v = v.split(`{${k}}`).join(vars[k]);
    }
    return v;
  };
  res.locals.daysShort = dict.days_short || locales.fr.days_short;
  res.locals.L = (frVal, arVal) => (lang === 'ar' ? arVal : frVal);
  res.locals.user = req.session.user || null;
  res.locals.path = req.path;
  res.locals.query = req.query;
  // Compteur de notifications non lues pour la cloche du header
  if (req.session.user) {
    try {
      res.locals.nbNotifs = db
        .prepare('SELECT COUNT(*) AS n FROM notifications WHERE utilisateur_id = ? AND lue = 0')
        .get(req.session.user.id).n;
    } catch (_) { res.locals.nbNotifs = 0; }
  } else {
    res.locals.nbNotifs = 0;
  }
  next();
});

// --- Helpers de données -----------------------------------------------------
const getSpecialites = () => db.prepare('SELECT * FROM specialites ORDER BY nom_fr').all();
const getWilayas = () =>
  db.prepare('SELECT code, nom_fr, nom_ar FROM wilayas ORDER BY code').all();

/**
 * Cache TTL (5 min) :
 *  • disponibilités agrégées : Map<medicament_id → nb_pharmacies_avec_dispo>
 *  • médicaments populaires (toutes + sans ordo) — préformaté pour la vue
 *
 * Évite la sous-requête GROUP BY sur 358 500 lignes à chaque page.
 */
const popularMedsCache = (() => {
  const TTL = 5 * 60_000;
  let dispoMap = null;
  let popAll = null;
  let popOtc = null;
  let at = 0;
  function refresh() {
    const counts = db
      .prepare('SELECT medicament_id, COUNT(*) AS n FROM stock_pharmacie WHERE disponible = 1 GROUP BY medicament_id')
      .all();
    dispoMap = new Map(counts.map((r) => [r.medicament_id, r.n]));
    // Récupère les ids top, puis va chercher les détails
    const topIds = counts.slice().sort((a, b) => b.n - a.n).slice(0, 60).map((r) => r.medicament_id);
    if (topIds.length) {
      const placeholders = topIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT id, nom_fr, nom_ar, dci, forme, dosage, sur_ordonnance, laboratoire
           FROM medicaments WHERE id IN (${placeholders})`
        )
        .all(...topIds);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered = topIds.map((id) => byId.get(id)).filter(Boolean).map((m) => ({ ...m, nb_dispo: dispoMap.get(m.id) || 0 }));
      popAll = ordered.slice(0, 8);
      popOtc = ordered.filter((r) => !r.sur_ordonnance).slice(0, 6);
    } else {
      popAll = []; popOtc = [];
    }
    at = Date.now();
  }
  function ensure() { if (!dispoMap || Date.now() - at > TTL) refresh(); }
  return {
    getDispo(id) { ensure(); return dispoMap.get(id) || 0; },
    getAll() { ensure(); return popAll; },
    getOtc() { ensure(); return popOtc; },
  };
})();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/connexion?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireMedecin(req, res, next) {
  const u = req.session.user;
  if (!u) return res.redirect('/connexion?next=' + encodeURIComponent(req.originalUrl));
  if (u.role !== 'medecin' || !u.medecin_id) return res.status(403).render('404');
  next();
}

function requirePharmacien(req, res, next) {
  const u = req.session.user;
  if (!u) return res.redirect('/connexion?next=' + encodeURIComponent(req.originalUrl));
  if (u.role !== 'pharmacien' || !u.pharmacie_id) return res.status(403).render('404');
  next();
}

/** Reconstruit un JSON d'horaires hebdo depuis les champs day_X_m_start/end + day_X_a_start/end. */
function horairesDepuisForm(body) {
  const out = {};
  for (let d = 0; d < 7; d++) {
    const segs = [];
    const ms = (body[`day_${d}_m_start`] || '').trim();
    const me = (body[`day_${d}_m_end`] || '').trim();
    const as = (body[`day_${d}_a_start`] || '').trim();
    const ae = (body[`day_${d}_a_end`] || '').trim();
    if (ms && me) segs.push([ms, me]);
    if (as && ae) segs.push([as, ae]);
    out[d] = segs;
  }
  return JSON.stringify(out);
}

/** Découpe les horaires en {matin:[s,e], aprem:[s,e]} pour pré-remplir le form. */
function horairesPourForm(horairesJson) {
  const h = typeof horairesJson === 'string' ? JSON.parse(horairesJson) : horairesJson;
  const out = {};
  for (let d = 0; d < 7; d++) {
    const segs = h[d] || h[String(d)] || [];
    out[d] = {
      m_start: segs[0]?.[0] || '',
      m_end: segs[0]?.[1] || '',
      a_start: segs[1]?.[0] || '',
      a_end: segs[1]?.[1] || '',
    };
  }
  return out;
}

// --- Changement de langue ---------------------------------------------------
app.get('/langue/:lang', (req, res) => {
  if (['fr', 'ar'].includes(req.params.lang)) req.session.lang = req.params.lang;
  res.redirect(req.get('referer') || '/');
});

// --- Changement de thème (clair/sombre) -------------------------------------
app.get('/theme/:mode', (req, res) => {
  req.session.theme = req.params.mode === 'dark' ? 'dark' : 'light';
  res.redirect(req.get('referer') || '/');
});

// --- Helper : créer une notification ---------------------------------------
function pushNotif(userId, type, titre, message, url) {
  try {
    db.prepare(
      'INSERT INTO notifications (utilisateur_id, type, titre, message, url) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, type, titre, message || '', url || '');
  } catch (e) { /* silencieux */ }
}

// --- API : suggestions de recherche (autocomplete) --------------------------
app.get('/api/suggest', (req, res) => {
  const q = String(req.query.q || '').trim();
  const kind = String(req.query.kind || 'med');
  if (q.length < 2) return res.json({ items: [] });
  const like = `%${q}%`;
  let items = [];
  if (kind === 'med') {
    items = db
      .prepare(
        `SELECT id, nom_fr, nom_ar, dci, forme, sur_ordonnance
         FROM medicaments
         WHERE nom_fr LIKE ? OR nom_ar LIKE ? OR dci LIKE ?
         ORDER BY nom_fr LIMIT 8`
      )
      .all(like, like, like)
      .map((m) => ({
        id: m.id,
        title: m.nom_fr,
        subtitle: `${m.dci} · ${m.forme}${m.sur_ordonnance ? ' · ℞' : ''}`,
        url: `/medicaments/${m.id}`,
        icon: '💊',
      }));
  } else if (kind === 'pharma') {
    items = db
      .prepare(
        `SELECT id, nom, ville, wilaya, de_garde
         FROM pharmacies
         WHERE nom LIKE ? OR ville LIKE ? OR wilaya LIKE ?
         ORDER BY de_garde DESC, nom LIMIT 8`
      )
      .all(like, like, like)
      .map((p) => ({
        id: p.id,
        title: p.nom,
        subtitle: `${p.ville}, ${p.wilaya}${p.de_garde ? ' · 🌙' : ''}`,
        url: `/pharmacies/${p.id}`,
        icon: '🏥',
      }));
  } else if (kind === 'doctor') {
    items = db
      .prepare(
        `SELECT m.id, m.prenom, m.nom, m.ville, m.wilaya, s.nom_fr AS spec, s.icone
         FROM medecins m JOIN specialites s ON s.id = m.specialite_id
         WHERE m.nom LIKE ? OR m.prenom LIKE ? OR m.ville LIKE ?
         ORDER BY m.note DESC LIMIT 8`
      )
      .all(like, like, like)
      .map((m) => ({
        id: m.id,
        title: `Dr ${m.prenom} ${m.nom}`,
        subtitle: `${m.spec} · ${m.ville}, ${m.wilaya}`,
        url: `/medecins/${m.id}`,
        icon: m.icone || '🩺',
      }));
  }
  res.json({ items });
});

// --- Carte interactive des pharmacies --------------------------------------
app.get('/carte', (req, res) => {
  // Sous la carte : pharmacies de garde ouvertes maintenant pour ne jamais laisser de vide
  const populaires = db
    .prepare('SELECT * FROM pharmacies WHERE de_garde = 1 ORDER BY RANDOM() LIMIT 16')
    .all()
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }))
    .filter((p) => p.ouvert)
    .slice(0, 8);
  res.render('carte', {
    wilayas: getWilayas(),
    initialWilaya: String(req.query.wilaya || ''),
    populaires,
  });
});

// GeoJSON FeatureCollection des pharmacies (pour la carte Leaflet)
app.get('/api/pharmacies/geojson', (req, res) => {
  const { wilaya = '', garde = '' } = req.query;
  const cond = ['lat IS NOT NULL', 'lng IS NOT NULL'];
  const params = [];
  if (wilaya) { cond.push('wilaya = ?'); params.push(String(wilaya)); }
  if (garde) cond.push('de_garde = 1');
  const rows = db
    .prepare(`SELECT id, nom, wilaya, ville, adresse, telephone, de_garde, horaires, lat, lng FROM pharmacies WHERE ${cond.join(' AND ')}`)
    .all(...params);
  const features = rows.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: {
      id: p.id,
      nom: p.nom,
      wilaya: p.wilaya,
      ville: p.ville,
      adresse: p.adresse,
      telephone: p.telephone,
      de_garde: p.de_garde,
      ouvert: h.ouverteMaintenant(p.horaires),
    },
  }));
  res.json({ type: 'FeatureCollection', features });
});

// --- Accueil ----------------------------------------------------------------
app.get('/', (req, res) => {
  const specialites = getSpecialites();
  const wilayas = getWilayas();
  const pharmaGarde = db
    .prepare('SELECT * FROM pharmacies WHERE de_garde = 1')
    .all()
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }))
    .filter((p) => p.ouvert)
    .slice(0, 4);
  const stats = {
    medecins: db.prepare('SELECT COUNT(*) AS n FROM medecins').get().n,
    pharmacies: db.prepare('SELECT COUNT(*) AS n FROM pharmacies').get().n,
    medicaments: db.prepare('SELECT COUNT(*) AS n FROM medicaments').get().n,
    wilayas: db.prepare('SELECT COUNT(*) AS n FROM wilayas').get().n,
  };
  res.render('index', { specialites, wilayas, pharmaGarde, stats });
});

// --- Médecins : liste + recherche -------------------------------------------
const PAGE_SIZE = 60;
app.get('/medecins', (req, res) => {
  const { specialite = '', wilaya = '', q = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const cond = [];
  const params = [];
  if (specialite) { cond.push('m.specialite_id = ?'); params.push(specialite); }
  if (wilaya) { cond.push('m.wilaya = ?'); params.push(wilaya); }
  if (q) {
    cond.push('(m.nom LIKE ? OR m.prenom LIKE ? OR m.ville LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM medecins m ${where}`).get(...params).n;
  const medecins = db
    .prepare(
      `SELECT m.*, s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       ${where} ORDER BY m.note DESC, m.nom LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, offset);
  // 3 sections « propositions » pour ne jamais laisser la page vide
  const populaires = db
    .prepare(
      `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif, m.accepte_cnas,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       ORDER BY m.note DESC, RANDOM() LIMIT 8`
    )
    .all();
  const cnasMedecins = db
    .prepare(
      `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif, m.accepte_cnas,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       WHERE m.accepte_cnas = 1 ORDER BY RANDOM() LIMIT 6`
    )
    .all();
  // Compteurs par spécialité pour les chips
  const specCounts = db
    .prepare(
      `SELECT s.id, s.nom_fr, s.nom_ar, s.icone, COUNT(m.id) AS n
       FROM specialites s LEFT JOIN medecins m ON m.specialite_id = s.id
       GROUP BY s.id ORDER BY n DESC LIMIT 8`
    )
    .all();

  const pagination = {
    page,
    total,
    pageSize: PAGE_SIZE,
    nbPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
  res.render('medecins', {
    medecins,
    populaires,
    cnasMedecins,
    specCounts,
    pagination,
    specialites: getSpecialites(),
    wilayas: getWilayas(),
    filtres: { specialite: String(specialite), wilaya: String(wilaya), q: String(q) },
  });
});

// --- Médecin : fiche + réservation ------------------------------------------
app.get('/medecins/:id', (req, res) => {
  const med = db
    .prepare(
      `SELECT m.*, s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id WHERE m.id = ?`
    )
    .get(req.params.id);
  if (!med) return res.status(404).render('404');

  const jours = h.prochainJours(14, res.locals.daysShort);
  const joursOuverts = jours.filter((j) => h.segmentsDuJour(med.horaires, j.dayIndex).length > 0);

  let dateSel = String(req.query.date || '');
  if (!joursOuverts.some((j) => j.date === dateSel)) {
    dateSel = joursOuverts.length ? joursOuverts[0].date : '';
  }

  let creneaux = [];
  let dayIndexSel = null;
  if (dateSel) {
    dayIndexSel = jours.find((j) => j.date === dateSel).dayIndex;
    const reserves = db
      .prepare("SELECT heure FROM rendezvous WHERE medecin_id = ? AND date = ? AND statut = 'confirme'")
      .all(med.id, dateSel)
      .map((r) => r.heure);
    creneaux = h.creneauxLibres(med.horaires, med.duree_consultation, dateSel, dayIndexSel, reserves);
  }

  // Suggestions : autres médecins de la même spécialité dans la même wilaya
  // (puis fallback : même spécialité ailleurs si rien dans la wilaya).
  let suggestions = db
    .prepare(
      `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       WHERE m.specialite_id = ? AND m.wilaya = ? AND m.id != ?
       ORDER BY m.note DESC LIMIT 6`
    )
    .all(med.specialite_id, med.wilaya, med.id);
  if (suggestions.length < 6) {
    const extra = db
      .prepare(
        `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif,
                s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
         FROM medecins m JOIN specialites s ON s.id = m.specialite_id
         WHERE m.specialite_id = ? AND m.id != ? AND m.id NOT IN (${suggestions.map(() => '?').join(',') || 'NULL'})
         ORDER BY m.note DESC LIMIT ?`
      )
      .all(med.specialite_id, med.id, ...suggestions.map((s) => s.id), 6 - suggestions.length);
    suggestions = suggestions.concat(extra);
  }

  // Avis : liste + agrégat + autorisation pour l'utilisateur courant
  const avis = db
    .prepare(
      `SELECT a.note, a.commentaire, a.cree_le, u.prenom, u.nom
       FROM avis a JOIN utilisateurs u ON u.id = a.utilisateur_id
       WHERE a.medecin_id = ? ORDER BY a.cree_le DESC LIMIT 20`
    )
    .all(med.id);
  const avisAgg = db
    .prepare('SELECT COUNT(*) AS n, AVG(note) AS m FROM avis WHERE medecin_id = ?')
    .get(med.id);
  let canReview = false;
  let monAvis = null;
  if (req.session.user) {
    const r = db
      .prepare('SELECT 1 AS x FROM rendezvous WHERE utilisateur_id = ? AND medecin_id = ? LIMIT 1')
      .get(req.session.user.id, med.id);
    canReview = !!r;
    monAvis = db
      .prepare('SELECT note, commentaire FROM avis WHERE utilisateur_id = ? AND medecin_id = ?')
      .get(req.session.user.id, med.id);
  }

  res.render('medecin', {
    med,
    horaires: h.horairesLisibles(med.horaires, res.locals.daysShort, res.locals.t('closed')),
    joursOuverts: joursOuverts.slice(0, 10),
    dateSel,
    creneaux,
    suggestions,
    avis,
    avisAgg,
    canReview,
    monAvis,
    msg: req.query.msg || '',
  });
});

app.post('/medecins/:id/reserver', requireAuth, (req, res) => {
  const med = db.prepare('SELECT * FROM medecins WHERE id = ?').get(req.params.id);
  if (!med) return res.status(404).render('404');

  const { date, heure, motif = '' } = req.body;
  const dayIndex = new Date(`${date}T12:00:00`).getDay();
  const reserves = db
    .prepare("SELECT heure FROM rendezvous WHERE medecin_id = ? AND date = ? AND statut = 'confirme'")
    .all(med.id, date)
    .map((r) => r.heure);
  const dispo = h.creneauxLibres(med.horaires, med.duree_consultation, date, dayIndex, reserves);

  if (!dispo.includes(heure)) {
    return res.redirect(`/medecins/${med.id}?date=${encodeURIComponent(date)}&msg=slot_taken`);
  }
  let rdvId;
  try {
    const info = db.prepare(
      'INSERT INTO rendezvous (utilisateur_id, medecin_id, date, heure, motif) VALUES (?, ?, ?, ?, ?)'
    ).run(req.session.user.id, med.id, date, heure, motif.trim());
    rdvId = Number(info.lastInsertRowid);
  } catch (e) {
    return res.redirect(`/medecins/${med.id}?date=${encodeURIComponent(date)}&msg=slot_taken`);
  }
  pushNotif(
    req.session.user.id,
    'rdv_confirme',
    `Rendez-vous confirmé avec Dr ${med.prenom} ${med.nom}`,
    `Le ${date} à ${heure} · ${med.adresse}, ${med.ville}`,
    '/mon-compte'
  );
  res.redirect('/mon-compte?ok=booked');
});

// --- Laisser un avis sur un médecin (après RDV) -----------------------------
app.post('/medecins/:id/avis', requireAuth, (req, res) => {
  const medId = Number(req.params.id);
  const note = Math.max(1, Math.min(5, Number(req.body.note) || 0));
  const commentaire = String(req.body.commentaire || '').trim().slice(0, 600);
  if (!note) return res.redirect(`/medecins/${medId}?msg=avis_err`);
  // L'utilisateur doit avoir au moins un RDV avec ce médecin
  const rdv = db
    .prepare('SELECT id FROM rendezvous WHERE utilisateur_id = ? AND medecin_id = ? ORDER BY date DESC LIMIT 1')
    .get(req.session.user.id, medId);
  if (!rdv) return res.redirect(`/medecins/${medId}?msg=avis_no_rdv`);
  // Un seul avis par utilisateur+médecin
  const exist = db
    .prepare('SELECT id FROM avis WHERE utilisateur_id = ? AND medecin_id = ?')
    .get(req.session.user.id, medId);
  if (exist) {
    db.prepare('UPDATE avis SET note = ?, commentaire = ?, cree_le = datetime(\'now\') WHERE id = ?')
      .run(note, commentaire, exist.id);
  } else {
    db.prepare('INSERT INTO avis (utilisateur_id, medecin_id, rdv_id, note, commentaire) VALUES (?, ?, ?, ?, ?)')
      .run(req.session.user.id, medId, rdv.id, note, commentaire);
  }
  // Recalcule la note moyenne du médecin
  const avg = db.prepare('SELECT AVG(note) AS m FROM avis WHERE medecin_id = ?').get(medId).m;
  if (avg) db.prepare('UPDATE medecins SET note = ? WHERE id = ?').run(avg, medId);
  res.redirect(`/medecins/${medId}?msg=avis_ok#avis`);
});

// --- Pharmacies -------------------------------------------------------------
app.get('/pharmacies', (req, res) => {
  const { q = '', wilaya = '', garde = '' } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const cond = [];
  const params = [];
  if (wilaya) { cond.push('wilaya = ?'); params.push(wilaya); }
  if (q) { cond.push('(nom LIKE ? OR ville LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (garde) cond.push('de_garde = 1');
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM pharmacies ${where}`).get(...params).n;
  const pharmacies = db
    .prepare(`SELECT * FROM pharmacies ${where} ORDER BY de_garde DESC, nom LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, offset)
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }));
  // 3 sections de propositions
  const populaires = db
    .prepare('SELECT * FROM pharmacies WHERE de_garde = 1 ORDER BY RANDOM() LIMIT 16')
    .all()
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }))
    .filter((p) => p.ouvert)
    .slice(0, 8);
  const aDecouvrir = db
    .prepare('SELECT * FROM pharmacies WHERE de_garde = 0 ORDER BY RANDOM() LIMIT 6')
    .all()
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }));
  // Wilayas les mieux couvertes
  const topWilayas = db
    .prepare(
      `SELECT wilaya, COUNT(*) AS n FROM pharmacies GROUP BY wilaya ORDER BY n DESC LIMIT 10`
    )
    .all();

  const pagination = {
    page,
    total,
    pageSize: PAGE_SIZE,
    nbPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
  res.render('pharmacies', {
    pharmacies,
    populaires,
    aDecouvrir,
    topWilayas,
    pagination,
    wilayas: getWilayas(),
    filtres: { q: String(q), wilaya: String(wilaya), garde: String(garde) },
  });
});

app.get('/pharmacies/:id', (req, res) => {
  const pharma = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.params.id);
  if (!pharma) return res.status(404).render('404');
  const q = String(req.query.q || '');
  const cond = ['sp.pharmacie_id = ?'];
  const params = [pharma.id];
  if (q) {
    cond.push('(m.nom_fr LIKE ? OR m.nom_ar LIKE ? OR m.dci LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const stock = db
    .prepare(
      `SELECT m.*, sp.disponible, sp.prix
       FROM stock_pharmacie sp JOIN medicaments m ON m.id = sp.medicament_id
       WHERE ${cond.join(' AND ')}
       ORDER BY sp.disponible DESC, m.nom_fr`
    )
    .all(...params);
  // Suggestions : autres pharmacies dans la même wilaya, priorité aux pharmacies de garde
  const suggestions = db
    .prepare(
      `SELECT * FROM pharmacies
       WHERE wilaya = ? AND id != ?
       ORDER BY de_garde DESC, RANDOM() LIMIT 6`
    )
    .all(pharma.wilaya, pharma.id)
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }));

  res.render('pharmacie', {
    pharma,
    ouvert: h.ouverteMaintenant(pharma.horaires),
    horaires: h.horairesLisibles(pharma.horaires, res.locals.daysShort, res.locals.t('closed')),
    stock,
    suggestions,
    q,
  });
});

// --- Médicaments ------------------------------------------------------------
app.get('/medicaments', (req, res) => {
  const q = String(req.query.q || '').trim();
  const rx = String(req.query.rx || ''); // '' = tous, '1' = sur ordonnance, '0' = libre
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const cond = [];
  const params = [];
  if (q) {
    cond.push('(m.nom_fr LIKE ? OR m.nom_ar LIKE ? OR m.dci LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (rx === '1' || rx === '0') {
    cond.push('m.sur_ordonnance = ?');
    params.push(Number(rx));
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM medicaments m ${where}`).get(...params).n;
  // Récupère uniquement la page courante, puis enrichit avec le cache Map.
  const medicaments = db
    .prepare(
      `SELECT m.* FROM medicaments m ${where} ORDER BY m.nom_fr LIMIT ? OFFSET ?`
    )
    .all(...params, PAGE_SIZE, offset)
    .map((m) => ({ ...m, nb_dispo: popularMedsCache.getDispo(m.id) }));
  // Propositions : utilise le cache mis en place ci-dessous
  const populaires = popularMedsCache.getAll();
  const sansOrdo = popularMedsCache.getOtc();
  // Top DCI (molécules les plus représentées) — chips
  const topDci = db
    .prepare(
      `SELECT dci, COUNT(*) AS n FROM medicaments
       WHERE dci IS NOT NULL AND dci != ''
       GROUP BY dci ORDER BY n DESC LIMIT 10`
    )
    .all();

  const pagination = {
    page,
    total,
    pageSize: PAGE_SIZE,
    nbPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
  res.render('medicaments', { q, rx, medicaments, populaires, sansOrdo, topDci, pagination });
});

app.get('/medicaments/:id', (req, res) => {
  const med = db.prepare('SELECT * FROM medicaments WHERE id = ?').get(req.params.id);
  if (!med) return res.status(404).render('404');
  const wilaya = String(req.query.wilaya || '');
  const cond = ['sp.medicament_id = ?'];
  const params = [med.id];
  if (wilaya) { cond.push('p.wilaya = ?'); params.push(wilaya); }
  const pharmacies = db
    .prepare(
      `SELECT p.*, sp.disponible, sp.prix
       FROM stock_pharmacie sp JOIN pharmacies p ON p.id = sp.pharmacie_id
       WHERE ${cond.join(' AND ')}
       ORDER BY sp.disponible DESC, sp.prix`
    )
    .all(...params)
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }));
  // Suggestions : autres médicaments avec la même DCI (génériques / variantes)
  let suggestions = db
    .prepare(
      `SELECT id, nom_fr, nom_ar, dci, forme, dosage, sur_ordonnance, laboratoire
       FROM medicaments WHERE dci = ? AND id != ? ORDER BY nom_fr LIMIT 6`
    )
    .all(med.dci, med.id);
  if (suggestions.length < 6) {
    // Fallback : autres médicaments du même laboratoire
    const extra = db
      .prepare(
        `SELECT id, nom_fr, nom_ar, dci, forme, dosage, sur_ordonnance, laboratoire
         FROM medicaments WHERE laboratoire = ? AND id != ? AND id NOT IN (${suggestions.map(() => '?').join(',') || 'NULL'})
         ORDER BY nom_fr LIMIT ?`
      )
      .all(med.laboratoire || '', med.id, ...suggestions.map((s) => s.id), 6 - suggestions.length);
    suggestions = suggestions.concat(extra);
  }

  res.render('medicament', { med, pharmacies, wilayas: getWilayas(), wilaya, suggestions });
});

// --- Authentification -------------------------------------------------------
app.get('/connexion', (req, res) => {
  res.render('connexion', { err: '', next: String(req.query.next || '') });
});
app.post('/connexion', (req, res) => {
  const { email = '', password = '', next = '' } = req.body;
  const u = db.prepare('SELECT * FROM utilisateurs WHERE email = ?').get(email.trim().toLowerCase());
  if (!u || !bcrypt.compareSync(password, u.mot_de_passe)) {
    return res.status(401).render('connexion', { err: res.locals.t('err_login'), next });
  }
  req.session.user = {
    id: u.id,
    prenom: u.prenom,
    nom: u.nom,
    email: u.email,
    role: u.role || 'patient',
    medecin_id: u.medecin_id,
    pharmacie_id: u.pharmacie_id,
  };
  if (next && next.startsWith('/')) return res.redirect(next);
  if (u.role === 'medecin') return res.redirect('/pro/medecin');
  if (u.role === 'pharmacien') return res.redirect('/pro/pharmacie');
  res.redirect('/mon-compte');
});

app.get('/inscription', (req, res) => {
  res.render('inscription', { err: '', valeurs: {} });
});
app.post('/inscription', (req, res) => {
  const { prenom = '', nom = '', email = '', telephone = '', password = '' } = req.body;
  const valeurs = { prenom, nom, email, telephone };
  if (!prenom.trim() || !nom.trim() || !email.trim() || !password) {
    return res.status(400).render('inscription', { err: res.locals.t('err_fields'), valeurs });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare(
        'INSERT INTO utilisateurs (prenom, nom, email, telephone, mot_de_passe) VALUES (?, ?, ?, ?, ?)'
      )
      .run(prenom.trim(), nom.trim(), email.trim().toLowerCase(), telephone.trim(), hash);
    req.session.user = { id: Number(info.lastInsertRowid), prenom: prenom.trim(), nom: nom.trim(), email: email.trim().toLowerCase() };
    res.redirect('/mon-compte');
  } catch (e) {
    res.status(409).render('inscription', { err: res.locals.t('err_email_taken'), valeurs });
  }
});

app.post('/deconnexion', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --- Mon compte -------------------------------------------------------------
app.get('/mon-compte', requireAuth, (req, res) => {
  const rdvs = db
    .prepare(
      `SELECT r.*, m.prenom AS m_prenom, m.nom AS m_nom, m.adresse, m.ville, m.wilaya,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM rendezvous r
       JOIN medecins m ON m.id = r.medecin_id
       JOIN specialites s ON s.id = m.specialite_id
       WHERE r.utilisateur_id = ?
       ORDER BY (r.statut = 'annule'), r.date, r.heure`
    )
    .all(req.session.user.id);
  // Suggestions : top médecins à découvrir, pour ne jamais laisser la page vide
  const populaires = db
    .prepare(
      `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif, m.accepte_cnas,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       ORDER BY m.note DESC, RANDOM() LIMIT 6`
    )
    .all();
  res.render('mon-compte', { rdvs, populaires, ok: String(req.query.ok || '') });
});

app.post('/mon-compte/rdv/:id/annuler', requireAuth, (req, res) => {
  db.prepare("UPDATE rendezvous SET statut = 'annule' WHERE id = ? AND utilisateur_id = ?")
    .run(req.params.id, req.session.user.id);
  pushNotif(
    req.session.user.id,
    'rdv_annule',
    'Rendez-vous annulé',
    'Votre rendez-vous a été annulé avec succès.',
    '/mon-compte'
  );
  res.redirect('/mon-compte?ok=cancel');
});

// --- Notifications ----------------------------------------------------------
app.get('/notifications', requireAuth, (req, res) => {
  const notifs = db
    .prepare('SELECT * FROM notifications WHERE utilisateur_id = ? ORDER BY cree_le DESC LIMIT 50')
    .all(req.session.user.id);
  // Marque toutes comme lues
  db.prepare('UPDATE notifications SET lue = 1 WHERE utilisateur_id = ?')
    .run(req.session.user.id);
  res.render('notifications', { notifs });
});

app.post('/notifications/:id/lue', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET lue = 1 WHERE id = ? AND utilisateur_id = ?')
    .run(req.params.id, req.session.user.id);
  res.redirect('/notifications');
});

// ============================================================================
// ESPACE PRO — MÉDECIN
// ============================================================================
app.get('/pro/medecin', requireMedecin, (req, res) => {
  const med = db
    .prepare(
      `SELECT m.*, s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id WHERE m.id = ?`
    )
    .get(req.session.user.medecin_id);
  if (!med) return res.status(404).render('404');

  const { dateStr } = h.nowDZ();
  const rdvs = db
    .prepare(
      `SELECT r.*, u.prenom AS p_prenom, u.nom AS p_nom, u.telephone AS p_tel, u.email AS p_email
       FROM rendezvous r
       JOIN utilisateurs u ON u.id = r.utilisateur_id
       WHERE r.medecin_id = ? AND r.date >= ?
       ORDER BY (r.statut = 'annule'), r.date, r.heure`
    )
    .all(med.id, dateStr);

  res.render('pro/medecin', {
    med,
    rdvs,
    ok: String(req.query.ok || ''),
  });
});

app.post('/pro/medecin/rdv/:id/annuler', requireMedecin, (req, res) => {
  db.prepare("UPDATE rendezvous SET statut = 'annule' WHERE id = ? AND medecin_id = ?")
    .run(req.params.id, req.session.user.medecin_id);
  res.redirect('/pro/medecin?ok=cancel');
});

app.get('/pro/medecin/profil', requireMedecin, (req, res) => {
  const med = db.prepare('SELECT * FROM medecins WHERE id = ?').get(req.session.user.medecin_id);
  if (!med) return res.status(404).render('404');
  const specialites = getSpecialites();
  res.render('pro/medecin-profil', { med, specialites, ok: String(req.query.ok || '') });
});

app.post('/pro/medecin/profil', requireMedecin, (req, res) => {
  const {
    specialite_id,
    tarif,
    duree_consultation,
    accepte_cnas,
    telephone = '',
    adresse = '',
    bio_fr = '',
    bio_ar = '',
  } = req.body;
  db.prepare(
    `UPDATE medecins SET specialite_id = ?, tarif = ?, duree_consultation = ?,
       accepte_cnas = ?, telephone = ?, adresse = ?, bio_fr = ?, bio_ar = ?
     WHERE id = ?`
  ).run(
    Number(specialite_id) || 1,
    Math.max(0, Number(tarif) || 0),
    Math.max(5, Number(duree_consultation) || 30),
    accepte_cnas ? 1 : 0,
    telephone.trim(),
    adresse.trim(),
    bio_fr.trim(),
    bio_ar.trim(),
    req.session.user.medecin_id
  );
  res.redirect('/pro/medecin/profil?ok=1');
});

app.get('/pro/medecin/horaires', requireMedecin, (req, res) => {
  const med = db.prepare('SELECT * FROM medecins WHERE id = ?').get(req.session.user.medecin_id);
  if (!med) return res.status(404).render('404');
  res.render('pro/medecin-horaires', {
    med,
    horairesForm: horairesPourForm(med.horaires),
    ok: String(req.query.ok || ''),
  });
});

app.post('/pro/medecin/horaires', requireMedecin, (req, res) => {
  const horaires = horairesDepuisForm(req.body);
  db.prepare('UPDATE medecins SET horaires = ? WHERE id = ?').run(horaires, req.session.user.medecin_id);
  res.redirect('/pro/medecin/horaires?ok=1');
});

// ============================================================================
// ESPACE PRO — PHARMACIE
// ============================================================================
app.get('/pro/pharmacie', requirePharmacien, (req, res) => {
  const pharma = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.session.user.pharmacie_id);
  if (!pharma) return res.status(404).render('404');
  const nbStock = db
    .prepare('SELECT COUNT(*) AS n FROM stock_pharmacie WHERE pharmacie_id = ? AND disponible = 1')
    .get(pharma.id).n;
  const nbTotal = db
    .prepare('SELECT COUNT(*) AS n FROM stock_pharmacie WHERE pharmacie_id = ?')
    .get(pharma.id).n;
  res.render('pro/pharmacie', {
    pharma,
    ouvert: h.ouverteMaintenant(pharma.horaires),
    horaires: h.horairesLisibles(pharma.horaires, res.locals.daysShort, res.locals.t('closed')),
    nbStock,
    nbTotal,
    ok: String(req.query.ok || ''),
  });
});

app.post('/pro/pharmacie/garde', requirePharmacien, (req, res) => {
  db.prepare('UPDATE pharmacies SET de_garde = 1 - de_garde WHERE id = ?').run(req.session.user.pharmacie_id);
  res.redirect('/pro/pharmacie?ok=garde');
});

app.post('/pro/pharmacie/profil', requirePharmacien, (req, res) => {
  const { telephone = '', adresse = '' } = req.body;
  db.prepare('UPDATE pharmacies SET telephone = ?, adresse = ? WHERE id = ?')
    .run(telephone.trim(), adresse.trim(), req.session.user.pharmacie_id);
  res.redirect('/pro/pharmacie?ok=profil');
});

app.get('/pro/pharmacie/horaires', requirePharmacien, (req, res) => {
  const pharma = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.session.user.pharmacie_id);
  if (!pharma) return res.status(404).render('404');
  res.render('pro/pharmacie-horaires', {
    pharma,
    horairesForm: horairesPourForm(pharma.horaires),
    ok: String(req.query.ok || ''),
  });
});

app.post('/pro/pharmacie/horaires', requirePharmacien, (req, res) => {
  const horaires = horairesDepuisForm(req.body);
  db.prepare('UPDATE pharmacies SET horaires = ? WHERE id = ?').run(horaires, req.session.user.pharmacie_id);
  res.redirect('/pro/pharmacie/horaires?ok=1');
});

app.get('/pro/pharmacie/stock', requirePharmacien, (req, res) => {
  const pharma = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(req.session.user.pharmacie_id);
  if (!pharma) return res.status(404).render('404');
  const stock = db
    .prepare(
      `SELECT m.id AS medicament_id, m.nom_fr, m.nom_ar, m.dci, m.forme, m.dosage, m.sur_ordonnance,
              sp.disponible, sp.prix
       FROM medicaments m
       LEFT JOIN stock_pharmacie sp ON sp.medicament_id = m.id AND sp.pharmacie_id = ?
       ORDER BY m.nom_fr`
    )
    .all(pharma.id);
  res.render('pro/pharmacie-stock', { pharma, stock, ok: String(req.query.ok || '') });
});

app.post('/pro/pharmacie/stock', requirePharmacien, (req, res) => {
  const pid = req.session.user.pharmacie_id;
  const ids = [].concat(req.body.medicament_id || []);
  const upsert = db.prepare(
    `INSERT INTO stock_pharmacie (pharmacie_id, medicament_id, disponible, prix, maj_le)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(pharmacie_id, medicament_id) DO UPDATE SET
       disponible = excluded.disponible, prix = excluded.prix, maj_le = datetime('now')`
  );
  for (const id of ids) {
    const mid = Number(id);
    if (!mid) continue;
    const dispo = req.body[`dispo_${mid}`] ? 1 : 0;
    const prixRaw = req.body[`prix_${mid}`];
    const prix = prixRaw === '' || prixRaw == null ? null : Math.max(0, Number(prixRaw) || 0);
    upsert.run(pid, mid, dispo, prix);
  }
  res.redirect('/pro/pharmacie/stock?ok=1');
});

// --- Pour les pros (landing B2B) -------------------------------------------
app.get('/pour-les-pros', (req, res) => {
  const stats = {
    medecins: db.prepare('SELECT COUNT(*) AS n FROM medecins').get().n,
    pharmacies: db.prepare('SELECT COUNT(*) AS n FROM pharmacies').get().n,
    rdvs: db.prepare("SELECT COUNT(*) AS n FROM rendezvous WHERE statut='confirme'").get().n,
  };
  res.render('pour-les-pros', { stats });
});

// --- Tarifs (3 plans) -------------------------------------------------------
app.get('/tarifs', (req, res) => {
  res.render('tarifs', {});
});

app.post('/tarifs/inscrire', requireAuth, (req, res) => {
  const { plan = 'gratuit', cible_type = 'medecin' } = req.body;
  db.prepare(
    'INSERT INTO abonnements (utilisateur_id, plan, cible_type) VALUES (?, ?, ?)'
  ).run(req.session.user.id, plan, cible_type);
  pushNotif(
    req.session.user.id,
    'abonnement',
    `Plan ${plan.toUpperCase()} activé`,
    `Bienvenue dans Afya Pro — votre plan ${plan} est actif. (Démo : aucun paiement n'a été perçu)`,
    '/mon-compte'
  );
  res.redirect('/tarifs?ok=1');
});

// --- À propos ---------------------------------------------------------------
app.get('/a-propos', (req, res) => {
  const stats = {
    medecins: db.prepare('SELECT COUNT(*) AS n FROM medecins').get().n,
    pharmacies: db.prepare('SELECT COUNT(*) AS n FROM pharmacies').get().n,
    medicaments: db.prepare('SELECT COUNT(*) AS n FROM medicaments').get().n,
    wilayas: db.prepare('SELECT COUNT(*) AS n FROM wilayas').get().n,
    specialites: db.prepare('SELECT COUNT(*) AS n FROM specialites').get().n,
  };
  // Propositions en bas
  const topMedecins = db
    .prepare(
      `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       ORDER BY m.note DESC, RANDOM() LIMIT 6`
    )
    .all();
  const topPharmacies = db
    .prepare('SELECT * FROM pharmacies WHERE de_garde = 1 ORDER BY RANDOM() LIMIT 16')
    .all()
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }))
    .filter((p) => p.ouvert)
    .slice(0, 6);
  res.render('a-propos', { stats, topMedecins, topPharmacies });
});

// --- Contact ----------------------------------------------------------------
app.get('/contact', (req, res) => {
  // Suggestions affichées sous le formulaire : top médecins + pharmacies de garde
  const topMedecins = db
    .prepare(
      `SELECT m.id, m.prenom, m.nom, m.sexe, m.ville, m.wilaya, m.note, m.tarif,
              s.nom_fr AS spec_fr, s.nom_ar AS spec_ar, s.icone AS spec_icone
       FROM medecins m JOIN specialites s ON s.id = m.specialite_id
       ORDER BY m.note DESC, RANDOM() LIMIT 6`
    )
    .all();
  const topPharmacies = db
    .prepare('SELECT * FROM pharmacies WHERE de_garde = 1 ORDER BY RANDOM() LIMIT 16')
    .all()
    .map((p) => ({ ...p, ouvert: h.ouverteMaintenant(p.horaires) }))
    .filter((p) => p.ouvert)
    .slice(0, 6);
  res.render('contact', {
    topMedecins,
    topPharmacies,
    sent: String(req.query.sent || '') === '1',
  });
});

app.post('/contact', (req, res) => {
  // Démonstration : on log et on confirme. (Pas de SMTP ici.)
  const { nom = '', email = '', sujet = '', message = '' } = req.body;
  console.log(`[contact] ${new Date().toISOString()} ← ${nom} <${email}> | ${sujet} | ${message.slice(0, 200)}`);
  res.redirect('/contact?sent=1');
});

// --- 404 --------------------------------------------------------------------
app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`✓ Afya en ligne → http://localhost:${PORT}`);
  // Pré-chauffe le cache des disponibilités au démarrage pour éviter le coût initial sur la 1ère requête.
  const t0 = Date.now();
  popularMedsCache.getAll();
  console.log(`  • cache des disponibilités chargé (${Date.now() - t0} ms)`);
});
