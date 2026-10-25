// API base URL
const API_BASE = '';

// State
const state = {
  token: localStorage.getItem('token'),
  user: null,
  books: [],
  currentBook: null,
  viewMode: localStorage.getItem('viewMode') || 'grid',
  metaResults: [],
  pendingCoverUrl: '',
  readerSettings: Object.assign({
    fontSize: 18,
    lineHeight: 1.75,
    theme: 'dark',
    fontFamily: 'Noto Sans SC',
    imgScale: 100
  }, JSON.parse(localStorage.getItem('readerSettings')) || {})
};

// API helpers
async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = { ...options.headers };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof ArrayBuffer)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  if (!res.ok) {
    const error = (data && data.error) || res.statusText;
    throw new Error(error);
  }
  return data;
}

function navigate(path) {
  window.location.hash = path;
  render();
}

function getRoute() {
  const hash = window.location.hash.replace('#', '') || '/login';
  const [path, query] = hash.split('?');
  return { path, query };
}

function currentId() {
  return getRoute().path.split('/').pop();
}

// Render the current page
function render() {
  const app = document.getElementById('app');
  const { path } = getRoute();
  app.innerHTML = '';

  if (!state.token && path !== '/register') {
    renderLogin(app);
    return;
  }

  switch (path) {
    case '/login':
      renderLogin(app);
      break;
    case '/register':
      renderRegister(app);
      break;
    case '/bookshelf':
      renderBookshelf(app);
      break;
    case '/upload':
      renderUpload(app);
      break;
    case '/reader':
      renderReader(app);
      break;
    case '/book':
      renderBookDetail(app);
      break;
    case '/edit':
      renderBookEdit(app);
      break;
    default:
      if (path.startsWith('/reader/')) {
        renderReader(app);
      } else if (path.startsWith('/book/') || path.startsWith('/series/')) {
        renderBookDetail(app);
      } else if (path.startsWith('/edit/')) {
        renderBookEdit(app);
      } else {
        renderBookshelf(app);
      }
  }
}

// Login page
function renderLogin(container) {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-box">
        <div class="auth-logo">
          <h1>资源书架</h1>
          <p>登录你的账户</p>
        </div>
        <div class="panel" id="login-panel">
          <div class="panel-title">用户登录</div>
          <div id="login-msg"></div>
          <form id="login-form">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="email" required placeholder="operator@rhodes.island" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="password" required placeholder='输入密码' />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">登录</button>
          </form>
          <p style="text-align:center;margin-top:16px;color:var(--text-secondary);font-size:0.9rem">
            还没有账号？<a href="#/register">注册</a>
          </p>
        </div>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { email, password } });
      setAuth(data);
      navigate('/bookshelf');
    } catch (err) {
      showMsg('login-msg', err.message, true);
    }
  });
}

// Register page
function renderRegister(container) {
  container.innerHTML = `
    <div class="auth-page">
      <div class="auth-box">
        <div class="auth-logo">
          <h1>注册账户</h1>
          <p>创建新账户以开始使用</p>
        </div>
        <div class="panel" id="register-panel">
          <div class="panel-title">填写信息</div>
          <div id="register-msg"></div>
          <form id="register-form">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="reg-email" required placeholder="operator@rhodes.island" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="reg-password" required placeholder='至少 6 位' />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">注册</button>
          </form>
          <p style="text-align:center;margin-top:16px;color:var(--text-secondary);font-size:0.9rem">
            已有账号？<a href="#/login">登录</a>
          </p>
        </div>
      </div>
    </div>
  `;
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    try {
      const data = await api('/api/auth/register', { method: 'POST', body: { email, password } });
      setAuth(data);
      navigate('/bookshelf');
    } catch (err) {
      showMsg('register-msg', err.message, true);
    }
  });
}

function setAuth(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('token', data.token);
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  navigate('/login');
}

