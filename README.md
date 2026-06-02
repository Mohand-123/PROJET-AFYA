# ✚ Afya · عافية

> **Votre santé, simplifiée — Health, simplified — صحتك ببساطة**

Afya est une plateforme santé bilingue (Français / العربية) inspirée de **Doctolib**, conçue pour l'Algérie. Elle réunit en un seul endroit :

- 🩺 **Prise de rendez-vous médicaux** en ligne 24/7
- 💊 **Disponibilité des médicaments** dans les pharmacies (4 627 spécialités · nomenclature MIPH officielle)
- 🏥 **Horaires + pharmacies de garde** en temps réel (2 391 pharmacies réelles avec GPS)
- 🗺️ **Carte interactive** des pharmacies sur les 58 wilayas
- 🌙 **Mode sombre** et 📱 **PWA installable**

---

## 🇩🇿 Pourquoi Afya ?

L'Algérie compte 45 millions d'habitants mais **aucune plateforme santé nationale** unifiée. Les patients passent encore par le téléphone pour réserver, courent de pharmacie en pharmacie pour vérifier un stock, et n'ont aucun moyen simple de savoir quelle pharmacie est de garde le week-end.

Afya répond à ce vide en couvrant **les 58 wilayas**, en **français ET en arabe** (avec support RTL natif), et en s'appuyant sur des **données officielles réelles** — pas de mocks.

---

## 🛠️ Stack technique

| Couche | Technologie |
|---|---|
| Runtime | **Node.js 22+** |
| Serveur | **Express 4.21** |
| Base de données | **`node:sqlite`** (module natif, sans dépendance native) |
| Templating | **EJS 3.1** (server-rendered) |
| Authentification | **bcryptjs** + **express-session** |
| Cartographie | **Leaflet 1.9** + **leaflet.markercluster** (OpenStreetMap) |
| PWA | **Service Worker** + Web Manifest |
| Front-end | HTML / CSS / JS vanilla — **zéro framework, zéro build** |
| Polices | **Poppins** (latin) + **Cairo** (arabe) |

> 🎯 **Pourquoi pas React/Vite/Next ?** Pour rester pédagogique, performant et déployable n'importe où — un simple `node server.js` suffit.

---

## ✨ Fonctionnalités

### Côté patient
- 🔍 **Recherche** avec autocomplétion (médecins, pharmacies, médicaments)
- 📅 **Réservation de RDV** sur 14 jours, gestion des créneaux libres en temps réel
- ⭐ **Système d'avis** (1-5 étoiles) après chaque consultation
- 🔔 **Notifications** (RDV confirmé, annulé, etc.) avec cloche dans le header
- 👤 **Espace personnel** (« Mon compte ») pour voir/annuler ses RDV
- 🗺️ **Carte interactive** des pharmacies avec filtres (de garde, ouvert maintenant)
- 📱 **Installable** comme une vraie app sur mobile (PWA)

### Côté professionnel
- 🩺 **Espace médecin** : agenda, RDV à venir, horaires, tarifs, conventionnement CNAS
- 💊 **Espace pharmacie** : gestion du stock (4 627 médicaments), mode garde, horaires
- 💼 **Page « Pour les pros »** + grille de **tarifs** (Gratuit / Standard / Premium)

### Multilingue & accessibilité
- 🌍 Bilingue **FR / AR** avec **direction RTL automatique**
- 🌙 **Mode sombre** (toggle dans le header, sauvegardé en session)
- ♿ Respect de `prefers-reduced-motion`
- 🎨 Couleurs accessibles (contrastes WCAG AA)

---

## 🚀 Installation locale

### Prérequis
- **Node.js ≥ 22** (le module `node:sqlite` est natif depuis Node 22.5)
- Git

### Étapes

```bash
# 1. Cloner
git clone https://github.com/Mohand-123/PROJET-AFYA.git
cd PROJET-AFYA

# 2. Installer les dépendances
npm install

# 3. (Optionnel) Re-télécharger les données réelles
node fetch-real-data.js

# 4. Initialiser la base de données (4 627 médicaments + 2 391 pharmacies + 1 541 médecins)
npm run init-bdd

# 5. Lancer le serveur
npm start
```

L'application est disponible sur **http://localhost:3000** 🚀

### Comptes de démo

| Rôle | Email | Mot de passe |
|---|---|---|
| 👤 Patient | `demo@afya.dz` | `demo123` |
| 🩺 Médecin (pro) | voir `init-bdd.js` | `medecin123` |
| 💊 Pharmacien (pro) | voir `init-bdd.js` | `pharma123` |

---

## 📂 Structure du projet

```
afya/
├── server.js              # Routes Express, middlewares, i18n, sessions
├── init-bdd.js            # Initialise la BDD avec les données réelles
├── fetch-real-data.js     # Récupère pharmacies/médicaments depuis les API publiques
├── db.js                  # Connexion node:sqlite
├── helpers.js             # Utilitaires (horaires, créneaux, fuseau Algiers)
├── data/
│   ├── medicaments.json   # 4 627 médicaments (nomenclature MIPH)
│   ├── pharmacies-real.json   # 2 391 pharmacies + GPS
│   └── wilayas-real.json  # 58 wilayas officielles
├── locales/
│   ├── fr.json            # Traductions françaises (~250 clés)
│   └── ar.json            # Traductions arabes (~250 clés)
├── views/                 # Templates EJS
│   ├── partials/          # head, foot, pagination, pro-nav
│   ├── pro/               # Vues espace pro (médecin, pharmacie)
│   ├── index.ejs · medecins.ejs · pharmacies.ejs · medicaments.ejs
│   ├── carte.ejs · a-propos.ejs · contact.ejs · tarifs.ejs ...
└── public/
    ├── style.css          # Feuille de style unique (dark mode inclus)
    ├── app.js             # JS client (autocomplete, reveal, PWA)
    ├── sw.js              # Service Worker (cache-first assets)
    ├── manifest.webmanifest
    └── icons/
```

