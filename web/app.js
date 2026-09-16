const $ = selector => document.querySelector(selector);
const palette = $(".palette");
const input = $("#input");
const actions = $("#actions");
const kind = $("#kind");
const footer = $("#footer");
const scrollThumb = $("#scroll-thumb");
const commandEditor = $("#command-editor");
const commandList = $("#command-list");
const commandNew = $("#command-new");
const commandName = $("#command-name");
const commandMatch = $("#command-match");
const commandHotkey = $("#command-hotkey");
const commandInputMode = $("#command-input-mode");
const commandMissingInput = $("#command-missing-input");
const commandOutputMode = $("#command-output-mode");
const commandCode = $("#command-code");
const commandStatus = $("#command-status");
const commandDelete = $("#command-delete");
const commandCancel = $("#command-cancel");
const commandSave = $("#command-save");
const actionMenu = $("#item-actions");
const actionMenuTitle = $("#item-actions-title");
const actionMenuHint = $("#item-actions-hint");
const actionMenuList = $("#item-actions-list");
const actionMenuInput = $("#item-actions-search");

const { invoke } = window.__TAURI__.core;
const currentWindow = window.__TAURI__.window.getCurrentWindow();
const globalShortcut = window.__TAURI__.globalShortcut;
const defaultPlaceholder = "Search apps and actions…";
const reservedHotkeys = new Set(["alt+space", "ctrl+k"]);
const maxResults = 60;

let items = [];
let selected = 0;
let startApps = [];
let commands = [];
let preferences = {};
let activeCommand = null;
let commandSearchQuery = "";
let commandError = "";
let promptTarget = null;
let promptSelectAll = false;
let promptFocus = 0;
let promptLocked = false;
let deferredRun = 0;
let editingCommandId = "";
let editorStatusTimer;
let editorHotkeyOriginal = "";
let registeredHotkeys = [];
const pressedHotkeys = new Set();
let menuState = null;
let menuMode = "";
let menuSelected = 0;
let pendingHotkey = "";
let originalHotkey = "";
let blurTimer;
let scrollFadeTimer;

const systemActions = [
  { icon: "▣", title: "File Explorer", detail: "Windows", id: "explorer", keywords: "files folders", default: true },
  { icon: "⚙", title: "Settings", detail: "Windows", id: "settings", keywords: "preferences system", default: true },
  { icon: ">_", title: "Windows Terminal", detail: "Windows", id: "terminal", keywords: "terminal powershell command prompt cmd", default: true },
  { icon: "▤", title: "Task Manager", detail: "Windows", id: "task-manager", keywords: "processes performance startup", default: true },
  { icon: "↗", title: "Run", detail: "Windows", id: "run", keywords: "execute command" },
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
].map(item => ({ ...item, search: `${item.title} ${item.keywords}`.toLowerCase() }));

function persistCommands() {
  if (!window.hyperactConfig) return;
  window.hyperactConfig.commands = commands;
  window.saveHyperactConfig?.().catch(console.error);
}

function persistPreferences() {
  if (!window.hyperactConfig) return;
  window.hyperactConfig.preferences = preferences;
  window.saveHyperactConfig?.().catch(console.error);
}

function preference(key) {
  return preferences[key] || {};
}

function setPreference(key, field, value) {
  const next = { ...preference(key), [field]: value };
  if (!next.alias && !next.hotkey) delete preferences[key];
  else preferences[key] = next;
  persistPreferences();
}

function commandKey(command) {
  return `command:${command.id}`;
}

function systemKey(item) {
  return `system:${item.id}`;
}

function appKey(app) {
  return `app:${app.id}`;
}

function aliasFor(item) {
  return item?.itemKey ? preference(item.itemKey).alias || "" : "";
}

function hotkeyFor(item) {
  if (item?.command) return item.command.hotkey || "";
  return item?.itemKey ? preference(item.itemKey).hotkey || "" : "";
}

function decorateItem(item) {
  if (!item.itemKey) return item;
  item.alias = aliasFor(item);
  item.hotkey = hotkeyFor(item);
  return item;
}

function windowsPath(value) {
  return /^[a-z]:[\\/]/i.test(value.trim());
}

