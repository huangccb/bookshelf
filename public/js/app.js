// API base URL
const API_BASE = '';

// State
const state = {
  token: localStorage.getItem('token'),
  user: null,
  books: [],
  currentBook: null,
  viewMode: localStorage.getItem('viewMode') || 'grid',
  readerSettings: JSON.parse(localStorage.getItem('readerSettings')) || {
    fontSize: 18,
    lineHeight: 1.75,
    theme: 'dark',
    fontFamily: 'Noto Sans SC'
  }
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
    case '/series':
      renderSeries(app);
      break;
    default:
      if (path.startsWith('/reader/')) {
        renderReader(app);
      } else if (path.startsWith('/series/')) {
        renderSeries(app);
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
  div.textContent = text;
  return div.innerHTML;
}

function topBar() {
  const roleBadge = state.user && state.user.role === 'admin'
    ? '<span class="user-role">Admin</span>'
    : '';
  const userInfo = state.user
    ? `<span class="user-info">${state.user.email}${roleBadge}</span>`
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

// Series detail page
async function renderSeries(container) {
  const bookId = getRoute().path.split('/').pop();
  container.innerHTML = '<div class="container"><div class="loading" style="margin:40px auto"></div></div>';
  try {
    const books = await api('/api/books', { method: 'GET' });
    state.books = books;
    const currentBook = books.find(b => b.id === bookId);
    if (!currentBook) {
      container.innerHTML = topBar() + '<div class="container"><div class="message error">书籍不存在</div></div>';
      return;
    }

    const seriesName = currentBook.series || '';
    const seriesBooks = seriesName
      ? books.filter(b => b.series === seriesName).sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0))
      : [currentBook];

    let html = topBar() + `
      <div class="container">
        <div class="series-detail-header">
          <button class="btn" onclick="navigate('/bookshelf')">← 返回书架</button>
          <div>
            <h1 class="series-detail-title">${escapeHtml(seriesName || currentBook.title)}</h1>
            <p class="series-detail-subtitle">${seriesName ? '系列 ' + seriesBooks.length + ' 卷' : '单行本'}</p>
          </div>
        </div>

        <div class="series-book-list">
          <div class="book-list-header">
            <span class="col-title">书名</span>
            <span class="col-author">作者</span>
            <span class="col-volume">卷号</span>
            <span class="col-format">格式</span>
            <span class="col-actions">操作</span>
          </div>
    `;

    for (const book of seriesBooks) {
      const vol = book.volume_number ? `第 ${book.volume_number} 卷` : '全一册';
      const filename = `${book.title}.${book.format}`.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-.]/g, '_');
      const isActive = book.id === bookId;
      html += `
        <div class="book-list-row ${isActive ? 'active' : ''}">
          <span class="col-title">${escapeHtml(book.title)}${isActive ? ' <span class="current-badge">当前</span>' : ''}</span>
          <span class="col-author">${escapeHtml(book.author || '未知作者')}</span>
          <span class="col-volume">${vol}</span>
          <span class="col-format"><span class="book-format">${book.format}</span></span>
          <span class="col-actions">
            <button class="btn btn-primary btn-sm" onclick="navigate('/reader/${book.id}')">阅读</button>
            <button class="btn btn-sm" onclick="downloadBook('${book.id}', '${filename}')">下载</button>
          </span>
        </div>
      `;
    }

    html += `
        </div>
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = topBar() + `<div class="container"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
    if (err.message.includes('未登录') || err.message.includes('过期')) {
      logout();
    }
  }
}

