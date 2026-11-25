import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const CACHE_TTL_MS = 60_000;

interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink: string;
  webContentLink?: string;
  folderPath?: string;
}

interface ParsedFolderResponse {
  id: string;
  name: string;
  folders: DriveItem[];
  files: DriveItem[];
}

interface CacheRecord {
  data: ParsedFolderResponse;
  expiresAt: number;
}

const folderCache = new Map<string, CacheRecord>();

function isValidDriveId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,100}$/.test(id);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function parseEmbeddedFolderHtml(
  folderId: string,
  html: string
): ParsedFolderResponse {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const folderName = titleMatch
    ? decodeHtmlEntities(titleMatch[1].trim())
    : 'Drive Archive';

  const folders: DriveItem[] = [];
  const files: DriveItem[] = [];

  // Split by each flip-entry block
  const parts = html.split('<div class="flip-entry"');
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i];
    const idMatch = block.match(/^\s+id="entry-([^"]+)"/);
    if (!idMatch) continue;
    const itemId = idMatch[1].trim();

    const hrefMatch = block.match(/<a\s+href="([^"]+)"/i);
    const href = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : '';

    const titleElMatch = block.match(
      /<div class="flip-entry-title">([\s\S]*?)<\/div>/i
    );
    const name = titleElMatch
      ? decodeHtmlEntities(titleElMatch[1].trim())
      : itemId;

    const modMatch = block.match(
      /<div class="flip-entry-last-modified">\s*<div>([\s\S]*?)<\/div>/i
    );
    const modifiedTime = modMatch
      ? decodeHtmlEntities(modMatch[1].replace(/\u202f/g, ' ').trim())
      : undefined;

    const isFolder =
      href.includes('/drive/folders/') ||
      block.includes('drive-sprite-folder');

    if (isFolder) {
      folders.push({
        id: itemId,
        name,
        mimeType: FOLDER_MIME,
        modifiedTime,
        webViewLink: `https://drive.google.com/drive/folders/${itemId}`,
      });
    } else {
      const mimeMatch = block.match(
        /drive-thirdparty\.googleusercontent\.com\/\d+\/type\/([^"']+)/i
      );
      let mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
      if (href.includes('docs.google.com/document')) {
        mimeType = 'application/vnd.google-apps.document';
      } else if (href.includes('docs.google.com/spreadsheets')) {
        mimeType = 'application/vnd.google-apps.spreadsheet';
      } else if (href.includes('docs.google.com/presentation')) {
        mimeType = 'application/vnd.google-apps.presentation';
      }

      const webViewLink =
        href || `https://drive.google.com/file/d/${itemId}/view`;
      const isGoogleWorkspaceDoc = mimeType.startsWith(
        'application/vnd.google-apps.'
      );

      files.push({
        id: itemId,
        name,
        mimeType,
        modifiedTime,
        webViewLink,
        webContentLink: isGoogleWorkspaceDoc
          ? undefined
          : `https://drive.google.com/uc?export=download&id=${itemId}`,
      });
    }
  }

  folders.sort((a, b) => naturalCompare(a.name, b.name));
  files.sort((a, b) => naturalCompare(a.name, b.name));

  return {
    id: folderId,
    name: folderName,
    folders,
    files,
  };
}

async function fetchPublicDriveFolder(
  folderId: string,
  bypassCache = false
): Promise<ParsedFolderResponse> {
  if (!bypassCache) {
    const cached = folderCache.get(folderId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const targetUrl = `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(
    folderId
  )}#list`;
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(
      `Unable to access Drive folder (${response.status}). Make sure the folder is shared as "Anyone with the link can view".`
    );
  }

  if (response.url.includes('accounts.google.com')) {
    throw new Error(
      'This Google Drive folder is private. Set its sharing permission to "Anyone with the link can view".'
    );
  }

  const html = await response.text();
  if (!html.includes('flip-contents') && !html.includes('flip-entries')) {
    throw new Error(
      'Could not read folder listing. Ensure the Drive folder is publicly viewable.'
    );
  }

  const parsed = parseEmbeddedFolderHtml(folderId, html);
  folderCache.set(folderId, {
    data: parsed,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return parsed;
}

async function collectFilesRecursively(
  folderId: string,
  basePath = '',
  depth = 0,
  maxDepth = 3,
  bypassCache = false
): Promise<DriveItem[]> {
  const folder = await fetchPublicDriveFolder(folderId, bypassCache);
  const currentLabel = basePath || folder.name;
  const taggedFiles = folder.files.map((file) => ({
    ...file,
    folderPath: currentLabel,
  }));

  if (depth >= maxDepth || folder.folders.length === 0) {
    return taggedFiles;
  }

  const nested = await Promise.all(
    folder.folders.map((sub) => {
      const nextPath = basePath ? `${basePath} / ${sub.name}` : sub.name;
      return collectFilesRecursively(
        sub.id,
        nextPath,
        depth + 1,
        maxDepth,
        bypassCache
      );
    })
  );

  return [...taggedFiles, ...nested.flat()];
}

async function startServer() {
  const app = express();

  app.get('/api/drive/folder', async (req: Request, res: Response) => {
    const folderId = String(req.query.id || '').trim();
    const bypassCache = req.query.refresh === '1';

    if (!isValidDriveId(folderId)) {
      res.status(400).json({ error: 'Invalid Google Drive folder ID.' });
      return;
    }

    try {
      const data = await fetchPublicDriveFolder(folderId, bypassCache);
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load Drive folder.';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/drive/tree', async (req: Request, res: Response) => {
    const folderId = String(req.query.id || '').trim();
    const bypassCache = req.query.refresh === '1';
    const rawDepth = Number(req.query.maxDepth ?? 3);
    const maxDepth = Number.isFinite(rawDepth)
      ? Math.min(Math.max(rawDepth, 1), 4)
      : 3;

    if (!isValidDriveId(folderId)) {
      res.status(400).json({ error: 'Invalid Google Drive folder ID.' });
      return;
    }

    try {
      const files = await collectFilesRecursively(
        folderId,
        '',
        0,
        maxDepth,
        bypassCache
      );
      res.json({ files });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to scan Drive subfolders.';
      res.status(502).json({ error: message });
    }
  });

  const distDir = path.resolve(__dirname, 'dist');
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev || !fs.existsSync(path.join(distDir, 'index.html'))) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Study Archive server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