function toWslPath(value) {
  const path = value.trim();
  return `/mnt/${path[0].toLowerCase()}${path.slice(2).replaceAll("\\", "/")}`;
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

function matchScore(value, query) {
  if (value === query) return 0;
  if (value.startsWith(query)) return 1;
  if (value.split(/\s+/).some(word => word.startsWith(query))) return 2;
  const index = value.indexOf(query);
  if (index >= 0) return 3 + index / 100;

  let at = 0;
  for (const character of value) {
    if (character === query[at]) at++;
    if (at === query.length) return 5;
  }
  return Infinity;
}

function nativeCategory(item) {
  if (item.detail === "Settings" || item.id === "settings") return "Windows Settings";
  if (item.detail === "Folder") return "Folder";
  if (item.detail === "File Explorer") return "File Explorer";
  if (item.id === "control-panel") return "Control Panel";
  if (["explorer", "terminal", "task-manager"].includes(item.id)) return "Application";
  return "Windows";
}

function nativeItem(item, score = 0) {
  return decorateItem({
    icon: item.icon,
    title: item.title,
    detail: "",
    category: nativeCategory(item),
    score,
    itemKey: systemKey(item),
    itemType: "system",
    itemSource: item,
    run: () => runNative("run_system_action", { action: item.id })
  });
}

function appItem(app, score) {
  return decorateItem({
    icon: app.name.charAt(0).toUpperCase() || "A",
    image: app.icon,
    title: app.name,
    detail: "",
    category: app.type || "Application",
    score,
    itemKey: appKey(app),
    itemType: "app",
    itemSource: app,
    run: () => runNative("launch_start_app", { appId: app.id })
  });
}

function commandResult(command, score, mode, value) {
  const direct = mode === "input";
  return decorateItem({
    icon: "N",
    title: command.name,
    detail: "",
    category: direct ? "Text Action" : "Command",
    score,
    command,
    commandMode: mode,
    itemKey: commandKey(command),
    itemType: "command",
    itemSource: command,
    run: () => direct ? runCommand(command, value) : enterCommandMode(command)
  });
}

function manageCommandsItem(score = 9) {
  return {
    icon: "+",
    title: "Commands",
    detail: commands.length ? `${commands.length} custom` : "Add a custom command",
    category: "Command",
    score,
    run: () => openCommandEditor()
  };
}

function inputMatches(command, value) {
  if (!command.match) return false;
  try {
    return new RegExp(command.match).test(value);
  } catch {
    return false;
  }
}

function buildActions(value) {
  if (activeCommand) {
    return [decorateItem({
      icon: "N",
      title: `Run ${activeCommand.name}`,
      detail: commandError || (promptTarget !== null
        ? "Enter submit · Shift+Enter run again"
        : "Enter run · Shift+Enter run again"),
      category: "Command",
      score: 0,
      command: activeCommand,
      commandMode: "active",
      itemKey: commandKey(activeCommand),
      itemType: "command",
      itemSource: activeCommand,
      run: () => promptTarget !== null ? runPromptCommand(false) : runCommandMode(false)
    })];
  }

  const query = value.trim();
  if (!query) {
    return [
      ...systemActions.filter(item => item.default).map(nativeItem),
      manageCommandsItem()
    ];
  }

  const q = query.toLowerCase();
  const matches = [];

  if (windowsPath(value)) {
    const path = toWslPath(value);
    matches.push(
      {
        icon: ">_",
        title: "Linux cd",
        detail: `cd ${path}`,
        category: "Text Action",
        score: -2,
        run: () => setInput(`cd ${path}`)
      },
      {
        icon: "/",
        title: "WSL path",
        detail: path,
        category: "Text Action",
        score: -1,
        run: () => setInput(path)
      }
    );
  }

  for (const item of systemActions) {
    const baseScore = matchScore(item.search, q);
    const alias = preference(systemKey(item)).alias?.toLowerCase() || "";
    const aliasScore = alias ? matchScore(alias, q) + 0.03 : Infinity;
    const exactAllowed = !item.exact
      || Number.isFinite(aliasScore)
      || q === item.title.toLowerCase()
      || item.keywords.split(/\s+/).includes(q);
    const score = Math.min(baseScore, aliasScore);
    if (Number.isFinite(score) && exactAllowed) matches.push(nativeItem(item, score));
  }

  for (const app of startApps) {
    const baseScore = matchScore(app.search, q) + 0.1;
    const alias = preference(appKey(app)).alias?.toLowerCase() || "";
    const aliasScore = alias ? matchScore(alias, q) + 0.03 : Infinity;
    const score = Math.min(baseScore, aliasScore);
    if (Number.isFinite(score)) matches.push(appItem(app, score));
  }

  for (const command of commands) {
    if (inputMatches(command, value)) {
      matches.push(commandResult(command, 0.02, "input", value));
      continue;
    }

    const nameScore = matchScore(command.name.toLowerCase(), q) + 0.05;
    const alias = preference(commandKey(command)).alias?.toLowerCase() || "";
    const aliasScore = alias ? matchScore(alias, q) + 0.04 : Infinity;
    const score = Math.min(nameScore, aliasScore);

    if (Number.isFinite(score)) {
      matches.push(commandResult(command, score, "search", value));
    } else if (!command.match) {
      matches.push(commandResult(command, 8, "input", value));
    }
  }

  const managerScore = matchScore("commands add command edit command custom automation", q);
  if (Number.isFinite(managerScore)) matches.push(manageCommandsItem(managerScore));

  matches.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

  const textActions = [
    {
      icon: "Aa",
      title: "UPPERCASE",
      detail: value.toUpperCase(),
      category: "Text Action",
      score: 20,
      run: () => setInput(value.toUpperCase())
    },
    {
      icon: "aa",
      title: "lowercase",
      detail: value.toLowerCase(),
      category: "Text Action",
      score: 21,
      run: () => setInput(value.toLowerCase())
    },
    {
      icon: "#",
      title: "Slugify",
      detail: slugify(value),
      category: "Text Action",
      score: 22,
      run: () => setInput(slugify(value))
    }
  ];

  return [...matches.slice(0, maxResults - textActions.length), ...textActions];
}

function detectKind(value) {
  if (activeCommand) return activeCommand.name;
  if (!value.trim()) return "";
  if (windowsPath(value)) return "Windows path";
  if (/^https?:\/\//i.test(value.trim())) return "URL";
  return "";
}

function setInput(value) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  selected = 0;
  commandError = "";
  render();
}

function enterCommandMode(command) {
  commandSearchQuery = input.value;
  activeCommand = command;
  promptTarget = null;
  promptSelectAll = false;
  promptFocus = 0;
  commandError = "";
  input.value = "";
  input.placeholder = `${command.name} input…`;
  selected = 0;
  render();
  input.focus();
}

function exitCommandMode() {
  const query = commandSearchQuery;
  commandSearchQuery = "";
  activeCommand = null;
  commandError = "";
  input.placeholder = defaultPlaceholder;
  setInput(query);
  input.focus();
}

async function runCommandMode(stayOpen) {
  const command = activeCommand;
  if (!command || promptTarget !== null) return;

  commandError = "";
  try {
    const output = String(await invoke("run_node_command", {
      code: command.code,
      input: input.value
    }));

    if (stayOpen) {
      setInput(output);
      input.select();
      return;
    }

    commandSearchQuery = "";
    activeCommand = null;
    input.placeholder = defaultPlaceholder;
    setInput(output);
  } catch (error) {
    commandError = error?.message || String(error);
    render();
  }
}

async function runCommand(command, value) {
  commandError = "";
  try {
    const output = await invoke("run_node_command", { code: command.code, input: value });
    activeCommand = null;
    commandSearchQuery = "";
    input.placeholder = defaultPlaceholder;
    setInput(String(output));
  } catch (error) {
    commandError = error?.message || String(error);
    render();
  }
}

async function runPromptCommand(stayOpen) {
  const command = activeCommand;
  if (!command || promptTarget === null) return;

  commandError = "";
  try {
    const output = String(await invoke("run_node_command", {
      code: command.code,
      input: input.value
    }));

    if (stayOpen) {
      setInput(output);
      input.select();
      return;
    }

    const target = promptTarget;
    const selectAll = promptSelectAll;
    const focus = promptFocus;
    clearPromptState();
    render();
    await hideLauncher();
    await invoke("submit_prompt_result", {
      target,
      output,
      outputMode: command.outputMode,
      selectAll,
      focus
    });
  } catch (error) {
    commandError = error?.message || String(error);
    render();
  }
}

function clearPromptState() {
  promptLocked = false;
  promptTarget = null;
  promptSelectAll = false;
  promptFocus = 0;
  activeCommand = null;
  commandError = "";
  input.readOnly = false;
  input.value = "";
  input.placeholder = defaultPlaceholder;
  selected = 0;
}

async function unlockPromptWhenReady(target) {
  while (promptLocked && promptTarget === target) {
    try {
      if (!await invoke("modifiers_held")) break;
    } catch {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 8));
  }

  if (promptTarget === target) {
    promptLocked = false;
    input.readOnly = false;
    input.focus();
  }
}

