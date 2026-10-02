const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'arknights-bookshelf-secret-key';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '登录已过期' });
    req.user = user;
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
  const user = { id, email, password_hash, created_at: new Date().toISOString() };
  db.insert('users', user);
  const token = jwt.sign({ id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id, email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const users = db.get('users');
  const user = users.find(u => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email } });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Book routes
app.post('/api/books', authenticateToken, upload.single('file'), (req, res) => {
  const { title, author, series, volume_number } = req.body;
  if (!req.file || !title) return res.status(400).json({ error: '缺少文件或标题' });
  const id = uuidv4();
  const format = path.extname(req.file.originalname).toLowerCase().replace('.', '');
  const book = {
    id,
    title,
    author: author || '',
    series: series || '',
    volume_number: parseInt(volume_number) || 0,
    format,
    file_path: req.file.filename,
    file_size: req.file.size,
    created_by: req.user.id,
    created_at: new Date().toISOString()
  };
  db.insert('books', book);
  res.json({ id, title, author, series, volume_number: book.volume_number, format, file_size: req.file.size });
});

app.get('/api/books', authenticateToken, (req, res) => {
  const books = db.get('books').sort((a, b) => {
    if (a.series !== b.series) return (a.series || '').localeCompare(b.series || '');
    return (a.volume_number || 0) - (b.volume_number || 0);
  });
  res.json(books);
});

app.get('/api/books/:id', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { file_path, ...rest } = book;
  res.json(rest);
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

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Arknights Bookshelf running on http://localhost:${PORT}`);
});
