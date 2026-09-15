const input = document.querySelector("#input");
const actions = document.querySelector("#actions");
const kind = document.querySelector("#kind");
const dragHandle = document.querySelector("#drag-handle");
const { invoke } = window.__TAURI__.core;
const currentWindow = window.__TAURI__.window.getCurrentWindow();

let items = [];
let selected = 0;
let startApps = [];

const systemActions = [
  { icon: "▣", title: "File Explorer", detail: "Windows", id: "explorer", keywords: "files folders", default: true },
  { icon: "⚙", title: "Settings", detail: "Windows", id: "settings", keywords: "preferences system", default: true },
  { icon: ">_", title: "Windows Terminal", detail: "Windows", id: "terminal", keywords: "terminal powershell command prompt cmd", default: true },
  { icon: "▤", title: "Task Manager", detail: "Windows", id: "task-manager", keywords: "processes performance startup", default: true },
  { icon: "↗", title: "Run", detail: "Windows", id: "run", keywords: "execute command", default: true },
  { icon: "⌂", title: "This PC", detail: "File Explorer", id: "this-pc", keywords: "computer drives disks" },
  { icon: "↓", title: "Downloads", detail: "Folder", id: "downloads", keywords: "download folder" },
  { icon: "▱", title: "Documents", detail: "Folder", id: "documents", keywords: "document folder" },
  { icon: "□", title: "Pictures", detail: "Folder", id: "pictures", keywords: "photos images folder" },
  { icon: "⌂", title: "Home Folder", detail: "Folder", id: "profile", keywords: "user profile home folder" },
  { icon: "♲", title: "Recycle Bin", detail: "Windows", id: "recycle-bin", keywords: "trash deleted files" },
  { icon: "◫", title: "Control Panel", detail: "Windows", id: "control-panel", keywords: "legacy settings" },
  { icon: "↻", title: "Windows Update", detail: "Settings", id: "windows-update", keywords: "updates update check" },
  { icon: "B", title: "Bluetooth & devices", detail: "Settings", id: "bluetooth", keywords: "bluetooth devices mouse keyboard" },
  { icon: "▭", title: "Display settings", detail: "Settings", id: "display", keywords: "monitor screen resolution hdr" },
  { icon: "♪", title: "Sound settings", detail: "Settings", id: "sound", keywords: "audio speakers microphone volume" },
  { icon: "◎", title: "Network & internet", detail: "Settings", id: "network", keywords: "wifi ethernet network internet" },
  { icon: "▦", title: "Installed apps", detail: "Settings", id: "installed-apps", keywords: "apps uninstall programs features" },
  { icon: "▦", title: "Default apps", detail: "Settings", id: "default-apps", keywords: "defaults file associations browser" },
  { icon: "✦", title: "Personalization", detail: "Settings", id: "personalization", keywords: "wallpaper theme colors background" },
  { icon: "◐", title: "Power settings", detail: "Settings", id: "power-settings", keywords: "power battery sleep energy" },
  { icon: "◇", title: "Lock", detail: "Lock this PC", id: "lock", keywords: "lock screen" },
  { icon: "←", title: "Sign out", detail: "Sign out of Windows", id: "sign-out", keywords: "logout log out", exact: true },
  { icon: "↻", title: "Restart", detail: "Restart this PC", id: "restart", keywords: "reboot", exact: true },
  { icon: "○", title: "Shut down", detail: "Shut down this PC", id: "shutdown", keywords: "shutdown power off", exact: true }
];

function windowsPath(value) {
  return /^[a-z]:[\\/]/i.test(value.trim());
}

