const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const JSZip = require('jszip');
const { extractEpub, extractEpubCover } = require('./epub_extract');
const { decodeText } = require('./text_decode');
const metadata = require('./metadata');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'arknights-bookshelf-secret-key';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@admin.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
// 旧版默认管理员。升级时把它的角色与书籍归属迁到新管理员名下，避免出现第二个管理员
const LEGACY_ADMIN_EMAILS = (process.env.LEGACY_ADMIN_EMAILS || 'admin@rhodes.island')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// 后台地址：固定为 /admin，不在前台页面暴露入口
const ADMIN_PATH = '/admin';

app.use(express.json({ limit: '2mb' }));

// 独立页面的地址映射：登录、注册各有一个固定网址，后台固定 /admin
const PAGE_PATHS = {
  '/login': 'login.html',
  '/register': 'register.html'
};

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  // 静态目录里的文件不直接暴露，统一走下面的固定网址
  if (req.path === '/admin.html') return res.redirect(301, ADMIN_PATH);
  if (req.path === '/login.html') return res.redirect(301, '/login');
  if (req.path === '/register.html') return res.redirect(301, '/register');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// 书籍文件与封面统一放在数据目录（Docker 下由数据卷提供）
const uploadsDir = db.UPLOADS_DIR;
const coversDir = db.COVERS_DIR;
for (const d of [uploadsDir, coversDir]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ---------- 账户初始化与迁移 ----------

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const NAME_MAX = 32;

// 账户审批状态：注册后为 pending，管理员批准后才是 active
const USER_STATUSES = ['pending', 'active', 'rejected'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 历史数据没有 status，按已批准处理，避免升级后把老账户锁在门外
function statusOf(user) {
  return user && USER_STATUSES.includes(user.status) ? user.status : 'active';
}

function approvalError(status) {
  if (status === 'rejected') {
    return { error: '该账户未通过审批，请联系管理员', code: 'ACCOUNT_REJECTED' };
  }
  return { error: '账户正在等待管理员审批，审批通过后即可登录', code: 'ACCOUNT_PENDING' };
}

// 用户名只是显示名：注册必填，老账户留空时取邮箱 @ 前半段
function fallbackName(email) {
  const local = normalizeEmail(email).split('@')[0] || '';
  return local.slice(0, NAME_MAX) || '读者';
}

function seedAdmin() {
  const users = db.get('users');
  const target = normalizeEmail(ADMIN_EMAIL);

  // 1) 旧默认管理员改名：保留其历史、密码与书籍归属，账号直接变成 new email
  for (const legacy of LEGACY_ADMIN_EMAILS) {
    if (legacy === target) continue;
    const old = users.find(u => normalizeEmail(u.email) === legacy);
    if (!old) continue;
    if (users.find(u => normalizeEmail(u.email) === target)) continue;
    db.update('users', u => u.id === old.id, u => Object.assign({}, u, { email: target, role: 'admin' }));
    old.email = target;
    old.role = 'admin';
    console.log(`[Admin] Renamed legacy admin ${legacy} -> ${target}`);
  }

  // 2) 确保目标管理员存在且拥有管理员角色
  const fresh = db.get('users');
  const existing = fresh.find(u => normalizeEmail(u.email) === target);
  if (!existing) {
    const password_hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.insert('users', {
      id: uuidv4(),
      email: target,
      name: fallbackName(target),
      password_hash,
      role: 'admin',
      status: 'active',
      created_at: new Date().toISOString()
    });
    console.log(`[Admin] Created default admin: ${target}`);
  } else if (existing.role !== 'admin' || statusOf(existing) !== 'active') {
    db.update('users', u => u.id === existing.id, u => Object.assign({}, u, { role: 'admin', status: 'active' }));
    console.log(`[Admin] Promoted ${target} to admin`);
  }

  // 3) 其它账户缺失角色时补成普通用户
  db.update('users', u => !u.role, u => Object.assign({}, u, { role: 'user' }));

  // 4) 缺用户名的账户补邮箱前缀，保证顶栏始终有名字可显示
  db.update('users', u => !String(u.name || '').trim(),
    u => Object.assign({}, u, { name: fallbackName(u.email) }));

  // 5) 旧账户默认已批准；审批状态只由后台变更
  db.update('users', u => !u.status, u => Object.assign({}, u, { status: 'active' }));
}
seedAdmin();

// ---------- 鉴权 ----------

async function attachUser(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(403).json({ error: '登录已过期' });
  }
  // 每次都回查用户：角色变更、账号被删、审批状态变化后，旧令牌立即失效
  const user = db.get('users').find(u => u.id === payload.id);
  if (!user) return res.status(403).json({ error: '登录已过期' });
  const status = statusOf(user);
  if (status !== 'active') return res.status(403).json(approvalError(status));
  req.user = publicUser(user);
  req.token = token;
  next();
}

function authenticateToken(req, res, next) {
  attachUser(req, res, next);
}

// img / video 等标签无法携带请求头，允许从查询参数取令牌
function authenticateTokenOrQuery(req, res, next) {
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = 'Bearer ' + req.query.token.toString();
  }
  attachUser(req, res, next);
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

// 权限一览：管理员拥有全部权限；普通用户只能阅读、下载、上传，并修改自己上传的书籍
const ADMIN_PERMISSIONS = ['read', 'download', 'upload', 'edit_own', 'edit_any', 'delete_any', 'manage_users'];
const USER_PERMISSIONS = ['read', 'download', 'upload', 'edit_own'];

function permissionsOf(role) {
  return role === 'admin' ? ADMIN_PERMISSIONS.slice() : USER_PERMISSIONS.slice();
}

function publicUser(u) {
  const status = statusOf(u);
  const role = u.role || 'user';
  return {
    id: u.id,
    email: u.email,
    name: u.name || fallbackName(u.email),
    role,
    status,
    created_at: u.created_at,
    // 待审批/已拒绝的账户没有可用权限；批准后恢复普通用户权限
    permissions: status === 'active' ? permissionsOf(role) : []
  };
}

// 管理员或上传者本人可以修改书籍；删除只有管理员可以
function canEditBook(user, book) {
  if (!user || !book) return false;
  return user.role === 'admin' || book.created_by === user.id;
}

function canDeleteBook(user) {
  return !!user && user.role === 'admin';
}

// ---------- 上传 ----------

const BOOK_EXTENSIONS = ['.epub', '.pdf', '.txt', '.docx', '.mobi', '.azw3'];
const COVER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const COVER_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const storage = multer.diskStorage({
  // 书籍文件进 uploads，封面临时文件先放 covers，写入记录后再改成书籍专属文件名
  destination: (req, file, cb) => {
    const isCover = file.fieldname === 'cover_file' || file.fieldname === 'cover';
    cb(null, isCover ? coversDir : uploadsDir);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isCover = file.fieldname === 'cover_file' || file.fieldname === 'cover';
    if (isCover) {
      if (COVER_MIMES.includes(file.mimetype) && COVER_EXTENSIONS.includes(ext)) return cb(null, true);
      return cb(new Error('封面只支持 JPG、PNG、WebP、GIF 图片'));
    }
    if (file.fieldname === 'file' && BOOK_EXTENSIONS.includes(ext)) return cb(null, true);
    return cb(new Error('不支持的文件格式: ' + ext));
  }
});

// ---------- 认证 ----------

app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  const normalized = normalizeEmail(email);
  const displayName = String(name == null ? '' : name).trim();
  const pass = String(password == null ? '' : password);

  if (!normalized || !pass) return res.status(400).json({ error: '邮箱和密码不能为空' });
  if (!EMAIL_PATTERN.test(normalized)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!displayName) return res.status(400).json({ error: '请填写显示名称' });
  if (displayName.length > NAME_MAX) {
    return res.status(400).json({ error: `显示名称不能超过 ${NAME_MAX} 个字符` });
  }
  if (pass.length < 6) return res.status(400).json({ error: '密码至少 6 位' });

  const users = db.get('users');
  if (users.find(u => normalizeEmail(u.email) === normalized)) {
    return res.status(409).json({ error: '该邮箱已被注册，请直接登录' });
  }

  // 注册只创建待审批的普通用户，不签发令牌
  const user = {
    id: uuidv4(),
    email: normalized,
    name: displayName,
    password_hash: bcrypt.hashSync(pass, 10),
    role: 'user',
    status: 'pending',
    created_at: new Date().toISOString()
  };
  db.insert('users', user);
  res.status(201).json({
    pending: true,
    message: '注册申请已提交，请等待管理员审批',
    user: publicUser(user)
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalized = normalizeEmail(email);
  const users = db.get('users');
  const user = users.find(u => normalizeEmail(u.email) === normalized);
  if (!user || !bcrypt.compareSync(String(password == null ? '' : password), user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  // 密码正确后才暴露审批状态，避免未认证探测
  const status = statusOf(user);
  if (status !== 'active') return res.status(403).json(approvalError(status));
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role || 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});

// 健康检查：供 Docker / 反向代理探活
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  // attachUser 已返回完整的 publicUser（含 name/status/permissions）
  res.json({ user: req.user });
});

// ---------- 账户自助 ----------

// 修改自己的显示名称、邮箱、密码；改邮箱或密码需要额外验证当前密码
app.put('/api/account', authenticateToken, (req, res) => {
  const body = req.body || {};
  const { name, email, current_password, new_password, confirm_password } = body;
  const user = db.get('users').find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: '账户不存在' });

  const patch = {};
  let emailChanged = false;

  if (name !== undefined) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return res.status(400).json({ error: '显示名称不能为空' });
    if (trimmed.length > NAME_MAX) {
      return res.status(400).json({ error: `显示名称不能超过 ${NAME_MAX} 个字符` });
    }
    patch.name = trimmed;
  }

  if (email !== undefined) {
    const normalized = normalizeEmail(email);
    if (!normalized || !EMAIL_PATTERN.test(normalized)) {
      return res.status(400).json({ error: '邮箱格式不正确' });
    }
    const taken = db.get('users').find(u => u.id !== user.id && normalizeEmail(u.email) === normalized);
    if (taken) return res.status(409).json({ error: '邮箱已被使用' });
    emailChanged = normalized !== normalizeEmail(user.email);
    patch.email = normalized;
  }

  let passwordChanged = false;
  if (new_password) {
    const next = String(new_password);
    if (next.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
    if (confirm_password === undefined) {
      return res.status(400).json({ error: '请再次输入新密码' });
    }
    if (next !== String(confirm_password)) {
      return res.status(400).json({ error: '两次输入的密码不一致' });
    }
    patch.password_hash = bcrypt.hashSync(next, 10);
    passwordChanged = true;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: '没有需要修改的内容' });
  }

  // 敏感信息（邮箱、密码）变化时才要求当前密码；只改显示名称不需要
  if (emailChanged || passwordChanged) {
    if (!current_password) return res.status(400).json({ error: '请输入当前密码' });
    if (!bcrypt.compareSync(String(current_password), user.password_hash)) {
      return res.status(403).json({ error: '当前密码不正确' });
    }
  }

  db.update('users', u => u.id === user.id, u => Object.assign({}, u, patch));
  const updated = db.get('users').find(u => u.id === user.id);

  // 邮箱或密码变了就重新签发令牌，避免旧令牌里残留旧邮箱
  let token;
  if (passwordChanged || emailChanged) {
    token = jwt.sign({ id: updated.id, email: updated.email, role: updated.role || 'user' }, JWT_SECRET, { expiresIn: '7d' });
  }
  res.json({ success: true, user: publicUser(updated), token });
});

