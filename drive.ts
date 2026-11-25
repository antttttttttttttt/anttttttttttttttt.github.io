export const DEFAULT_ROOT_FOLDER_ID = '1TzTBBaYy47J3da4AAB_agrhiwxultxpv';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  webContentLink?: string;
  folderPath?: string;
}

export interface FolderListingResult {
  id: string;
  name: string;
  folders: DriveItem[];
  files: DriveItem[];
}

export interface PastPaperMeta {
  rawCode: string;
  sessionCode: 'MJ' | 'ON';
  sessionLabel: 'May/June' | 'Oct/Nov';
  yearShort: string;
  yearFull: string;
  paperCode: string;
  variantHint: string | null;
}

export interface ParsedFolderLabel {
  navLabel: string;
  topic: string;
  fullTitle: string;
}

export function extractFolderId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_ROOT_FOLDER_ID;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch?.[1]) return idParamMatch[1];
  return trimmed;
}

export function parseChapterLabel(folderName: string): ParsedFolderLabel {
  const match = folderName.match(
    /^((?:Chapter|Unit|Topic|Module)\s+\d+[a-z]?)\s*[-:–—]\s*(.+)$/i
  );
  if (match) {
    const rawPrefix = match[1].trim();
    const normalizedPrefix =
      rawPrefix.charAt(0).toUpperCase() + rawPrefix.slice(1);
    return {
      navLabel: normalizedPrefix,
      topic: match[2].trim(),
      fullTitle: folderName,
    };
  }
  return {
    navLabel: folderName,
    topic: '',
    fullTitle: folderName,
  };
}

export function parsePastPaperCode(fileName: string): PastPaperMeta | null {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const match = baseName.match(
    /(?:^|[^a-zA-Z0-9])(MJ|ON)[\s_-]?(\d{2})[\s_-]?(\d{1,3})(?=$|[^0-9])/i
  );
  if (!match) return null;

  const sessionCode = match[1].toUpperCase() as 'MJ' | 'ON';
  const yearShort = match[2];
  const paperCode = match[3];
  const sessionLabel = sessionCode === 'MJ' ? 'May/June' : 'Oct/Nov';

  let variantHint: string | null = null;
  if (/(?:^|[^a-zA-Z])(ms|mark[\s_-]?scheme)(?:$|[^a-zA-Z])/i.test(baseName)) {
    variantHint = 'Mark Scheme';
  } else if (
    /(?:^|[^a-zA-Z])(qp|question[\s_-]?paper)(?:$|[^a-zA-Z])/i.test(baseName)
  ) {
    variantHint = 'Question Paper';
  } else if (
    /(?:^|[^a-zA-Z])(er|examiner[\s_-]?report)(?:$|[^a-zA-Z])/i.test(baseName)
  ) {
    variantHint = 'Examiner Report';
  } else if (
    /(?:^|[^a-zA-Z])(gt|threshold)(?:$|[^a-zA-Z])/i.test(baseName)
  ) {
    variantHint = 'Grade Threshold';
  }

  return {
    rawCode: `${sessionCode}${yearShort}${paperCode}`,
    sessionCode,
    sessionLabel,
    yearShort,
    yearFull: `20${yearShort}`,
    paperCode,
    variantHint,
  };
}

export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function formatFileType(mimeType: string, fileName: string): string {
  if (mimeType === FOLDER_MIME) return 'Folder';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Google Slides';
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType.startsWith('video/')) return 'Video';
  if (mimeType.startsWith('audio/')) return 'Audio';
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toUpperCase() : '';
  return ext && ext.length <= 6 ? ext : 'File';
}

export function formatShortDate(raw?: string): string {
  if (!raw) return '—';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  return raw;
}

const folderCache = new Map<string, FolderListingResult>();
const treeCache = new Map<string, DriveItem[]>();

/* ------------------------------------------------------------------ */
/*  Manifest loading (no Google API key needed)                        */
/*  The manifest is generated at build time by                         */
/*  scripts/build-drive-manifest.mjs and served from /public.          */
/* ------------------------------------------------------------------ */

interface Manifest {
  root: string;
  generated: string;
  folders: Record<string, FolderListingResult>;
}

let manifestPromise: Promise<Manifest> | null = null;

function loadManifest(refresh = false): Promise<Manifest> {
  if (!manifestPromise || refresh) {
    const url = `${import.meta.env.BASE_URL}drive-manifest.json`;
    manifestPromise = fetch(url)
      .then((r) => {
        if (!r.ok) {
          throw new Error(
            `Could not load drive-manifest.json (${r.status}). Run the manifest build script.`
          );
        }
        return r.json() as Promise<Manifest>;
      })
      .catch((err) => {
        manifestPromise = null; // allow retry after a failure
        throw err;
      });
  }
  return manifestPromise;
}

export async function fetchPublicFolder(
  folderId: string,
  refresh = false
): Promise<FolderListingResult> {
  if (!refresh && folderCache.has(folderId)) {
    return folderCache.get(folderId)!;
  }

  const manifest = await loadManifest(refresh);
  const raw = manifest.folders[folderId];
  if (!raw) {
    throw new Error(
      'Folder not found in the exported archive. Re-run the manifest build.'
    );
  }

  const result: FolderListingResult = {
    ...raw,
    folders: [...raw.folders].sort((a, b) => naturalCompare(a.name, b.name)),
    files: [...raw.files].sort((a, b) => naturalCompare(a.name, b.name)),
  };

  folderCache.set(folderId, result);
  return result;
}

