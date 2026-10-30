// 后台控制面板（/admin）
// 独立于前台应用，不向前台页面暴露任何入口；所有数据接口都由服务端校验管理员身份

const API_BASE = '';
const TOKEN_KEY = 'adminToken';

const state = {
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  view: 'books',
  books: [],
  users: [],
  stats: null,
  selected: new Set(),
  query: '',
  sort: { key: 'created_at', dir: 'desc' }
};

// ---------- 基础工具 ----------

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers);
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (options.body && typeof options.body === 'object') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(API_BASE + path, Object.assign({}, options, { headers }));
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // 令牌失效：回到后台登录页，前台登录状态不受影响
      if (state.token) clearSession();
    }
    throw new Error((data && data.error) || res.statusText || '请求失败');
  }
  return data;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function escapeAttr(text) {
  return escapeHtml(text)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatNumber(n) {
  return String(Number(n) || 0);
}

let toastTimer = null;
function toast(text, isError) {
  let el = document.getElementById('admin-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'admin-toast';
    document.body.appendChild(el);
  }
  el.className = 'admin-toast' + (isError ? ' error' : '');
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2600);
}

// ---------- 会话 ----------

function clearSession() {
  state.token = null;
  state.user = null;
  state.books = [];
  state.users = [];
  state.stats = null;
  state.selected.clear();
  localStorage.removeItem(TOKEN_KEY);
}

function logout() {
  clearSession();
  render();
}

async function restoreSession() {
  if (!state.token) return;
  try {
    const data = await api('/api/auth/me');
    if (!data.user || data.user.role !== 'admin') {
      clearSession();
      return;
    }
    state.user = data.user;
  } catch (e) {
    // api() 在 401 / 403 时已清理会话
  }
}

// ---------- 图标 ----------

const ICON = {
  shield: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/></svg>',
  books: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10v16H5.5A1.5 1.5 0 0 1 4 18.5v-13z"/><path d="M10 4h4.5A1.5 1.5 0 0 1 16 5.5v13a1.5 1.5 0 0 1-1.5 1.5H10"/><path d="M18 6l2 .5-2.5 13.5"/></svg>',
  users: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.1 2.8-5 5.5-5s4.9 1.9 5.5 5"/><path d="M16 5.5a3 3 0 0 1 0 5.6"/><path d="M17.5 14.2c1.7.6 2.8 2.2 3 4.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  dash: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>'
};

// ---------- 登录 ----------

function renderLogin() {
  const root = document.getElementById('admin-root');
  document.body.className = 'admin-body';
  root.innerHTML = `
    <div class="admin-login-page">
      <div class="admin-login-box">
        <div class="admin-login-mark">
          ${ICON.shield}
          <div>
            <h1 class="admin-login-title">后台控制面板</h1>
            <p class="admin-login-sub">仅限管理员账户登录</p>
          </div>
        </div>
        <div class="panel">
          <div id="login-msg"></div>
          <form id="admin-login-form">
            <div class="form-group">
              <label for="admin-email">邮箱</label>
              <input type="email" id="admin-email" autocomplete="username" required placeholder="邮箱地址" />
            </div>
            <div class="form-group">
              <label for="admin-password">密码</label>
              <input type="password" id="admin-password" autocomplete="current-password" required placeholder="输入密码" />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">登录后台</button>
          </form>
        </div>
      </div>
    </div>
  `;
  document.getElementById('admin-login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: {
          email: document.getElementById('admin-email').value.trim(),
          password: document.getElementById('admin-password').value
        }
      });
      if (!data.user || data.user.role !== 'admin') {
        showMsg('login-msg', '该账户不是管理员，无法进入后台。', true);
        return;
      }
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem(TOKEN_KEY, data.token);
      await enterConsole();
    } catch (err) {
      showMsg('login-msg', err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
}

function showMsg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<div class="message ${isError ? 'error' : ''}">${escapeHtml(text)}</div>`;
}

// ---------- 框架 ----------

async function enterConsole() {
  renderShell();
  await Promise.all([loadBooks(), loadUsers(), loadStats()]);
  renderView();
}

function renderShell() {
  document.body.className = 'admin-body';
  const root = document.getElementById('admin-root');
  root.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand">
          ${ICON.shield}
          <div>资源书架<small>后台控制面板</small></div>
        </div>
        <nav class="admin-nav">
          <button class="admin-nav-item" data-view="books">${ICON.books}<span>书籍管理</span></button>
          <button class="admin-nav-item" data-view="users">${ICON.users}<span>账户与权限</span></button>
          <button class="admin-nav-item" data-view="perm">${ICON.lock}<span>权限说明</span></button>
        </nav>
        <div class="admin-sidebar-foot">
          <div class="admin-identity"><span class="admin-role-tag admin">管理员</span>${escapeHtml(state.user.email)}</div>
          <button class="btn btn-sm" onclick="logout()">退出后台</button>
        </div>
      </aside>
      <main class="admin-main" id="admin-main"></main>
    </div>
    <div id="admin-modal-host"></div>
  `;
  root.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      state.view = btn.dataset.view;
      renderView();
    });
  });
}

