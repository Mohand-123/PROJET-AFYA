/**
 * Afya — initialisation de la base de données SQLite avec données RÉELLES.
 *
 * Sources :
 *   • Wilayas (58 officielles)
 *   • Pharmacies : ~2391 vraies pharmacies algériennes (annuaire YajidPharma,
 *     données publiques Supabase, avec coordonnées GPS).
 *     → fichier ./data/pharmacies-real.json (généré par fetch-real-data.js)
 *   • Médicaments : nomenclature nationale du Ministère de l'Industrie
 *     Pharmaceutique algérien — 4627 spécialités enregistrées.
 *     → fichier ./data/medicaments.json (depuis le repo GitHub
 *     mahmoudBens/Nomenclature-des-medicaments-en-algerie)
 *   • Médecins : générés (aucune liste publique exhaustive ne couvre tous les
 *     praticiens privés en Algérie ; le Conseil de l'Ordre ne publie pas).
 *
 * Lancement : npm run init-bdd  (après avoir lancé `node fetch-real-data.js`)
 */
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const db = require('./db');

console.log('→ Réinitialisation de la base Afya (données réelles)...');

// ---------------------------------------------------------------------------
// Chargement des fichiers de données réelles
// ---------------------------------------------------------------------------
const dataDir = path.join(__dirname, 'data');
const pharmaciesReal = JSON.parse(fs.readFileSync(path.join(dataDir, 'pharmacies-real.json'), 'utf8'));
const wilayasReal = JSON.parse(fs.readFileSync(path.join(dataDir, 'wilayas-real.json'), 'utf8'));
const medsRawFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'medicaments.json'), 'utf8'));
const medsRaw = medsRawFile[1]?.data || []; // structure : [{type:database...}, {data:[...]}]

console.log(`  • ${wilayasReal.length} wilayas chargées`);
console.log(`  • ${pharmaciesReal.length} pharmacies chargées`);
console.log(`  • ${medsRaw.length} médicaments chargés (nomenclature officielle)`);

// ---------------------------------------------------------------------------
// Schéma (avec lat/lng pour les pharmacies, utilisable pour une future carte)
// ---------------------------------------------------------------------------
db.exec(`
  DROP TABLE IF EXISTS rendezvous;
  DROP TABLE IF EXISTS stock_pharmacie;
  DROP TABLE IF EXISTS medicaments;
  DROP TABLE IF EXISTS pharmacies;
  DROP TABLE IF EXISTS medecins;
  DROP TABLE IF EXISTS specialites;
  DROP TABLE IF EXISTS wilayas;
  DROP TABLE IF EXISTS utilisateurs;

  CREATE TABLE utilisateurs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    prenom        TEXT NOT NULL,
    nom           TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    telephone     TEXT,
    mot_de_passe  TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'patient',
    medecin_id    INTEGER,
    pharmacie_id  INTEGER,
    cree_le       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE wilayas (
    code    TEXT PRIMARY KEY,
    nom_fr  TEXT NOT NULL,
    nom_ar  TEXT NOT NULL
  );

  CREATE TABLE specialites (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_fr  TEXT NOT NULL,
    nom_ar  TEXT NOT NULL,
    icone   TEXT NOT NULL
  );

  CREATE TABLE medecins (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    prenom              TEXT NOT NULL,
    nom                 TEXT NOT NULL,
    sexe                TEXT NOT NULL DEFAULT 'M',
    specialite_id       INTEGER NOT NULL REFERENCES specialites(id),
    wilaya              TEXT NOT NULL,
    ville               TEXT NOT NULL,
    adresse             TEXT NOT NULL,
    telephone           TEXT,
    tarif               INTEGER NOT NULL DEFAULT 1500,
    accepte_cnas        INTEGER NOT NULL DEFAULT 0,
    note                REAL NOT NULL DEFAULT 4.5,
    bio_fr              TEXT,
    bio_ar              TEXT,
    duree_consultation  INTEGER NOT NULL DEFAULT 30,
    horaires            TEXT NOT NULL
  );

  CREATE TABLE pharmacies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nom         TEXT NOT NULL,
    wilaya      TEXT NOT NULL,
    ville       TEXT NOT NULL,
    adresse     TEXT NOT NULL,
    telephone   TEXT,
    de_garde    INTEGER NOT NULL DEFAULT 0,
    horaires    TEXT NOT NULL,
    lat         REAL,
    lng         REAL,
    pharmacien  TEXT
  );

  CREATE TABLE medicaments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_fr          TEXT NOT NULL,
    nom_ar          TEXT NOT NULL,
    dci             TEXT NOT NULL,
    forme           TEXT NOT NULL,
    dosage          TEXT,
    sur_ordonnance  INTEGER NOT NULL DEFAULT 0,
    description_fr  TEXT,
    laboratoire     TEXT,
    prix_officiel   REAL,
    rembourse       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE stock_pharmacie (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    pharmacie_id   INTEGER NOT NULL REFERENCES pharmacies(id),
    medicament_id  INTEGER NOT NULL REFERENCES medicaments(id),
    disponible     INTEGER NOT NULL DEFAULT 1,
    prix           INTEGER,
    maj_le         TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(pharmacie_id, medicament_id)
  );

  CREATE TABLE rendezvous (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id),
    medecin_id     INTEGER NOT NULL REFERENCES medecins(id),
    date           TEXT NOT NULL,
    heure          TEXT NOT NULL,
    motif          TEXT,
    statut         TEXT NOT NULL DEFAULT 'confirme',
    cree_le        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(medecin_id, date, heure)
  );

  CREATE INDEX idx_medecins_specialite ON medecins(specialite_id);
  CREATE INDEX idx_medecins_wilaya ON medecins(wilaya);
  CREATE INDEX idx_pharmacies_wilaya ON pharmacies(wilaya);
  CREATE INDEX idx_stock_medicament ON stock_pharmacie(medicament_id);
  CREATE INDEX idx_stock_pharmacie ON stock_pharmacie(pharmacie_id);
  CREATE INDEX idx_rdv_utilisateur ON rendezvous(utilisateur_id);
`);