async function openPromptMode(command, target, selectAll, focus = 0) {
  if (!commandEditor.hidden) closeCommandEditor();

  activeCommand = command;
  promptTarget = target;
  promptSelectAll = selectAll;
  promptFocus = focus;
  promptLocked = true;
  commandError = "";
  input.disabled = false;
  input.readOnly = true;
  input.value = "";
  input.placeholder = `${command.name} input…`;
  selected = 0;
  render();

  await currentWindow.show();
  await currentWindow.setFocus();
  input.focus();
  unlockPromptWhenReady(target).catch(console.error);
}

async function launcherVisible() {
  try {
    return await currentWindow.isVisible();
  } catch {
    return false;
  }
}

async function continueDeferredHotkey(command, target, focus, run) {
  while (run === deferredRun) {
    try {
      if (!await invoke("non_ctrl_modifiers_held")) break;
    } catch {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 8));
  }

  if (run !== deferredRun || await launcherVisible()) return;

  try {
    const prompt = await invoke("resume_hotkey_command", {
      code: command.code,
      inputMode: command.inputMode,
      missingInput: command.missingInput,
      outputMode: command.outputMode,
      target,
      focus
    });

    if (run !== deferredRun || await launcherVisible()) return;
    if (Array.isArray(prompt) && prompt.length >= 2) {
      await openPromptMode(command, target, Boolean(prompt[1]), prompt[3] || focus);
    }
  } catch (error) {
    console.error(error);
  }
}

async function runHotkeyCommand(command) {
  const run = ++deferredRun;

  try {
    const prompt = await invoke("run_hotkey_command", {
      code: command.code,
      inputMode: command.inputMode,
      missingInput: command.missingInput,
      outputMode: command.outputMode
    });

    if (run !== deferredRun) return;

    if (Array.isArray(prompt) && prompt.length >= 3 && prompt[2] === 1) {
      continueDeferredHotkey(command, prompt[0], prompt[3] || 0, run).catch(console.error);
      return;
    }

    if (Array.isArray(prompt) && prompt.length >= 2) {
      await openPromptMode(command, prompt[0], Boolean(prompt[1]), prompt[3] || 0);
    }
  } catch (error) {
    console.error(error);
  }
}