function renderView() {
  document.querySelectorAll('.admin-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.view);
  });
  const main = document.getElementById('admin-main');
  if (!main) return;
  if (state.view === 'users') main.innerHTML = viewUsers();
  else if (state.view === 'perm') main.innerHTML = viewPermissions();
  else main.innerHTML = viewBooks();
  bindView();
}

// ---------- 数据加载 ----------

async function loadBooks() {
  try {
    state.books = await api('/api/admin/books');
    // 清掉已不存在的选中项
    state.selected.forEach(id => {
      if (!state.books.find(b => b.id === id)) state.selected.delete(id);
    });
  } catch (e) {
    toast('书籍加载失败：' + e.message, true);
  }
}

async function loadUsers() {
  try {
    state.users = await api('/api/admin/users');
  } catch (e) {
    toast('账户加载失败：' + e.message, true);
  }
}

async function loadStats() {
  try {
    state.stats = await api('/api/admin/stats');
  } catch (e) {
    state.stats = null;
  }
}

// ---------- 书籍管理 ----------

function filteredBooks() {
  const q = state.query.trim().toLowerCase();
  let list = state.books.slice();
  if (q) {
    list = list.filter(b =>
      [b.title, b.author, b.series, b.publisher, b.isbn, b.owner_email, b.format]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
  }
  const { key, dir } = state.sort;
  const factor = dir === 'asc' ? 1 : -1;
  list.sort((a, b) => {
    let va = a[key];
    let vb = b[key];
    if (key === 'file_size' || key === 'volume_number') {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
      return (va - vb) * factor;
    }
    if (key === 'created_at') {
      return String(va || '').localeCompare(String(vb || '')) * factor;
    }
    return String(va || '').localeCompare(String(vb || ''), 'zh-Hans-CN') * factor;
  });
  return list;
}

function sortHeader(key, label) {
  const on = state.sort.key === key;
  const arrow = on ? (state.sort.dir === 'asc' ? '↑' : '↓') : '↕';
  return `<button class="admin-sort${on ? ' on' : ''}" data-sort="${key}">${label}<span class="arrow">${arrow}</span></button>`;
}

function thumb(book) {
  if (book.cover) {
    return `<img src="/api/books/${book.id}/cover" alt="" loading="lazy" />`;
  }
  return `<div class="admin-thumb-fallback">${escapeHtml(book.format || '')}</div>`;
}

function viewBooks() {
  const list = filteredBooks();

  const rows = list.map(book => {
    const volume = book.series
      ? escapeHtml(book.series) + (book.volume_number ? ` 第 ${escapeHtml(book.volume_number)} 卷` : '')
      : (book.volume_number ? `第 ${escapeHtml(book.volume_number)} 卷` : '单行本');
    return `
      <tr data-id="${book.id}">
        <td>
          <div class="admin-book-cell" data-label="书名">
            <span class="admin-thumb">${thumb(book)}</span>
            <div class="admin-book-main">
              <div class="admin-book-title">${escapeHtml(book.title)}</div>
              <div class="admin-book-sub">${escapeHtml(book.author || '未知作者')}</div>
              <div class="admin-book-cardmeta">
                <span class="book-format">${escapeHtml(book.format || '—')}</span>
                <span>${formatSize(book.file_size)}</span>
                <span>${escapeHtml(book.owner_email || '—')}</span>
                <span>${formatDate(book.created_at)}</span>
              </div>
            </div>
          </div>
        </td>
        <td class="admin-muted" data-label="系列 / 卷册">${volume}</td>
        <td data-label="格式"><span class="book-format">${escapeHtml(book.format || '—')}</span></td>
        <td class="admin-mono" data-label="大小">${formatSize(book.file_size)}</td>
        <td class="admin-muted" data-label="上传者">${escapeHtml(book.owner_email || '—')}</td>
        <td class="admin-mono" data-label="上传时间">${formatDate(book.created_at)}</td>
        <td data-label="操作">
          <div class="admin-row-actions">
            <button class="btn" data-act="detail" data-id="${book.id}">详情</button>
            <button class="btn" data-act="edit" data-id="${book.id}">修改</button>
            <button class="btn btn-danger" data-act="delete" data-id="${book.id}">删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-page-head">
      <div>
        <h1 class="admin-page-title">书籍管理</h1>
        <p class="admin-page-desc">共 ${formatNumber(state.books.length)} 本书${state.query ? `，筛选出 ${formatNumber(list.length)} 本` : ''}</p>
      </div>
    </div>

    ${state.stats ? `
      <div class="admin-stats">
        <div class="admin-stat"><div class="admin-stat-label">书籍</div><div class="admin-stat-value">${formatNumber(state.stats.books)}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">账户</div><div class="admin-stat-value">${formatNumber(state.stats.users)}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">管理员</div><div class="admin-stat-value">${formatNumber(state.stats.admins)}</div></div>
        <div class="admin-stat"><div class="admin-stat-label">文件总量</div><div class="admin-stat-value">${formatSize(state.stats.size)}</div></div>
      </div>
    ` : ''}

    <div class="admin-toolbar">
      <div class="admin-search">
        <input type="search" id="admin-book-search" placeholder="搜索书名、作者、系列、上传者" value="${escapeAttr(state.query)}" />
      </div>
      <button class="btn" data-act="refresh">刷新</button>
      <div class="admin-toolbar-right">
        <button class="btn btn-primary" data-act="batch">批量修改</button>
      </div>
    </div>

    <div class="admin-table-wrap">
      ${list.length === 0 ? `
        <div class="admin-empty">${state.books.length === 0 ? '书架里还没有书。' : '没有符合条件的书籍。'}</div>
      ` : `
        <table class="admin-table">
          <thead>
            <tr>
              <th>${sortHeader('title', '书名')}</th>
              <th class="admin-muted">系列 / 卷册</th>
              <th>${sortHeader('format', '格式')}</th>
              <th>${sortHeader('file_size', '大小')}</th>
              <th>${sortHeader('owner_email', '上传者')}</th>
              <th>${sortHeader('created_at', '上传时间')}</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `}
    </div>
    <div class="admin-footnote">
      点「批量修改」可在弹窗里勾选多本书并批量删除。单本的修改与删除会立即对前台生效。
    </div>
  `;
}

function bindBooksView() {
  const search = document.getElementById('admin-book-search');
  if (search) {
    let composing = false;
    search.addEventListener('compositionstart', () => { composing = true; });
    search.addEventListener('compositionend', () => {
      composing = false;
      state.query = search.value;
      refreshBookTable();
    });
    search.addEventListener('input', () => {
      state.query = search.value;
      // 中文输入法组字期间不重绘，否则拼音会被打断
      if (composing) return;
      refreshBookTable();
    });
  }

}

// 只重绘书籍表格：搜索时保持输入框焦点与光标位置
function refreshBookTable() {
  const main = document.getElementById('admin-main');
  if (!main) return;
  main.innerHTML = viewBooks();
  bindBooksView();
  const search = document.getElementById('admin-book-search');
  if (search) {
    search.focus();
    const len = search.value.length;
    search.setSelectionRange(len, len);
  }
}

// ---------- 账户与权限 ----------

const ROLE_LABEL = { admin: '管理员', user: '普通用户' };

function viewUsers() {
  const rows = state.users.map(u => {
    const isSelf = state.user && u.id === state.user.id;
    return `
      <tr data-uid="${u.id}">
        <td data-label="账户">
          <div class="admin-book-title">${escapeHtml(u.email)}</div>
          ${isSelf ? '<div class="admin-book-sub">当前登录账户</div>' : ''}
        </td>
        <td data-label="角色"><span class="admin-role-tag ${u.role === 'admin' ? 'admin' : ''}">${ROLE_LABEL[u.role] || '普通用户'}</span></td>
        <td class="admin-mono" data-label="上传书籍">${formatNumber(u.book_count)}</td>
        <td class="admin-mono" data-label="注册时间">${formatDate(u.created_at)}</td>
        <td data-label="操作">
          <div class="admin-row-actions">
            <select class="admin-role-select" data-role-select="${u.id}" aria-label="调整 ${escapeAttr(u.email)} 的角色">
              <option value="user" ${u.role !== 'admin' ? 'selected' : ''}>普通用户</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
            </select>
            <button class="btn" data-act="reset-password" data-uid="${u.id}">重置密码</button>
            <button class="btn btn-danger" data-act="delete-user" data-uid="${u.id}" ${isSelf ? 'disabled title="不能删除自己的账户"' : ''}>删除</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-page-head">
      <div>
        <h1 class="admin-page-title">账户与权限</h1>
        <p class="admin-page-desc">在角色下拉框里切换「普通用户」与「管理员」，保存后立即生效。</p>
      </div>
      <div class="admin-toolbar-right">
        <button class="btn" data-act="refresh">刷新</button>
        <button class="btn btn-primary" data-act="create-user">新建账户</button>
      </div>
    </div>

    <div class="admin-table-wrap">
      ${state.users.length === 0 ? '<div class="admin-empty">还没有账户。</div>' : `
        <table class="admin-table">
          <thead>
            <tr><th>邮箱</th><th>角色</th><th>上传书籍</th><th>注册时间</th><th>操作</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `}
    </div>
    <div class="admin-footnote">
      管理员拥有全部权限；普通用户只能阅读、下载、上传书籍，并修改自己上传的书籍，不能删除任何书籍，也不能进入后台。
    </div>
  `;
}

function viewPermissions() {
  const adminPerms = [
    ['yes', '阅读全部书籍'],
    ['yes', '下载书籍文件'],
    ['yes', '上传书籍'],
    ['yes', '修改任意书籍的信息'],
    ['yes', '删除任意书籍，支持批量删除'],
    ['yes', '管理账户、调整角色与重置密码'],
    ['yes', '进入后台控制面板']
  ];
  const userPerms = [
    ['yes', '阅读全部书籍'],
    ['yes', '下载书籍文件'],
    ['yes', '上传书籍'],
    ['yes', '修改自己上传的书籍'],
    ['no', '不能修改他人上传的书籍'],
    ['no', '不能删除书籍'],
    ['no', '不能进入后台控制面板']
  ];
  const renderList = items => `<ul class="perm-list">${items.map(([mark, text]) =>
    `<li class="perm-${mark}"><span class="mark">${mark === 'yes' ? ICON.check : ICON.dash}</span><span>${escapeHtml(text)}</span></li>`
  ).join('')}</ul>`;

  return `
    <div class="admin-page-head">
      <div>
        <h1 class="admin-page-title">权限说明</h1>
        <p class="admin-page-desc">权限在服务端校验，前端只决定按钮是否显示。</p>
      </div>
    </div>
    <div class="perm-grid">
      <div class="perm-card">
        <h3><span class="admin-role-tag admin">管理员</span>全部权限</h3>
        ${renderList(adminPerms)}
      </div>
      <div class="perm-card">
        <h3><span class="admin-role-tag">普通用户</span>阅读、下载、上传</h3>
        ${renderList(userPerms)}
      </div>
    </div>
    <div class="admin-footnote">
      后台只通过 <span class="admin-mono">/admin</span> 网址访问，前台任何页面都不提供入口。
      登录前台账户不会自动进入后台，后台身份单独保存在当前浏览器。
    </div>
  `;
}

// ---------- 对话框 ----------

function closeModal() {
  const host = document.getElementById('admin-modal-host');
  if (host) host.innerHTML = '';
}

function modalHost() {
  return document.getElementById('admin-modal-host');
}

function openModal(title, bodyHtml, actionsHtml, wide) {
  const host = modalHost();
  if (!host) return;
  host.innerHTML = `
    <div class="admin-modal-mask" data-mask>
      <div class="admin-modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
        <div class="admin-modal-head">
          <h2>${escapeHtml(title)}</h2>
          <button class="admin-modal-close" data-close aria-label="关闭">×</button>
        </div>
        <div class="admin-modal-body">
          ${bodyHtml}
          ${actionsHtml ? `<div class="admin-modal-actions">${actionsHtml}</div>` : ''}
        </div>
      </div>
    </div>
  `;
  host.querySelector('[data-mask]').addEventListener('click', e => {
    if (e.target.hasAttribute('data-mask')) closeModal();
  });
  host.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));
}

function confirmDialog({ title, html, confirmText, danger, onConfirm }) {
  openModal(title, `<p class="admin-confirm-text">${html}</p>`,
    `<button class="btn" data-close>取消</button>
     <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${escapeHtml(confirmText || '确定')}</button>`);
  const btn = modalHost().querySelector('[data-confirm]');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await onConfirm();
    } finally {
      btn.disabled = false;
    }
  });
}

