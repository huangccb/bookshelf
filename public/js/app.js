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
  readerSettings: loadReaderSettings(),
  history: [],
  historyTotal: 0,
  myBooks: [],
  myBooksTotal: 0
};

// 读取阅读偏好，并迁移旧版主题名与行距数值
function loadReaderSettings() {
  const defaults = {
    fontSize: 20,
    lineHeight: 1.9,
    theme: 'paper',
    fontFamily: 'Noto Sans SC',
    imgScale: 100,
    margin: 'normal'
  };
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('readerSettings')) || {};
  } catch (e) {
    saved = {};
  }
  const settings = Object.assign({}, defaults, saved);
  if (settings.theme === 'light') settings.theme = 'white';
  if (settings.theme === 'sepia') settings.theme = 'paper';
  if (['white', 'paper', 'green', 'dark'].indexOf(settings.theme) < 0) settings.theme = 'paper';
  if (['narrow', 'normal', 'wide'].indexOf(settings.margin) < 0) settings.margin = 'normal';
  // 行距对齐到分段控件的三档
  const steps = [1.6, 1.9, 2.2];
  let nearest = steps[0];
  let best = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const diff = Math.abs(steps[i] - settings.lineHeight);
    if (diff < best) { best = diff; nearest = steps[i]; }
  }
  settings.lineHeight = nearest;
  return settings;
}

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

// 站内页面：登录与注册各自是独立页面（/login、/register），
// 主目录 / 即书籍页面，其余页面用 hash 路由
const PAGE_ROUTES = {
  '/login': '/login',
  '/register': '/register'
};

function navigate(path) {
  if (PAGE_ROUTES[path]) {
    window.location.href = PAGE_ROUTES[path];
    return;
  }
  // 书架就是主目录，地址保持干净
  window.location.hash = path === '/bookshelf' ? '' : path;
  render();
}

function leaveApp() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
}

function getRoute() {
  const raw = window.location.hash.replace('#', '');
  // 空 hash 或站内旧链接（#/bookshelf）都落到书籍页面
  const path = (!raw || raw === '/bookshelf') ? '/' : raw;
  const [clean, query] = path.split('?');
  return { path: clean, query };
}

function currentId() {
  return getRoute().path.split('/').pop();
}

