// Server-side EPUB extraction helper
const JSZip = require('jszip');
const { decodeText } = require('./text_decode');

// 把相对路径按章节所在目录归一化，处理 ../ 与开头斜杠
function resolvePath(baseDir, rel) {
  const raw = (rel || '').replace(/^\/+/, '');
  const parts = (baseDir + raw).split('/');
  const out = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}

// 将章节内相对资源地址改写为可访问的资源接口地址
function rewriteUrls(html, chapterDir, bookId, token) {
  const suffix = token ? '&token=' + encodeURIComponent(token) : '';

  const toResource = (val) => {
    if (!val) return val;
    // 外链、内联数据、锚点保持原样
    if (/^(?:https?:|data:|blob:|#|mailto:|javascript:)/i.test(val)) return val;
    const hashIndex = val.indexOf('#');
    const pathPart = hashIndex >= 0 ? val.slice(0, hashIndex) : val;
    const hash = hashIndex >= 0 ? val.slice(hashIndex) : '';
    if (!pathPart) return val;
    // 指向其它章节的链接保持原样，交给阅读器处理
    if (/\.(?:x?html?|xml|opf|ncx)$/i.test(pathPart)) return val;
    const resolved = resolvePath(chapterDir, pathPart);
    if (!resolved) return val;
    return `/api/books/${bookId}/resource?path=${encodeURIComponent(resolved)}${suffix}${hash}`;
  };

  html = html.replace(
    /(\s(?:src|poster|href)\s*=\s*)(["'])([^"']+)\2/gi,
    (all, attr, quote, val) => attr + quote + toResource(val) + quote
  );

  // SVG 内嵌图片
  html = html.replace(
    /(\sxlink:href\s*=\s*)(["'])([^"']+)\2/gi,
    (all, attr, quote, val) => attr + quote + toResource(val) + quote
  );

  // srcset 多倍图
  html = html.replace(
    /(\ssrcset\s*=\s*)(["'])([^"']+)\2/gi,
    (all, attr, quote, val) => {
      const items = val.split(',').map(item => {
        const trimmed = item.trim();
        if (!trimmed) return trimmed;
        const sp = trimmed.split(/\s+/);
        sp[0] = toResource(sp[0]);
        return sp.join(' ');
      });
      return attr + quote + items.join(', ') + quote;
    }
  );

  return html;
}

async function extractEpub(buffer, options = {}) {
  const { bookId, token } = options;
  const zip = await JSZip.loadAsync(buffer);

  // 1. Read container.xml to find OPF path
  let opfPath = 'OEBPS/content.opf';
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const containerXml = await containerFile.async('text');
    const match = containerXml.match(/full-path=["']([^"']+)["']/);
    if (match) opfPath = match[1];
  }

  // 2. Read OPF
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error('无法解析 EPUB 结构');
  const opfXml = await opfFile.async('text');
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  // 3. Parse manifest items
  const manifest = {};
  const itemRe = /<item\s+[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["'][^>]*\/?>/g;
  const itemRe2 = /<item\s+[^>]*href=["']([^"']+)["'][^>]*id=["']([^"']+)["'][^>]*\/?>/g;
  let m;
  while ((m = itemRe.exec(opfXml)) !== null) {
    manifest[m[1]] = { href: m[2], type: (m[0].match(/media-type=["']([^"']+)["']/) || [])[1] };
  }
  while ((m = itemRe2.exec(opfXml)) !== null) {
    if (!manifest[m[2]]) manifest[m[2]] = { href: m[1], type: (m[0].match(/media-type=["']([^"']+)["']/) || [])[1] };
  }

  // 4. Parse spine order
  const spine = [];
  const spineRe = /<itemref\s+[^>]*idref=["']([^"']+)["'][^>]*\/?>/g;
  while ((m = spineRe.exec(opfXml)) !== null) {
    spine.push(m[1]);
  }

  // 5. Parse TOC (ncx) for titles
  const ncxId = (opfXml.match(/<spine\s+[^>]*toc=["']([^"']+)["']/) || [])[1];
  const tocMap = {};
  if (ncxId && manifest[ncxId]) {
    const ncxFile = zip.file(opfDir + manifest[ncxId].href);
    if (ncxFile) {
      const ncxXml = await ncxFile.async('text');
      const labelRe = /<text>([\s\S]*?)<\/text>/;
      const navBlocks = ncxXml.split(/<navPoint/).slice(1);
      for (const block of navBlocks) {
        const labelMatch = block.match(labelRe);
        const contentMatch = block.match(/<content\s+src=["']([^"']+?)["']/);
        if (labelMatch && contentMatch) {
          const src = contentMatch[1].split('#')[0];
          tocMap[src] = labelMatch[1].trim();
        }
      }
    }
  }

  // 6. Extract chapters
  const chapters = [];
  for (const idref of spine) {
    const item = manifest[idref];
    if (!item) continue;
    const fullHref = opfDir + item.href;
    const file = zip.file(fullHref);
    if (!file) continue;
    const rawBuffer = await file.async('nodebuffer');
    let html = decodeText(rawBuffer);
    const hrefBase = item.href.split('#')[0];
    // 章节内相对资源按章节所在目录解析
    if (bookId) {
      const chapterDir = fullHref.includes('/') ? fullHref.substring(0, fullHref.lastIndexOf('/') + 1) : '';
      html = rewriteUrls(html, chapterDir, bookId, token);
    }
    chapters.push({
      id: idref,
      title: tocMap[hrefBase] || tocMap[item.href] || `章节 ${chapters.length + 1}`,
      href: item.href,
      html: html
    });
  }

  return { chapters };
}

// 读取 EPUB 内嵌封面：优先 OPF 的 meta name="cover"，其次 cover-image 属性，再次常见文件名
async function extractEpubCover(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let opfPath = 'OEBPS/content.opf';
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const containerXml = await containerFile.async('text');
    const match = containerXml.match(/full-path=["']([^"']+)["']/);
    if (match) opfPath = match[1];
  }

  const opfFile = zip.file(opfPath);
  if (!opfFile) return null;
  const opfXml = await opfFile.async('text');
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  const attr = (tag, name) => {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']', 'i'));
    return m ? m[1] : '';
  };
  const items = [...opfXml.matchAll(/<item\b[^>]*>/gi)].map(m => m[0]);
  let href = '';

  const coverMeta = opfXml.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || opfXml.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']cover["'][^>]*>/i);
  if (coverMeta) {
    const item = items.find(tag => attr(tag, 'id') === coverMeta[1]);
    if (item) href = attr(item, 'href');
  }
  if (!href) {
    const item = items.find(tag => (attr(tag, 'properties') || '').split(/\s+/).includes('cover-image'));
    if (item) href = attr(item, 'href');
  }
  if (!href) {
    const item = items.find(tag => attr(tag, 'id') === 'cover' && /\.(?:jpe?g|png|webp|gif)$/i.test(attr(tag, 'href')));
    if (item) href = attr(item, 'href');
  }

  let coverPath = '';
  if (href) {
    let rawHref = href.split(/[?#]/)[0];
    try { rawHref = decodeURIComponent(rawHref); } catch (e) {}
    coverPath = resolvePath(opfDir, rawHref);
  }
  if (!coverPath || !zip.file(coverPath)) {
    const candidates = Object.keys(zip.files)
      .filter(p => !zip.files[p].dir && /(^|\/)cover\.(?:jpe?g|png|webp|gif)$/i.test(p))
      .sort((a, b) => a.length - b.length);
    coverPath = candidates[0] || '';
  }
  if (!coverPath) return null;
  const file = zip.file(coverPath);
  if (!file) return null;

  const ext = coverPath.split('.').pop().toLowerCase();
  const contentType = ext === 'png' ? 'image/png'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/jpeg';
  return { buffer: await file.async('nodebuffer'), contentType };
}

module.exports = { extractEpub, extractEpubCover };