// 详情
function openDetail(book) {
  const fields = [
    ['作者', book.author || '—'],
    ['系列', book.series || '单行本'],
    ['卷号', book.volume_number ? String(book.volume_number) : '—'],
    ['格式', (book.format || '—').toUpperCase()],
    ['文件大小', formatSize(book.file_size)],
    ['出版年', book.publish_year || '—'],
    ['出版社', book.publisher || '—'],
    ['ISBN', book.isbn || '—'],
    ['上传者', book.owner_email || '—'],
    ['上传时间', formatDate(book.created_at)]
  ];
  const cover = book.cover
    ? `<img src="/api/books/${book.id}/cover" alt="《${escapeAttr(book.title)}》封面" />`
    : `<div class="admin-thumb-fallback">${escapeHtml(book.format || '')}</div>`;

  openModal('书籍详情', `
    <div class="admin-detail">
      <div class="admin-detail-cover">${cover}</div>
      <div class="admin-detail-main">
        <h3 class="admin-detail-title">${escapeHtml(book.title)}</h3>
        <p class="admin-detail-author">${escapeHtml(book.author || '未知作者')}</p>
        <dl class="admin-detail-fields">
          ${fields.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}
        </dl>
        <p class="admin-detail-desc">${book.description ? escapeHtml(book.description) : '暂无简介。'}</p>
      </div>
    </div>
  `, `
    <button class="btn" data-close>关闭</button>
    <button class="btn btn-primary" data-edit>修改</button>
  `, true);
  modalHost().querySelector('[data-edit]').addEventListener('click', () => openEdit(book));
}

