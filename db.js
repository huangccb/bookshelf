const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { users: [], books: [], reading_progress: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    return { users: [], books: [], reading_progress: [] };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function get(table) {
  const db = load();
  return db[table] || [];
}

function insert(table, record) {
  const db = load();
  if (!db[table]) db[table] = [];
  db[table].push(record);
  save(db);
  return record;
}

function update(table, predicate, updater) {
  const db = load();
  if (!db[table]) db[table] = [];
  db[table] = db[table].map(item => predicate(item) ? { ...item, ...updater(item) } : item);
  save(db);
}

function remove(table, predicate) {
  const db = load();
  if (!db[table]) db[table] = [];
  db[table] = db[table].filter(item => !predicate(item));
  save(db);
}

module.exports = { load, save, get, insert, update, remove };