function showMsg(id, text, isError) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<div class="message ${isError ? 'error' : ''}">${escapeHtml(text)}</div>`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFilename(book) {
  return `${book.title}.${book.format}`.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-.]/g, '_');
}

function topBar() {
  const roleBadge = state.user && state.user.role === 'admin'
    ? '<span class="user-role">Admin</span>'
    : '';
  const userInfo = state.user
    ? `<span class="user-info">${escapeHtml(state.user.email)}${roleBadge}</span>`
    : '';
  return `
    <div class="top-bar">
      <div class="logo" onclick="navigate('/bookshelf')">
        <span class="logo-text">资源书架</span>
      </div>
      <div class="nav-links">
        ${userInfo}
        <a class="btn" href="#/bookshelf">书架</a>
        <a class="btn" href="#/upload">上传书籍</a>
        <button class="btn btn-danger" onclick="logout()">退出</button>
      </div>
    </div>
  `;
}

// ---------- 书架 ----------

// 把书按系列归并：一个系列 = 一个条目，用第 1 本书（有封面的优先）代表它
function buildEntries(books) {
  const seriesMap = new Map();
  const singles = [];
  books.forEach(book => {
    if (book.series) {
      if (!seriesMap.has(book.series)) seriesMap.set(book.series, []);
      seriesMap.get(book.series).push(book);
    } else {
      singles.push(book);
    }
  });

  const entries = [];
  seriesMap.forEach((vols, name) => {
    vols.sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0));
    entries.push({
      type: 'series',
      name,
      books: vols,
      first: vols[0],
      cover: vols.find(b => b.cover) || vols[0]
    });
  });
  singles.forEach(book => {
    entries.push({ type: 'single', name: book.title, books: [book], first: book, cover: book });
  });

  return entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

// 封面：有图用图，没图用书名文字占位
function coverBlock(book, extraClass) {
  if (!book) return '';
  const cls = extraClass ? ' ' + extraClass : '';
  if (book.cover) {
    return `<img class="book-cover-img${cls}" src="${API_BASE}/api/books/${book.id}/cover" alt="${escapeAttr(book.title)}" loading="lazy" />`;
  }
  return `<div class="book-cover-fallback${cls}">${escapeHtml(book.title)}</div>`;
}

function bookCard(entry) {
  const isSeries = entry.type === 'series';
  const count = entry.books.length;
  const first = entry.first;
  const metaParts = [first.author || '未知作者'];
  if (isSeries) {
    metaParts.push(count + ' 卷');
  } else if (first.volume_number) {
    metaParts.push('第 ' + first.volume_number + ' 卷');
  }
  const badge = isSeries ? `<span class="cover-badge">${count} 卷</span>` : '';
  return `
    <div class="book-card" onclick="navigate('/book/${first.id}')">
      <div class="book-cover">
        ${coverBlock(entry.cover)}
        ${badge}
      </div>
      <div class="book-title">${escapeHtml(entry.name)}</div>
      <div class="book-meta">${escapeHtml(metaParts.join(' · '))}</div>
    </div>
  `;
}

function toggleViewMode() {
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
  localStorage.setItem('viewMode', state.viewMode);
  render();
}

function renderGridView(entries) {
  return `<div class="book-grid">${entries.map(bookCard).join('')}</div>`;
}

function renderListView(entries) {
  return `
    <div class="book-list">
      <div class="book-list-header">
        <span class="col-title">书名</span>
        <span class="col-author">作者</span>
        <span class="col-volume">卷册</span>
        <span class="col-format">格式</span>
        <span class="col-actions">操作</span>
      </div>
      ${entries.map(bookListRow).join('')}
    </div>
  `;
}

function bookListRow(entry) {
  const isSeries = entry.type === 'series';
  const first = entry.first;
  const count = entry.books.length;
  const formats = [...new Set(entry.books.map(b => b.format))].join(' / ');
  const volumeText = isSeries
    ? `${count} 卷`
    : (first.volume_number ? `第 ${first.volume_number} 卷` : '全一册');
  const actions = isSeries
    ? `<button class="btn btn-sm btn-primary" onclick="navigate('/book/${first.id}')">查看</button>`
    : `<button class="btn btn-sm btn-primary" onclick="navigate('/reader/${first.id}')">阅读</button>
       <button class="btn btn-sm" onclick="downloadBook('${first.id}', '${safeFilename(first)}')">下载</button>`;
  return `
    <div class="book-list-row">
      <span class="col-title" onclick="navigate('/book/${first.id}')">
        <span class="row-thumb">${coverBlock(entry.cover)}</span>
        <span class="row-title-text">${escapeHtml(entry.name)}</span>
      </span>
      <span class="col-author">${escapeHtml(first.author || '未知作者')}</span>
      <span class="col-volume">${volumeText}</span>
      <span class="col-format"><span class="book-format">${escapeHtml(formats)}</span></span>
      <span class="col-actions">${actions}</span>
    </div>
  `;
}

async function renderBookshelf(container) {
  container.innerHTML = topBar() + '<div class="container" id="bookshelf-container"><div class="loading"></div></div>';
  try {
    const books = await api('/api/books', { method: 'GET' });
    state.books = books;
    const containerEl = document.getElementById('bookshelf-container');
    if (books.length === 0) {
      containerEl.innerHTML = `
        <div class="empty-state">
          <h3>书架为空</h3>
          <p>点击上方「上传书籍」添加你的第一本藏书吧。</p>
          <a href="#/upload" class="btn btn-primary" style="margin-top:16px">上传书籍</a>
        </div>
      `;
      return;
    }

    const entries = buildEntries(books);
    const html = `
      <div class="bookshelf-header">
        <div class="bookshelf-title">
          <h2>藏书目录</h2>
          <span class="bookshelf-count">${entries.length} 部作品 · ${books.length} 个文件</span>
          <button class="btn btn-view-toggle" onclick="toggleViewMode()">
            ${state.viewMode === 'grid' ? '切换为列表' : '切换为网格'}
          </button>
        </div>
      </div>
      ${state.viewMode === 'list' ? renderListView(entries) : renderGridView(entries)}
    `;
    containerEl.innerHTML = html;
  } catch (err) {
    container.innerHTML = topBar() + `<div class="container"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
    if (err.message.includes('未登录') || err.message.includes('过期')) {
      logout();
    }
  }
}