// ---------------------------------------------------------------------------
// Wilayas officielles (codes Algérie + traduction arabe)
// ---------------------------------------------------------------------------
const WILAYAS = [
  ['01', 'Adrar', 'أدرار'], ['02', 'Chlef', 'الشلف'], ['03', 'Laghouat', 'الأغواط'],
  ['04', 'Oum El Bouaghi', 'أم البواقي'], ['05', 'Batna', 'باتنة'], ['06', 'Béjaïa', 'بجاية'],
  ['07', 'Biskra', 'بسكرة'], ['08', 'Béchar', 'بشار'], ['09', 'Blida', 'البليدة'],
  ['10', 'Bouira', 'البويرة'], ['11', 'Tamanrasset', 'تمنراست'], ['12', 'Tébessa', 'تبسة'],
  ['13', 'Tlemcen', 'تلمسان'], ['14', 'Tiaret', 'تيارت'], ['15', 'Tizi Ouzou', 'تيزي وزو'],
  ['16', 'Alger', 'الجزائر'], ['17', 'Djelfa', 'الجلفة'], ['18', 'Jijel', 'جيجل'],
  ['19', 'Sétif', 'سطيف'], ['20', 'Saïda', 'سعيدة'], ['21', 'Skikda', 'سكيكدة'],
  ['22', 'Sidi Bel Abbès', 'سيدي بلعباس'], ['23', 'Annaba', 'عنابة'], ['24', 'Guelma', 'قالمة'],
  ['25', 'Constantine', 'قسنطينة'], ['26', 'Médéa', 'المدية'], ['27', 'Mostaganem', 'مستغانم'],
  ['28', "M'Sila", 'المسيلة'], ['29', 'Mascara', 'معسكر'], ['30', 'Ouargla', 'ورقلة'],
  ['31', 'Oran', 'وهران'], ['32', 'El Bayadh', 'البيض'], ['33', 'Illizi', 'إليزي'],
  ['34', 'Bordj Bou Arréridj', 'برج بوعريريج'], ['35', 'Boumerdès', 'بومرداس'], ['36', 'El Tarf', 'الطارف'],
  ['37', 'Tindouf', 'تندوف'], ['38', 'Tissemsilt', 'تيسمسيلت'], ['39', 'El Oued', 'الوادي'],
  ['40', 'Khenchela', 'خنشلة'], ['41', 'Souk Ahras', 'سوق أهراس'], ['42', 'Tipaza', 'تيبازة'],
  ['43', 'Mila', 'ميلة'], ['44', 'Aïn Defla', 'عين الدفلى'], ['45', 'Naâma', 'النعامة'],
  ['46', 'Aïn Témouchent', 'عين تيموشنت'], ['47', 'Ghardaïa', 'غرداية'], ['48', 'Relizane', 'غليزان'],
  ['49', 'Timimoun', 'تيميمون'], ['50', 'Bordj Badji Mokhtar', 'برج باجي مختار'],
  ['51', 'Ouled Djellal', 'أولاد جلال'], ['52', 'Béni Abbès', 'بني عباس'], ['53', 'In Salah', 'عين صالح'],
  ['54', 'In Guezzam', 'عين قزام'], ['55', 'Touggourt', 'تقرت'], ['56', 'Djanet', 'جانت'],
  ['57', "El M'Ghair", 'المغير'], ['58', 'El Meniaa', 'المنيعة'],
];
const insWilaya = db.prepare('INSERT INTO wilayas (code, nom_fr, nom_ar) VALUES (?, ?, ?)');
for (const w of WILAYAS) insWilaya.run(w[0], w[1], w[2]);

