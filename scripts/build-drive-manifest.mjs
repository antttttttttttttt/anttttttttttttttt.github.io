// Usage: node scripts/build-drive-manifest.mjs [rootFolderId] [maxDepth]
import { mkdir, writeFile } from 'node:fs/promises';

const ROOT = process.argv[2] || process.env.DRIVE_ROOT_FOLDER_ID || '1TzTBBaYy47J3da4AAB_agrhiwxultxpv';
const MAX_DEPTH = Number(process.argv[3] || 4);
const FOLDER_MIME = 'application/vnd.google-apps.folder';

const decode = (s = '') =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
   .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
   .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function toIso(raw) {
  const d = new Date(raw);
  return isNaN(d) ? raw : d.toISOString();
}

async function listFolder(id) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${id}#list`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Folder ${id}: HTTP ${res.status} (is it shared publicly?)`);
  const html = await res.text();

  const name = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || id).trim();
  const folders = [];
  const files = [];

  const chunks = html.split('class="flip-entry"').slice(1);
  for (const c of chunks) {
    const entryId = c.match(/id="entry-([^"]+)"/)?.[1];
    const href = decode(c.match(/href="([^"]+)"/)?.[1] || '');
    const title = decode(c.match(/flip-entry-title">([^<]*)</)?.[1] || '').trim();
    const mime = decodeURIComponent(c.match(/\/type\/([^"'?\s]+)/)?.[1] || '');
    const modified = decode(c.match(/flip-entry-last-modified">\s*<div>([^<]*)</)?.[1] || '').trim();
    const folderId = href.match(/\/folders\/([\w-]+)/)?.[1];
    const id2 = folderId || entryId;
    if (!id2 || !title) continue;

    if (folderId || mime === FOLDER_MIME) {
      folders.push({ id: id2, name: title, mimeType: FOLDER_MIME });
    } else {
      files.push({
        id: id2,
        name: title,
        mimeType: mime || 'application/octet-stream',
        modifiedTime: modified ? toIso(modified) : undefined,
        webViewLink: `https://drive.google.com/file/d/${id2}/view`,
        webContentLink: `https://drive.google.com/uc?export=download&id=${id2}`,
      });
    }
  }
  return { id, name, folders, files };
}

const manifest = {};
async function walk(id, depth) {
  if (manifest[id]) return;
  console.log(`${'  '.repeat(depth)}↳ ${id}`);
  const listing = await listFolder(id);
  manifest[id] = listing;
  if (depth < MAX_DEPTH) {
    for (const sub of listing.folders) {
      await walk(sub.id, depth + 1);
      await new Promise((r) => setTimeout(r, 250)); // be polite
    }
  }
}

await walk(ROOT, 0);
await mkdir('public', { recursive: true });
await writeFile('public/drive-manifest.json', JSON.stringify({ root: ROOT, generated: new Date().toISOString(), folders: manifest }));
console.log(`Done: ${Object.keys(manifest).length} folders`);