// Render the current page
function render() {
  const app = document.getElementById('app');
  const { path } = getRoute();
  app.innerHTML = '';

  // 独立页面只在自己的网址上渲染，直接用 hash 访问就送回对应页面
  if (path === '/login' || path === '/register') {
    window.location.replace(PAGE_ROUTES[path]);
    return;
  }

  // 主目录与书籍相关页面需要登录，未登录转到登录页
  if (!state.token) {
    leaveApp();
    window.location.replace('/login');
    return;
  }

  switch (path) {
    case '/':
      renderBookshelf(app);
      break;
    case '/bookshelf':
      navigate('/');
      return;
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
    case '/account':
      renderAccount(app);
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

function setAuth(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('token', data.token);
}

function logout() {
  leaveApp();
  window.location.href = '/login';
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

// 顶栏不提供后台入口：后台只通过 /admin 网址进入
function topBar() {
  return `
    <div class="top-bar">
      <a class="logo" href="/">
        <span class="logo-text">资源书架</span>
      </a>
      <div class="nav-links">
        ${userChip()}
        <a class="btn" href="/">书架</a>
        <a class="btn" href="#/upload">上传书籍</a>
        <button class="btn btn-danger" onclick="logout()">退出</button>
      </div>
    </div>
  `;
}

// 用户名：账户没设过名字时退回邮箱前缀，保证按钮上总有字
function displayName(user) {
  const u = user || state.user;
  if (!u) return '读者';
  const name = String(u.name || '').trim();
  if (name) return name;
  return String(u.email || '').split('@')[0] || '读者';
}

// viewBox 描边的云朵，用作用户按钮与卡片装饰的图形母题
const CLOUD_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.2 18h9.4a3.4 3.4 0 0 0 .5-6.76A4.6 4.6 0 0 0 8.6 10a3.6 3.6 0 0 0-1.4 8z"/></svg>`;

// 右上角的用户按钮：显示用户名，点击进入账户中心
function userChip() {
  const name = displayName();
  const initial = Array.from(name)[0] || '读';
  return `
    <a class="user-chip" href="#/account" title="${escapeAttr(name)}">
      ${CLOUD_ICON}
      <span class="user-chip-name">${escapeHtml(name)}</span>
      <span class="user-chip-initial" aria-hidden="true">${escapeHtml(initial)}</span>
    </a>
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
          <button class="btn" onclick="navigate('/')">← 返回书架</button>
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

// ---------- 账户中心 ----------

// 相对时间：历史记录角标用
function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + ' 分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + ' 小时前';
  const day = Math.floor(hour / 24);
  if (day < 30) return day + ' 天前';
  const d = new Date(t);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 网格里的一张书卡：封面 + 书名 + 作者 + 可选角标
function cloudBookCard(book, opts) {
  const o = opts || {};
  const badge = o.badge ? `<span class="collection-badge">${escapeHtml(o.badge)}</span>` : '';
  return `
    <li class="cloud-book-card" data-book-id="${escapeAttr(book.id)}" data-href="${escapeAttr(o.href || '#/book/' + book.id)}">
      <div class="cloud-book-cover">
        ${coverBlock(book)}
        ${badge}
      </div>
      <div class="cloud-book-title">${escapeHtml(book.title)}</div>
      <div class="cloud-book-author">${escapeHtml(book.author || '未知作者')}</div>
    </li>
  `;
}

// 一级只展示 5 本，超出时给「查看全部」
const FEATURED_LIMIT = 5;

function collectionSection(opts) {
  const items = opts.items || [];
  const total = opts.total || 0;
  const shown = items.slice(0, FEATURED_LIMIT);
  const hasMore = total > FEATURED_LIMIT;
  const empty = total === 0;

  return `
    <section class="cloud-card collection-panel">
      <span class="cloud-deco" aria-hidden="true"></span>
      <header class="collection-head">
        <h2 class="collection-title">${CLOUD_ICON}<span>${escapeHtml(opts.title)}</span></h2>
        <div class="collection-head-right">
          <span class="collection-count">共 ${total} 本</span>
          ${hasMore ? `<button class="btn btn-sm collection-more" data-open-collection="${escapeAttr(opts.kind)}">查看全部</button>` : ''}
        </div>
      </header>
      ${empty
        ? `<div class="collection-empty">${escapeHtml(opts.emptyText || '还没有内容。')}</div>`
        : `<ul class="collection-grid">${shown.map(item => cloudBookCard(item.book, {
            href: opts.hrefFor(item.book),
            badge: opts.badgeFor ? opts.badgeFor(item) : ''
          })).join('')}</ul>`}
    </section>
  `;
}

async function renderAccount(container) {
  container.innerHTML = topBar() + '<div class="container" id="account-container"><div class="loading"></div></div>';
  try {
    const [me, history, mine] = await Promise.all([
      api('/api/auth/me', { method: 'GET' }),
      api('/api/history?limit=200', { method: 'GET' }),
      api('/api/my-books?limit=200', { method: 'GET' })
    ]);
    state.user = me.user;
    state.history = history.items || [];
    state.historyTotal = history.total || 0;
    state.myBooks = mine.items || [];
    state.myBooksTotal = mine.total || 0;
    paintAccount(container);
  } catch (err) {
    container.innerHTML = topBar() + `<div class="container"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
    if (err.message.includes('未登录') || err.message.includes('过期')) logout();
  }
}

function paintAccount(container) {
  const user = state.user || {};
  const roleLabel = user.role === 'admin' ? '管理员' : '普通用户';

  const historySection = collectionSection({
    title: '历史阅读',
    kind: 'history',
    total: state.historyTotal,
    items: state.history,
    emptyText: '还没有阅读记录，打开一本书就会出现在这里。',
    // 历史卡片直接续读
    hrefFor: book => '#/reader/' + book.id,
    badgeFor: item => relativeTime(item.last_read_at)
  });

  const mineSection = collectionSection({
    title: '我的上传',
    kind: 'my-books',
    total: state.myBooksTotal,
    items: state.myBooks,
    emptyText: '你还没有上传过书籍。',
    hrefFor: book => '#/book/' + book.id,
    badgeFor: () => '我上传'
  });

  container.innerHTML = topBar() + `
    <div class="container account-page">
      <div class="account-topbar">
        <a class="btn" href="/">← 返回书架</a>
      </div>

      <section class="cloud-card account-card">
        <span class="cloud-deco" aria-hidden="true"></span>
        <header class="account-head">
          <span class="account-avatar" aria-hidden="true">${CLOUD_ICON}</span>
          <div class="account-head-text">
            <h1 class="account-title">${escapeHtml(displayName(user))}</h1>
            <p class="account-sub">
              <span class="user-role">${roleLabel}</span>
              ${escapeHtml(user.email || '')}
            </p>
          </div>
        </header>

        <div id="account-msg"></div>

        <form id="account-form" class="account-form" novalidate>
          <fieldset class="account-fieldset">
            <legend>资料</legend>
            <div class="form-group">
              <label for="account-name">用户名</label>
              <input type="text" id="account-name" maxlength="32" value="${escapeAttr(displayName(user))}" placeholder="用户名" />
              <div class="upload-hint">顶栏显示的名字，1 到 32 个字符</div>
            </div>
            <div class="form-group">
              <label for="account-email">邮箱</label>
              <input type="email" id="account-email" value="${escapeAttr(user.email || '')}" placeholder="邮箱地址" autocapitalize="none" spellcheck="false" />
              <div class="upload-hint">用于登录，修改后请用新邮箱登录</div>
            </div>
          </fieldset>

          <fieldset class="account-fieldset">
            <legend>修改密码</legend>
            <div class="form-group">
              <label for="account-current">当前密码</label>
              <input type="password" id="account-current" autocomplete="current-password" placeholder="输入当前密码后保存" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="account-new">新密码</label>
                <input type="password" id="account-new" autocomplete="new-password" placeholder="不修改请留空" />
              </div>
              <div class="form-group">
                <label for="account-confirm">确认新密码</label>
                <input type="password" id="account-confirm" autocomplete="new-password" placeholder="再输入一次新密码" />
              </div>
            </div>
            <div class="account-match" id="account-match" hidden>两次输入的密码不一致</div>
          </fieldset>

          <div class="account-actions">
            <button type="submit" class="btn btn-primary" id="account-save">保存修改</button>
            <button type="button" class="btn btn-danger" onclick="logout()">退出登录</button>
          </div>
        </form>
      </section>

      ${historySection}
      ${mineSection}
    </div>
  `;

  bindAccountForm();
  bindCollectionCards();
}

function bindAccountForm() {
  const form = document.getElementById('account-form');
  if (!form) return;
  const pwd = document.getElementById('account-new');
  const confirm = document.getElementById('account-confirm');
  const matchTip = document.getElementById('account-match');
  const saveBtn = document.getElementById('account-save');

  // 两个密码框实时比对，不一致就禁用保存
  const syncMatch = () => {
    const a = pwd.value;
    const b = confirm.value;
    const mismatch = !!a && !!b && a !== b;
    matchTip.hidden = !mismatch;
    saveBtn.disabled = mismatch;
  };
  pwd.addEventListener('input', syncMatch);
  confirm.addEventListener('input', syncMatch);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('account-name').value.trim();
    const email = document.getElementById('account-email').value.trim();
    const current = document.getElementById('account-current').value;
    const next = pwd.value;
    const nextConfirm = confirm.value;

    if (!name) return showMsg('account-msg', '用户名不能为空', true);
    if (!current) return showMsg('account-msg', '请输入当前密码后再保存', true);
    if (next && next !== nextConfirm) return showMsg('account-msg', '两次输入的密码不一致', true);

    const payload = { name, email, current_password: current };
    if (next) {
      payload.new_password = next;
      payload.confirm_password = nextConfirm;
    }

    saveBtn.disabled = true;
    try {
      const data = await api('/api/account', { method: 'PUT', body: payload });
      state.user = data.user;
      if (data.token) {
        state.token = data.token;
        localStorage.setItem('token', data.token);
      }
      // 清掉刚填的密码框
      document.getElementById('account-current').value = '';
      pwd.value = '';
      confirm.value = '';
      syncMatch();
      showMsg('account-msg', '已保存', false);
      paintAccount(document.getElementById('app'));
    } catch (err) {
      showMsg('account-msg', err.message, true);
      saveBtn.disabled = false;
    }
  });
}