// Mapping nom (normalisé) -> nom_fr officiel, pour réconcilier les wilayas YajidPharma
// avec notre référentiel (cas "Bordj Baji Mokhtar" vs "Bordj Badji Mokhtar").
const normalize = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['\s-]/g, '');
const nameByNorm = new Map(WILAYAS.map((w) => [normalize(w[1]), w[1]]));
const wilayaIdToNomFr = new Map();
for (const w of wilayasReal) {
  const officialNom = nameByNorm.get(normalize(w.nom));
  if (officialNom) wilayaIdToNomFr.set(w.id, officialNom);
}

// ---------------------------------------------------------------------------
// Horaires
// ---------------------------------------------------------------------------
const H_MEDECIN = JSON.stringify({
  0: [['08:00', '12:00'], ['13:00', '16:30']], 1: [['08:00', '12:00'], ['13:00', '16:30']],
  2: [['08:00', '12:00'], ['13:00', '16:30']], 3: [['08:00', '12:00'], ['13:00', '16:30']],
  4: [['08:00', '12:00'], ['13:00', '16:30']], 5: [], 6: [['08:00', '12:00']],
});
const H_MEDECIN_APREM = JSON.stringify({
  0: [['14:00', '19:00']], 1: [['14:00', '19:00']], 2: [['14:00', '19:00']],
  3: [['14:00', '19:00']], 4: [['14:00', '19:00']], 5: [], 6: [['09:00', '13:00']],
});
const H_PHARMA_STD = JSON.stringify({
  0: [['08:00', '20:00']], 1: [['08:00', '20:00']], 2: [['08:00', '20:00']],
  3: [['08:00', '20:00']], 4: [['08:00', '20:00']], 5: [['14:00', '20:00']], 6: [['08:00', '20:00']],
});
const H_PHARMA_24 = JSON.stringify({
  0: [['00:00', '23:59']], 1: [['00:00', '23:59']], 2: [['00:00', '23:59']],
  3: [['00:00', '23:59']], 4: [['00:00', '23:59']], 5: [['00:00', '23:59']], 6: [['00:00', '23:59']],
});

// ---------------------------------------------------------------------------
// Spécialités
// ---------------------------------------------------------------------------
const specialites = [
  ['Médecine générale', 'طب عام', '🩺'],
  ['Dentiste', 'طبيب أسنان', '🦷'],
  ['Pédiatre', 'طبيب أطفال', '🧸'],
  ['Gynécologue', 'طبيب نساء وتوليد', '🤰'],
  ['Cardiologue', 'طبيب قلب', '❤️'],
  ['Dermatologue', 'طبيب جلدية', '🧴'],
  ['Ophtalmologue', 'طبيب عيون', '👁️'],
  ['ORL', 'أنف وأذن وحنجرة', '👂'],
  ['Psychiatre', 'طبيب نفسي', '🧠'],
  ['Gastro-entérologue', 'طبيب جهاز هضمي', '🩻'],
];
const insSpec = db.prepare('INSERT INTO specialites (nom_fr, nom_ar, icone) VALUES (?, ?, ?)');
const specIds = specialites.map((s) => Number(insSpec.run(s[0], s[1], s[2]).lastInsertRowid));

// ---------------------------------------------------------------------------
// Insertion des 2391 vraies pharmacies algériennes
// ---------------------------------------------------------------------------
console.log('→ Import des pharmacies réelles...');
const insPharma = db.prepare(`
  INSERT INTO pharmacies (nom, wilaya, ville, adresse, telephone, de_garde, horaires, lat, lng, pharmacien)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const allPharmaIds = [];

// Une pharmacie sur ~8 est marquée de garde, déterministe sur l'id pour stabilité.
// Au moins une de garde par wilaya garantie en pré-marquant la première de chaque wilaya.
const gardeByWilaya = new Map();
db.exec('BEGIN');
pharmaciesReal.forEach((p, idx) => {
  const wilayaNomFr = wilayaIdToNomFr.get(p.wilaya_id);
  if (!wilayaNomFr) return; // Pharmacie sans wilaya valide : ignorée (1 cas)
  const firstInWilaya = !gardeByWilaya.has(wilayaNomFr);
  const deGarde = firstInWilaya || idx % 8 === 3 ? 1 : 0;
  if (deGarde) gardeByWilaya.set(wilayaNomFr, true);
  const horaires = deGarde && idx % 3 === 0 ? H_PHARMA_24 : H_PHARMA_STD;
  const nom = p.nom || `Pharmacie #${idx + 1}`;
  const adresse = p.adresse || wilayaNomFr;
  const lat = typeof p.lat === 'number' ? p.lat : null;
  const lng = typeof p.lng === 'number' ? p.lng : null;
  const id = insPharma.run(
    nom, wilayaNomFr, wilayaNomFr, adresse,
    p.telephone || null, deGarde, horaires,
    lat, lng, p.pharmacien_nom || null
  ).lastInsertRowid;
  allPharmaIds.push(Number(id));
});
db.exec('COMMIT');
console.log(`  ✓ ${allPharmaIds.length} pharmacies insérées`);

