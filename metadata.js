// 图书元数据检索模块
// 数据源：豆瓣（suggest 接口 + 详情页解析）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const REFERER = 'https://book.douban.com/';

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
    isbn: pickField('ISBN:'),
    pages: pickField('页数:'),
    description,
    cover,
    url
  };
}

// 下载封面图片，返回 Buffer
async function downloadCover(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Referer': REFERER,
      'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error('封面下载失败：HTTP ' + res.status);
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!type.startsWith('image/')) throw new Error('封面不是图片：' + type);
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType: type };
}

module.exports = { searchBooks, getBookDetail, downloadCover };