// 卡片点击跳转；弹窗里的卡片先关弹窗再跳
function bindCollectionCards() {
  document.querySelectorAll('.cloud-book-card').forEach(card => {
    card.addEventListener('click', () => {
      const href = card.dataset.href;
      closeCollectionModal();
      if (href) navigate(href.replace(/^#/, ''));
    });
  });
}

// ---------- 全部书籍弹窗 ----------

function collectionSource(kind) {
  if (kind === 'history') {
    return {
      title: '历史阅读',
      items: state.history || [],
      hrefFor: book => '#/reader/' + book.id,
      badgeFor: item => relativeTime(item.last_read_at),
      emptyText: '还没有阅读记录。'
    };
  }
  return {
    title: '我的上传',
    items: state.myBooks || [],
    hrefFor: book => '#/book/' + book.id,
    badgeFor: () => '我上传',
    emptyText: '你还没有上传过书籍。'
  };
}

function openCollectionModal(kind) {
  const source = collectionSource(kind);
  const items = source.items;

  let host = document.getElementById('collection-modal-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'collection-modal-host';
    document.body.appendChild(host);
  }

  host.innerHTML = `
    <div class="collection-mask" data-collection-mask>
      <div class="collection-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(source.title)}">
        <header class="collection-modal-head">
          <h2>${CLOUD_ICON}<span>${escapeHtml(source.title)} · 全部 ${items.length} 本</span></h2>
          <button class="collection-close" data-collection-close aria-label="关闭">×</button>
        </header>
        <div class="collection-modal-body">
          ${items.length === 0
            ? `<div class="collection-empty">${escapeHtml(source.emptyText)}</div>`
            : `<ul class="collection-grid">${items.map(item => cloudBookCard(item.book, {
                href: source.hrefFor(item.book),
                badge: source.badgeFor(item)
              })).join('')}</ul>`}
        </div>
        <footer class="collection-modal-foot">
          <button class="btn" data-collection-close>关闭</button>
        </footer>
      </div>
    </div>
  `;

  host.querySelector('[data-collection-mask]').addEventListener('click', e => {
    if (e.target.hasAttribute('data-collection-mask')) closeCollectionModal();
  });
  host.querySelectorAll('[data-collection-close]').forEach(btn => {
    btn.addEventListener('click', closeCollectionModal);
  });
  bindCollectionCards();
  document.body.classList.add('modal-open');
}

function closeCollectionModal() {
  const host = document.getElementById('collection-modal-host');
  if (host) host.innerHTML = '';
  document.body.classList.remove('modal-open');
}

// ---------- 阅读器 ----------

// 记录一次阅读：历史列表按最近阅读时间排序
async function recordReading(bookId) {
  try {
    await api(`/api/books/${bookId}/progress`, { method: 'POST', body: {} });
  } catch (e) {
    // 历史记录失败不影响阅读
  }
}


async function renderReader(container) {
  const bookId = currentId();
  container.innerHTML = `<div class="loading" style="position:absolute;top:50%;left:50%"></div>`;
  try {
    const book = await api(`/api/books/${bookId}`, { method: 'GET' });
    state.currentBook = book;
    // 打开阅读器即记一次历史，失败不影响阅读
    recordReading(bookId);
    const fileUrl = `${API_BASE}/api/books/${bookId}/file`;
    container.innerHTML = `
      <div class="reader-page" id="reader-page"
           data-theme="${state.readerSettings.theme}"
           data-margin="${state.readerSettings.margin}">
        <header class="reader-topbar">
          <button class="reader-back" onclick="navigate('/book/${bookId}')" aria-label="返回详情">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <span class="reader-book-title">${escapeHtml(book.title)}</span>
          <span class="reader-topbar-spacer"></span>
        </header>

        <div class="reader-content" id="reader-content">
          <div id="reader-host" class="reader-text"></div>
        </div>

        <nav class="reader-bottombar">
          <button class="reader-tab" id="tab-toc" onclick="toggleReaderSheet('toc')" aria-label="目录">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="M4 7h16M4 12h16M4 17h11" />
            </svg>
          </button>
          <button class="reader-tab" id="tab-theme" onclick="toggleReaderSheet('theme')" aria-label="背景">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button class="reader-tab" id="tab-font" onclick="toggleReaderSheet('font')" aria-label="字体">
            <span class="reader-tab-glyph">A</span>
          </button>
        </nav>

        <div class="reader-sheet" id="reader-sheet">
          <div class="reader-sheet-pane" id="pane-font">
            <div class="reader-slider-row">
              <span class="reader-slider-cap">A</span>
              <input type="range" id="font-size" min="14" max="30" step="1" value="${state.readerSettings.fontSize}" />
              <span class="reader-slider-cap reader-slider-cap-lg">A</span>
            </div>
            <div class="reader-seg-row">
              <div class="reader-seg">
                <span class="reader-seg-title">边距</span>
                <div class="reader-seg-btns" id="seg-margin">
                  <button data-value="narrow">小</button>
                  <button data-value="normal">中</button>
                  <button data-value="wide">大</button>
                </div>
              </div>
              <div class="reader-seg">
                <span class="reader-seg-title">行距</span>
                <div class="reader-seg-btns" id="seg-lineheight">
                  <button data-value="1.6">紧</button>
                  <button data-value="1.9">中</button>
                  <button data-value="2.2">松</button>
                </div>
              </div>
            </div>
            <div class="reader-select-row">
              <label for="font-family">字体</label>
              <select id="font-family">
                <option value="Noto Sans SC" ${state.readerSettings.fontFamily === 'Noto Sans SC' ? 'selected' : ''}>黑体</option>
                <option value="serif" ${state.readerSettings.fontFamily === 'serif' ? 'selected' : ''}>宋体</option>
                <option value="monospace" ${state.readerSettings.fontFamily === 'monospace' ? 'selected' : ''}>等宽</option>
              </select>
            </div>
            <div class="reader-slider-row">
              <span class="reader-slider-cap">图片</span>
              <input type="range" id="img-scale" min="50" max="200" step="10" value="${state.readerSettings.imgScale}" />
              <span class="reader-slider-cap" id="img-scale-value">${state.readerSettings.imgScale}%</span>
            </div>
          </div>

          <div class="reader-sheet-pane" id="pane-theme">
            <div class="reader-sheet-label">颜色</div>
            <div class="reader-swatches" id="theme-swatches">
              <button data-theme="white" aria-label="白色" style="--sw-bg:#ffffff"></button>
              <button data-theme="paper" aria-label="纸黄" style="--sw-bg:#f7f1e3"></button>
              <button data-theme="green" aria-label="豆绿" style="--sw-bg:#cfe7d4"></button>
              <button data-theme="dark" aria-label="夜间" style="--sw-bg:#1e2229"></button>
            </div>
          </div>

          <div class="reader-sheet-pane" id="pane-toc">
            <div class="reader-sheet-label">目录</div>
            <div class="reader-toc" id="reader-toc"></div>
          </div>
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

    buildReaderToc(host);
  } catch (err) {
    container.innerHTML = `<div class="container" style="padding-top:64px"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
  }
}

function toggleReaderSheet(which) {
  const sheet = document.getElementById('reader-sheet');
  if (!sheet) return;
  const panes = { font: 'pane-font', theme: 'pane-theme', toc: 'pane-toc' };
  const tabs = { font: 'tab-font', theme: 'tab-theme', toc: 'tab-toc' };
  if (sheet.classList.contains('open') && sheet.getAttribute('data-pane') === which) {
    closeReaderSheet();
    return;
  }
  sheet.classList.add('open');
  sheet.setAttribute('data-pane', which);
  Object.keys(panes).forEach(key => {
    const pane = document.getElementById(panes[key]);
    const tab = document.getElementById(tabs[key]);
    const on = key === which;
    if (pane) pane.classList.toggle('active', on);
    if (tab) tab.classList.toggle('active', on);
  });
}

function closeReaderSheet() {
  const sheet = document.getElementById('reader-sheet');
  if (sheet) {
    sheet.classList.remove('open');
    sheet.removeAttribute('data-pane');
  }
  ['tab-font', 'tab-theme', 'tab-toc'].forEach(id => {
    const tab = document.getElementById(id);
    if (tab) tab.classList.remove('active');
  });
}

function syncReaderSegments() {
  const margin = document.getElementById('seg-margin');
  if (margin) {
    Array.prototype.forEach.call(margin.querySelectorAll('button'), btn => {
      btn.classList.toggle('active', btn.dataset.value === state.readerSettings.margin);
    });
  }
  const lineHeight = document.getElementById('seg-lineheight');
  if (lineHeight) {
    Array.prototype.forEach.call(lineHeight.querySelectorAll('button'), btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.value) === state.readerSettings.lineHeight);
    });
  }
}

