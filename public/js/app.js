// API base URL
const API_BASE = '';

// State
const state = {
  token: localStorage.getItem('token'),
  user: null,
  books: [],
  currentBook: null,
  readerSettings: JSON.parse(localStorage.getItem('readerSettings')) || {
    fontSize: 18,
    lineHeight: 1.8,
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
    default:
      if (path.startsWith('/reader/')) {
        renderReader(app);
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
          <h1>◢ RHODES ISLAND</h1>
          <p>罗德岛共享书架 · 登录</p>
        </div>
        <div class="panel" id="login-panel">
          <div class="panel-title">操作员认证</div>
          <div id="login-msg"></div>
          <form id="login-form">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="email" required placeholder="operator@rhodes.island" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="password" required placeholder="••••••••" />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">登录</button>
          </form>
          <p style="text-align:center;margin-top:16px;color:var(--text-secondary);font-size:0.9rem">
            还没有账号？ <a href="#/register" style="color:var(--accent)">注册</a>
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
          <h1>◢ RHODES ISLAND</h1>
          <p>罗德岛共享书架 · 注册</p>
        </div>
        <div class="panel" id="register-panel">
          <div class="panel-title">新操作员登记</div>
          <div id="register-msg"></div>
          <form id="register-form">
            <div class="form-group">
              <label>邮箱</label>
              <input type="email" id="reg-email" required placeholder="operator@rhodes.island" />
            </div>
            <div class="form-group">
              <label>密码</label>
              <input type="password" id="reg-password" required placeholder="至少6位" />
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%">注册</button>
          </form>
          <p style="text-align:center;margin-top:16px;color:var(--text-secondary);font-size:0.9rem">
            已有账号？ <a href="#/login" style="color:var(--accent)">登录</a>
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
  const userInfo = state.user ? `<span style="color:var(--text-secondary);font-family:var(--font-mono);font-size:0.85rem">${state.user.email}</span>` : '';
  return `
    <div class="top-bar">
      <div class="logo" onclick="navigate('/bookshelf')">罗德岛书架</div>
      <div class="nav-links">
        ${userInfo}
        <a class="btn" href="#/bookshelf">书架</a>
        <a class="btn" href="#/upload">上传书籍</a>
        <button class="btn btn-danger" onclick="logout()">退出</button>
      </div>
    </div>
  `;
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

    // Group by series
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

    let html = `
      <div class="bookshelf-header">
        <h2>藏书目录</h2>
      </div>
    `;

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
    <div class="book-card" onclick="navigate('/reader/${book.id}')">
      <div class="book-cover">
        ${escapeHtml(book.series || book.title)}
      </div>
      <div class="book-title">${escapeHtml(book.title)}</div>
      <div class="book-meta">${escapeHtml(book.author || '未知作者')} · ${vol}</div>
      <span class="book-format">${book.format}</span>
    </div>
  `;
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
            <input type="text" id="title" required placeholder="例如：明日方舟 官方漫画集" />
          </div>
          <div class="form-group">
            <label>作者</label>
            <input type="text" id="author" placeholder="作者名" />
          </div>
          <div class="form-group">
            <label>系列名</label>
            <input type="text" id="series" placeholder="例如：明日方舟官方漫画" />
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
                <option value="serif" ${state.readerSettings.fontFamily === 'serif' ? 'selected' : ''}> serif</option>
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
      await renderEpub(fileUrl, host);
    } else if (book.format === 'pdf') {
      await renderPdf(fileUrl, host);
    } else if (book.format === 'docx') {
      await renderDocx(fileUrl, host);
    } else if (book.format === 'txt') {
      await renderTxt(fileUrl, host);
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

// EPUB rendering
async function renderEpub(url, host) {
  host.innerHTML = '<div id="epub-viewer"></div>';
  const book = ePub(url);
  const rendition = book.renderTo('epub-viewer', {
    width: '100%',
    height: '100%',
    flow: 'scrolled-doc'
  });
  await rendition.display();
  // Apply custom styles via rendition themes
  rendition.themes.register('custom', {
    body: {
      'font-size': state.readerSettings.fontSize + 'px !important',
      'line-height': state.readerSettings.lineHeight + ' !important',
      'font-family': state.readerSettings.fontFamily + ' !important'
    }
  });
  rendition.themes.select('custom');
}

// PDF rendering
async function renderPdf(url, host) {
  host.innerHTML = '';
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument(url).promise;
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