// 修改
function openEdit(book) {
  openModal('修改书籍', `
    <div id="edit-msg"></div>
    <form id="admin-edit-form">
      <div class="form-group">
        <label>书名</label>
        <input type="text" id="edit-title" required value="${escapeAttr(book.title)}" />
      </div>
      <div class="form-group">
        <label>作者</label>
        <input type="text" id="edit-author" value="${escapeAttr(book.author || '')}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>系列名</label>
          <input type="text" id="edit-series" value="${escapeAttr(book.series || '')}" placeholder="留空表示单行本" />
        </div>
        <div class="form-group">
          <label>卷号</label>
          <input type="number" id="edit-volume" min="0" value="${escapeAttr(book.volume_number || 0)}" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>出版年</label>
          <input type="text" id="edit-year" value="${escapeAttr(book.publish_year || '')}" placeholder="例如：2012-8" />
        </div>
        <div class="form-group">
          <label>出版社</label>
          <input type="text" id="edit-publisher" value="${escapeAttr(book.publisher || '')}" />
        </div>
      </div>
      <div class="form-group">
        <label>ISBN</label>
        <input type="text" id="edit-isbn" value="${escapeAttr(book.isbn || '')}" />
      </div>
      <div class="form-group">
        <label>简介</label>
        <textarea id="edit-description" rows="5">${escapeHtml(book.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>封面地址</label>
        <input type="text" id="edit-cover" placeholder="留空则保持当前封面" />
        <div class="upload-hint">支持豆瓣图书封面地址；留空表示不修改封面</div>
      </div>
    </form>
  `, `
    <button class="btn" data-close>取消</button>
    <button class="btn btn-primary" id="save-edit">保存修改</button>
  `, true);

  modalHost().querySelector('#save-edit').addEventListener('click', async () => {
    const payload = {
      title: document.getElementById('edit-title').value.trim(),
      author: document.getElementById('edit-author').value,
      series: document.getElementById('edit-series').value,
      volume_number: document.getElementById('edit-volume').value || '0',
      publish_year: document.getElementById('edit-year').value,
      publisher: document.getElementById('edit-publisher').value,
      isbn: document.getElementById('edit-isbn').value,
      description: document.getElementById('edit-description').value
    };
    if (!payload.title) {
      showMsg('edit-msg', '书名不能为空', true);
      return;
    }
    const coverUrl = document.getElementById('edit-cover').value.trim();
    if (coverUrl) payload.cover_url = coverUrl;
    try {
      await api('/api/books/' + book.id, { method: 'PUT', body: payload });
      closeModal();
      toast('已保存修改');
      await Promise.all([loadBooks(), loadStats()]);
      renderView();
    } catch (err) {
      showMsg('edit-msg', err.message, true);
    }
  });
}