function syncReaderSwatches() {
  const wrap = document.getElementById('theme-swatches');
  if (!wrap) return;
  Array.prototype.forEach.call(wrap.querySelectorAll('button'), btn => {
    btn.classList.toggle('active', btn.dataset.theme === state.readerSettings.theme);
  });
}

function bindReaderControls() {
  const fontSize = document.getElementById('font-size');
  const imgScale = document.getElementById('img-scale');
  const imgScaleValue = document.getElementById('img-scale-value');
  const fontFamily = document.getElementById('font-family');

  const persist = () => {
    localStorage.setItem('readerSettings', JSON.stringify(state.readerSettings));
    applyReaderStyles();
  };

  if (fontSize) {
    fontSize.addEventListener('input', () => {
      state.readerSettings.fontSize = parseInt(fontSize.value, 10);
      persist();
    });
  }

  if (imgScale) {
    imgScale.addEventListener('input', () => {
      state.readerSettings.imgScale = parseInt(imgScale.value, 10);
      if (imgScaleValue) imgScaleValue.textContent = imgScale.value + '%';
      persist();
    });
  }

  if (fontFamily) {
    fontFamily.addEventListener('change', () => {
      state.readerSettings.fontFamily = fontFamily.value;
      persist();
    });
  }

  const segMargin = document.getElementById('seg-margin');
  if (segMargin) {
    segMargin.addEventListener('click', event => {
      const btn = event.target.closest('button');
      if (!btn || !btn.dataset.value) return;
      state.readerSettings.margin = btn.dataset.value;
      syncReaderSegments();
      persist();
    });
  }

  const segLineHeight = document.getElementById('seg-lineheight');
  if (segLineHeight) {
    segLineHeight.addEventListener('click', event => {
      const btn = event.target.closest('button');
      if (!btn || !btn.dataset.value) return;
      state.readerSettings.lineHeight = parseFloat(btn.dataset.value);
      syncReaderSegments();
      persist();
    });
  }

  const swatches = document.getElementById('theme-swatches');
  if (swatches) {
    swatches.addEventListener('click', event => {
      const btn = event.target.closest('button');
      if (!btn || !btn.dataset.theme) return;
      state.readerSettings.theme = btn.dataset.theme;
      syncReaderSwatches();
      persist();
    });
  }

  const content = document.getElementById('reader-content');
  if (content) content.addEventListener('click', closeReaderSheet);

  syncReaderSegments();
  syncReaderSwatches();
}