// 修改自己的密码
app.post('/api/auth/password', authenticateToken, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!new_password || String(new_password).length < 6) {
    return res.status(400).json({ error: '新密码至少 6 位' });
  }
  const user = db.get('users').find(u => u.id === req.user.id);
  if (!user || !bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(403).json({ error: '当前密码不正确' });
  }
  const password_hash = bcrypt.hashSync(String(new_password), 10);
  db.update('users', u => u.id === user.id, u => Object.assign({}, u, { password_hash }));
  res.json({ success: true });
});

// ---------- 后台：用户与权限 ----------

app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const books = db.get('books');
  const users = db.get('users').map(u => Object.assign(publicUser(u), {
    book_count: books.filter(b => b.created_by === u.id).length
  }));
  const statusRank = { pending: 0, active: 1, rejected: 2 };
  users.sort((a, b) =>
    (statusRank[a.status] == null ? 3 : statusRank[a.status]) - (statusRank[b.status] == null ? 3 : statusRank[b.status]) ||
    (a.role === 'admin' ? 0 : 1) - (b.role === 'admin' ? 0 : 1) ||
    String(a.created_at).localeCompare(String(b.created_at))
  );
  res.json(users);
});

// 新建账户：管理员可直接指定角色；后台创建的账户视为已批准
app.post('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const { email, password, role } = req.body || {};
  const normalized = normalizeEmail(email);
  if (!normalized || !password) return res.status(400).json({ error: '邮箱和密码不能为空' });
  if (!EMAIL_PATTERN.test(normalized)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (role && role !== 'admin' && role !== 'user') return res.status(400).json({ error: '角色不正确' });
  if (db.get('users').find(u => normalizeEmail(u.email) === normalized)) {
    return res.status(409).json({ error: '邮箱已被注册' });
  }
  const user = {
    id: uuidv4(),
    email: normalized,
    password_hash: bcrypt.hashSync(String(password), 10),
    role: role === 'admin' ? 'admin' : 'user',
    status: 'active',
    created_at: new Date().toISOString()
  };
  db.insert('users', user);
  res.json(publicUser(user));
});