// 删除单本
function askDelete(book) {
  confirmDialog({
    title: '删除书籍',
    html: `确定删除《${escapeHtml(book.title)}》吗？<br /><strong>书籍文件与封面会一并删除，无法恢复。</strong>`,
    confirmText: '删除',
    danger: true,
    onConfirm: async () => {
      try {
        await api('/api/books/' + book.id, { method: 'DELETE' });
        state.selected.delete(book.id);
        closeModal();
        toast('已删除《' + book.title + '》');
        await Promise.all([loadBooks(), loadStats()]);
        renderView();
      } catch (err) {
        toast('删除失败：' + err.message, true);
      }
    }
  });
}

// 批量修改：勾选与全选都放在弹窗里，列表本身不带复选框
function openBatch() {
  const list = filteredBooks();
  if (list.length === 0) {
    toast('当前没有可操作的书籍', true);
    return;
  }
  // 每次打开都从空选开始，避免沿用上一次的勾选
  state.selected.clear();

  const render = () => {
    const checkedCount = list.filter(b => state.selected.has(b.id)).length;
    const allChecked = list.length > 0 && checkedCount === list.length;
    const rows = list.map(book => `
      <tr data-id="${book.id}" class="${state.selected.has(book.id) ? 'selected' : ''}">
        <td class="col-check"><input type="checkbox" data-batch-check="${book.id}" ${state.selected.has(book.id) ? 'checked' : ''} aria-label="选择《${escapeAttr(book.title)}》" /></td>
        <td>
          <div class="admin-book-cell">
            <span class="admin-thumb">${thumb(book)}</span>
            <div>
              <div class="admin-book-title">${escapeHtml(book.title)}</div>
              <div class="admin-book-sub">${escapeHtml(book.author || '未知作者')}</div>
            </div>
          </div>
        </td>
        <td class="admin-muted">${escapeHtml(book.series || '单行本')}</td>
        <td class="admin-mono">${formatSize(book.file_size)}</td>
      </tr>
    `).join('');

    const body = document.getElementById('batch-body');
    if (!body) return;
    body.innerHTML = `
      <div class="admin-toolbar">
        <label class="admin-muted" style="display:flex;align-items:center;gap:8px;margin:0">
          <input type="checkbox" id="batch-check-all" ${allChecked ? 'checked' : ''} /> 全选当前 ${formatNumber(list.length)} 本
        </label>
        <span class="admin-selection">已选 ${formatNumber(checkedCount)} 本</span>
      </div>
      <div class="admin-table-wrap admin-batch-list">
        <table class="admin-table admin-mini-table">
          <thead><tr><th class="col-check"></th><th>书名</th><th>系列</th><th>大小</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
    const all = document.getElementById('batch-check-all');
    all.addEventListener('change', () => {
      if (all.checked) list.forEach(b => state.selected.add(b.id));
      else list.forEach(b => state.selected.delete(b.id));
      render();
    });
    body.querySelectorAll('[data-batch-check]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.selected.add(cb.dataset.batchCheck);
        else state.selected.delete(cb.dataset.batchCheck);
        render();
      });
    });
    const footer = document.getElementById('batch-count');
    if (footer) footer.textContent = `已选 ${formatNumber(checkedCount)} 本`;
    const delBtn = document.getElementById('batch-delete');
    if (delBtn) delBtn.disabled = checkedCount === 0;
  };

  openModal('批量修改', `<div id="batch-body"></div>`, `
    <span class="admin-muted" id="batch-count" style="margin-right:auto"></span>
    <button class="btn" data-close>取消</button>
    <button class="btn btn-danger" id="batch-delete" disabled>批量删除</button>
  `, true);

  render();

  modalHost().querySelector('#batch-delete').addEventListener('click', () => {
    const ids = Array.from(state.selected);
    if (ids.length === 0) return;
    confirmDialog({
      title: '批量删除',
      html: `确定删除选中的 <strong>${formatNumber(ids.length)}</strong> 本书吗？<br />书籍文件与封面会一并删除，无法恢复。`,
      confirmText: `删除 ${formatNumber(ids.length)} 本`,
      danger: true,
      onConfirm: async () => {
        try {
          const result = await api('/api/books/batch', { method: 'POST', body: { action: 'delete', ids } });
          state.selected.clear();
          closeModal();
          toast(`已删除 ${formatNumber(result.deleted || ids.length)} 本书`);
          await Promise.all([loadBooks(), loadStats()]);
          renderView();
        } catch (err) {
          toast('批量删除失败：' + err.message, true);
        }
      }
    });
  });
}

// 新建账户
function openCreateUser() {
  openModal('新建账户', `
    <div id="create-msg"></div>
    <form id="create-user-form">
      <div class="form-group">
        <label>邮箱</label>
        <input type="email" id="new-email" required placeholder="账户邮箱" />
      </div>
      <div class="form-group">
        <label>初始密码</label>
        <input type="password" id="new-password" required placeholder="至少 6 位" />
      </div>
      <div class="form-group">
        <label>角色</label>
        <select id="new-role">
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
      </div>
    </form>
  `, `
    <button class="btn" data-close>取消</button>
    <button class="btn btn-primary" id="create-user-save">创建</button>
  `);
  modalHost().querySelector('#create-user-save').addEventListener('click', async () => {
    const email = document.getElementById('new-email').value.trim();
    const password = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;
    if (!email || !password) {
      showMsg('create-msg', '邮箱和密码不能为空', true);
      return;
    }
    try {
      await api('/api/admin/users', { method: 'POST', body: { email, password, role } });
      closeModal();
      toast('账户已创建');
      await Promise.all([loadUsers(), loadStats()]);
      renderView();
    } catch (err) {
      showMsg('create-msg', err.message, true);
    }
  });
}

function openResetPassword(user) {
  openModal('重置密码', `
    <div id="reset-msg"></div>
    <p class="admin-muted" style="margin-top:0">为 ${escapeHtml(user.email)} 设置新密码。</p>
    <div class="form-group">
      <label>新密码</label>
      <input type="password" id="reset-password" placeholder="至少 6 位" />
    </div>
  `, `
    <button class="btn" data-close>取消</button>
    <button class="btn btn-primary" id="reset-save">保存</button>
  `);
  modalHost().querySelector('#reset-save').addEventListener('click', async () => {
    const password = document.getElementById('reset-password').value;
    if (!password) {
      showMsg('reset-msg', '请输入新密码', true);
      return;
    }
    try {
      await api('/api/admin/users/' + user.id, { method: 'PUT', body: { password } });
      closeModal();
      toast('密码已更新');
    } catch (err) {
      showMsg('reset-msg', err.message, true);
    }
  });
}

function askDeleteUser(user) {
  confirmDialog({
    title: '删除账户',
    html: `确定删除账户 ${escapeHtml(user.email)} 吗？<br /><strong>该账户上传的书籍会保留，但归属显示为「已删除的账户」。</strong>`,
    confirmText: '删除账户',
    danger: true,
    onConfirm: async () => {
      try {
        await api('/api/admin/users/' + user.id, { method: 'DELETE' });
        closeModal();
        toast('账户已删除');
        await Promise.all([loadUsers(), loadBooks(), loadStats()]);
        renderView();
      } catch (err) {
        toast('删除失败：' + err.message, true);
      }
    }
  });
}

async function changeRole(user, role) {
  if (user.role === role) return;
  try {
    await api('/api/admin/users/' + user.id, { method: 'PUT', body: { role } });
    toast(role === 'admin' ? '已设为管理员' : '已设为普通用户');
    await Promise.all([loadUsers(), loadStats()]);
    renderView();
  } catch (err) {
    toast('修改失败：' + err.message, true);
    renderView();
  }
}

// ---------- 事件绑定 ----------

function bindView() {
  if (state.view === 'books') bindBooksView();

  const main = document.getElementById('admin-main');
  if (!main) return;

  main.addEventListener('click', e => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      if (state.sort.key === key) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { key, dir: key === 'created_at' ? 'desc' : 'asc' };
      }
      renderView();
      return;
    }

    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const book = id ? state.books.find(b => b.id === id) : null;

    if (act === 'refresh') {
      Promise.all([loadBooks(), loadUsers(), loadStats()]).then(renderView);
    } else if (act === 'batch') {
      openBatch();
    } else if (act === 'detail' && book) {
      openDetail(book);
    } else if (act === 'edit' && book) {
      openEdit(book);
    } else if (act === 'delete' && book) {
      askDelete(book);
    } else if (act === 'create-user') {
      openCreateUser();
    } else if (act === 'reset-password') {
      const user = state.users.find(u => u.id === btn.dataset.uid);
      if (user) openResetPassword(user);
    } else if (act === 'delete-user') {
      const user = state.users.find(u => u.id === btn.dataset.uid);
      if (user) askDeleteUser(user);
    }
  });

  main.addEventListener('change', e => {
    const sel = e.target.closest('[data-role-select]');
    if (sel) {
      const user = state.users.find(u => u.id === sel.dataset.roleSelect);
      if (user) changeRole(user, sel.value);
    }
  });
}

// ---------- 启动 ----------

async function boot() {
  await restoreSession();
  if (state.user && state.user.role === 'admin') {
    await enterConsole();
  } else {
    renderLogin();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

window.logout = logout;
boot();
