const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('path');

// En prod (Render), la DB peut vivre sur le disque persistant si fourni.
// En local et par défaut : à côté du code.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'afya.db');
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const dbIsNew = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

module.exports = db;
module.exports.dbIsNew = dbIsNew;
module.exports.DB_PATH = DB_PATH;