function toWslPath(value) {
  const path = value.trim();
  const drive = path[0].toLowerCase();
  return `/mnt/${drive}${path.slice(2).replaceAll("\\", "/")}`;
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function matchScore(text, query) {
  const value = text.toLowerCase();
  const q = query.toLowerCase();
  if (value === q) return 0;
  if (value.startsWith(q)) return 1;
  if (value.split(/\s+/).some(word => word.startsWith(q))) return 2;
  const index = value.indexOf(q);
  if (index >= 0) return 3 + index / 100;

  let at = 0;
  for (const character of value) {
    if (character === q[at]) at++;
    if (at === q.length) return 5;
  }
  return Infinity;
}

function nativeItem(item, score = 0) {
  return {
    ...item,
    score,
    run: () => runNative("run_system_action", { action: item.id })
  };
}

function appItem(app, score) {
  return {
    icon: app.name.trim().charAt(0).toUpperCase() || "A",
    image: app.icon,
    title: app.name,
    detail: "Application",
    score,
    run: () => runNative("launch_start_app", { appId: app.id })
  };
}

function buildActions(value) {
  const query = value.trim();

  if (!query) {
    return systemActions.filter(item => item.default).map(nativeItem);
  }

  const result = [];

  if (windowsPath(value)) {
    const path = toWslPath(value);
    result.push(
      {
        icon: ">_",
        title: "Linux cd",
        detail: `cd ${path}`,
        score: -2,
        run: () => setInput(`cd ${path}`)
      },
      {
        icon: "/",
        title: "WSL path",
        detail: path,
        score: -1,
        run: () => setInput(path)
      }
    );
  }

  const matches = [];

  for (const item of systemActions) {
    const text = `${item.title} ${item.keywords}`;
    const score = matchScore(text, query);
    const exactQuery = query.toLowerCase();
    const exactAllowed = !item.exact
      || exactQuery === item.title.toLowerCase()
      || item.keywords.split(/\s+/).includes(exactQuery);

    if (Number.isFinite(score) && exactAllowed) matches.push(nativeItem(item, score));
  }

  for (const app of startApps) {
    const score = matchScore(app.name, query);
    if (Number.isFinite(score)) matches.push(appItem(app, score + 0.1));
  }

  matches.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
  result.push(...matches.slice(0, 10));

  result.push(
    {
      icon: "Aa",
      title: "UPPERCASE",
      detail: value.toUpperCase(),
      score: 20,
      run: () => setInput(value.toUpperCase())
    },
    {
      icon: "aa",
      title: "lowercase",
      detail: value.toLowerCase(),
      score: 21,
      run: () => setInput(value.toLowerCase())
    },
    {
      icon: "#",
      title: "Slugify",
      detail: slugify(value),
      score: 22,
      run: () => setInput(slugify(value))
    }
  );

  return result;
}

function detectKind(value) {
  if (!value.trim()) return "";
  if (windowsPath(value)) return "Windows path";
  if (/^https?:\/\//i.test(value.trim())) return "URL";
  return "";
}

function setInput(value) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  selected = 0;
  render();
}

async function hideLauncher() {
  await currentWindow.hide();
}

async function runNative(command, args) {
  input.value = "";
  selected = 0;
  render();

  try {
    await hideLauncher();
    await invoke(command, args);
  } catch (error) {
    console.error(error);
  }
}

function run(index = selected) {
  items[index]?.run();
}

function render() {
  items = buildActions(input.value);
  selected = Math.min(selected, Math.max(0, items.length - 1));

  const type = detectKind(input.value);
  kind.textContent = type;
  kind.classList.toggle("visible", Boolean(type));

  actions.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matches";
    actions.append(empty);
    return;
  }

  items.forEach((item, index) => {
    const row = document.createElement("button");
    row.className = `action${index === selected ? " selected" : ""}`;
    row.type = "button";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === selected ? "true" : "false");

    const icon = document.createElement("span");
    icon.className = "action-icon";

    if (item.image) {
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = "";
      image.draggable = false;
      image.addEventListener("error", () => {
        icon.replaceChildren();
        icon.textContent = item.icon;
      });
      icon.append(image);
    } else {
      icon.textContent = item.icon;
    }

    const copy = document.createElement("span");
    copy.className = "action-copy";

    const title = document.createElement("div");
    title.className = "action-title";
    title.textContent = item.title;

    const detail = document.createElement("div");
    detail.className = "action-detail";
    detail.textContent = item.detail;

    const key = document.createElement("span");
    key.className = "action-key";
    key.innerHTML = "<kbd>↵</kbd>";

    copy.append(title, detail);
    row.append(icon, copy, key);

    row.addEventListener("mouseenter", () => {
      selected = index;
      render();
    });
    row.addEventListener("click", () => run(index));
    actions.append(row);
  });

  actions.children[selected]?.scrollIntoView({ block: "nearest" });
}

async function loadStartApps() {
  try {
    const raw = await invoke("get_start_apps");
    startApps = raw
      .split(/\r?\n/)
      .map(line => line.split("\x1f"))
      .filter(parts => parts.length >= 2 && parts[0] && parts[1])
      .map(([name, id, icon]) => ({
        name: name.trim(),
        id: id.trim(),
        icon: icon?.trim() || ""
      }));
    render();
  } catch (error) {
    console.error(error);
  }
}

input.addEventListener("input", () => {
  selected = 0;
  render();
});

dragHandle.addEventListener("mousedown", event => {
  if (event.button === 0) currentWindow.startDragging();
});

window.addEventListener("focus", () => input.focus());

document.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" && items.length) {
    event.preventDefault();
    selected = (selected + 1) % items.length;
    render();
  } else if (event.key === "ArrowUp" && items.length) {
    event.preventDefault();
    selected = (selected - 1 + items.length) % items.length;
    render();
  } else if (event.key === "Enter" && items.length) {
    event.preventDefault();
    run();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (input.value) setInput("");
    else hideLauncher().catch(console.error);
  }
});

input.focus();
render();
loadStartApps();
