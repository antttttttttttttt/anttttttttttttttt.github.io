import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildStaticArchiveHtml,
  DEFAULT_ROOT_FOLDER_ID,
  DriveItem,
  extractFolderId,
  fetchPublicFolder,
  fetchPublicFolderTree,
  formatFileType,
  formatShortDate,
  naturalCompare,
  parseChapterLabel,
  parsePastPaperCode,
  PastPaperMeta,
} from './drive';

type ViewMode = 'overview' | 'folder' | 'past-papers';

interface FolderCacheEntry {
  folders: DriveItem[];
  files: DriveItem[];
}

interface BreadcrumbItem {
  id: string;
  name: string;
}

interface FileWithPaperMeta {
  file: DriveItem;
  paper: PastPaperMeta | null;
}

export default function App() {
  const [rootFolderId, setRootFolderId] = useState<string>(DEFAULT_ROOT_FOLDER_ID);
  const [folderInput, setFolderInput] = useState<string>(DEFAULT_ROOT_FOLDER_ID);
  const [showFolderInput, setShowFolderInput] = useState<boolean>(false);
  const [rootTitle, setRootTitle] = useState<string>('Study Archive');

  const [topFolders, setTopFolders] = useState<DriveItem[]>([]);
  const [rootFiles, setRootFiles] = useState<DriveItem[]>([]);
  const [folderCache, setFolderCache] = useState<Record<string, FolderCacheEntry>>({});
  const [allScannedFiles, setAllScannedFiles] = useState<DriveItem[] | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [activeFolderId, setActiveFolderId] = useState<string>(DEFAULT_ROOT_FOLDER_ID);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [includeSubfoldersInView, setIncludeSubfoldersInView] = useState<boolean>(false);
  const [subfolderFiles, setSubfolderFiles] = useState<DriveItem[] | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isScanningAll, setIsScanningAll] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Past Paper & File Filters
  const [sessionFilter, setSessionFilter] = useState<'ALL' | 'MJ' | 'ON'>('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [paperCodeFilter, setPaperCodeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Document preview modal
  const [previewFile, setPreviewFile] = useState<DriveItem | null>(null);

  const resetFilters = useCallback(() => {
    setSessionFilter('ALL');
    setYearFilter('ALL');
    setPaperCodeFilter('ALL');
    setSearchQuery('');
  }, []);

  const loadRootFolder = useCallback(
    async (targetId: string, forceRefresh = false) => {
      setIsLoading(true);
      setLoadError(null);
      setAllScannedFiles(null);
      setSubfolderFiles(null);
      setIncludeSubfoldersInView(false);

      try {
        const result = await fetchPublicFolder(targetId, forceRefresh);
        setRootTitle(result.name);
        setTopFolders(result.folders);
        setRootFiles(result.files);
        setFolderCache({
          [targetId]: { folders: result.folders, files: result.files },
        });
        setActiveFolderId(targetId);
        setBreadcrumbs([{ id: targetId, name: result.name }]);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Unable to load Google Drive contents.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const openFolder = useCallback(
    async (folder: DriveItem, trail?: BreadcrumbItem[], forceRefresh = false) => {
      setViewMode('folder');
      setActiveFolderId(folder.id);
      setIncludeSubfoldersInView(false);
      setSubfolderFiles(null);
      resetFilters();
      window.location.hash = `#/folder/${folder.id}`;

      if (trail) {
        setBreadcrumbs(trail);
      } else {
        setBreadcrumbs((prev) => {
          const existingIdx = prev.findIndex((b) => b.id === folder.id);
          if (existingIdx !== -1) {
            return prev.slice(0, existingIdx + 1);
          }
          const isTopLevel = topFolders.some((tf) => tf.id === folder.id);
          if (isTopLevel) {
            return [
              { id: rootFolderId, name: rootTitle },
              { id: folder.id, name: folder.name },
            ];
          }
          return [...prev, { id: folder.id, name: folder.name }];
        });
      }

      if (!forceRefresh && folderCache[folder.id]) {
        return;
      }

      setIsLoading(true);
      setLoadError(null);
      try {
        const result = await fetchPublicFolder(folder.id, forceRefresh);
        setFolderCache((prev) => ({
          ...prev,
          [folder.id]: { folders: result.folders, files: result.files },
        }));
        // Update breadcrumb name if opened directly via URL hash
        setBreadcrumbs((prev) =>
          prev.map((b) => (b.id === folder.id ? { ...b, name: result.name } : b))
        );
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : 'Unable to load folder contents.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [folderCache, resetFilters, rootFolderId, rootTitle, topFolders]
  );

  const openOverview = useCallback(() => {
    setViewMode('overview');
    setActiveFolderId(rootFolderId);
    setBreadcrumbs([{ id: rootFolderId, name: rootTitle }]);
    setIncludeSubfoldersInView(false);
    setSubfolderFiles(null);
    resetFilters();
    window.location.hash = '#/';
  }, [resetFilters, rootFolderId, rootTitle]);

  const openPastPapersView = useCallback(
    async (forceRefresh = false) => {
      setViewMode('past-papers');
      resetFilters();
      window.location.hash = '#/past-papers';

      if (!forceRefresh && allScannedFiles !== null) {
        return;
      }

      setIsScanningAll(true);
      setLoadError(null);
      try {
        const files = await fetchPublicFolderTree(rootFolderId, 3, forceRefresh);
        setAllScannedFiles(files);
      } catch (err) {
        setLoadError(
          err instanceof Error
            ? err.message
            : 'Unable to scan folders for past papers.'
        );
      } finally {
        setIsScanningAll(false);
      }
    },
    [allScannedFiles, resetFilters, rootFolderId]
  );

  const handleToggleSubfolders = useCallback(async () => {
    if (includeSubfoldersInView) {
      setIncludeSubfoldersInView(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const files = await fetchPublicFolderTree(activeFolderId, 3);
      setSubfolderFiles(files);
      setIncludeSubfoldersInView(true);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to scan subfolder files.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeFolderId, includeSubfoldersInView]);

  // Initial load on mount — no sign-in required
  useEffect(() => {
    loadRootFolder(DEFAULT_ROOT_FOLDER_ID).then(() => {
      const hash = window.location.hash;
      if (hash === '#/past-papers') {
        openPastPapersView();
      } else if (hash.startsWith('#/folder/')) {
        const id = hash.replace('#/folder/', '').trim();
        if (id && id !== DEFAULT_ROOT_FOLDER_ID) {
          openFolder({
            id,
            name: 'Folder',
            mimeType: 'application/vnd.google-apps.folder',
          });
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hash navigation sync
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#/past-papers') {
        openPastPapersView();
      } else if (hash.startsWith('#/folder/')) {
        const id = hash.replace('#/folder/', '').trim();
        if (id && id !== activeFolderId) {
          const knownTop = topFolders.find((f) => f.id === id);
          if (knownTop) {
            openFolder(knownTop);
          } else {
            openFolder({
              id,
              name: 'Folder',
              mimeType: 'application/vnd.google-apps.folder',
            });
          }
        }
      } else {
        setViewMode('overview');
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [activeFolderId, openFolder, openPastPapersView, topFolders]);

  const handleRefreshCurrent = async () => {
    if (viewMode === 'past-papers') {
      await openPastPapersView(true);
    } else if (viewMode === 'folder') {
      await openFolder(
        {
          id: activeFolderId,
          name: currentFolderTitle,
          mimeType: 'application/vnd.google-apps.folder',
        },
        breadcrumbs,
        true
      );
    } else {
      await loadRootFolder(rootFolderId, true);
    }
  };

  const handleSwitchRootFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const extracted = extractFolderId(folderInput);
    setRootFolderId(extracted);
    setFolderInput(extracted);
    setViewMode('overview');
    setShowFolderInput(false);
    window.location.hash = '#/';
    await loadRootFolder(extracted);
  };

  const activeEntry: FolderCacheEntry = useMemo(() => {
    return folderCache[activeFolderId] || { folders: [], files: [] };
  }, [activeFolderId, folderCache]);

  const rawDisplayedFiles: DriveItem[] = useMemo(() => {
    if (viewMode === 'past-papers') {
      return (allScannedFiles || []).filter(
        (file) => parsePastPaperCode(file.name) !== null
      );
    }
    if (viewMode === 'overview') {
      return rootFiles;
    }
    if (includeSubfoldersInView && subfolderFiles) {
      return subfolderFiles;
    }
    return activeEntry.files;
  }, [
    activeEntry.files,
    allScannedFiles,
    includeSubfoldersInView,
    rootFiles,
    subfolderFiles,
    viewMode,
  ]);

  const filesWithMeta: FileWithPaperMeta[] = useMemo(() => {
    return rawDisplayedFiles.map((file) => ({
      file,
      paper: parsePastPaperCode(file.name),
    }));
  }, [rawDisplayedFiles]);

  const hasAnyPastPapers = useMemo(() => {
    return filesWithMeta.some((item) => item.paper !== null);
  }, [filesWithMeta]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const item of filesWithMeta) {
      if (item.paper) years.add(item.paper.yearFull);
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [filesWithMeta]);

  const availablePaperCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const item of filesWithMeta) {
      if (item.paper) codes.add(item.paper.paperCode);
    }
    return Array.from(codes).sort(naturalCompare);
  }, [filesWithMeta]);

  const filteredFiles: FileWithPaperMeta[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return filesWithMeta.filter(({ file, paper }) => {
      if (sessionFilter !== 'ALL') {
        if (!paper || paper.sessionCode !== sessionFilter) return false;
      }
      if (yearFilter !== 'ALL') {
        if (!paper || paper.yearFull !== yearFilter) return false;
      }
      if (paperCodeFilter !== 'ALL') {
        if (!paper || paper.paperCode !== paperCodeFilter) return false;
      }
      if (q) {
        const hay = `${file.name} ${
          paper
            ? `${paper.rawCode} ${paper.sessionLabel} ${paper.yearFull} Paper ${paper.paperCode}`
            : ''
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [filesWithMeta, paperCodeFilter, searchQuery, sessionFilter, yearFilter]);

  const isFilterActive =
    sessionFilter !== 'ALL' ||
    yearFilter !== 'ALL' ||
    paperCodeFilter !== 'ALL' ||
    searchQuery.trim() !== '';

  const currentFolderTitle = useMemo(() => {
    if (viewMode === 'past-papers') return 'Past Papers Index';
    if (viewMode === 'overview') return rootTitle;
    const currentCrumb = breadcrumbs[breadcrumbs.length - 1];
    return currentCrumb?.name || 'Folder';
  }, [breadcrumbs, rootTitle, viewMode]);

  const currentParsedTitle = useMemo(() => {
    return parseChapterLabel(currentFolderTitle);
  }, [currentFolderTitle]);

  const handleExportHtml = async () => {
    setIsExporting(true);
    try {
      let scanned = allScannedFiles;
      if (!scanned) {
        scanned = await fetchPublicFolderTree(rootFolderId, 3);
        setAllScannedFiles(scanned);
      }

      const sections: Array<{ title: string; navLabel: string; files: DriveItem[] }> = [];

      if (rootFiles.length > 0) {
        sections.push({
          title: `${rootTitle} (Root Files)`,
          navLabel: 'Overview',
          files: rootFiles,
        });
      }

      for (const folder of topFolders) {
        const parsed = parseChapterLabel(folder.name);
        const cached = folderCache[folder.id];
        const matchedFromScan = scanned.filter(
          (f) =>
            f.folderPath === folder.name ||
            f.folderPath?.startsWith(`${folder.name} / `)
        );
        const files =
          matchedFromScan.length > 0
            ? matchedFromScan
            : cached?.files || [];

        sections.push({
          title: parsed.fullTitle,
          navLabel: parsed.navLabel,
          files,
        });
      }

      const html = buildStaticArchiveHtml({
        rootTitle,
        rootFolderId,
        sections,
      });

      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${
        rootTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'study-archive'
      }.html`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to export static HTML.'
      );
    } finally {
      setIsExporting(false);
    }
  };

  const topNavChapters = topFolders.slice(0, 2);

  return (
    <div className="min-h-screen flex flex-col relative">
      {/* 50% Opacity Background Image */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none z-0 opacity-50 bg-[url('/assets/image_ebfefcab.png')] bg-cover bg-center bg-no-repeat"
      />

      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="relative z-10 border-b border-[#2f2f37] bg-[#18181c]/95">
        <div className="max-w-[1040px] mx-auto px-4 py-3 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Title */}
          <button
            type="button"
            onClick={openOverview}
            className="text-base font-semibold tracking-tight text-[#e4e4e7] hover:text-[#bcb6d1] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Study Archive
          </button>

          {/* Zone 2: Concise single-line nav links */}
          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-6 text-sm text-[#a1a1aa]"
          >
            <button
              type="button"
              onClick={openOverview}
              className={`hover:text-[#e4e4e7] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'overview' ? 'text-[#e4e4e7] underline' : ''
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => openPastPapersView()}
              className={`hover:text-[#e4e4e7] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'past-papers' ? 'text-[#e4e4e7] underline' : ''
              }`}
            >
              Past Papers
            </button>
            {topNavChapters.map((folder) => {
              const parsed = parseChapterLabel(folder.name);
              const isActive =
                viewMode === 'folder' && activeFolderId === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() =>
                    openFolder(folder, [
                      { id: rootFolderId, name: rootTitle },
                      { id: folder.id, name: folder.name },
                    ])
                  }
                  className={`hover:text-[#e4e4e7] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive ? 'text-[#e4e4e7] underline' : ''
                  }`}
                >
                  {parsed.navLabel}
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleExportHtml}
              disabled={isExporting}
              className="hover:text-[#e4e4e7] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isExporting ? 'Exporting...' : 'Export HTML'}
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleRefreshCurrent}
              disabled={isLoading || isScanningAll}
              className="px-4 py-1.5 text-xs font-medium bg-[#25252c] text-[#e4e4e7] border border-[#42424d] hover:border-[#9f99b3] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isLoading || isScanningAll ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      {/* Main MySpace-Inspired Two-Column Container */}
      <div className="relative z-10 flex-1 w-full max-w-[1040px] mx-auto px-4 py-6">
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5 items-start">
          {/* Left Column: MySpace-style Profile + Chapter Directory */}
          <aside className="space-y-4">
            {/* Profile Box */}
            <section className="bg-[#1c1c20] border border-[#2f2f37]">
              <div className="bg-[#222227] border-b border-[#2f2f37] px-3 py-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-[#e4e4e7]">
                  Archive Profile
                </span>
                <button
                  type="button"
                  onClick={() => setShowFolderInput((v) => !v)}
                  className="text-xs text-[#9f99b3] hover:text-[#bcb6d1] underline cursor-pointer"
                >
                  {showFolderInput ? 'Close' : 'Change Folder'}
                </button>
              </div>
              <div className="p-4 space-y-3 text-xs">
                <div>
                  <div className="text-sm font-semibold text-[#e4e4e7] break-words">
                    {rootTitle}
                  </div>
                  <div className="text-[#a1a1aa] mt-1 font-mono break-all">
                    {rootFolderId}
                  </div>
                </div>

                <div className="border-t border-[#2f2f37] pt-2.5 space-y-1 text-[#a1a1aa]">
                  <div>
                    Viewing:{' '}
                    <span className="text-[#e4e4e7]">
                      {currentParsedTitle.navLabel}
                    </span>
                  </div>
                  <div className="font-mono">
                    Folders: {topFolders.length} · Root Files: {rootFiles.length}
                  </div>
                </div>

                {showFolderInput && (
                  <form
                    onSubmit={handleSwitchRootFolder}
                    className="border-t border-[#2f2f37] pt-3 space-y-2"
                  >
                    <label
                      htmlFor="drive-folder-input"
                      className="block text-[#a1a1aa]"
                    >
                      Public Drive Folder URL or ID
                    </label>
                    <input
                      id="drive-folder-input"
                      type="text"
                      value={folderInput}
                      onChange={(e) => setFolderInput(e.target.value)}
                      placeholder="Paste Drive folder link or ID"
                      className="w-full bg-[#151518] border border-[#2f2f37] px-2.5 py-1.5 text-xs text-[#e4e4e7] font-mono focus:outline-none focus:border-[#9f99b3]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="px-3 py-1 bg-[#25252c] border border-[#42424d] text-[#e4e4e7] hover:border-[#9f99b3] cursor-pointer"
                      >
                        Load
                      </button>
                      {rootFolderId !== DEFAULT_ROOT_FOLDER_ID && (
                        <button
                          type="button"
                          onClick={() => {
                            setFolderInput(DEFAULT_ROOT_FOLDER_ID);
                            setRootFolderId(DEFAULT_ROOT_FOLDER_ID);
                            setShowFolderInput(false);
                            loadRootFolder(DEFAULT_ROOT_FOLDER_ID);
                          }}
                          className="px-2 py-1 text-[#a1a1aa] hover:text-[#e4e4e7] underline cursor-pointer"
                        >
                          Reset Default
                        </button>
                      )}
                    </div>
                  </form>
                )}

                <div className="border-t border-[#2f2f37] pt-2.5 flex items-center justify-between gap-2">
                  <a
                    href={`https://drive.google.com/drive/folders/${rootFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#9f99b3] hover:text-[#bcb6d1] underline underline-offset-2"
                  >
                    Open in Drive
                  </a>
                  <button
                    type="button"
                    onClick={handleExportHtml}
                    disabled={isExporting}
                    className="text-[#a1a1aa] hover:text-[#e4e4e7] underline underline-offset-2 cursor-pointer disabled:opacity-50"
                  >
                    {isExporting ? 'Exporting...' : 'Export HTML'}
                  </button>
                </div>
              </div>
            </section>

            {/* Study Playlist Spotify Embed */}
            <section className="bg-[#1c1c20] border border-[#2f2f37]">
              <div className="bg-[#222227] border-b border-[#2f2f37] px-3 py-2 text-xs font-semibold text-[#e4e4e7]">
                Study Playlist
              </div>
              <div className="p-2">
                <iframe
                  data-testid="embed-iframe"
                  title="Study Playlist"
                  className="w-full rounded-xl border-0 block"
                  src="https://open.spotify.com/embed/playlist/5j57bDtCQqpDuEMKPhnRe8?utm_source=generator&si=9903a01482774b6c"
                  width="100%"
                  height="352"
                  allowFullScreen
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                />
              </div>
            </section>

            {/* Chapter & Folder Navigation Directory */}
            <nav
              aria-label="Chapter Directory"
              className="bg-[#1c1c20] border border-[#2f2f37]"
            >
              <div className="bg-[#222227] border-b border-[#2f2f37] px-3 py-2 text-xs font-semibold text-[#e4e4e7]">
                Chapters &amp; Folders
              </div>
              <ul className="divide-y divide-[#2a2a32] text-sm">
                <li>
                  <button
                    type="button"
                    onClick={openOverview}
                    className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                      viewMode === 'overview'
                        ? 'bg-[#26262d] text-[#e4e4e7] font-medium'
                        : 'text-[#a1a1aa] hover:bg-[#222227] hover:text-[#e4e4e7]'
                    }`}
                  >
                    <span className="truncate">Overview</span>
                    <span className="font-mono text-xs text-[#71717a] shrink-0">
                      {viewMode === 'overview' ? '>' : ''}
                    </span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => openPastPapersView()}
                    className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                      viewMode === 'past-papers'
                        ? 'bg-[#26262d] text-[#e4e4e7] font-medium'
                        : 'text-[#a1a1aa] hover:bg-[#222227] hover:text-[#e4e4e7]'
                    }`}
                  >
                    <span className="truncate">All Past Papers (SSYYID)</span>
                    <span className="font-mono text-xs text-[#71717a] shrink-0">
                      {viewMode === 'past-papers' ? '>' : ''}
                    </span>
                  </button>
                </li>

                {topFolders.map((folder) => {
                  const parsed = parseChapterLabel(folder.name);
                  const isSelected =
                    viewMode === 'folder' &&
                    (activeFolderId === folder.id ||
                      breadcrumbs.some((b) => b.id === folder.id));
                  return (
                    <li key={folder.id}>
                      <button
                        type="button"
                        onClick={() =>
                          openFolder(folder, [
                            { id: rootFolderId, name: rootTitle },
                            { id: folder.id, name: folder.name },
                          ])
                        }
                        className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-[#26262d] text-[#e4e4e7]'
                            : 'text-[#a1a1aa] hover:bg-[#222227] hover:text-[#e4e4e7]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`truncate ${
                              isSelected ? 'font-medium text-[#e4e4e7]' : ''
                            }`}
                          >
                            {parsed.navLabel}
                          </span>
                          <span className="font-mono text-xs text-[#71717a] shrink-0">
                            {isSelected ? '>' : ''}
                          </span>
                        </div>
                        {parsed.topic && (
                          <div className="text-xs text-[#71717a] truncate mt-0.5">
                            {parsed.topic}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* SSYYID Legend */}
            <section className="bg-[#1c1c20] border border-[#2f2f37]">
              <div className="bg-[#222227] border-b border-[#2f2f37] px-3 py-2 text-xs font-semibold text-[#e4e4e7]">
                SSYYID Format
              </div>
              <div className="p-3 text-xs text-[#a1a1aa] space-y-1 font-mono">
                <div>SS · MJ (May/June) or ON (Oct/Nov)</div>
                <div>YY · 20YY (e.g. 18 → 2018)</div>
                <div>ID · Paper code (e.g. 13 → Paper 13)</div>
              </div>
            </section>
          </aside>

          {/* Right Column: Main Content Panel */}
          <main className="space-y-4 min-w-0">
            {/* Breadcrumb & Page Title Box */}
            <section className="bg-[#1c1c20] border border-[#2f2f37]">
              <div className="bg-[#222227] border-b border-[#2f2f37] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 text-[#a1a1aa]">
                  {viewMode === 'past-papers' ? (
                    <>
                      <button
                        type="button"
                        onClick={openOverview}
                        className="hover:text-[#e4e4e7] underline cursor-pointer"
                      >
                        {rootTitle}
                      </button>
                      <span aria-hidden="true">/</span>
                      <span className="text-[#e4e4e7]">Past Papers (SSYYID)</span>
                    </>
                  ) : (
                    breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <React.Fragment key={crumb.id}>
                          {idx > 0 && <span aria-hidden="true">/</span>}
                          {isLast ? (
                            <span className="text-[#e4e4e7]">{crumb.name}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (idx === 0) {
                                  openOverview();
                                } else {
                                  openFolder(
                                    {
                                      id: crumb.id,
                                      name: crumb.name,
                                      mimeType:
                                        'application/vnd.google-apps.folder',
                                    },
                                    breadcrumbs.slice(0, idx + 1)
                                  );
                                }
                              }}
                              className="hover:text-[#e4e4e7] underline cursor-pointer"
                            >
                              {crumb.name}
                            </button>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </div>

                {viewMode === 'folder' && activeEntry.folders.length > 0 && (
                  <button
                    type="button"
                    onClick={handleToggleSubfolders}
                    className="text-xs text-[#9f99b3] hover:text-[#bcb6d1] underline cursor-pointer whitespace-nowrap"
                  >
                    {includeSubfoldersInView
                      ? 'Show immediate folder only'
                      : 'Include subfolder files'}
                  </button>
                )}
              </div>

              <div className="p-4 flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <h1 className="text-lg font-semibold text-[#e4e4e7] [text-wrap:balance]">
                    {viewMode === 'past-papers'
                      ? 'Past Papers Filter'
                      : currentParsedTitle.navLabel}
                  </h1>
                  {currentParsedTitle.topic && viewMode === 'folder' && (
                    <p className="text-sm text-[#a1a1aa] mt-0.5">
                      {currentParsedTitle.topic}
                    </p>
                  )}
                  {viewMode === 'past-papers' && (
                    <p className="text-sm text-[#a1a1aa] mt-0.5">
                      Automatically indexed from filenames matching SSYYID across all folders.
                    </p>
                  )}
                </div>
                <div className="text-xs text-[#a1a1aa] font-mono tabular-nums">
                  {filteredFiles.length}{' '}
                  {filteredFiles.length === 1 ? 'file' : 'files'}
                  {isFilterActive ? ` of ${filesWithMeta.length}` : ''}
                </div>
              </div>
            </section>

            {/* Error Banner */}
            {loadError && (
              <div
                role="alert"
                className="bg-[#24191c] border border-[#5c3b42] px-4 py-3 text-sm text-[#e4c2c9] flex items-center justify-between gap-4"
              >
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={handleRefreshCurrent}
                  className="px-3 py-1 text-xs border border-[#5c3b42] hover:border-[#e4c2c9] cursor-pointer whitespace-nowrap shrink-0"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Overview Folder Grid */}
            {viewMode === 'overview' && !isLoading && (
              <section className="bg-[#1c1c20] border border-[#2f2f37]">
                <div className="bg-[#222227] border-b border-[#2f2f37] px-4 py-2 text-xs font-semibold text-[#e4e4e7]">
                  Chapters &amp; Folders ({topFolders.length})
                </div>
                {topFolders.length === 0 ? (
                  <div className="p-6 text-sm text-[#a1a1aa]">
                    No subfolders found in this Drive folder.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:gap-px bg-[#2f2f37]">
                    {topFolders.map((folder) => {
                      const parsed = parseChapterLabel(folder.name);
                      return (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() =>
                            openFolder(folder, [
                              { id: rootFolderId, name: rootTitle },
                              { id: folder.id, name: folder.name },
                            ])
                          }
                          className="bg-[#1c1c20] hover:bg-[#222227] p-4 text-left transition-colors cursor-pointer flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-[#e4e4e7] truncate">
                              {parsed.navLabel}
                            </div>
                            <div className="text-xs text-[#a1a1aa] truncate mt-0.5">
                              {parsed.topic || 'Open folder contents'}
                            </div>
                          </div>
                          <span className="text-xs font-mono text-[#71717a] shrink-0">
                            Open →
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Nested Subfolders inside a Chapter */}
            {viewMode === 'folder' &&
              !isLoading &&
              activeEntry.folders.length > 0 && (
                <section className="bg-[#1c1c20] border border-[#2f2f37]">
                  <div className="bg-[#222227] border-b border-[#2f2f37] px-4 py-2 text-xs font-semibold text-[#e4e4e7]">
                    Subfolders ({activeEntry.folders.length})
                  </div>
                  <div className="divide-y divide-[#2a2a32]">
                    {activeEntry.folders.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => openFolder(sub)}
                        className="w-full px-4 py-2.5 text-left hover:bg-[#222227] transition-colors flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <span className="text-sm text-[#e4e4e7] truncate">
                          {sub.name}
                        </span>
                        <span className="text-xs font-mono text-[#71717a] shrink-0">
                          Folder →
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

            {/* Automatic SSYYID Past Paper Filter Bar + Search */}
            {(hasAnyPastPapers ||
              viewMode === 'past-papers' ||
              rawDisplayedFiles.length > 0) &&
              !isLoading &&
              !isScanningAll && (
                <section className="bg-[#1c1c20] border border-[#2f2f37]">
                  <div className="bg-[#222227] border-b border-[#2f2f37] px-4 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-[#e4e4e7]">
                      {hasAnyPastPapers || viewMode === 'past-papers'
                        ? 'Past Paper Filter (SSYYID)'
                        : 'Filter Files'}
                    </span>
                    {isFilterActive && (
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="text-xs text-[#9f99b3] hover:text-[#bcb6d1] underline cursor-pointer"
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                  <div className="p-3 flex flex-wrap items-center gap-3">
                    {(hasAnyPastPapers || viewMode === 'past-papers') && (
                      <>
                        {/* Session Segmented Control */}
                        <div
                          role="group"
                          aria-label="Session filter"
                          className="inline-flex border border-[#2f2f37] bg-[#151518]"
                        >
                          {(
                            [
                              { key: 'ALL', label: 'All Sessions' },
                              { key: 'MJ', label: 'May/June (MJ)' },
                              { key: 'ON', label: 'Oct/Nov (ON)' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => setSessionFilter(opt.key)}
                              className={`px-3 py-1.5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                sessionFilter === opt.key
                                  ? 'bg-[#2a2a33] text-[#e4e4e7] font-medium'
                                  : 'text-[#a1a1aa] hover:text-[#e4e4e7]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>

                        {/* Year Select */}
                        <select
                          aria-label="Filter by year"
                          value={yearFilter}
                          onChange={(e) => setYearFilter(e.target.value)}
                          className="bg-[#151518] border border-[#2f2f37] px-2.5 py-1.5 text-xs text-[#e4e4e7] font-mono focus:outline-none focus:border-[#9f99b3]"
                        >
                          <option value="ALL">All Years</option>
                          {availableYears.map((yr) => (
                            <option key={yr} value={yr}>
                              {yr}
                            </option>
                          ))}
                        </select>

                        {/* Paper Code Select */}
                        <select
                          aria-label="Filter by paper code"
                          value={paperCodeFilter}
                          onChange={(e) => setPaperCodeFilter(e.target.value)}
                          className="bg-[#151518] border border-[#2f2f37] px-2.5 py-1.5 text-xs text-[#e4e4e7] font-mono focus:outline-none focus:border-[#9f99b3]"
                        >
                          <option value="ALL">All Papers</option>
                          {availablePaperCodes.map((code) => (
                            <option key={code} value={code}>
                              Paper {code}
                            </option>
                          ))}
                        </select>
                      </>
                    )}

                    {/* Search Box */}
                    <input
                      type="search"
                      aria-label="Search files"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        hasAnyPastPapers || viewMode === 'past-papers'
                          ? 'Search code or filename (e.g. MJ1813)...'
                          : 'Search filenames...'
                      }
                      className="flex-1 min-w-[200px] bg-[#151518] border border-[#2f2f37] px-3 py-1.5 text-xs text-[#e4e4e7] placeholder:text-[#71717a] focus:outline-none focus:border-[#9f99b3]"
                    />
                  </div>
                </section>
              )}

            {/* Loading State */}
            {(isLoading || isScanningAll) && (
              <section className="bg-[#1c1c20] border border-[#2f2f37] p-6 text-sm text-[#a1a1aa] font-mono">
                {isScanningAll
                  ? 'Scanning Drive folders for SSYYID past papers...'
                  : 'Loading folder contents...'}
              </section>
            )}

            {/* Files Table */}
            {!isLoading &&
              !isScanningAll &&
              (viewMode !== 'overview' || rootFiles.length > 0) && (
                <section className="bg-[#1c1c20] border border-[#2f2f37]">
                  <div className="bg-[#222227] border-b border-[#2f2f37] px-4 py-2 text-xs font-semibold text-[#e4e4e7]">
                    Files ({filteredFiles.length})
                  </div>

                  {filteredFiles.length === 0 ? (
                    <div className="p-6 text-sm text-[#a1a1aa]">
                      {isFilterActive
                        ? 'No files match the selected past-paper filters.'
                        : viewMode === 'past-papers'
                        ? 'No files matching the SSYYID format (e.g. mj1813 or on2042) were found.'
                        : 'No files directly inside this folder.'}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b border-[#2f2f37] text-xs text-[#a1a1aa]">
                            <th className="py-2.5 px-4 font-medium">File</th>
                            <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                              {hasAnyPastPapers || viewMode === 'past-papers'
                                ? 'Paper Details'
                                : 'Type'}
                            </th>
                            <th className="py-2.5 px-3 font-medium whitespace-nowrap">
                              Modified
                            </th>
                            <th className="py-2.5 px-4 font-medium text-right whitespace-nowrap">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#2a2a32] text-sm">
                          {filteredFiles.map(({ file, paper }) => {
                            const driveUrl =
                              file.webViewLink ||
                              `https://drive.google.com/file/d/${file.id}/view`;
                            return (
                              <tr
                                key={file.id}
                                className="hover:bg-[#222227] transition-colors"
                              >
                                <td className="py-2.5 px-4 max-w-[360px]">
                                  <button
                                    type="button"
                                    onClick={() => setPreviewFile(file)}
                                    className="text-left text-[#e4e4e7] hover:text-[#bcb6d1] hover:underline underline-offset-2 break-words cursor-pointer"
                                  >
                                    {file.name}
                                  </button>
                                  {file.folderPath && file.folderPath !== rootTitle && (
                                    <div className="text-xs text-[#71717a] mt-0.5 truncate">
                                      {file.folderPath}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-xs text-[#a1a1aa] font-mono whitespace-nowrap">
                                  {paper ? (
                                    <span>
                                      {paper.sessionLabel} · {paper.yearFull} · Paper{' '}
                                      {paper.paperCode}
                                      {paper.variantHint
                                        ? ` · ${paper.variantHint}`
                                        : ''}
                                    </span>
                                  ) : (
                                    <span>
                                      {formatFileType(file.mimeType, file.name)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 text-xs text-[#a1a1aa] font-mono whitespace-nowrap">
                                  {formatShortDate(file.modifiedTime)}
                                </td>
                                <td className="py-2.5 px-4 text-right whitespace-nowrap">
                                  <div className="inline-flex items-center gap-3 text-xs">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewFile(file)}
                                      className="text-[#9f99b3] hover:text-[#bcb6d1] underline underline-offset-2 cursor-pointer"
                                    >
                                      Preview
                                    </button>
                                    <a
                                      href={driveUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#a1a1aa] hover:text-[#e4e4e7] underline underline-offset-2"
                                    >
                                      Open
                                    </a>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
          </main>
        </div>
      </div>

      {/* Inline File Preview Modal */}
      {previewFile && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${previewFile.name}`}
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="bg-[#1c1c20] border border-[#42424d] w-full max-w-4xl h-[82vh] flex flex-col">
            <div className="bg-[#222227] border-b border-[#2f2f37] px-4 py-2.5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#e4e4e7] truncate">
                  {previewFile.name}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs shrink-0">
                {previewFile.webContentLink && (
                  <a
                    href={previewFile.webContentLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#9f99b3] hover:text-[#bcb6d1] underline"
                  >
                    Download
                  </a>
                )}
                <a
                  href={
                    previewFile.webViewLink ||
                    `https://drive.google.com/file/d/${previewFile.id}/view`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#a1a1aa] hover:text-[#e4e4e7] underline"
                >
                  Open in Drive
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  className="px-2.5 py-1 bg-[#151518] border border-[#42424d] text-[#e4e4e7] hover:border-[#9f99b3] cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 bg-[#151518]">
              <iframe
                title={previewFile.name}
                src={`https://drive.google.com/file/d/${previewFile.id}/preview`}
                className="w-full h-full border-0"
                allow="autoplay"
              />
            </div>
          </div>
        </div>
      )}

      {/* Quiet Footer */}
      <footer className="relative z-10 border-t border-[#2f2f37] bg-[#18181c]/95 mt-auto">
        <div className="max-w-[1040px] mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs text-[#71717a]">
          <span>Study Archive · Public Drive Directory</span>
          <span className="font-mono">SSYYID: MJ/ON · 20YY · Paper ID</span>
        </div>
      </footer>
    </div>
  );
}
