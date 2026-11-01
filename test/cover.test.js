const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { extractEpubCover } = require('../epub_extract');
const metadata = require('../metadata');

// 1x1 PNG，仅用于验证封面保存与读取
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata><meta name="cover" content="cover-img" /></metadata>
  <manifest>
    <item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image" />
    <item id="chap1" href="chap1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine><itemref idref="chap1" /></spine>
</package>`);
  zip.file('OEBPS/images/cover.png', PNG);
  zip.file('OEBPS/chap1.xhtml', '<html><body><p>测试章节</p></body></html>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('封面提取与上传', async (t) => {
  const epub = await makeEpub();

  await t.test('从 EPUB 读取内嵌封面', async () => {
    const cover = await extractEpubCover(epub);
    assert.ok(cover);
    assert.equal(cover.contentType, 'image/png');
    assert.ok(cover.buffer.equals(PNG));
  });

  await t.test('封面地址拒绝内网和非 http 协议', async () => {
    await assert.rejects(
      () => metadata.downloadCover('http://127.0.0.1:3000/cover.png'),
      /封面地址不可用/
    );
    await assert.rejects(
      () => metadata.downloadCover('file:///etc/passwd'),
      /http\/https/
    );
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookshelf-cover-'));
  const dbPath = path.join(tmpDir, 'data.json');
  fs.writeFileSync(dbPath, JSON.stringify({ users: [], books: [], reading_progress: [] }, null, 2));

  process.env.DATA_DIR = tmpDir;
  process.env.DB_PATH = dbPath;
  process.env.ADMIN_EMAIL = 'admin@test.local';
  process.env.ADMIN_PASSWORD = 'admin-pass-123';
  process.env.JWT_SECRET = 'test-secret';

  const app = require('../server');
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function jsonRequest(pathname, { method = 'GET', token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + pathname, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  async function uploadBook({ withCover, coverUrl, title }) {
    const form = new FormData();
    form.append('title', title);
    form.append('series', '测试系列');
    form.append('volume_number', '1');
    if (coverUrl) form.append('cover_url', coverUrl);
    if (withCover) form.append('cover_file', new Blob([PNG], { type: 'image/png' }), 'cover.png');
    form.append('file', new Blob([epub], { type: 'application/epub+zip' }), 'book.epub');
    const res = await fetch(base + '/api/books', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: form
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  let adminToken;

  try {
    const login = await jsonRequest('/api/auth/login', {
      method: 'POST',
      body: { email: 'admin@test.local', password: 'admin-pass-123' }
    });
    assert.equal(login.status, 200);
    adminToken = login.data.token;

    await t.test('上传书籍时可手动上传封面', async () => {
      const res = await uploadBook({ withCover: true, title: '带封面书籍' });
      assert.equal(res.status, 200);
      assert.equal(res.data.cover_source, 'user');
      assert.ok(res.data.cover);
      assert.equal(res.data.cover_warning, undefined);

      const coverRes = await fetch(base + '/api/books/' + res.data.id + '/cover?v=' + encodeURIComponent(res.data.cover));
      assert.equal(coverRes.status, 200);
      assert.equal(coverRes.headers.get('content-type').split(';')[0], 'image/png');
      assert.ok(Buffer.from(await coverRes.arrayBuffer()).equals(PNG));

      const embedded = await jsonRequest('/api/books/' + res.data.id + '/cover/embedded', {
        method: 'POST',
        token: adminToken
      });
      assert.equal(embedded.status, 200);
      assert.equal(embedded.data.cover_source, 'embedded');

      const form = new FormData();
      form.append('cover', new Blob([PNG], { type: 'image/png' }), 'new-cover.png');
      const replaced = await fetch(base + '/api/books/' + res.data.id + '/cover', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form
      });
      const replacedData = await replaced.json();
      assert.equal(replaced.status, 200);
      assert.equal(replacedData.cover_source, 'user');
      assert.notEqual(replacedData.cover, embedded.data.cover);

      const deleted = await jsonRequest('/api/books/' + res.data.id + '/cover', {
        method: 'DELETE',
        token: adminToken
      });
      assert.equal(deleted.status, 200);
      const missing = await fetch(base + '/api/books/' + res.data.id + '/cover');
      assert.equal(missing.status, 404);
    });

    await t.test('未提供封面时自动使用 EPUB 内嵌封面', async () => {
      const res = await uploadBook({ withCover: false, title: '内嵌封面书籍' });
      assert.equal(res.status, 200);
      assert.equal(res.data.cover_source, 'embedded');
      assert.ok(res.data.cover);

      const coverRes = await fetch(base + '/api/books/' + res.data.id + '/cover?v=' + encodeURIComponent(res.data.cover));
      assert.equal(coverRes.status, 200);
      assert.equal(coverRes.headers.get('content-type').split(';')[0], 'image/png');
    });

    await t.test('自定义封面地址会下载并保存', async () => {
      const original = metadata.downloadCover;
      metadata.downloadCover = async () => ({ buffer: PNG, contentType: 'image/png' });
      try {
        const res = await uploadBook({
          withCover: false,
          coverUrl: 'https://example.com/cover.png',
          title: '地址封面书籍'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.cover_source, 'user');
        assert.ok(res.data.cover);
      } finally {
        metadata.downloadCover = original;
      }
    });

    await t.test('有系列时书名可以留空', async () => {
      const form = new FormData();
      form.append('series', '测试系列');
      form.append('volume_number', '3');
      form.append('file', new Blob([epub], { type: 'application/epub+zip' }), 'book.epub');
      const res = await fetch(base + '/api/books', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form
      });
      const data = await res.json();
      assert.equal(res.status, 200);
      assert.equal(data.title, '测试系列');
      assert.equal(data.series, '测试系列');
      assert.equal(data.volume_number, 3);
    });

    await t.test('既没有书名也没有系列时拒绝上传', async () => {
      const form = new FormData();
      form.append('file', new Blob([epub], { type: 'application/epub+zip' }), 'book.epub');
      const res = await fetch(base + '/api/books', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: form
      });
      const data = await res.json();
      assert.equal(res.status, 400);
      assert.match(data.error, /书名或系列/);
    });

    await t.test('系列列表返回已有系列名', async () => {
      const res = await jsonRequest('/api/series', { token: adminToken });
      assert.equal(res.status, 200);
      assert.ok(res.data.series.includes('测试系列'));
    });

    await t.test('封面地址失败时回退到 EPUB 内嵌封面', async () => {
      const original = metadata.downloadCover;
      metadata.downloadCover = async () => { throw new Error('网络错误'); };
      try {
        const res = await uploadBook({
          withCover: false,
          coverUrl: 'https://example.com/broken.png',
          title: '地址失败书籍'
        });
        assert.equal(res.status, 200);
        assert.equal(res.data.cover_source, 'embedded');
        assert.match(res.data.cover_warning, /封面地址获取失败/);
        assert.match(res.data.cover_warning, /自带封面/);
      } finally {
        metadata.downloadCover = original;
      }
    });
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