export async function fetchPublicFolderTree(
  folderId: string,
  maxDepth = 3,
  refresh = false
): Promise<DriveItem[]> {
  const cacheKey = `${folderId}:${maxDepth}`;
  if (!refresh && treeCache.has(cacheKey)) {
    return treeCache.get(cacheKey)!;
  }

  const collectedFiles: DriveItem[] = [];

  async function walk(currentId: string, currentPath: string, depth: number) {
    const listing = await fetchPublicFolder(currentId, refresh);

    for (const file of listing.files) {
      collectedFiles.push({
        ...file,
        folderPath: currentPath || listing.name,
      });
    }

    if (depth < maxDepth) {
      await Promise.all(
        listing.folders.map((sub) => {
          const nextPath = currentPath ? `${currentPath}/${sub.name}` : sub.name;
          return walk(sub.id, nextPath, depth + 1);
        })
      );
    }
  }

  await walk(folderId, '', 0);
  treeCache.set(cacheKey, collectedFiles);
  return collectedFiles;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildStaticArchiveHtml(params: {
  rootTitle: string;
  rootFolderId: string;
  sections: Array<{
    title: string;
    navLabel: string;
    files: DriveItem[];
  }>;
}): string {
  const { rootTitle, rootFolderId, sections } = params;
  const generatedDate = new Date().toISOString().slice(0, 10);

  const navHtml = sections
    .map(
      (sec, idx) =>
        `<a href="#sec-${idx}">${escapeHtml(sec.navLabel)} (${sec.files.length})</a>`
    )
    .join('\n        ');

  const sectionsHtml = sections
    .map((sec, idx) => {
      const rows = sec.files
        .map((file) => {
          const pp = parsePastPaperCode(file.name);
          const codeAttr = pp
            ? `data-ss="${pp.sessionCode}" data-yy="${pp.yearFull}" data-id="${pp.paperCode}"`
            : '';
          const metaStr = pp
            ? `${pp.sessionLabel} · ${pp.yearFull} · Paper ${pp.paperCode}`
            : formatFileType(file.mimeType, file.name);
          const link =
            file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
          return `<tr ${codeAttr}>
            <td><a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            file.name
          )}</a></td>
            <td class="mono">${escapeHtml(metaStr)}</td>
            <td class="mono">${escapeHtml(formatShortDate(file.modifiedTime))}</td>
          </tr>`;
        })
        .join('\n          ');

      return `<section id="sec-${idx}" class="panel">
      <h2>${escapeHtml(sec.title)}</h2>
      <table>
        <thead><tr><th>File</th><th>Details</th><th>Modified</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3">No files in this section.</td></tr>'}</tbody>
      </table>
    </section>`;
    })
    .join('\n    ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(rootTitle)} — Static Archive</title>
  <style>
    body{margin:0;background:#151518;color:#e4e4e7;font-family:Verdana,Tahoma,sans-serif;font-size:14px;line-height:1.5}
    .wrap{max-width:980px;margin:24px auto;padding:0 16px;display:grid;grid-template-columns:240px 1fr;gap:16px}
    .panel{background:#1c1c20;border:1px solid #2f2f37;padding:14px;margin-bottom:16px}
    h1,h2{font-size:15px;margin:0 0 10px;border-bottom:1px solid #2f2f37;padding-bottom:6px;font-weight:600}
    nav a{display:block;padding:5px 0;color:#bcb6d1;text-decoration:none;border-bottom:1px dotted #2f2f37;font-size:13px}
    nav a:hover{text-decoration:underline;color:#e4e4e7}
    table{width:100%;border-collapse:collapse}
    th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #2f2f37;font-size:13px}
    th{color:#a1a1aa;font-weight:500}
    a{color:#bcb6d1;text-decoration:none}
    a:hover{text-decoration:underline}
    .mono{font-family:"Courier New",monospace;color:#a1a1aa;white-space:nowrap}
    .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .filters select,.filters input{background:#151518;color:#e4e4e7;border:1px solid #2f2f37;padding:5px 8px;font-size:13px}
    @media(max-width:720px){.wrap{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <aside>
      <div class="panel">
        <h1>${escapeHtml(rootTitle)}</h1>
        <p class="mono">Exported ${generatedDate}</p>
        <p><a href="https://drive.google.com/drive/folders/${escapeHtml(rootFolderId)}" target="_blank" rel="noopener noreferrer">Open Source Drive</a></p>
      </div>
      <div class="panel">
        <h2>Chapters</h2>
        <nav>${navHtml}</nav>
      </div>
    </aside>
    <main>
      <div class="panel">
        <h2>Quick Past Paper Filter (SSYYID)</h2>
        <div class="filters">
          <select id="f-ss"><option value="">All Sessions</option><option value="MJ">May/June (MJ)</option><option value="ON">Oct/Nov (ON)</option></select>
          <input id="f-yy" placeholder="Year (e.g. 2018)" size="14">
          <input id="f-id" placeholder="Paper (e.g. 13)" size="12">
        </div>
      </div>
      ${sectionsHtml}
    </main>
  </div>
  <script>
    (function(){
      var ss=document.getElementById('f-ss'),yy=document.getElementById('f-yy'),pid=document.getElementById('f-id');
      function apply(){
        var s=ss.value,y=yy.value.trim(),p=pid.value.trim();
        document.querySelectorAll('tbody tr').forEach(function(tr){
          var ok=true;
          if(s && tr.dataset.ss!==s) ok=false;
          if(y && (tr.dataset.yy||'').indexOf(y)===-1) ok=false;
          if(p && (tr.dataset.id||'').indexOf(p)===-1) ok=false;
          tr.style.display=ok?'':'none';
        });
      }
      ss.addEventListener('change',apply);yy.addEventListener('input',apply);pid.addEventListener('input',apply);
    })();
  </script>
</body>
</html>`;
}
