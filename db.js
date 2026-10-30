const fs = require('fs');
const path = require('path');

const LEGACY_DB_PATH = path.join(__dirname, 'data.json');

// 数据目录：默认与代码同目录；Docker 下由 DATA_DIR 指向数据卷
const DATA_DIR = process.env.DATA_DIR || __dirname;
// DB_PATH 可单独覆盖 data.json 的位置
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');
const COVERS_DIR = process.env.COVERS_DIR || path.join(DATA_DIR, 'covers');

function ensureDirs() {
  for (const dir of [path.dirname(DB_PATH), UPLOADS_DIR, COVERS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    // 首次以数据目录运行时，把仓库里的旧 data.json 迁过去
    if (DB_PATH !== LEGACY_DB_PATH && fs.existsSync(LEGACY_DB_PATH)) {
      try {
        fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
      } catch (e) {
        console.warn('[DB] 迁移旧 data.json 失败:', e.message);
      }
    } else {
      return { users: [], books: [], reading_progress: [] };
    }
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return Object.assign({ users: [], books: [], reading_progress: [] }, data);
  } catch (e) {
    console.warn('[DB] data.json 解析失败，已按空数据库处理:', e.message);
    return { users: [], books: [], reading_progress: [] };
  }
}

// 先写临时文件再改名，避免写入过程中进程退出留下半截文件
function save(data) {
  ensureDirs();
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
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

module.exports = { load, save, get, insert, update, remove, DB_PATH, UPLOADS_DIR, COVERS_DIR, DATA_DIR };