// ---------- 详情页 ----------

async function renderBookDetail(container) {
  const bookId = currentId();
  container.innerHTML = topBar() + '<div class="container"><div class="loading"></div></div>';
  try {
    const books = await api('/api/books', { method: 'GET' });
    state.books = books;
    const current = books.find(b => b.id === bookId);
    if (!current) {
      container.innerHTML = topBar() + '<div class="container"><div class="message error">书籍不存在</div></div>';
      return;
    }

    const isSeries = !!current.series;
    const volumes = isSeries
      ? books.filter(b => b.series === current.series).sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0))
      : [current];
    const coverBook = current.cover ? current : (volumes.find(b => b.cover) || current);
    const title = isSeries ? current.series : current.title;

    const volumeRows = volumes.map(book => {
      const vol = book.volume_number ? `第 ${book.volume_number} 卷` : '全一册';
      const isActive = book.id === current.id;
      return `
        <div class="book-list-row${isActive ? ' active' : ''}">
          <span class="col-title">
            <span class="row-thumb">${coverBlock(book)}</span>
            <span class="row-title-text">${escapeHtml(book.title)}${isActive ? ' <span class="current-badge">当前</span>' : ''}</span>
          </span>
          <span class="col-author">${escapeHtml(book.author || '未知作者')}</span>
          <span class="col-volume">${vol}</span>
          <span class="col-format"><span class="book-format">${escapeHtml(book.format)}</span></span>
          <span class="col-actions">
            <button class="btn btn-primary btn-sm" onclick="navigate('/reader/${book.id}')">阅读</button>
            <button class="btn btn-sm" onclick="downloadBook('${book.id}', '${safeFilename(book)}')">下载</button>
          </span>
        </div>
      `;
    }).join('');

    container.innerHTML = topBar() + `
      <div class="container">
        <div class="detail-topbar">
          <button class="btn" onclick="navigate('/bookshelf')">← 返回书架</button>
        </div>

        <div class="book-detail">
          <div class="book-detail-cover">${coverBlock(coverBook)}</div>
          <div class="book-detail-info">
            <h1 class="book-detail-title">${escapeHtml(title)}</h1>
            <p class="book-detail-author">${escapeHtml(current.author || '未知作者')}</p>
            <dl class="meta-list">
              <div><dt>出版年</dt><dd>${escapeHtml(current.publish_year || '—')}</dd></div>
              <div><dt>出版社</dt><dd>${escapeHtml(current.publisher || '—')}</dd></div>
              <div><dt>ISBN</dt><dd>${escapeHtml(current.isbn || '—')}</dd></div>
              <div><dt>系列</dt><dd>${escapeHtml(isSeries ? current.series : '单行本')}</dd></div>
            </dl>
            <div class="book-detail-actions">
              <button class="btn btn-primary" onclick="navigate('/reader/${current.id}')">阅读</button>
              <button class="btn" onclick="downloadBook('${current.id}', '${safeFilename(current)}')">下载</button>
            </div>
            <div class="book-detail-desc">
              <h3>简介</h3>
              <p>${current.description ? escapeHtml(current.description) : '暂无简介，可在下方搜索或手动填写。'}</p>
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">${isSeries ? `系列卷册（${volumes.length}）` : '文件'}</div>
          <div class="book-list">
            <div class="book-list-header">
              <span class="col-title">书名</span>
              <span class="col-author">作者</span>
              <span class="col-volume">卷号</span>
              <span class="col-format">格式</span>
              <span class="col-actions">操作</span>
            </div>
            ${volumeRows}
          </div>
        </div>

        ${current.can_edit ? `
          <div class="detail-edit-bar">
            <button class="btn btn-primary" onclick="navigate('/edit/${current.id}')">修改</button>
          </div>
        ` : ''}
      </div>
    `;

  } catch (err) {
    container.innerHTML = topBar() + `<div class="container"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
    if (err.message.includes('未登录') || err.message.includes('过期')) {
      logout();
    }
  }
}

// 通用：检索元数据并渲染候选列表
async function searchMetadataList(query, resultsId, applyFn) {
  const box = document.getElementById(resultsId);
  if (!box) return;
  if (!query) {
    box.innerHTML = '<div class="message error">请先输入书名</div>';
    return;
  }
  box.innerHTML = '<div class="loading"></div>';
  try {
    const data = await api('/api/metadata/search?q=' + encodeURIComponent(query));
    state.metaResults = data.results || [];
    if (state.metaResults.length === 0) {
      box.innerHTML = '<div class="meta-empty">没有找到匹配的元数据，可手动填写。</div>';
      return;
    }
    box.innerHTML = state.metaResults.map(r => `
      <div class="meta-result" onclick="${applyFn}('${escapeAttr(r.id)}')">
        <div class="meta-result-cover">
          ${r.cover ? `<img src="${API_BASE}/api/metadata/cover?url=${encodeURIComponent(r.cover)}" alt="" loading="lazy" />` : ''}
        </div>
        <div class="meta-result-body">
          <div class="meta-result-title">${escapeHtml(r.title)}</div>
          <div class="meta-result-sub">${escapeHtml(r.author || '未知作者')} · ${escapeHtml(r.year || '年份未知')}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    box.innerHTML = `<div class="message error">${escapeHtml(err.message)}</div>`;
  }
}

