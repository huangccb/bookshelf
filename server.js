const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const JSZip = require('jszip');
const { extractEpub } = require('./epub_extract');
const { decodeText } = require('./text_decode');
const metadata = require('./metadata');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'arknights-bookshelf-secret-key';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@rhodes.island';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
const coversDir = path.join(__dirname, 'covers');
for (const d of [uploadsDir, coversDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Seed default admin
function seedAdmin() {
  const users = db.get('users');
  if (!users.find(u => u.email === ADMIN_EMAIL)) {
    const id = uuidv4();
    const password_hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.insert('users', { id, email: ADMIN_EMAIL, password_hash, role: 'admin', created_at: new Date().toISOString() });
    console.log(`[Admin] Created default admin: ${ADMIN_EMAIL}`);
  }
}
seedAdmin();

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '登录已过期' });
    req.user = user;
    req.token = token;
    next();
  });
}

// img / video 等标签无法携带请求头，允许从查询参数取令牌
function authenticateTokenOrQuery(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  if (!token && req.query.token) token = req.query.token.toString();
  if (!token) return res.status(401).json({ error: '未登录' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '登录已过期' });
    req.user = user;
    req.token = token;
    next();
  });
}

// File upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.epub', '.pdf', '.txt', '.docx', '.mobi', '.azw3'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('不支持的文件格式: ' + ext));
  }
});

// Auth routes
app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码不能为空' });
  const users = db.get('users');
  if (users.find(u => u.email === email)) {
    return res.status(409).json({ error: '邮箱已被注册' });
  }
  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);
  const user = { id, email, password_hash, role: 'user', created_at: new Date().toISOString() };
  db.insert('users', user);
  const token = jwt.sign({ id, email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, email, role: user.role } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const users = db.get('users');
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, role: user.role || 'user' } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// 管理员或上传者本人可以修改书籍
function canEditBook(user, book) {
  if (!user || !book) return false;
  return user.role === 'admin' || book.created_by === user.id;
}

// Admin middleware
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// Admin routes
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const users = db.get('users').map(u => ({ id: u.id, email: u.email, role: u.role || 'user', created_at: u.created_at }));
  res.json(users);
});

app.get('/api/admin/books', authenticateToken, requireAdmin, (req, res) => {
  const books = db.get('books');
  res.json(books);
});

// ---------- 元数据检索 ----------

// 按书名搜索候选元数据
app.get('/api/metadata/search', authenticateToken, async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: '请输入书名' });
  try {
    const results = await metadata.searchBooks(q);
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: '元数据检索失败：' + e.message });
  }
});

// 取某条元数据的详情（简介 / 出版社 / ISBN / 页数）
app.get('/api/metadata/detail', authenticateToken, async (req, res) => {
  const id = (req.query.id || '').toString().trim();
  if (!id) return res.status(400).json({ error: '缺少元数据 ID' });
  try {
    const detail = await metadata.getBookDetail(id);
    res.json(detail);
  } catch (e) {
    res.status(502).json({ error: '元数据详情获取失败：' + e.message });
  }
});

// 只允许从豆瓣图床抓封面，避免把服务端变成任意 URL 代理
const COVER_HOST_RE = /^https:\/\/img\d*\.doubanio\.com\//;

// 搜索结果里的封面缩略图代理（img 标签无法带鉴权头，因此不校验登录，但严格限定来源）
app.get('/api/metadata/cover', async (req, res) => {
  const url = (req.query.url || '').toString();
  if (!COVER_HOST_RE.test(url)) return res.status(400).end();
  try {
    const { buffer, contentType } = await metadata.downloadCover(url);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buffer);
  } catch (e) {
    res.status(502).end();
  }
});

// ---------- 书籍 ----------

// 保存封面：下载外链封面并落盘
async function saveCoverFromUrl(bookId, coverUrl) {
  if (!COVER_HOST_RE.test(coverUrl)) throw new Error('封面地址不受支持');
  const { buffer, contentType } = await metadata.downloadCover(coverUrl);
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  const filename = bookId + ext;
  // 清理该书的旧封面
  for (const old of fs.readdirSync(coversDir)) {
    if (old.startsWith(bookId + '.')) {
      try { fs.unlinkSync(path.join(coversDir, old)); } catch (e) {}
    }
  }
  fs.writeFileSync(path.join(coversDir, filename), buffer);
  return filename;
}

app.post('/api/books', authenticateToken, upload.single('file'), async (req, res) => {
  const { title, author, series, volume_number, description, publish_year, publisher, isbn, cover_url } = req.body;
  if (!req.file || !title) return res.status(400).json({ error: '缺少文件或标题' });
  const id = uuidv4();
  const format = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const book = {
    id,
    title,
    author: author || '',
    series: series || '',
    volume_number: parseInt(volume_number) || 0,
    description: description || '',
    publish_year: publish_year || '',
    publisher: publisher || '',
    isbn: isbn || '',
    cover: '',
    format,
    file_path: req.file.filename,
    file_size: req.file.size,
    created_by: req.user.id,
    created_at: new Date().toISOString()
  };
  // 上传时若附带封面地址，一并抓取；失败不阻断上传
  if (cover_url) {
    try {
      book.cover = await saveCoverFromUrl(id, cover_url);
    } catch (e) {
      console.warn('[Cover] 上传时封面保存失败:', e.message);
    }
  }
  db.insert('books', book);
  res.json({ id, title, author, series, volume_number: book.volume_number, format, file_size: req.file.size, cover: book.cover });
});