// 审批状态 / 修改角色 / 重置密码 / 改邮箱
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  const target = db.get('users').find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: '账户不存在' });
  const { role, password, email, status } = req.body || {};
  const patch = {};

  if (status !== undefined) {
    if (!USER_STATUSES.includes(status)) return res.status(400).json({ error: '审批状态不正确' });
    // 防止管理员把自己或其它管理员锁在后台之外
    if (target.id === req.user.id && status !== 'active') {
      return res.status(400).json({ error: '不能停用自己的账户' });
    }
    if (target.role === 'admin' && status !== 'active') {
      return res.status(400).json({ error: '不能停用管理员账户' });
    }
    patch.status = status;
  }

  // 待审批/已拒绝的账户先批准再改角色，避免出现无法登录的管理员
  const effectiveStatus = patch.status || statusOf(target);
  if (role !== undefined) {
    if (role !== 'admin' && role !== 'user') return res.status(400).json({ error: '角色不正确' });
    if (effectiveStatus !== 'active') {
      return res.status(400).json({ error: '请先批准该账户，再调整角色' });
    }
    if (target.id === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: '不能取消自己的管理员身份' });
    }
    patch.role = role;
  }
  if (email !== undefined) {
    const normalized = normalizeEmail(email);
    if (!normalized) return res.status(400).json({ error: '邮箱不能为空' });
    if (!EMAIL_PATTERN.test(normalized)) return res.status(400).json({ error: '邮箱格式不正确' });
    if (db.get('users').find(u => u.id !== target.id && normalizeEmail(u.email) === normalized)) {
      return res.status(409).json({ error: '邮箱已被使用' });
    }
    patch.email = normalized;
  }
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    patch.password_hash = bcrypt.hashSync(String(password), 10);
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: '没有需要修改的内容' });

  db.update('users', u => u.id === target.id, u => Object.assign({}, u, patch));
  const updated = db.get('users').find(u => u.id === target.id);
  res.json(publicUser(updated));
});