function searchMetadataForUpload() {
  const q = document.getElementById('title').value.trim();
  return searchMetadataList(q, 'upload-meta-results', 'applyMetadataToUpload');
}

async function applyMetadataToUpload(id) {
  const box = document.getElementById('upload-meta-results');
  box.innerHTML = '<div class="loading"></div>';
  try {
    const d = await api('/api/metadata/detail?id=' + encodeURIComponent(id));
    if (d.title) document.getElementById('title').value = d.title;
    document.getElementById('author').value = d.author || '';
    document.getElementById('publish_year').value = d.year || '';
    document.getElementById('publisher').value = d.publisher || '';
    document.getElementById('isbn').value = d.isbn || '';
    if (d.description) document.getElementById('description').value = d.description;
    state.pendingCoverUrl = d.cover || '';
    renderUploadCoverPreview(d.cover);
    box.innerHTML = `<div class="meta-applied">已填入「${escapeHtml(d.title || '')}」的元数据${d.cover ? '与封面' : ''}，确认后点击「上传」。</div>`;
  } catch (err) {
    box.innerHTML = `<div class="message error">${escapeHtml(err.message)}</div>`;
  }
}

function renderUploadCoverPreview(coverUrl) {
  const el = document.getElementById('upload-cover-preview');
  if (!el) return;
  if (!coverUrl) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div class="upload-cover-preview">
      <img src="${API_BASE}/api/metadata/cover?url=${encodeURIComponent(coverUrl)}" alt="封面预览" />
      <span class="upload-cover-label">封面预览</span>
    </div>
  `;
}



async function downloadBook(bookId, filename) {
  try {
    const res = await fetch(`${API_BASE}/api/books/${bookId}/file`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('下载失败：' + err.message);
  }
}

// ---------- 修改书籍 ----------

async function renderBookEdit(container) {
  const bookId = currentId();
  container.innerHTML = topBar() + '<div class="container"><div class="loading"></div></div>';
  try {
    const book = await api('/api/books/' + bookId, { method: 'GET' });
    if (!book.can_edit) {
      container.innerHTML = topBar() + '<div class="container"><div class="message error">你没有修改这本书的权限</div></div>';
      return;
    }
    container.innerHTML = topBar() + `
      <div class="container">
        <div class="detail-topbar">
          <button class="btn" onclick="navigate('/book/${bookId}')">← 返回详情</button>
        </div>
        <div class="panel panel-narrow">
          <div class="panel-title">修改书籍信息</div>
          <div id="edit-msg"></div>
          <form id="edit-form">
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
                <input type="text" id="edit-series" value="${escapeAttr(book.series || '')}" placeholder='留空表示单行本' />
              </div>
              <div class="form-group">
                <label>卷号</label>
                <input type="number" id="edit-volume" min="0" value="${escapeAttr(book.volume_number || 0)}" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>出版年</label>
                <input type="text" id="edit-year" value="${escapeAttr(book.publish_year || '')}" placeholder='例如：2012-8' />
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
              <textarea id="edit-description" rows="6" placeholder='可自行填写或修改'>${escapeHtml(book.description || '')}</textarea>
            </div>
            <div class="form-group">
              <label>封面地址</label>
              <input type="text" id="edit-cover" placeholder='留空则保持当前封面' />
              <div class="upload-hint">支持豆瓣图书封面地址；留空表示不修改封面</div>
            </div>
            <div class="meta-actions">
              <button type="submit" class="btn btn-primary">保存修改</button>
              ${book.cover ? '<button type="button" class="btn btn-danger" onclick="removeCover()">删除封面</button>' : ''}
              <button type="button" class="btn" onclick="navigate('/book/${bookId}')">取消</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.getElementById('edit-form').addEventListener('submit', saveBookEdit);
  } catch (err) {
    container.innerHTML = topBar() + `<div class="container"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
    if (err.message.includes('未登录') || err.message.includes('过期')) {
      logout();
    }
  }
}

async function saveBookEdit(event) {
  if (event) event.preventDefault();
  const bookId = currentId();
  const payload = {
    title: document.getElementById('edit-title').value,
    author: document.getElementById('edit-author').value,
    series: document.getElementById('edit-series').value,
    volume_number: document.getElementById('edit-volume').value || '0',
    publish_year: document.getElementById('edit-year').value,
    publisher: document.getElementById('edit-publisher').value,
    isbn: document.getElementById('edit-isbn').value,
    description: document.getElementById('edit-description').value
  };
  const coverUrl = document.getElementById('edit-cover').value.trim();
  if (coverUrl) payload.cover_url = coverUrl;
  try {
    await api('/api/books/' + bookId, { method: 'PUT', body: payload });
    showMsg('edit-msg', '已保存，正在返回详情…', false);
    setTimeout(() => navigate('/book/' + bookId), 700);
  } catch (err) {
    showMsg('edit-msg', err.message, true);
  }
}

async function removeCover() {
  const bookId = currentId();
  try {
    await api('/api/books/' + bookId + '/cover', { method: 'DELETE' });
    showMsg('edit-msg', '封面已删除', false);
    setTimeout(() => render(), 700);
  } catch (err) {
    showMsg('edit-msg', err.message, true);
  }
}

// ---------- 上传 ----------

function renderUpload(container) {
  state.pendingCoverUrl = '';
  container.innerHTML = topBar() + `
    <div class="container">
      <div class="panel panel-narrow">
        <div class="panel-title">上传新书</div>
        <div id="upload-msg"></div>
        <form id="upload-form">
          <div class="form-group">
            <label>书名</label>
            <div class="meta-search">
              <input type="text" id="title" required placeholder='例如：活着' />
              <button type="button" class="btn btn-primary" onclick="searchMetadataForUpload()">搜索元数据</button>
            </div>
            <div class="upload-hint">输入书名后点「搜索元数据」，可自动补全作者、出版年、出版社、简介与封面</div>
          </div>

          <div id="upload-meta-results" class="meta-results"></div>

          <div class="form-group">
            <label>作者</label>
            <input type="text" id="author" placeholder='作者名' />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>出版年</label>
              <input type="text" id="publish_year" placeholder='例如：2012-8' />
            </div>
            <div class="form-group">
              <label>出版社</label>
              <input type="text" id="publisher" placeholder='出版社' />
            </div>
          </div>
          <div class="form-group">
            <label>ISBN</label>
            <input type="text" id="isbn" placeholder='ISBN' />
          </div>
          <div class="form-group">
            <label>简介</label>
            <textarea id="description" rows="5" placeholder='可自动填入，也可自行填写或修改'></textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>系列名</label>
              <input type="text" id="series" placeholder='同一系列的书籍填同一个系列名' />
              <div class="upload-hint">同一系列会自动归并为一部作品</div>
            </div>
            <div class="form-group">
              <label>卷号</label>
              <input type="number" id="volume_number" min="0" placeholder="1" />
              <div class="upload-hint">0 表示无卷号</div>
            </div>
          </div>
          <div class="form-group">
            <label>书籍文件</label>
            <input type="file" id="file" accept=".epub,.pdf,.txt,.docx,.mobi,.azw3" required />
            <div class="upload-hint">支持 EPUB、PDF、TXT、DOCX、MOBI、AZW3</div>
          </div>
          <div id="upload-cover-preview"></div>
          <button type="submit" class="btn btn-primary" style="width:100%">上传</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('title', document.getElementById('title').value);
    formData.append('author', document.getElementById('author').value);
    formData.append('publish_year', document.getElementById('publish_year').value);
    formData.append('publisher', document.getElementById('publisher').value);
    formData.append('isbn', document.getElementById('isbn').value);
    formData.append('description', document.getElementById('description').value);
    formData.append('series', document.getElementById('series').value);
    formData.append('volume_number', document.getElementById('volume_number').value || '0');
    if (state.pendingCoverUrl) formData.append('cover_url', state.pendingCoverUrl);
    formData.append('file', document.getElementById('file').files[0]);
    try {
      const created = await api('/api/books', { method: 'POST', body: formData });
      showMsg('upload-msg', '上传成功', false);
      setTimeout(() => navigate('/book/' + created.id), 900);
    } catch (err) {
      showMsg('upload-msg', err.message, true);
    }
  });
}