app.get('/api/books', authenticateToken, (req, res) => {
  const books = db.get('books').sort((a, b) => {
    if (a.series !== b.series) return (a.series || '').localeCompare(b.series || '');
    return (a.volume_number || 0) - (b.volume_number || 0);
  }).map(b => Object.assign({}, b, { can_edit: canEditBook(req.user, b) }));
  res.json(books);
});

app.get('/api/books/:id', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { file_path, ...rest } = book;
  res.json(Object.assign({}, rest, { can_edit: canEditBook(req.user, book) }));
});

// 更新元数据（可同时替换封面）
app.put('/api/books/:id', authenticateToken, async (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  if (!canEditBook(req.user, book)) {
    return res.status(403).json({ error: '只能修改自己上传的书籍' });
  }
  const b = req.body || {};
  const patch = {};
  for (const key of ['title', 'author', 'series', 'description', 'publish_year', 'publisher', 'isbn', 'pages']) {
    if (typeof b[key] === 'string') patch[key] = b[key];
  }
  if (b.volume_number !== undefined) patch.volume_number = parseInt(b.volume_number) || 0;

  if (b.cover_url) {
    try {
      patch.cover = await saveCoverFromUrl(book.id, b.cover_url);
    } catch (e) {
      return res.status(502).json({ error: '封面保存失败：' + e.message });
    }
  }
  db.update('books', x => x.id === book.id, x => Object.assign({}, x, patch));
  const updated = db.get('books').find(x => x.id === book.id);
  const { file_path, ...rest } = updated;
  res.json(rest);
});

// 删除封面
app.delete('/api/books/:id/cover', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  if (!canEditBook(req.user, book)) {
    return res.status(403).json({ error: '只能修改自己上传的书籍' });
  }
  for (const old of fs.readdirSync(coversDir)) {
    if (old.startsWith(book.id + '.')) {
      try { fs.unlinkSync(path.join(coversDir, old)); } catch (e) {}
    }
  }
  db.update('books', x => x.id === book.id, x => Object.assign({}, x, { cover: '' }));
  res.json({ success: true });
});

// 封面图片（供 img 标签直接引用，无需鉴权）
app.get('/api/books/:id/cover', (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book || !book.cover) return res.status(404).end();
  const filePath = path.join(coversDir, path.basename(book.cover));
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

// EPUB 内嵌资源（图片、字体等）：img 标签无法带请求头，故允许从查询参数取令牌
const RESOURCE_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg'
};

// 按书籍缓存解压结果，避免每张图都重新解包
const epubZipCache = new Map();
async function getEpubZip(book) {
  const filePath = path.join(uploadsDir, book.file_path);
  const stat = fs.statSync(filePath);
  const cached = epubZipCache.get(book.id);
  if (cached && cached.mtime === stat.mtimeMs) return cached.zip;
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  epubZipCache.set(book.id, { zip, mtime: stat.mtimeMs });
  return zip;
}

app.get('/api/books/:id/resource', authenticateTokenOrQuery, async (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).end();
  const rel = (req.query.path || '').toString();
  // 只允许读取 EPUB 内部路径，拒绝目录穿越
  if (!rel || rel.includes('..') || rel.startsWith('/')) return res.status(400).end();
  const filePath = path.join(uploadsDir, book.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  try {
    const zip = await getEpubZip(book);
    const entry = zip.file(rel);
    if (!entry) return res.status(404).end();
    const buf = await entry.async('nodebuffer');
    const ext = path.extname(rel).toLowerCase().replace('.', '');
    res.setHeader('Content-Type', RESOURCE_MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end(buf);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/api/books/:id/file', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const filePath = path.join(uploadsDir, book.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  res.sendFile(filePath);
});

// Reading progress
app.post('/api/books/:id/progress', authenticateToken, (req, res) => {
  const { location } = req.body;
  const progress = { user_id: req.user.id, book_id: req.params.id, location: JSON.stringify(location || {}), updated_at: new Date().toISOString() };
  const existing = db.get('reading_progress').find(p => p.user_id === progress.user_id && p.book_id === progress.book_id);
  if (existing) {
    db.update('reading_progress', p => p.user_id === progress.user_id && p.book_id === progress.book_id, () => progress);
  } else {
    db.insert('reading_progress', progress);
  }
  res.json({ success: true });
});

app.get('/api/books/:id/progress', authenticateToken, (req, res) => {
  const row = db.get('reading_progress').find(p => p.user_id === req.user.id && p.book_id === req.params.id);
  res.json({ location: row ? JSON.parse(row.location) : null });
});


// Book content extraction (for online reading)
app.get('/api/books/:id/content', authenticateToken, async (req, res) => {
  // 正文不做缓存，避免编码修复后浏览器仍拿到旧结果
  res.setHeader('Cache-Control', 'no-store');
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const filePath = path.join(uploadsDir, book.file_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件不存在' });
  const buffer = fs.readFileSync(filePath);
  try {
    if (book.format === 'epub') {
      const data = await extractEpub(buffer, { bookId: book.id, token: req.token });
      return res.json({ format: 'epub', title: book.title, chapters: data.chapters });
    }
    if (book.format === 'txt') {
      // 中文 TXT 常见 GBK / Big5，按探测结果解码
      return res.json({ format: 'txt', title: book.title, text: decodeText(buffer) });
    }
    if (book.format === 'docx' || book.format === 'pdf' || book.format === 'mobi' || book.format === 'azw3') {
      // Binary formats: front-end handles them
      return res.json({ format: book.format, title: book.title, file_url: `/api/books/${book.id}/file` });
    }
    return res.json({ format: book.format, title: book.title, file_url: `/api/books/${book.id}/file` });
  } catch (e) {
    return res.status(500).json({ error: '内容解析失败：' + e.message });
  }
});

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Bookshelf running on http://localhost:${PORT}`);
});