// ---------------------------------------------------------------------------
// Insertion des médicaments officiels (nomenclature MIPH)
// ---------------------------------------------------------------------------
console.log('→ Import des médicaments officiels...');
const insMedic = db.prepare(`
  INSERT INTO medicaments
    (nom_fr, nom_ar, dci, forme, dosage, sur_ordonnance, description_fr, laboratoire, prix_officiel, rembourse)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Titre case : "RIVASTIGMINE" -> "Rivastigmine", garde les nombres et points
const titleCase = (s) => {
  if (!s) return '';
  return s
    .toLowerCase()
    .split(/(\s+|-|\/|,)/)
    .map((part) =>
      /^[a-zà-ÿ]/i.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part
    )
    .join('');
};

// Parse "PCSU 2907,20 DA" / "PPA 1234,50 DA" -> 2907.20
const parsePrix = (s) => {
  if (!s) return null;
  const m = String(s).match(/(\d+(?:[,.]\d+)?)/);
  if (!m) return null;
  return Number(m[1].replace(',', '.')) || null;
};

const medicIds = [];
const medMeta = []; // pour stock, garde forme/nom pour info
db.exec('BEGIN');
for (const m of medsRaw) {
  const nomFr = titleCase(m.NOM_DE_MARQUE || m.DENOMINATION_COMMUNE_INTERNATIONALE);
  const dci = titleCase(m.DENOMINATION_COMMUNE_INTERNATIONALE || m.NOM_DE_MARQUE || 'Inconnu');
  const forme = titleCase(m.FORME || 'Comprimé');
  const dosage = m.DOSAGE || '';
  const liste = m.LISTE || '';
  const surOrdonnance = /Liste/i.test(liste) ? 1 : 0;
  const labo = m.LABORATOIRES_DETENTEUR_DE_LA_DECISION_DENREGISTREMENT || null;
  const prix = parsePrix(m.PRIX_PORTE_SUR_LA_DECISION_DENREGISTREMENT);
  const rembourse = m.REMBOURSEMENT ? 1 : 0;
  if (!nomFr) continue;
  const id = insMedic.run(
    nomFr, '', dci, forme, dosage, surOrdonnance, null,
    labo ? titleCase(labo) : null, prix, rembourse
  ).lastInsertRowid;
  medicIds.push(Number(id));
  medMeta.push({ nom: nomFr, prix });
}
db.exec('COMMIT');
console.log(`  ✓ ${medicIds.length} médicaments insérés`);

// ---------------------------------------------------------------------------
// Stock par pharmacie (chaque pharmacie stocke ~150 médicaments, déterministe)
// Hash simple : (pharma_idx * 53 + med_idx * 17) % N → couverture pseudo-aléatoire stable
// ---------------------------------------------------------------------------
console.log('→ Génération des stocks...');
const insStock = db.prepare(
  'INSERT INTO stock_pharmacie (pharmacie_id, medicament_id, disponible, prix) VALUES (?, ?, ?, ?)'
);

const STOCK_PAR_PHARMACIE = 150; // ~358 650 lignes de stock total
db.exec('BEGIN');
allPharmaIds.forEach((pid, pi) => {
  const seen = new Set();
  let count = 0;
  let step = 1;
  while (count < STOCK_PAR_PHARMACIE && step < medicIds.length * 3) {
    const mi = (pi * 53 + step * 17 + step * step) % medicIds.length;
    step++;
    if (seen.has(mi)) continue;
    seen.add(mi);
    const mid = medicIds[mi];
    const disponible = (pi * 7 + mi * 3) % 9 === 0 ? 0 : 1;
    const base = medMeta[mi].prix || (50 + (mi % 50) * 10);
    const prix = Math.round(base + ((pi * 5) % 30) - 10);
    insStock.run(pid, mid, disponible, Math.max(10, prix));
    count++;
  }
});
db.exec('COMMIT');
console.log(`  ✓ ${db.prepare('SELECT COUNT(*) AS n FROM stock_pharmacie').get().n} lignes de stock`);

// ---------------------------------------------------------------------------
// Médecins générés (pas de source publique exhaustive en Algérie)
// On augmente le volume pour matcher l'échelle des pharmacies réelles.
// ---------------------------------------------------------------------------
console.log('→ Génération des médecins...');
const PRENOMS_M = ['Mohamed', 'Ahmed', 'Karim', 'Sofiane', 'Yacine', 'Riad', 'Bilal', 'Walid', 'Mehdi', 'Amine', 'Nabil', 'Adel', 'Farid', 'Hakim', 'Reda', 'Samir', 'Toufik', 'Djamel', 'Rachid', 'Salim', 'Hocine', 'Mourad', 'Anis', 'Tarek', 'Omar', 'Khaled', 'Younes'];
const PRENOMS_F = ['Amel', 'Nadia', 'Leila', 'Sara', 'Imene', 'Fatima', 'Yasmine', 'Sabrina', 'Lamia', 'Hanane', 'Souad', 'Karima', 'Nawel', 'Meriem', 'Lydia', 'Asma', 'Rania', 'Lina', 'Hayat', 'Wissam', 'Samira', 'Houda', 'Naima', 'Salima', 'Djamila'];
const NOMS = ['Benali', 'Haddad', 'Maarfia', 'Cherif', 'Tabet', 'Bouzid', 'Slimani', 'Khelifi', 'Bourdim', 'Saidi', 'Ferhat', 'Zerrouki', 'Mansouri', 'Belaid', 'Boudiaf', 'Hamidi', 'Brahimi', 'Saadi', 'Belkacem', 'Meziane', 'Larbi', 'Kaci', 'Amrani', 'Yahiaoui', 'Bensalem', 'Touati', 'Aziz', 'Gacem', 'Chaibi', 'Rahmani', 'Bouchareb', 'Hamdi', 'Boutaleb', 'Saci', 'Mokrani', 'Berkani', 'Ouyahia', 'Boudjedra'];
const RUES = ['Didouche Mourad', "de l'Indépendance", 'Larbi Ben Mhidi', 'Abane Ramdane', 'du 1er Novembre', 'de la Liberté', 'Hassiba Ben Bouali', 'Emir Abdelkader', 'du 8 Mai 1945', 'Colonel Amirouche', 'Mohamed Belouizdad', 'des Frères Bouadou', 'Frantz Fanon', 'des Martyrs', 'Krim Belkacem'];

const pad2 = (n) => String(n).padStart(2, '0');
const genTel = (seed) => `0${550 + (seed % 50)} ${pad2((seed * 7) % 100)} ${pad2((seed * 13) % 100)} ${pad2((seed * 17) % 100)}`;

const insMed = db.prepare(`
  INSERT INTO medecins
    (prenom, nom, sexe, specialite_id, wilaya, ville, adresse, telephone, tarif, accepte_cnas, note, bio_fr, bio_ar, duree_consultation, horaires)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

// Volumes échelonnés : grandes métropoles bien plus dotées
const DOCS_PAR_WILAYA_DEFAULT = 25;
const DOCS_PAR_WILAYA_OVERRIDE = {
  '16': 80, '31': 55, '25': 45, '23': 40, '09': 40, '19': 40,
  '15': 35, '13': 35, '06': 35, '35': 32, '02': 28, '05': 30,
  '11': 12, '37': 12, '33': 12, '50': 12, '52': 12, '53': 12, '54': 12, '56': 12,
};

let medGlobalIdx = 0;
db.exec('BEGIN');
WILAYAS.forEach((w) => {
    const [code, villeFr, villeAr] = w;
    const nbDocs = DOCS_PAR_WILAYA_OVERRIDE[code] || DOCS_PAR_WILAYA_DEFAULT;
    for (let k = 0; k < nbDocs; k++) {
      const gi = medGlobalIdx++;
      const female = (gi * 5 + k) % 3 === 0;
      const prenom = female ? PRENOMS_F[(gi * 3 + k) % PRENOMS_F.length] : PRENOMS_M[(gi * 7 + k) % PRENOMS_M.length];
      const nom = NOMS[(gi * 11 + k * 3) % NOMS.length];
      const si = k % specialites.length;
      const horaires = k % 2 === 0 ? H_MEDECIN : H_MEDECIN_APREM;
      const duree = [20, 30, 20, 30, 25, 30][k % 6];
      const tarif = 1500 + ((gi + k) % 8) * 250;
      const cnas = (gi + k) % 2;
      const note = Math.round((4.0 + ((gi * 3 + k) % 10) / 10) * 10) / 10;
      const adresse = `${((gi * 17 + k) % 120) + 1} Rue ${RUES[(gi + k) % RUES.length]}`;
      const bioFr = `${specialites[si][0]} à ${villeFr}. Consultations sur rendez-vous.`;
      const bioAr = `${specialites[si][1]} في ${villeAr}. الاستشارات بموعد مسبق.`;
      insMed.run(prenom, nom, female ? 'F' : 'M', specIds[si], villeFr, villeFr, adresse, genTel(gi + 3), tarif, cnas, note, bioFr, bioAr, duree, horaires);
    }
});
db.exec('COMMIT');
console.log(`  ✓ ${db.prepare('SELECT COUNT(*) AS n FROM medecins').get().n} médecins générés`);

// ---------------------------------------------------------------------------
// Comptes de démonstration
// ---------------------------------------------------------------------------
const hash = bcrypt.hashSync('demo123', 10);
const insUser = db.prepare(
  'INSERT INTO utilisateurs (prenom, nom, email, telephone, mot_de_passe, role, medecin_id, pharmacie_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
);
insUser.run('Demo', 'Patient', 'demo@afya.dz', '0550 00 00 00', hash, 'patient', null, null);

const medecinDemo = db.prepare('SELECT id, prenom, nom FROM medecins ORDER BY id LIMIT 1').get();
if (medecinDemo) {
  insUser.run(medecinDemo.prenom, medecinDemo.nom, 'medecin@afya.dz', '0550 11 11 11', hash, 'medecin', medecinDemo.id, null);
}

const pharmaDemo = db.prepare('SELECT id, nom FROM pharmacies ORDER BY id LIMIT 1').get();
if (pharmaDemo) {
  insUser.run('Pharmacien', pharmaDemo.nom, 'pharma@afya.dz', '0550 22 22 22', hash, 'pharmacien', null, pharmaDemo.id);
}

// ---------------------------------------------------------------------------
// Résumé
// ---------------------------------------------------------------------------
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
console.log('');
console.log('✓ Base initialisée avec données RÉELLES :');
console.log(`   • ${count('wilayas')} wilayas`);
console.log(`   • ${count('specialites')} spécialités`);
console.log(`   • ${count('medecins')} médecins (générés)`);
console.log(`   • ${count('pharmacies')} pharmacies (annuaire YajidPharma)`);
console.log(`   • ${count('medicaments')} médicaments (nomenclature MIPH officielle)`);
console.log(`   • ${count('stock_pharmacie')} lignes de stock`);
console.log('   • Comptes démo :');
console.log('       - Patient    : demo@afya.dz     / demo123');
console.log('       - Médecin    : medecin@afya.dz  / demo123');
console.log('       - Pharmacien : pharma@afya.dz   / demo123');
console.log('→ Lance maintenant : npm start');