// ---------- 阅读器 ----------

async function renderReader(container) {
  const bookId = currentId();
  container.innerHTML = `<div class="loading" style="position:absolute;top:50%;left:50%"></div>`;
  try {
    const book = await api(`/api/books/${bookId}`, { method: 'GET' });
    state.currentBook = book;
    const fileUrl = `${API_BASE}/api/books/${bookId}/file`;
    container.innerHTML = `
      <div class="reader-page">
        <div class="reader-toolbar">
          <div class="reader-toolbar-left">
            <button class="btn" onclick="navigate('/book/${bookId}')">返回详情</button>
            <span class="reader-title">${escapeHtml(book.title)}</span>
          </div>
          <div class="reader-toolbar-right">
            <div class="reader-controls">
              <label>字号</label>
              <input type="range" id="font-size" min="12" max="32" value="${state.readerSettings.fontSize}" />
              <label>行距</label>
              <input type="range" id="line-height" min="1.2" max="2.5" step="0.1" value="${state.readerSettings.lineHeight}" />
              <label>主题</label>
              <select id="theme">
                <option value="dark" ${state.readerSettings.theme === 'dark' ? 'selected' : ''}>暗色</option>
                <option value="light" ${state.readerSettings.theme === 'light' ? 'selected' : ''}>浅色</option>
                <option value="sepia" ${state.readerSettings.theme === 'sepia' ? 'selected' : ''}>羊皮纸</option>
              </select>
              <label>字体</label>
              <select id="font-family">
                <option value="Noto Sans SC" ${state.readerSettings.fontFamily === 'Noto Sans SC' ? 'selected' : ''}>无衬线</option>
                <option value="serif" ${state.readerSettings.fontFamily === 'serif' ? 'selected' : ''}>serif</option>
                <option value="monospace" ${state.readerSettings.fontFamily === 'monospace' ? 'selected' : ''}>等宽</option>
              </select>
              <label>图片</label>
              <input type="range" id="img-scale" min="50" max="200" step="10" value="${state.readerSettings.imgScale}" />
              <span class="range-value" id="img-scale-value">${state.readerSettings.imgScale}%</span>
            </div>
          </div>
        </div>
        <div class="reader-content ${state.readerSettings.theme}" id="reader-content">
          <div id="reader-host" class="reader-text"></div>
        </div>
      </div>
    `;
    const host = document.getElementById('reader-host');
    applyReaderStyles();
    bindReaderControls();

    if (book.format === 'epub') {
      await renderEpub(fileUrl, host, bookId);
    } else if (book.format === 'pdf') {
      await renderPdf(fileUrl, host, bookId);
    } else if (book.format === 'docx') {
      await renderDocx(fileUrl, host, bookId);
    } else if (book.format === 'txt') {
      await renderTxt(fileUrl, host, bookId);
    } else {
      host.innerHTML = `<div class="empty-state"><h3>暂不支持在线阅读的格式</h3><p>请下载后阅读</p></div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top:64px"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
  }
}

function bindReaderControls() {
  const fontSize = document.getElementById('font-size');
  const lineHeight = document.getElementById('line-height');
  const theme = document.getElementById('theme');
  const fontFamily = document.getElementById('font-family');
  const imgScale = document.getElementById('img-scale');
  const imgScaleValue = document.getElementById('img-scale-value');

  const update = () => {
    state.readerSettings.fontSize = parseInt(fontSize.value);
    state.readerSettings.lineHeight = parseFloat(lineHeight.value);
    state.readerSettings.theme = theme.value;
    state.readerSettings.fontFamily = fontFamily.value;
    state.readerSettings.imgScale = parseInt(imgScale.value);
    if (imgScaleValue) imgScaleValue.textContent = imgScale.value + '%';
    localStorage.setItem('readerSettings', JSON.stringify(state.readerSettings));
    applyReaderStyles();
  };

  fontSize.addEventListener('input', update);
  lineHeight.addEventListener('input', update);
  theme.addEventListener('change', update);
  fontFamily.addEventListener('change', update);
  imgScale.addEventListener('input', update);
}

function applyReaderStyles() {
  const content = document.getElementById('reader-content');
  const host = document.getElementById('reader-host');
  content.className = `reader-content ${state.readerSettings.theme}`;
  host.style.fontSize = state.readerSettings.fontSize + 'px';
  host.style.lineHeight = state.readerSettings.lineHeight;
  host.style.fontFamily = state.readerSettings.fontFamily;
  // 图片缩放：以阅读区宽度为 100%
  host.style.setProperty('--img-scale', (state.readerSettings.imgScale || 100) / 100);
}

// EPUB rendering (server-side extraction)
async function renderEpub(url, host, bookId) {
  try {
    const data = await api(`/api/books/${bookId}/content`, { method: 'GET' });
    if (data.error) throw new Error(data.error);
    if (data.chapters && data.chapters.length > 0) {
      let html = '';
      for (const ch of data.chapters) {
        html += '<div class="epub-chapter"><h2 class="epub-chapter-title">' + escapeHtml(ch.title) + '</h2>';
        // Extract body content from XHTML
        var bodyMatch = ch.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        var content = bodyMatch ? bodyMatch[1] : ch.html;
        // Remove script/style/link tags and XML/DOCTYPE declarations
        content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
        content = content.replace(/<style[\s\S]*?<\/style>/gi, '');
        content = content.replace(/<link[^>]*>/gi, '');
        content = content.replace(/<\?xml[^>]*>/gi, '');
        content = content.replace(/<!DOCTYPE[^>]*>/gi, '');
        html += content + '</div>';
      }
      host.innerHTML = html;
    } else {
      host.innerHTML = '<div class="empty-state"><h3>无法解析 EPUB 内容</h3><p>该文件可能格式异常</p></div>';
    }
  } catch (err) {
    host.innerHTML = '<div class="empty-state"><h3>EPUB 加载失败</h3><p>' + escapeHtml(err.message) + '</p></div>';
  }
}

// PDF rendering
async function renderPdf(url, host) {
  host.innerHTML = '';
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${state.token}` } });
  const buffer = await res.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  // 以容器宽度为基准渲染，并按设备像素比提升清晰度，放大后依然清晰
  const containerWidth = host.clientWidth || window.innerWidth || 800;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const fitScale = Math.max(0.5, Math.min(3, (containerWidth / base.width) * dpr));
    const viewport = page.getViewport({ scale: fitScale });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    host.appendChild(canvas);
    await page.render({ canvasContext: context, viewport }).promise;
  }
}

// DOCX rendering
async function renderDocx(url, host) {
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${state.token}` } });
  const arrayBuffer = await res.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: ['p => p'] });
  host.innerHTML = result.value;
}

// TXT rendering：正文由服务端按实际编码解码，避免浏览器按 UTF-8 强解导致乱码
async function renderTxt(url, host, bookId) {
  const data = await api(`/api/books/${bookId}/content`, { method: 'GET' });
  const text = typeof data === 'string' ? data : (data.text || '');
  const normalized = text.replace(/\r\n?/g, '\n');
  const paragraphs = normalized
    .split(/\n\s*\n+/)
    .filter(p => p.trim() !== '')
    .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  host.innerHTML = paragraphs || '<p>（正文为空）</p>';
}

// 刷新页面后凭本地令牌取回用户信息，供顶栏与权限判断使用
async function restoreSession() {
  if (!state.token) return;
  try {
    const data = await api('/api/auth/me', { method: 'GET' });
    state.user = data.user;
  } catch (e) {
    state.token = null;
    state.user = null;
    localStorage.removeItem('token');
  }
}

// Init
window.addEventListener('hashchange', render);
window.addEventListener('load', async () => {
  await restoreSession();
  render();
});