app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: '不能删除自己的账户' });
  const target = db.get('users').find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: '账户不存在' });
  db.remove('users', u => u.id === target.id);
  db.remove('reading_progress', p => p.user_id === target.id);
  res.json({ success: true });
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
  const books = db.get('books');
  const users = db.get('users');
  res.json({
    books: books.length,
    users: users.length,
    admins: users.filter(u => u.role === 'admin').length,
    pending: users.filter(u => statusOf(u) === 'pending').length,
    size: books.reduce((sum, b) => sum + (b.file_size || 0), 0)
  });
});

// 兼容旧接口：后台书籍列表与普通列表一致，额外带上传者邮箱
app.get('/api/admin/books', authenticateToken, requireAdmin, (req, res) => {
  const users = db.get('users');
  const books = db.get('books').map(b => {
    const owner = users.find(u => u.id === b.created_by);
    const { file_path, ...rest } = b;
    return Object.assign({}, rest, {
      owner_email: owner ? owner.email : '已删除的账户',
      can_edit: true,
      can_delete: true
    });
  });
  books.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(books);
});

// 批量操作：仅支持批量删除
app.post('/api/books/batch', authenticateToken, requireAdmin, (req, res) => {
  const { action, ids } = req.body || {};
  if (action !== 'delete') return res.status(400).json({ error: '不支持的批量操作' });
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请先选择书籍' });
  const targets = db.get('books').filter(b => ids.indexOf(b.id) >= 0);
  if (targets.length === 0) return res.status(404).json({ error: '选中的书籍不存在' });
  targets.forEach(removeBookFiles);
  const idSet = new Set(targets.map(b => b.id));
  db.remove('books', b => idSet.has(b.id));
  db.remove('reading_progress', p => idSet.has(p.book_id));
  res.json({ success: true, deleted: targets.length });
});

