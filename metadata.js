// 图书元数据检索模块
// 数据源：豆瓣（suggest 接口 + 详情页解析）
const dns = require('dns').promises;
const net = require('net');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REFERER = 'https://book.douban.com/';
const COVER_MAX_BYTES = 8 * 1024 * 1024;
const COVER_REDIRECT_LIMIT = 3;
const COVER_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': REFERER,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });
  if (!res.ok) throw new Error('请求失败：HTTP ' + res.status);
  return res.text();
}

// 按书名搜索，返回候选列表
async function searchBooks(query) {
  const url = 'https://book.douban.com/j/subject_suggest?q=' + encodeURIComponent(query);
  const text = await fetchText(url);
  let list;
  try {
    list = JSON.parse(text);
  } catch (e) {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item.type === 'b')
    .map(item => ({
      source: 'douban',
      id: item.id,
      title: item.title,
      author: item.author_name || '',
      year: item.year || '',
      cover: (item.pic || '').replace('/s/public/', '/l/public/'),
      url: item.url
    }));
}

// 取详情：简介、出版社、ISBN、页数
async function getBookDetail(doubanId) {
  const url = 'https://book.douban.com/subject/' + encodeURIComponent(doubanId) + '/';
  const html = await fetchText(url);

  function pickField(label) {
    // 形如：<span class="pl">出版社:</span> <a ...>南海出版公司</a>
    const re = new RegExp('<span[^>]*class="pl"[^>]*>' + label + '</span>\\s*([\\s\\S]{0,300}?)(?:<br|</div>)', 'i');
    const m = html.match(re);
    if (!m) return '';
    return m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // 简介：优先取完整版（class="intro" 中最后/最长的一段）
  let description = '';
  const introBlocks = [...html.matchAll(/<div[^>]*class="intro"[^>]*>([\s\S]*?)<\/div>/g)];
  if (introBlocks.length) {
    const texts = introBlocks.map(b => b[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    texts.sort((a, b) => b.length - a.length);
    description = texts[0] || '';
  }
  // 去掉“展开全部”等残留
  description = description.replace(/展开全部|收起/g, '').trim();

  // 封面
  let cover = '';
  const coverMatch = html.match(/<div id="mainpic"[\s\S]*?<img[^>]*src="([^"]+)"/i);
  if (coverMatch) {
    cover = coverMatch[1].replace('/s/public/', '/l/public/');
  }

  // 标题 / 作者
  const titleMatch = html.match(/<span property="v:itemreviewed">([^<]+)<\/span>/);
  const authorMatch = html.match(/<a[^>]*href="(?:https:\/\/book\.douban\.com)?\/author\/[^"]*"[^>]*>([^<]+)<\/a>/);

  return {
    source: 'douban',
    id: doubanId,
    title: titleMatch ? titleMatch[1].trim() : '',
    author: authorMatch ? authorMatch[1].trim() : '',
    year: pickField('出版年:'),
    publisher: pickField('出版社:'),
    series: pickField('丛书:') || pickField('丛书'),
    isbn: pickField('ISBN:'),
    pages: pickField('页数:'),
    description,
    cover,
    url
  };
}

// 阻止封面地址访问本机、内网与保留地址，避免把服务端变成 SSRF 跳板
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    const a = parts[0];
    const b = parts[1];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 0 || b === 168)) return true;
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return true;
    if (a === 203 && b === 0) return true;
    return a >= 224;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      return mapped.includes('.') ? isPrivateAddress(mapped) : true;
    }
    if (/^fc|^fd/.test(lower)) return true; // fc00::/7
    if (/^fe[89ab]/.test(lower)) return true; // fe80::/10
    if (lower.startsWith('ff')) return true; // 组播
    return false;
  }
  return true;
}

async function assertPublicHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch (e) {
    throw new Error('封面地址格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('封面地址只支持 http/https');
  }
  if (url.username || url.password) throw new Error('封面地址不能包含账号信息');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('封面地址不可用');
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (e) {
    throw new Error('封面地址无法解析');
  }
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('封面地址不可用');
  }
  return url;
}

// 下载封面图片：限制协议、内网地址、重定向次数与响应大小，返回 Buffer
async function downloadCover(rawUrl) {
  let url = await assertPublicHttpUrl(rawUrl);
  let res = null;

  for (let redirects = 0; redirects <= COVER_REDIRECT_LIMIT; redirects++) {
    const headers = {
      'User-Agent': UA,
      'Accept': 'image/jpeg,image/png,image/webp,image/gif,*/*;q=0.5'
    };
    if (/(^|\.)doubanio\.com$/i.test(url.hostname)) headers.Referer = REFERER;

    res = await fetch(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || redirects === COVER_REDIRECT_LIMIT) throw new Error('封面地址重定向过多');
      url = await assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    break;
  }

  if (!res || !res.ok) throw new Error('封面下载失败：HTTP ' + (res ? res.status : '未知'));
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!COVER_TYPES.includes(type)) {
    throw new Error('封面格式不支持，仅支持 JPG、PNG、WebP、GIF');
  }

  const declaredLength = Number(res.headers.get('content-length') || 0);
  if (declaredLength > COVER_MAX_BYTES) {
    try { if (res.body) await res.body.cancel(); } catch (e) {}
    throw new Error('封面图片过大');
  }

  if (!res.body) throw new Error('封面图片为空');
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > COVER_MAX_BYTES) {
        try { await reader.cancel(); } catch (e) {}
        throw new Error('封面图片过大');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch (e) {}
  }
  if (!total) throw new Error('封面图片为空');
  return { buffer: Buffer.concat(chunks), contentType: type };
}

module.exports = { searchBooks, getBookDetail, downloadCover };