async function hideLauncher() {
  deferredRun++;
  promptLocked = false;
  input.readOnly = false;
  closeActionMenu(false);
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

function selectItem(index) {
  if (!items.length) return;

  const next = (index + items.length) % items.length;
  const previous = actions.children[selected];
  previous?.classList.remove("selected");
  previous?.setAttribute("aria-selected", "false");

  selected = next;
  const row = actions.children[selected];
  row?.classList.add("selected");
  row?.setAttribute("aria-selected", "true");
  row?.scrollIntoView({ block: "nearest" });
  updateFooter();
}

function createActionRow(item, index) {
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
    }, { once: true });
    icon.append(image);
  } else {
    icon.textContent = item.icon;
  }

  const copy = document.createElement("span");
  copy.className = "action-copy";

  const title = document.createElement("span");
  title.className = "action-title";
  title.textContent = item.title;
  copy.append(title);

  if (item.alias) {
    const alias = document.createElement("span");
    alias.className = "action-alias-badge";
    alias.textContent = item.alias;
    copy.append(alias);
  }

  if (item.detail) {
    const detail = document.createElement("span");
    detail.className = "action-detail";
    detail.textContent = item.detail;
    copy.append(detail);
  }

  if (item.hotkey) {
    const hotkey = document.createElement("span");
    hotkey.className = "action-hotkey";
    hotkey.textContent = item.hotkey;
    copy.append(hotkey);
  }

  const category = document.createElement("span");
  category.className = "action-category";
  category.textContent = item.category || "Action";

  row.append(icon, copy, category);
  row.addEventListener("mouseenter", () => {
    if (selected !== index) selectItem(index);
  });
  row.addEventListener("click", () => run(index));
  row.addEventListener("contextmenu", event => {
    event.preventDefault();
    if (selected !== index) selectItem(index);
    openActionMenu(item);
  });
  return row;
}

function render() {
  if (!commandEditor.hidden) return;

  items = buildActions(input.value);
  selected = Math.min(selected, Math.max(0, items.length - 1));

  const type = detectKind(input.value);
  kind.textContent = type;
  kind.classList.toggle("visible", Boolean(type));

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No matches";
    actions.replaceChildren(empty);
    updateFooter();
    updateScrollThumb();
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => fragment.append(createActionRow(item, index)));
  actions.replaceChildren(fragment);

  if (selected === 0) actions.scrollTop = 0;
  else actions.children[selected]?.scrollIntoView({ block: "nearest" });

  updateFooter();
  updateScrollThumb();
}