// ---------- 元数据检索 ----------

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

// 封面代理：支持豆瓣与自定义图片地址；metadata.downloadCover 会限制协议、内网地址与大小
app.get('/api/metadata/cover', async (req, res) => {
  const url = (req.query.url || '').toString().trim();
  if (!url) return res.status(400).end();
  try {
    const { buffer, contentType } = await metadata.downloadCover(url);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buffer);
  } catch (e) {
    res.status(502).end();
  }
});

// ---------- 书籍封面 ----------

function coverExtFromMime(contentType, fallback) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = COVER_EXT_BY_MIME[type];
  if (ext) return ext;
  if (fallback && COVER_EXTENSIONS.includes(fallback)) return fallback;
  throw new Error('封面格式不支持，仅支持 JPG、PNG、WebP、GIF');
}

function removeCoverFiles(bookId) {
  if (!bookId || !fs.existsSync(coversDir)) return;
  for (const old of fs.readdirSync(coversDir)) {
    if (old === bookId || old.startsWith(bookId + '.') || old.startsWith(bookId + '-')) {
      try { fs.unlinkSync(path.join(coversDir, old)); } catch (e) {}
    }
  }
}

// 封面统一用「书籍 ID + UUID」命名，换封面后 URL 也变化，避免浏览器缓存旧图
function saveCoverBuffer(bookId, buffer, contentType) {
  if (!buffer || buffer.length > COVER_MAX_BYTES) throw new Error('封面图片不能超过 5MB');
  const filename = `${bookId}-${uuidv4()}${coverExtFromMime(contentType)}`;
  removeCoverFiles(bookId);
  fs.writeFileSync(path.join(coversDir, filename), buffer);
  return filename;
}

function saveUploadedCover(bookId, file) {
  const ext = coverExtFromMime(file.mimetype, path.extname(file.originalname).toLowerCase());
  const filename = `${bookId}-${uuidv4()}${ext}`;
  removeCoverFiles(bookId);
  fs.renameSync(file.path, path.join(coversDir, filename));
  return filename;
}

function discardUploadedFile(file) {
  if (!file || !file.path) return;
  try { fs.unlinkSync(file.path); } catch (e) {}
}

async function saveCoverFromUrl(bookId, coverUrl) {
  const { buffer, contentType } = await metadata.downloadCover(coverUrl);
  return saveCoverBuffer(bookId, buffer, contentType);
}

// 只有 EPUB 能可靠读取内嵌封面；用户提供封面时不会走到这里
async function saveEmbeddedCover(book) {
  if (!book || book.format !== 'epub' || !book.file_path) return '';
  const filePath = path.join(uploadsDir, path.basename(book.file_path));
  if (!fs.existsSync(filePath)) return '';
  const cover = await extractEpubCover(fs.readFileSync(filePath));
  if (!cover) return '';
  return saveCoverBuffer(book.id, cover.buffer, cover.contentType);
}