// Bookshelf page
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
          <p>点击上方“上传书籍”添加你的第一本藏书吧。</p>
          <a href="#/upload" class="btn btn-primary" style="margin-top:16px">上传书籍</a>
        </div>
      `;
      return;
    }

    const seriesMap = {};
    const noSeries = [];
    books.forEach(book => {
      if (book.series) {
        if (!seriesMap[book.series]) seriesMap[book.series] = [];
        seriesMap[book.series].push(book);
      } else {
        noSeries.push(book);
      }
    });

    const viewToggles = `
      <button class="btn btn-view-toggle" onclick="toggleViewMode()">
        ${state.viewMode === 'grid' ? '切换为列表' : '切换为网格'}
      </button>
    `;

    let html = `
      <div class="bookshelf-header">
        <div class="bookshelf-title">
          <h2>藏书目录</h2>
          ${viewToggles}
        </div>
      </div>
    `;

    if (state.viewMode === 'list') {
      html += renderListView(seriesMap, noSeries);
    } else {
      html += renderGridView(seriesMap, noSeries);
    }

    containerEl.innerHTML = html;
  } catch (err) {
    container.innerHTML = topBar() + `<div class="container"><div class="message error">加载失败：${escapeHtml(err.message)}</div></div>`;
    if (err.message.includes('未登录') || err.message.includes('过期')) {
      logout();
    }
  }
}

function bookCard(book) {
  const vol = book.volume_number ? `第 ${book.volume_number} 卷` : '全一册';
  return `
    <div class="book-card" onclick="navigate('/series/${book.id}')">
      <div class="book-cover">
        ${escapeHtml(book.series || book.title)}
      </div>
      <div class="book-title">${escapeHtml(book.title)}</div>
      <div class="book-meta">${escapeHtml(book.author || '未知作者')} · ${vol}</div>
      <span class="book-format">${book.format}</span>
    </div>
  `;
}

function toggleViewMode() {
  state.viewMode = state.viewMode === 'grid' ? 'list' : 'grid';
  localStorage.setItem('viewMode', state.viewMode);
  render();
}

function renderGridView(seriesMap, noSeries) {
  let html = '';
  Object.keys(seriesMap).sort().forEach(series => {
    const vols = seriesMap[series].sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0));
    html += `
      <div class="series-group">
        <div class="series-title">
          <span>${escapeHtml(series)}</span>
          <span class="badge">${vols.length} 卷</span>
        </div>
        <div class="book-grid">
          ${vols.map(book => bookCard(book)).join('')}
        </div>
      </div>
    `;
  });

  if (noSeries.length > 0) {
    html += `
      <div class="series-group">
        <div class="series-title"><span>单行本</span></div>
        <div class="book-grid">
          ${noSeries.map(book => bookCard(book)).join('')}
        </div>
      </div>
    `;
  }
  return html;
}

function renderListView(seriesMap, noSeries) {
  let html = '';
  Object.keys(seriesMap).sort().forEach(series => {
    const vols = seriesMap[series].sort((a, b) => (a.volume_number || 0) - (b.volume_number || 0));
    html += renderListSection(series, vols);
  });

  if (noSeries.length > 0) {
    html += renderListSection('单行本', noSeries);
  }
  return html;
}

function renderListSection(title, books) {
  return `
    <div class="series-group">
      <div class="series-title">
        <span>${escapeHtml(title)}</span>
        <span class="badge">${books.length} 卷</span>
      </div>
      <div class="book-list">
        <div class="book-list-header">
          <span class="col-title">书名</span>
          <span class="col-author">作者</span>
          <span class="col-volume">卷号</span>
          <span class="col-format">格式</span>
          <span class="col-actions">操作</span>
        </div>
        ${books.map(book => bookListRow(book)).join('')}
      </div>
    </div>
  `;
}

function bookListRow(book) {
  const vol = book.volume_number ? `第 ${book.volume_number} 卷` : '全一册';
  const filename = `${book.title}.${book.format}`.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-.]/g, '_');
  return `
    <div class="book-list-row">
      <span class="col-title" onclick="navigate('/series/${book.id}')">${escapeHtml(book.title)}</span>
      <span class="col-author">${escapeHtml(book.author || '未知作者')}</span>
      <span class="col-volume">${vol}</span>
      <span class="col-format"><span class="book-format">${book.format}</span></span>
      <span class="col-actions">
        <button class="btn btn-sm" onclick="navigate('/reader/${book.id}')">阅读</button>
        <button class="btn btn-sm" onclick="downloadBook('${book.id}', '${filename}')">下载</button>
      </span>
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

