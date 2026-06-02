// fetch-real-data.js
// Télécharge les vraies données algériennes (pharmacies + wilayas) depuis l'API Supabase publique
// de YajidPharma (annuaire de référence des pharmacies en Algérie).
// Les écrit dans ./data/ pour usage par init-bdd.js.

const fs = require('node:fs');
const path = require('node:path');

const SUPA_URL = 'https://sizcbkqrdxwudzmlxlkn.supabase.co';
const SUPA_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpemNia3FyZHh3dWR6bWx4bGtuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDgxMDUsImV4cCI6MjA4OTYyNDEwNX0.xPO9yhnY4M_7Bn6nMSM48jFEFJYKZOvj5-7v4UdNhGI';

const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

async function fetchAll(table, select = '*') {
  const PAGE = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    const res = await fetch(url, {
      headers: { ...headers, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

(async () => {
  console.log('▶ Téléchargement wilayas...');
  const wilayas = await fetchAll('wilayas', 'id,nom,code');
  console.log(`  ${wilayas.length} wilayas`);
  fs.writeFileSync(path.join(dataDir, 'wilayas-real.json'), JSON.stringify(wilayas, null, 2));

  console.log('▶ Téléchargement pharmacies (2391, paginé)...');
  const pharmas = await fetchAll(
    'pharmacies',
    'id,nom,slug,adresse,wilaya_id,lat,lng,telephone,est_de_garde,est_ouverte,pharmacien_nom'
  );
  console.log(`  ${pharmas.length} pharmacies`);
  fs.writeFileSync(path.join(dataDir, 'pharmacies-real.json'), JSON.stringify(pharmas, null, 2));

  console.log('✓ Données réelles sauvegardées dans ./data/');
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
