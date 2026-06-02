/** Fonctions utilitaires : temps (fuseau Algérie), créneaux, ouverture pharmacie. */

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Date/heure actuelles dans le fuseau Africa/Algiers (UTC+1, sans heure d'été). */
function nowDZ() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  const dayIndex = new Date(`${dateStr}T12:00:00`).getDay(); // 0=Dim … 6=Sam
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return { dateStr, dayIndex, minutes };
}

/** Liste des N prochains jours (à partir d'aujourd'hui) sous forme {date, dayIndex, label}. */
function prochainJours(n, daysShort) {
  const { dateStr } = nowDZ();
  const base = new Date(`${dateStr}T12:00:00`);
  const jours = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const di = d.getDay();
    jours.push({
      date: iso,
      dayIndex: di,
      jour: daysShort[di],
      num: d.getDate(),
    });
  }
  return jours;
}

/** Segments d'horaires pour un jour donné. */
function segmentsDuJour(horairesJson, dayIndex) {
  const h = typeof horairesJson === 'string' ? JSON.parse(horairesJson) : horairesJson;
  return h[dayIndex] || h[String(dayIndex)] || [];
}

/** Génère les créneaux libres d'un médecin pour une date donnée. */
function creneauxLibres(horairesJson, duree, dateStr, dayIndex, reserves) {
  const segs = segmentsDuJour(horairesJson, dayIndex);
  const { dateStr: today, minutes: nowMin } = nowDZ();
  const isToday = dateStr === today;
  const pris = new Set(reserves);
  const out = [];
  for (const [start, end] of segs) {
    let t = toMin(start);
    const fin = toMin(end);
    while (t + duree <= fin) {
      const hhmm = toHHMM(t);
      const past = isToday && t <= nowMin;
      if (!pris.has(hhmm) && !past) out.push(hhmm);
      t += duree;
    }
  }
  return out;
}

/** Une pharmacie est-elle ouverte à l'instant T (heure Algérie) ? */
function ouverteMaintenant(horairesJson) {
  const { dayIndex, minutes } = nowDZ();
  const segs = segmentsDuJour(horairesJson, dayIndex);
  return segs.some(([s, e]) => minutes >= toMin(s) && minutes < toMin(e));
}

/** Formate les horaires hebdo en lignes affichables [{jour, texte}]. */
function horairesLisibles(horairesJson, daysShort, fermeLabel) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    const segs = segmentsDuJour(horairesJson, d);
    const texte = segs.length
      ? segs.map(([s, e]) => `${s} – ${e}`).join(' / ')
      : fermeLabel;
    out.push({ jour: daysShort[d], texte, ferme: segs.length === 0 });
  }
  return out;
}

module.exports = {
  toMin, toHHMM, nowDZ, prochainJours, segmentsDuJour,
  creneauxLibres, ouverteMaintenant, horairesLisibles,
};