// Upload page
function renderUpload(container) {
  container.innerHTML = topBar() + `
    <div class="container">
      <div class="panel" style="max-width:600px;margin:0 auto">
        <div class="panel-title">上传新书</div>
        <div id="upload-msg"></div>
        <form id="upload-form">
          <div class="form-group">
            <label>书名</label>
            <input type="text" id="title" required placeholder='例如：明日方舟 官方漫画集' />
          </div>
          <div class="form-group">
            <label>作者</label>
            <input type="text" id="author" placeholder='作者名' />
          </div>
          <div class="form-group">
            <label>系列名</label>
            <input type="text" id="series" placeholder='例如：明日方舟官方漫画' />
            <div class="upload-hint">同一系列的书籍会自动归并显示</div>
          </div>
          <div class="form-group">
            <label>卷号</label>
            <input type="number" id="volume_number" min="0" placeholder="1" />
            <div class="upload-hint">0 表示无卷号</div>
          </div>
          <div class="form-group">
            <label>书籍文件</label>
            <input type="file" id="file" accept=".epub,.pdf,.txt,.docx,.mobi,.azw3" required />
            <div class="upload-hint">支持 EPUB、PDF、TXT、DOCX、MOBI、AZW3</div>
          </div>
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
    formData.append('series', document.getElementById('series').value);
    formData.append('volume_number', document.getElementById('volume_number').value || '0');
    formData.append('file', document.getElementById('file').files[0]);
    try {
      await api('/api/books', { method: 'POST', body: formData });
      showMsg('upload-msg', '上传成功', false);
      setTimeout(() => navigate('/bookshelf'), 1000);
    } catch (err) {
      showMsg('upload-msg', err.message, true);
    }
  });
}

// Reader page
async function renderReader(container) {
  const bookId = getRoute().path.split('/').pop();
  container.innerHTML = `<div class="loading" style="position:absolute;top:50%;left:50%"></div>`;
  try {
    const book = await api(`/api/books/${bookId}`, { method: 'GET' });
    state.currentBook = book;
    const fileUrl = `${API_BASE}/api/books/${bookId}/file`;
    container.innerHTML = `
      <div class="reader-page">
        <div class="reader-toolbar">
          <div class="reader-toolbar-left">
            <button class="btn" onclick="navigate('/bookshelf')">返回书架</button>
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

  const update = () => {
    state.readerSettings.fontSize = parseInt(fontSize.value);
    state.readerSettings.lineHeight = parseFloat(lineHeight.value);
    state.readerSettings.theme = theme.value;
    state.readerSettings.fontFamily = fontFamily.value;
    localStorage.setItem('readerSettings', JSON.stringify(state.readerSettings));
    applyReaderStyles();
  };

  fontSize.addEventListener('input', update);
  lineHeight.addEventListener('input', update);
  theme.addEventListener('change', update);
  fontFamily.addEventListener('change', update);
}

function applyReaderStyles() {
  const content = document.getElementById('reader-content');
  const host = document.getElementById('reader-host');
  content.className = `reader-content ${state.readerSettings.theme}`;
  host.style.fontSize = state.readerSettings.fontSize + 'px';
  host.style.lineHeight = state.readerSettings.lineHeight;
  host.style.fontFamily = state.readerSettings.fontFamily;
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
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.5 });
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

// TXT rendering
async function renderTxt(url, host) {
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${state.token}` } });
  const text = await res.text();
  const paragraphs = text.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  host.innerHTML = paragraphs;
}

// Init
window.addEventListener('hashchange', render);
window.addEventListener('load', render);