async function loadStartApps() {
  try {
    const raw = await invoke("get_start_apps");
    const seen = new Set();
    startApps = raw
      .split(/\r?\n/)
      .map(line => line.split("\x1f"))
      .filter(parts => parts.length >= 2 && parts[0] && parts[1])
      .map(([name, id, icon, type]) => ({
        name: name.trim(),
        id: id.trim(),
        icon: icon?.trim() || "",
        type: type?.trim() || "Application"
      }))
      .filter(app => {
        const key = `${app.name}\x1f${app.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(app => ({ ...app, search: app.name.toLowerCase() }));
    render();
  } catch (error) {
    console.error(error);
  }
}

function normalizeHotkey(value) {
  return value.trim().replace(/\s+/g, "");
}

function hotkeyKey(event) {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return "";
  if (event.key === " ") return "Space";
  if (event.key.length === 1) return event.key.toUpperCase();
  return event.key;
}

function shortcutFromEvent(event) {
  const key = hotkeyKey(event);
  if (!key) return "";
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  return parts.join("+");
}

async function registerHotkey(hotkey, id, callback, failures, seen) {
  const normalized = normalizeHotkey(hotkey).toLowerCase();
  if (!normalized) return;
  if (seen.has(normalized)) {
    failures.set(id, "Hotkey is already in use by Hyperact");
    return;
  }
  seen.add(normalized);

  try {
    await globalShortcut.register(hotkey, event => {
      if (event.state === "Pressed") {
        if (pressedHotkeys.has(normalized)) return;
        pressedHotkeys.add(normalized);
        callback();
      } else if (event.state === "Released") {
        pressedHotkeys.delete(normalized);
      }
    });
    registeredHotkeys.push(hotkey);
  } catch (error) {
    failures.set(id, error?.message || String(error));
  }
}

async function refreshHotkeys() {
  const failures = new Map();
  if (!globalShortcut) return failures;

  for (const hotkey of registeredHotkeys) {
    try { await globalShortcut.unregister(hotkey); } catch {}
  }
  registeredHotkeys = [];
  pressedHotkeys.clear();

  const seen = new Set(reservedHotkeys);

  for (const command of commands) {
    const hotkey = normalizeHotkey(command.hotkey || "");
    if (!hotkey) continue;
    await registerHotkey(
      hotkey,
      command.id,
      () => runHotkeyCommand(command).catch(console.error),
      failures,
      seen
    );
  }

  for (const [key, pref] of Object.entries(preferences)) {
    if (!key.startsWith("app:") && !key.startsWith("system:")) continue;
    const hotkey = normalizeHotkey(pref.hotkey || "");
    if (!hotkey) continue;
    await registerHotkey(
      hotkey,
      key,
      () => launchConfiguredItem(key).catch(console.error),
      failures,
      seen
    );
  }

  return failures;
}

async function launchConfiguredItem(key) {
  if (key.startsWith("system:")) {
    await invoke("run_system_action", { action: key.slice(7) });
  } else if (key.startsWith("app:")) {
    await invoke("launch_start_app", { appId: key.slice(4) });
  }
}

function primaryMenuLabel(item) {
  if (item.commandMode === "input") return "Run";
  if (item.itemType === "app") return "Open";
  if (item.commandMode === "search") return "Use";
  return "Run";
}

function actionMenuOptions() {
  if (!menuState) return [];
  const target = menuState.item;
  const options = [{
    icon: "↵",
    title: primaryMenuLabel(target),
    detail: "Enter",
    run: () => {
      const runItem = target.run;
      closeActionMenu(false);
      runItem();
    }
  }];

  if (target.itemKey) {
    options.push(
      { icon: "⌨", title: "Set Hotkey", detail: hotkeyFor(target) || "None", run: () => beginMenuSetting("hotkey") },
      { icon: "@", title: "Set Alias", detail: aliasFor(target) || "None", run: () => beginMenuSetting("alias") }
    );
  }

  if (target.command) {
    options.push({
      icon: "⚙",
      title: "Edit Command",
      detail: "",
      run: () => {
        const id = target.command.id;
        closeActionMenu(false);
        openCommandEditor(id);
      }
    });
  }

  const query = actionMenuInput.value.trim().toLowerCase();
  if (!query || menuMode) return options;
  return options
    .map(option => ({ ...option, score: matchScore(`${option.title} ${option.detail}`.toLowerCase(), query) }))
    .filter(option => Number.isFinite(option.score))
    .sort((a, b) => a.score - b.score);
}

function createMenuRow(iconText, labelText, detailText = "", selectedRow = false) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `item-actions-row${selectedRow ? " selected" : ""}`;

  const icon = document.createElement("span");
  icon.className = "item-actions-icon";
  icon.textContent = iconText;
  const label = document.createElement("span");
  label.className = "item-actions-label";
  label.textContent = labelText;
  const detail = document.createElement("span");
  detail.className = "item-actions-detail";
  detail.textContent = detailText;
  row.append(icon, label, detail);
  return row;
}

function renderActionMenu() {
  if (!menuState) return;

  actionMenuTitle.textContent = menuMode === "alias"
    ? `Alias · ${menuState.item.title}`
    : menuMode === "hotkey"
      ? `Hotkey · ${menuState.item.title}`
      : menuState.item.title;

  if (menuMode === "alias") {
    actionMenuHint.textContent = "Enter to save";
    const row = createMenuRow("@", actionMenuInput.value.trim() ? "Save Alias" : "Clear Alias", "", true);
    row.addEventListener("click", saveAlias);
    actionMenuList.replaceChildren(row);
    return;
  }

  if (menuMode === "hotkey") {
    actionMenuHint.textContent = "Enter to save · Esc to cancel";
    const row = createMenuRow("⌨", pendingHotkey || "No hotkey", "Backspace clears", true);
    actionMenuList.replaceChildren(row);
    return;
  }

  actionMenuHint.textContent = "Ctrl K";
  const options = actionMenuOptions();
  menuSelected = Math.min(menuSelected, Math.max(0, options.length - 1));
  const fragment = document.createDocumentFragment();

  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "item-actions-hint";
    empty.style.padding = "12px 10px 16px";
    empty.textContent = "No actions";
    fragment.append(empty);
  } else {
    options.forEach((option, index) => {
      const row = createMenuRow(option.icon, option.title, option.detail, index === menuSelected);
      row.addEventListener("mouseenter", () => {
        menuSelected = index;
        renderActionMenu();
      });
      row.addEventListener("click", option.run);
      fragment.append(row);
    });
  }

  actionMenuList.replaceChildren(fragment);
}

function openActionMenu(item) {
  if (!item) return;
  if (menuState) closeActionMenu(false);
  menuState = { item: { ...item } };
  menuMode = "";
  menuSelected = 0;
  pendingHotkey = "";
  originalHotkey = "";
  actionMenuInput.readOnly = false;
  actionMenuInput.value = "";
  actionMenuInput.placeholder = "Search for actions…";
  actionMenu.hidden = false;
  renderActionMenu();
  updateFooter();
  actionMenuInput.focus();
}

function closeActionMenu(focusMain = true) {
  if (!menuState) return;
  const restoreHotkeys = menuMode === "hotkey";
  menuState = null;
  menuMode = "";
  menuSelected = 0;
  pendingHotkey = "";
  originalHotkey = "";
  actionMenuInput.readOnly = false;
  actionMenuInput.value = "";
  actionMenu.hidden = true;
  if (restoreHotkeys) refreshHotkeys().catch(console.error);
  updateFooter();
  if (focusMain) input.focus();
}

function returnToActionMenu() {
  menuMode = "";
  menuSelected = 0;
  pendingHotkey = "";
  originalHotkey = "";
  actionMenuInput.readOnly = false;
  actionMenuInput.value = "";
  actionMenuInput.placeholder = "Search for actions…";
  renderActionMenu();
  updateFooter();
  actionMenuInput.focus();
}

async function beginMenuSetting(mode) {
  if (!menuState?.item) return;
  menuMode = mode;
  menuSelected = 0;

  if (mode === "alias") {
    actionMenuInput.readOnly = false;
    actionMenuInput.value = aliasFor(menuState.item);
    actionMenuInput.placeholder = "Type alias…";
    renderActionMenu();
    updateFooter();
    actionMenuInput.focus();
    actionMenuInput.select();
    return;
  }

  originalHotkey = hotkeyFor(menuState.item);
  pendingHotkey = originalHotkey;
  actionMenuInput.readOnly = true;
  actionMenuInput.value = pendingHotkey;
  actionMenuInput.placeholder = "Press shortcut…";
  if (originalHotkey) {
    try { await globalShortcut.unregister(originalHotkey); } catch {}
  }
  renderActionMenu();
  updateFooter();
  actionMenuInput.focus();
}

function saveAlias() {
  if (!menuState?.item?.itemKey) return;
  setPreference(menuState.item.itemKey, "alias", actionMenuInput.value.trim());
  render();
  returnToActionMenu();
}

async function setItemHotkey(target, hotkey) {
  const previous = hotkeyFor(target);
  const failureKey = target.command ? target.command.id : target.itemKey;

  if (target.command) {
    commands = commands.map(command => command.id === target.command.id ? { ...command, hotkey } : command);
    target.command.hotkey = hotkey;
    persistCommands();
  } else {
    setPreference(target.itemKey, "hotkey", hotkey);
  }

  const failures = await refreshHotkeys();
  if (!failures.has(failureKey)) return true;

  if (target.command) {
    commands = commands.map(command => command.id === target.command.id ? { ...command, hotkey: previous } : command);
    target.command.hotkey = previous;
    persistCommands();
  } else {
    setPreference(target.itemKey, "hotkey", previous);
  }
  await refreshHotkeys();
  return false;
}

async function commitPendingHotkey() {
  if (!menuState?.item || menuMode !== "hotkey") return;
  const candidate = pendingHotkey;
  if (candidate && reservedHotkeys.has(candidate.toLowerCase())) {
    actionMenuHint.textContent = "Reserved by Hyperact";
    return;
  }

  const success = await setItemHotkey(menuState.item, candidate);
  if (!success) {
    actionMenuHint.textContent = "Already in use";
    if (originalHotkey) {
      try { await globalShortcut.unregister(originalHotkey); } catch {}
    }
    actionMenuInput.focus();
    return;
  }

  render();
  returnToActionMenu();
}

function cancelHotkeySetting() {
  refreshHotkeys().catch(console.error);
  returnToActionMenu();
}

function updateFooter() {
  if (footer.hidden || !commandEditor.hidden) return;

  if (menuState) {
    if (menuMode === "hotkey") {
      footer.replaceChildren(footerPart("↵", "save"), footerPart("⌫", "clear"), footerPart("esc", "cancel"));
    } else if (menuMode === "alias") {
      footer.replaceChildren(footerPart("↵", "save"), footerPart("esc", "back"));
    } else {
      footer.replaceChildren(footerPart("↵", "select"), footerPart("esc", "close actions"));
    }
    return;
  }

  if (activeCommand && promptTarget === null) {
    footer.replaceChildren(
      footerPart("↵", "run"),
      footerPart("⇧↵", "again"),
      footerPart("Ctrl K", "actions"),
      footerPart("esc", "back")
    );
    return;
  }

  const item = items[selected];
  if (item) {
    footer.replaceChildren(
      footerPart("↑↓", "navigate"),
      footerPart("↵", item.commandMode === "search" ? "use" : "run"),
      footerPart("Ctrl K", "actions"),
      footerPart("esc", "back")
    );
  }
}

function footerPart(keys, label) {
  const part = document.createElement("span");
  const key = document.createElement("kbd");
  key.textContent = keys;
  part.append(key, document.createTextNode(` ${label}`));
  return part;
}

function updateScrollThumb() {
  if (actions.hidden || actions.scrollHeight <= actions.clientHeight) {
    scrollThumb.hidden = true;
    return;
  }

  scrollThumb.hidden = false;
  const inset = 5;
  const trackHeight = actions.clientHeight - inset * 2;
  const height = Math.max(24, trackHeight * actions.clientHeight / actions.scrollHeight);
  const maxScroll = actions.scrollHeight - actions.clientHeight;
  const travel = trackHeight - height;
  const y = maxScroll ? travel * actions.scrollTop / maxScroll : 0;
  scrollThumb.style.height = `${height}px`;
  scrollThumb.style.top = `${actions.offsetTop + inset + y}px`;
}

function showScrollThumb() {
  updateScrollThumb();
  if (scrollThumb.hidden) return;
  scrollThumb.classList.add("visible");
  clearTimeout(scrollFadeTimer);
  scrollFadeTimer = setTimeout(() => scrollThumb.classList.remove("visible"), 650);
}

function choiceValue(group) {
  return group.dataset.value;
}

function setChoice(group, value) {
  group.dataset.value = value;
  for (const button of group.querySelectorAll("button[data-value]")) {
    button.classList.toggle("selected", button.dataset.value === value);
  }
}

function setCommandStatus(message = "", type = "") {
  clearTimeout(editorStatusTimer);
  commandStatus.textContent = message;
  commandStatus.className = `command-status${type ? ` ${type}` : ""}`;
  if (message && type === "success") {
    editorStatusTimer = setTimeout(() => setCommandStatus(), 1400);
  }
}

function populateCommandList(selectedId = editingCommandId) {
  const fragment = document.createDocumentFragment();

  if (!commands.length) {
    const empty = document.createElement("div");
    empty.className = "command-list-empty";
    empty.textContent = "No commands yet";
    commandList.replaceChildren(empty);
    return;
  }

  for (const command of commands) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `command-list-item${command.id === selectedId ? " selected" : ""}`;

    const icon = document.createElement("span");
    icon.className = "command-list-icon";
    icon.textContent = "N";
    const copy = document.createElement("span");
    copy.className = "command-list-copy";
    const name = document.createElement("div");
    name.className = "command-list-name";
    name.textContent = command.name;
    copy.append(name);

    if (command.hotkey) {
      const hotkey = document.createElement("div");
      hotkey.className = "command-list-hotkey";
      hotkey.textContent = command.hotkey;
      copy.append(hotkey);
    }

    row.append(icon, copy);
    row.addEventListener("click", () => loadEditorCommand(command.id));
    fragment.append(row);
  }

  commandList.replaceChildren(fragment);
}

function loadEditorCommand(id) {
  const command = commands.find(item => item.id === id);
  editingCommandId = command?.id || "";
  commandName.value = command?.name || "";
  commandMatch.value = command?.match || "";
  commandHotkey.value = command?.hotkey || "";
  setChoice(commandInputMode, command?.inputMode === "selected" ? "selected" : "focused");
  setChoice(commandMissingInput, command?.missingInput === "nothing" ? "nothing" : "prompt");
  setChoice(commandOutputMode, command?.outputMode === "paste" ? "paste" : "type");
  commandCode.value = command?.code || "return input;";
  commandDelete.hidden = !command;
  setCommandStatus();
  populateCommandList(editingCommandId);
  commandName.focus();
  commandName.select();
  window.hyperactCommandLoaded?.();
}

function openCommandEditor(id = "") {
  deferredRun++;
  closeActionMenu(false);
  clearPromptState();
  input.value = "Commands";
  input.placeholder = "Commands";
  input.disabled = true;
  kind.textContent = "";
  kind.classList.remove("visible");
  actions.hidden = true;
  footer.hidden = true;
  commandEditor.hidden = false;
  palette.classList.add("command-mode");
  loadEditorCommand(id || commands[0]?.id || "");
  window.hyperactEditorVisibilityChanged?.(true);
}

function closeCommandEditor() {
  commandEditor.hidden = true;
  actions.hidden = false;
  footer.hidden = false;
  palette.classList.remove("command-mode");
  input.disabled = false;
  input.value = "";
  input.placeholder = defaultPlaceholder;
  selected = 0;
  editingCommandId = "";
  setCommandStatus();
  render();
  input.focus();
  window.hyperactEditorVisibilityChanged?.(false);
}

async function saveEditorCommand() {
  const name = commandName.value.trim();
  const code = commandCode.value.trim();
  const hotkey = normalizeHotkey(commandHotkey.value);
  const match = commandMatch.value.trim();
  const inputMode = choiceValue(commandInputMode) === "selected" ? "selected" : "focused";
  const missingInput = choiceValue(commandMissingInput) === "nothing" ? "nothing" : "prompt";
  const outputMode = choiceValue(commandOutputMode) === "paste" ? "paste" : "type";

  if (!name) {
    setCommandStatus("Give the command a name", "error");
    commandName.focus();
    return;
  }
  if (!code) {
    setCommandStatus("Add Node.js code", "error");
    commandCode.focus();
    return;
  }
  if (match) {
    try { new RegExp(match); }
    catch {
      setCommandStatus("Input pattern is not a valid regular expression", "error");
      commandMatch.focus();
      return;
    }
  }

  const existing = commands.find(command => command.id === editingCommandId);
  const id = existing?.id || crypto.randomUUID();
  const next = { id, name, hotkey, match, inputMode, missingInput, outputMode, code };
  if (existing) commands = commands.map(command => command.id === id ? next : command);
  else commands.push(next);

  editingCommandId = id;
  persistCommands();
  populateCommandList(id);
  commandDelete.hidden = false;

  const failures = await refreshHotkeys();
  if (failures.has(id)) {
    setCommandStatus(`Saved · hotkey failed: ${failures.get(id)}`, "error");
    return;
  }
  setCommandStatus("Saved", "success");
}

async function deleteEditorCommand() {
  if (!editingCommandId) return;
  const index = commands.findIndex(command => command.id === editingCommandId);
  if (index < 0) return;

  commands.splice(index, 1);
  persistCommands();
  await refreshHotkeys();
  const next = commands[Math.min(index, commands.length - 1)];
  loadEditorCommand(next?.id || "");
}

function scheduleBlurHide() {
  clearTimeout(blurTimer);
  blurTimer = setTimeout(async () => {
    try {
      if (await currentWindow.isFocused()) return;
    } catch {}
    closeActionMenu(false);
    hideLauncher().catch(console.error);
  }, 70);
}

input.addEventListener("input", () => {
  selected = 0;
  commandError = "";
  render();
});

actions.addEventListener("scroll", showScrollThumb, { passive: true });
window.addEventListener("resize", updateScrollThumb);

for (const group of [commandInputMode, commandMissingInput, commandOutputMode]) {
  group.addEventListener("click", event => {
    const button = event.target.closest("button[data-value]");
    if (button) setChoice(group, button.dataset.value);
  });
}

commandNew.addEventListener("click", () => loadEditorCommand(""));
commandCancel.addEventListener("click", closeCommandEditor);
commandSave.addEventListener("click", () => saveEditorCommand().catch(console.error));
commandDelete.addEventListener("click", () => deleteEditorCommand().catch(console.error));

commandHotkey.addEventListener("focus", () => {
  editorHotkeyOriginal = commandHotkey.value;
  if (editorHotkeyOriginal) globalShortcut.unregister(editorHotkeyOriginal).catch(() => {});
});

commandHotkey.addEventListener("blur", () => {
  refreshHotkeys().catch(console.error);
});

commandHotkey.addEventListener("keydown", event => {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    commandHotkey.value = editorHotkeyOriginal;
    commandHotkey.blur();
    return;
  }
  if (event.key === "Enter") {
    commandHotkey.blur();
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    commandHotkey.value = "";
    return;
  }

  const hotkey = shortcutFromEvent(event);
  if (hotkey && !reservedHotkeys.has(hotkey.toLowerCase())) commandHotkey.value = hotkey;
});

actionMenuInput.addEventListener("input", () => {
  menuSelected = 0;
  renderActionMenu();
});

actionMenuInput.addEventListener("keydown", event => {
  if (!menuState) return;

  if (menuMode === "hotkey") {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      cancelHotkeySetting();
      return;
    }
    if (event.key === "Enter") {
      commitPendingHotkey().catch(console.error);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      pendingHotkey = "";
      actionMenuInput.value = "";
      renderActionMenu();
      return;
    }

    const hotkey = shortcutFromEvent(event);
    if (!hotkey) return;
    if (reservedHotkeys.has(hotkey.toLowerCase())) {
      actionMenuHint.textContent = "Reserved by Hyperact";
      return;
    }
    pendingHotkey = hotkey;
    actionMenuInput.value = hotkey;
    renderActionMenu();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (menuMode === "alias") returnToActionMenu();
    else closeActionMenu(true);
    return;
  }

  if (menuMode === "alias" && event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    saveAlias();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    const count = actionMenuOptions().length;
    if (!count) return;
    menuSelected = (menuSelected + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
    renderActionMenu();
    actionMenuList.children[menuSelected]?.scrollIntoView({ block: "nearest" });
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    actionMenuOptions()[menuSelected]?.run();
  }
});

document.addEventListener("mousedown", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (menuState && !actionMenu.contains(target)) closeActionMenu(false);
  if (event.button !== 0) return;

  const noDrag = "input, textarea, button, select, option, a, label, pre, [contenteditable='true'], .command-resizer, .item-actions-popover";
  if (!target.closest(noDrag)) currentWindow.startDragging().catch(console.error);
}, true);

document.addEventListener("keydown", event => {
  if (!commandEditor.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandEditor();
    } else if (event.key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      saveEditorCommand().catch(console.error);
    } else if (event.key.toLowerCase() === "n" && event.ctrlKey) {
      event.preventDefault();
      loadEditorCommand("");
    }
    return;
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (menuState) closeActionMenu(true);
    else if (items[selected]) openActionMenu(items[selected]);
    return;
  }

  if (promptLocked && !["Control", "Shift", "Alt", "Meta", "Escape"].includes(event.key)) {
    event.preventDefault();
    return;
  }

  if (event.key === "Enter" && activeCommand && promptTarget !== null) {
    event.preventDefault();
    runPromptCommand(event.shiftKey).catch(console.error);
  } else if (event.key === "Enter" && event.shiftKey && activeCommand) {
    event.preventDefault();
    runCommandMode(true).catch(console.error);
  } else if (event.key === "ArrowDown" && items.length) {
    event.preventDefault();
    selectItem(selected + 1);
  } else if (event.key === "ArrowUp" && items.length) {
    event.preventDefault();
    selectItem(selected - 1);
  } else if (event.key === "Enter" && items.length) {
    event.preventDefault();
    run();
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (promptTarget !== null) {
      deferredRun++;
      clearPromptState();
      render();
      input.focus();
    } else if (activeCommand) {
      exitCommandMode();
    } else if (input.value) {
      setInput("");
    } else {
      hideLauncher().catch(console.error);
    }
  }
});

currentWindow.onFocusChanged(({ payload: focused }) => {
  clearTimeout(blurTimer);
  if (!focused) scheduleBlurHide();
});

window.addEventListener("blur", scheduleBlurHide);
window.addEventListener("focus", () => {
  clearTimeout(blurTimer);
  if (!commandEditor.hidden) return;
  if (menuState) actionMenuInput.focus();
  else {
    input.focus();
    input.select();
  }
});

input.focus();
render();
loadStartApps();
refreshHotkeys().catch(console.error);
