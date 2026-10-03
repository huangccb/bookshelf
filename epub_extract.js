// Server-side EPUB extraction helper
const JSZip = require('jszip');

async function extractEpub(buffer) {
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
      const navRe = /<navPoint[\s\S]*?<content\s+src=["']([^"']+?)["'][\s\S]*?<\/navPoint>/g;
      const labelRe = /<text>([\s\S]*?)<\/text>/;
      // Simpler: parse each navPoint block
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
    const html = await file.async('text');
    const hrefBase = item.href.split('#')[0];
    chapters.push({
      id: idref,
      title: tocMap[hrefBase] || tocMap[item.href] || `章节 ${chapters.length + 1}`,
      href: item.href,
      html: html
    });
  }

  return { chapters };
}

module.exports = { extractEpub };