function applyReaderStyles() {
  const page = document.getElementById('reader-page');
  const host = document.getElementById('reader-host');
  if (!page || !host) return;
  const settings = state.readerSettings;
  page.setAttribute('data-theme', settings.theme);
  page.setAttribute('data-margin', settings.margin || 'normal');
  host.style.fontSize = settings.fontSize + 'px';
  host.style.lineHeight = settings.lineHeight;
  host.style.fontFamily = settings.fontFamily;
  // 图片缩放：以阅读区宽度为 100%
  host.style.setProperty('--img-scale', (settings.imgScale || 100) / 100);
}

// 依据渲染出的章节标题生成目录
function buildReaderToc(host) {
  const toc = document.getElementById('reader-toc');
  const tab = document.getElementById('tab-toc');
  if (!toc || !host) return;
  const titles = host.querySelectorAll('.epub-chapter-title');
  if (titles.length === 0) {
    if (tab) {
      tab.disabled = true;
      tab.setAttribute('title', '本书没有章节信息');
    }
    toc.innerHTML = '<div class="reader-toc-empty">本书没有分章信息</div>';
    return;
  }
  let html = '';
  Array.prototype.forEach.call(titles, (el, index) => {
    const chapter = el.closest('.epub-chapter');
    const id = 'reader-ch-' + index;
    if (chapter) chapter.id = id;
    html += '<button class="reader-toc-item" data-target="' + id + '">' + escapeHtml(el.textContent) + '</button>';
  });
  toc.innerHTML = html;
  toc.onclick = event => {
    const btn = event.target.closest('.reader-toc-item');
    if (!btn) return;
    const target = document.getElementById(btn.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    closeReaderSheet();
  };
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
// 账户页的「查看全部」由事件委托处理，重绘后无需重新绑定
document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-open-collection]');
  if (!trigger) return;
  event.preventDefault();
  openCollectionModal(trigger.dataset.openCollection);
});

// Esc 关闭弹窗
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeCollectionModal();
});

window.addEventListener('hashchange', render);
window.addEventListener('load', async () => {
  await restoreSession();
  render();
});