// 删除书籍对应的文件、封面与解压缓存
function removeBookFiles(book) {
  if (!book) return;
  try {
    if (book.file_path) {
      const f = path.join(uploadsDir, path.basename(book.file_path));
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  } catch (e) {
    console.warn('[Delete] 文件删除失败:', e.message);
  }
  try { removeCoverFiles(book.id); } catch (e) {}
  epubZipCache.delete(book.id);
}

app.post('/api/books', authenticateToken, upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'cover_file', maxCount: 1 }
]), async (req, res) => {
  const { title, author, series, volume_number, description, publish_year, publisher, isbn, cover_url } = req.body;
  const files = req.files || {};
  const bookFile = (files.file || [])[0];
  const coverFile = (files.cover_file || [])[0];
  const titleText = String(title || '').trim();
  const seriesText = String(series || '').trim();
  const discardAll = () => {
    discardUploadedFile(bookFile);
    discardUploadedFile(coverFile);
  };

  // 有系列时书名可以留空，标题回退为系列名
  if (!bookFile || (!titleText && !seriesText)) {
    discardAll();
    return res.status(400).json({ error: '缺少文件、书名或系列' });
  }
  if (coverFile && coverFile.size > COVER_MAX_BYTES) {
    discardAll();
    return res.status(400).json({ error: '封面图片不能超过 5MB' });
  }

  const id = uuidv4();
  const format = path.extname(bookFile.originalname).toLowerCase().replace('.', '');
  const book = {
    id,
    title: titleText || seriesText,
    author: author || '',
    series: seriesText,
    volume_number: parseInt(volume_number) || 0,
    description: description || '',
    publish_year: publish_year || '',
    publisher: publisher || '',
    isbn: isbn || '',
    cover: '',
    cover_source: '',
    format,
    file_path: bookFile.filename,
    file_size: bookFile.size,
    created_by: req.user.id,
    created_at: new Date().toISOString()
  };

  // 封面优先级：用户上传的图片 > 用户填写的地址 > 书籍自带封面
  let coverError = '';
  if (coverFile) {
    try {
      book.cover = saveUploadedCover(id, coverFile);
      book.cover_source = 'user';
    } catch (e) {
      coverError = '封面保存失败';
      discardUploadedFile(coverFile);
      console.warn('[Cover] 上传封面保存失败:', e.message);
    }
  } else if (cover_url) {
    try {
      book.cover = await saveCoverFromUrl(id, cover_url);
      book.cover_source = 'user';
    } catch (e) {
      coverError = '封面地址获取失败';
      console.warn('[Cover] 上传时封面保存失败:', e.message);
    }
  }

  if (!book.cover) {
    try {
      book.cover = await saveEmbeddedCover(book);
      if (book.cover) book.cover_source = 'embedded';
    } catch (e) {
      console.warn('[Cover] 内嵌封面读取失败:', e.message);
    }
  }

  let coverWarning = '';
  if (coverError) {
    coverWarning = book.cover && book.cover_source === 'embedded'
      ? coverError + '，已使用书籍自带封面'
      : coverError;
  }

  db.insert('books', book);
  res.json({
    id,
    title: book.title,
    author,
    series: book.series,
    volume_number: book.volume_number,
    format,
    file_size: book.file_size,
    cover: book.cover,
    cover_source: book.cover_source,
    cover_warning: coverWarning || undefined
  });
});

app.get('/api/books', authenticateToken, (req, res) => {
  const books = db.get('books').sort((a, b) => {
    if (a.series !== b.series) return (a.series || '').localeCompare(b.series || '');
    return (a.volume_number || 0) - (b.volume_number || 0);
  }).map(b => Object.assign({}, b, {
    can_edit: canEditBook(req.user, b),
    can_delete: canDeleteBook(req.user)
  }));
  res.json(books);
});

