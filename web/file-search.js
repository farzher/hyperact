(() => {
  const historyKey = "hyperact.fileHistory";
  const fileLimit = 8;
  let fileQuery = "";
  let fileResults = [];
  let searchTimer;
  let searchVersion = 0;
  let unavailableUntil = 0;
  let history = loadHistory();

  function loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(historyKey) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function saveHistory() {
    localStorage.setItem(historyKey, JSON.stringify(history));
  }

  function fullPath(file) {
    return file.path ? `${file.path}\\${file.name}` : file.name;
  }

  function prettyPath(path) {
    return path.replace(/^[A-Za-z]:\\Users\\[^\\]+/i, "~");
  }

  function historyBonus(path) {
    const entry = history[path.toLowerCase()];
    if (!entry) return 0;
    const uses = Math.min(0.7, Math.log2((entry.count || 0) + 1) * 0.18);
    const age = Date.now() - (entry.last || 0);
    const recent = age < 86_400_000 ? 0.4 : age < 604_800_000 ? 0.22 : 0;
    return uses + recent;
  }

  function remember(path) {
    const key = path.toLowerCase();
    const current = history[key] || { count: 0, last: 0 };
    history[key] = { count: current.count + 1, last: Date.now() };

    const keys = Object.keys(history);
    if (keys.length > 200) {
      keys.sort((a, b) => (history[b].last || 0) - (history[a].last || 0));
      history = Object.fromEntries(keys.slice(0, 200).map(key => [key, history[key]]));
    }
    saveHistory();
  }

  function fileScore(file, query) {
    const name = file.name.toLowerCase();
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const nameScore = Math.min(matchScore(name, query), matchScore(stem, query));
    const lowerPath = file.path.toLowerCase();
    const common = /\\(desktop|documents|downloads|pictures|videos|music|onedrive)(\\|$)/i.test(file.path) ? 0.2 : 0;
    const depth = Math.max(0, file.path.split("\\").length - 3) * 0.025;
    const folder = file.folder ? 0.06 : 0;
    return 1.4 + nameScore * 0.65 + depth - common - folder - historyBonus(fullPath(file));
  }

  async function openFile(file) {
    const path = fullPath(file);
    remember(path);
    await hideLauncher();
    try {
      await invoke("open_path", { path });
    } catch (error) {
      console.error(error);
    }
  }

  function fileItem(file, query) {
    return {
      icon: file.folder ? "▰" : "▱",
      title: file.name,
      detail: prettyPath(file.path),
      category: file.folder ? "Folder" : "File",
      score: fileScore(file, query),
      itemType: "file",
      file,
      run: () => openFile(file)
    };
  }

  const buildBaseActions = buildActions;
  buildActions = function (value) {
    const base = buildBaseActions(value);
    const query = value.trim().toLowerCase();
    if (!query || activeCommand || query !== fileQuery || !fileResults.length) return base;

    const merged = [
      ...base,
      ...fileResults.slice(0, fileLimit).map(file => fileItem(file, query))
    ];
    merged.sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || a.title.localeCompare(b.title));
    return merged.slice(0, maxResults);
  };

  function parseResults(raw) {
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .map(line => line.split("\x1f"))
      .filter(parts => parts.length >= 3 && parts[0])
      .map(([name, path, folder]) => ({ name, path, folder: folder === "1" }));
  }

  async function searchFiles(value, version) {
    const query = value.trim();
    if (query.length < 2 || activeCommand || !commandEditor.hidden) {
      fileQuery = "";
      fileResults = [];
      return;
    }

    if (Date.now() < unavailableUntil) return;

    try {
      const raw = await invoke("search_files", { query });
      if (version !== searchVersion || input.value.trim() !== query) return;
      fileQuery = query.toLowerCase();
      fileResults = parseResults(raw)
        .sort((a, b) => fileScore(a, fileQuery) - fileScore(b, fileQuery))
        .slice(0, fileLimit);
      render();
    } catch {
      if (version !== searchVersion) return;
      fileQuery = "";
      fileResults = [];
      unavailableUntil = Date.now() + 5000;
    }
  }

  function scheduleSearch() {
    clearTimeout(searchTimer);
    const version = ++searchVersion;
    const value = input.value;
    if (value.trim().length < 2 || activeCommand || !commandEditor.hidden) {
      fileQuery = "";
      fileResults = [];
      return;
    }
    searchTimer = setTimeout(() => searchFiles(value, version), 35);
  }

  input.addEventListener("input", scheduleSearch);

  const baseActionMenuOptions = actionMenuOptions;
  actionMenuOptions = function () {
    const target = menuState?.item;
    if (target?.itemType !== "file") return baseActionMenuOptions();

    const path = fullPath(target.file);
    const options = [
      {
        icon: "↵",
        title: "Open",
        detail: "Enter",
        run: () => {
          closeActionMenu(false);
          target.run();
        }
      },
      {
        icon: "▣",
        title: "Show in File Explorer",
        detail: "",
        run: async () => {
          closeActionMenu(false);
          try { await invoke("reveal_path", { path }); } catch (error) { console.error(error); }
        }
      },
      {
        icon: "⌘",
        title: "Copy Path",
        detail: "",
        run: async () => {
          try { await navigator.clipboard.writeText(path); } catch (error) { console.error(error); }
          closeActionMenu(true);
        }
      }
    ];

    const query = actionMenuInput.value.trim().toLowerCase();
    if (!query) return options;
    return options
      .map(option => ({ ...option, score: matchScore(`${option.title} ${option.detail}`.toLowerCase(), query) }))
      .filter(option => Number.isFinite(option.score))
      .sort((a, b) => a.score - b.score);
  };
})();