---

## 📊 Données

Toutes les données sont **réelles** et issues de sources publiques :

| Source | Données | Volume |
|---|---|---|
| **YajidPharma** (annuaire public) | Pharmacies algériennes + GPS | 2 391 |
| **Ministère de l'Industrie Pharmaceutique (MIPH)** | Nomenclature officielle des médicaments | 4 627 |
| **Wikipedia + référentiel officiel** | 58 wilayas (codes, noms FR/AR) | 58 |
| Généré (aucune source publique) | Médecins fictifs | 1 541 |

> Aucune liste publique exhaustive des médecins privés n'existe en Algérie — le Conseil de l'Ordre ne la publie pas. Les médecins sont donc générés mais distribués réalistiquement sur les 58 wilayas.

---

## 🎨 Captures d'écran

```
┌─ Accueil ──────────────────────────────────────┐
│  Hero gradient teal · Recherche multi-tabs    │
│  Stats animées · 3 étapes · Battement de cœur │
└────────────────────────────────────────────────┘

┌─ Carte ────────────────────────────────────────┐
│  2 390 markers clusterisés · Filtre garde     │
│  Légende · Popup pharmacie · GPS              │
└────────────────────────────────────────────────┘

┌─ Tarifs ───────────────────────────────────────┐
│  Gratuit · Standard 2 990 DA · Premium 6 990  │
│  FAQ accordéon · Paiement CIB/Edahabia        │
└────────────────────────────────────────────────┘
```

---

## ⚡ Performance

| Page | Temps de réponse |
|---|---|
| Accueil | ~100 ms |
| Liste médecins (1 541 entrées) | ~40 ms (paginée 60/page) |
| Liste pharmacies (2 391 entrées) | ~30 ms (paginée) |
| Liste médicaments (4 627 entrées) | ~40 ms (cache 5 min + pagination) |
| Carte (GeoJSON 2 390 markers) | ~200 ms |

Optimisations notables :
- **Cache TTL 5 min** sur l'agrégation `nb_dispo` (évite un GROUP BY sur 358k lignes par requête)
- **Pré-chauffage** du cache au démarrage
- **Pagination** sur les grandes listes (60 par page)
- **Index** SQLite sur les colonnes filtrées

---

## 🌍 Internationalisation (i18n)

Système simple basé sur deux fichiers JSON :

```js
// Dans la vue
<%= t('nav_doctors') %>   // → "Médecins" en FR, "الأطباء" en AR
<%= L(med.nom_fr, med.nom_ar) %>  // → choisit la bonne langue
```

L'attribut `dir="rtl"` est posé automatiquement sur `<html>` quand la langue est l'arabe, ce qui inverse toute la mise en page (icônes, marges, textes alignés à droite).

---

## 🔐 Sécurité

- 🔒 Mots de passe hashés avec **bcrypt** (rounds=10)
- 🍪 Sessions HTTP-only stockées côté serveur
- ✅ Validation des entrées sur tous les formulaires
- 🛡️ Échappement EJS automatique (XSS)
- 🚫 Pas d'API publique exposant des données sensibles

---

## ☁️ Déploiement sur Render

L'application est prête pour [Render.com](https://render.com) (déploiement gratuit) :

1. Fork ce repo (ou utilise le tien)
2. Sur Render → **New +** → **Web Service** → connecte ton GitHub
3. Sélectionne le repo → Render détecte automatiquement le fichier `render.yaml`
4. Clique **Deploy** — c'est tout 🚀

Le premier déploiement prend ~3 minutes (npm install + init-bdd auto). Ensuite l'app tourne sur `https://afya.onrender.com`.

> ⚠️ Le free tier de Render met en veille après 15 min d'inactivité. La 1ère requête après veille prend ~30 s de réveil.

---

## 📜 Licence

**MIT** — projet libre et open-source.

Les données médicaments proviennent de sources publiques (nomenclature MIPH).
Les données pharmacies proviennent de YajidPharma (données publiques).

---

## 👨‍💻 Auteur

**Amir Mohand Arezki** — Étudiant B1 Ynov · 🇩🇿
- 📧 [mohandpro744@gmail.com](mailto:mohandpro744@gmail.com)
- 🐙 [@Mohand-123](https://github.com/Mohand-123)

---

## 🤝 Contribuer

Les contributions sont bienvenues ! Ouvre une issue ou une PR.

```bash
git checkout -b feature/ma-feature
git commit -m "feat: nouvelle fonctionnalité"
git push origin feature/ma-feature
```

---

<p align="center">
  <strong>Afya</strong> · Conçu et développé en Algérie 🇩🇿 avec ❤️<br/>
  <em>« الصحة تاج فوق رؤوس الأصحاء » — La santé est une couronne sur la tête des bien-portants</em>
</p>