// 已有系列名列表：上传页用来提供可点击的系列选项
app.get('/api/series', authenticateToken, (req, res) => {
  const series = Array.from(new Set(
    db.get('books')
      .map(b => String(b.series || '').trim())
      .filter(Boolean)
  ));
  series.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  res.json({ series });
});

app.get('/api/books/:id', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { file_path, ...rest } = book;
  res.json(Object.assign({}, rest, {
    can_edit: canEditBook(req.user, book),
    can_delete: canDeleteBook(req.user)
  }));
});

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
      patch.cover_source = 'user';
    } catch (e) {
      return res.status(502).json({ error: '封面保存失败：' + e.message });
    }
  }
  db.update('books', x => x.id === book.id, x => Object.assign({}, x, patch));
  const updated = db.get('books').find(x => x.id === book.id);
  const { file_path, ...rest } = updated;
  res.json(rest);
});

// 删除书籍：仅管理员
app.delete('/api/books/:id', authenticateToken, requireAdmin, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  removeBookFiles(book);
  db.remove('books', b => b.id === book.id);
  db.remove('reading_progress', p => p.book_id === book.id);
  res.json({ success: true });
});

// 上传或替换封面（图片文件）
app.post('/api/books/:id/cover', authenticateToken, upload.single('cover'), (req, res) => {
  const file = req.file;
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) {
    discardUploadedFile(file);
    return res.status(404).json({ error: '书籍不存在' });
  }
  if (!canEditBook(req.user, book)) {
    discardUploadedFile(file);
    return res.status(403).json({ error: '只能修改自己上传的书籍' });
  }
  if (!file) return res.status(400).json({ error: '请选择封面图片' });
  if (file.size > COVER_MAX_BYTES) {
    discardUploadedFile(file);
    return res.status(400).json({ error: '封面图片不能超过 5MB' });
  }
  try {
    const cover = saveUploadedCover(book.id, file);
    db.update('books', x => x.id === book.id, x => Object.assign({}, x, { cover, cover_source: 'user' }));
    const updated = db.get('books').find(x => x.id === book.id);
    const { file_path, ...rest } = updated;
    res.json(rest);
  } catch (e) {
    discardUploadedFile(file);
    res.status(500).json({ error: '封面保存失败：' + e.message });
  }
});

// 从 EPUB 文件重新读取内嵌封面
app.post('/api/books/:id/cover/embedded', authenticateToken, async (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  if (!canEditBook(req.user, book)) {
    return res.status(403).json({ error: '只能修改自己上传的书籍' });
  }
  if (book.format !== 'epub') {
    return res.status(400).json({ error: '只有 EPUB 支持读取内嵌封面' });
  }
  try {
    const cover = await saveEmbeddedCover(book);
    if (!cover) return res.status(404).json({ error: '没有找到内嵌封面' });
    db.update('books', x => x.id === book.id, x => Object.assign({}, x, { cover, cover_source: 'embedded' }));
    const updated = db.get('books').find(x => x.id === book.id);
    const { file_path, ...rest } = updated;
    res.json(rest);
  } catch (e) {
    res.status(500).json({ error: '内嵌封面读取失败：' + e.message });
  }
});

// 删除封面
app.delete('/api/books/:id/cover', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  if (!canEditBook(req.user, book)) {
    return res.status(403).json({ error: '只能修改自己上传的书籍' });
  }
  removeCoverFiles(book.id);
  db.update('books', x => x.id === book.id, x => Object.assign({}, x, { cover: '', cover_source: '' }));
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

// 阅读进度
// 打开阅读器即写入历史：last_read_at 用于历史排序，updated_at 用于进度保存
app.post('/api/books/:id/progress', authenticateToken, (req, res) => {
  const book = db.get('books').find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '书籍不存在' });
  const { location } = req.body || {};
  const now = new Date().toISOString();
  const progress = {
    user_id: req.user.id,
    book_id: book.id,
    location: JSON.stringify(location || {}),
    updated_at: now,
    last_read_at: now
  };
  const key = p => p.user_id === req.user.id && p.book_id === book.id;
  const existing = db.get('reading_progress').find(key);
  if (existing) {
    // 保留原有进度位置，除非这次明确传了新的位置
    const merged = location === undefined || location === null
      ? Object.assign({}, progress, { location: existing.location })
      : progress;
    db.update('reading_progress', key, () => merged);
  } else {
    db.insert('reading_progress', progress);
  }
  res.json({ success: true, last_read_at: now });
});

app.get('/api/books/:id/progress', authenticateToken, (req, res) => {
  const row = db.get('reading_progress').find(p => p.user_id === req.user.id && p.book_id === req.params.id);
  res.json({ location: row ? JSON.parse(row.location) : null });
});

// ---------- 个人数据 ----------

// 网格卡片只需要这些字段
function bookSummary(book) {
  return {
    id: book.id,
    title: book.title,
    author: book.author || '',
    series: book.series || '',
    volume_number: book.volume_number || 0,
    format: book.format || '',
    cover: book.cover || ''
  };
}

function readPaging(req) {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  return { limit, offset };
}

// 历史阅读记录：按最近阅读时间倒序
app.get('/api/history', authenticateToken, (req, res) => {
  const { limit, offset } = readPaging(req);
  const books = db.get('books');
  const bookMap = new Map(books.map(b => [b.id, b]));
  const rows = db.get('reading_progress').filter(p => p.user_id === req.user.id);

  // 书籍已被删除的记录顺手清理
  const orphans = rows.filter(p => !bookMap.has(p.book_id)).map(p => p.book_id);
  if (orphans.length) {
    const orphanSet = new Set(orphans);
    db.remove('reading_progress', p => p.user_id === req.user.id && orphanSet.has(p.book_id));
  }

  const alive = rows
    .filter(p => bookMap.has(p.book_id))
    .sort((a, b) => String(b.last_read_at || b.updated_at || '').localeCompare(String(a.last_read_at || a.updated_at || '')));

  res.json({
    total: alive.length,
    items: alive.slice(offset, offset + limit).map(p => ({
      book: bookSummary(bookMap.get(p.book_id)),
      last_read_at: p.last_read_at || p.updated_at || null
    }))
  });
});

// 我上传的书籍：按上传时间倒序
app.get('/api/my-books', authenticateToken, (req, res) => {
  const { limit, offset } = readPaging(req);
  const mine = db.get('books')
    .filter(b => b.created_by === req.user.id)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json({
    total: mine.length,
    items: mine.slice(offset, offset + limit).map(b => ({
      book: bookSummary(b),
      created_at: b.created_at || null
    }))
  });
});

// 正文提取（在线阅读）
app.get('/api/books/:id/content', authenticateToken, async (req, res) => {
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
      return res.json({ format: 'txt', title: book.title, text: decodeText(buffer) });
    }
    return res.json({ format: book.format, title: book.title, file_url: `/api/books/${book.id}/file` });
  } catch (e) {
    return res.status(500).json({ error: '内容解析失败：' + e.message });
  }
});

// ---------- 独立页面 ----------
// 登录、注册各有固定网址，均不在单页应用里渲染
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', PAGE_PATHS['/login']));
});
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', PAGE_PATHS['/register']));
});

// ---------- 后台页面 ----------
// 后台只通过 /admin 访问，不渲染任何指向它的链接。
app.get(ADMIN_PATH, (req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get(ADMIN_PATH + '/', (req, res) => res.redirect(ADMIN_PATH));

// 前台单页应用
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: '接口不存在' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 上传等中间件抛出的错误统一转成 JSON，并清理已落盘的临时文件
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (req.file) discardUploadedFile(req.file);
  if (req.files) {
    Object.keys(req.files).forEach(key => (req.files[key] || []).forEach(discardUploadedFile));
  }
  const msg = err && err.message ? err.message : '服务器内部错误';
  res.status(err.status || 400).json({ error: msg });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Bookshelf running on http://localhost:${PORT}`);
    console.log(`Admin console: http://localhost:${PORT}${ADMIN_PATH}`);
  });
}

module.exports = app;
