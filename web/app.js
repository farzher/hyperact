const palette = document.querySelector(".palette");
const input = document.querySelector("#input");
const actions = document.querySelector("#actions");
const kind = document.querySelector("#kind");
const footer = document.querySelector("#footer");
const dragHandle = document.querySelector("#drag-handle");
const commandEditor = document.querySelector("#command-editor");
const commandList = document.querySelector("#command-list");
const commandNew = document.querySelector("#command-new");
const commandName = document.querySelector("#command-name");
const commandHotkey = document.querySelector("#command-hotkey");
const commandInputMode = document.querySelector("#command-input-mode");
const commandMissingInput = document.querySelector("#command-missing-input");
const commandOutputMode = document.querySelector("#command-output-mode");
const commandCode = document.querySelector("#command-code");
const commandStatus = document.querySelector("#command-status");
const commandDelete = document.querySelector("#command-delete");
const commandCancel = document.querySelector("#command-cancel");
const commandSave = document.querySelector("#command-save");
const { invoke } = window.__TAURI__.core;
const currentWindow = window.__TAURI__.window.getCurrentWindow();
const globalShortcut = window.__TAURI__.globalShortcut;
const defaultPlaceholder = "Search apps and actions…";
const commandStorageKey = "hyperact.commands";

let items = [];
let selected = 0;
let startApps = [];
let commands = loadCommands();
let activeCommand = null;
let commandError = "";
let registeredCommandHotkeys = [];
let promptTarget = null;
let promptSelectAll = false;
let editingCommandId = "";
let editorStatusTimer;

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
];

function loadCommands() {
  try {
    const saved = JSON.parse(localStorage.getItem(commandStorageKey) || "[]");
    if (!Array.isArray(saved)) return [];

    return saved
      .filter(command => command && command.id && command.name && typeof command.code === "string")
      .map(({
        id,
        name,
        hotkey = "",
        inputMode = "focused",
        missingInput = "prompt",
        outputMode = "type",
        code
      }) => ({
        id,
        name,
        hotkey,
        inputMode: inputMode === "selected" ? "selected" : "focused",
        missingInput: missingInput === "nothing" ? "nothing" : "prompt",
        outputMode: outputMode === "paste" ? "paste" : "type",
        code
      }));
  } catch {
    return [];
  }
}

function persistCommands() {
  localStorage.setItem(commandStorageKey, JSON.stringify(commands));
}

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

function nativeCategory(item) {
  if (item.detail === "Settings") return "Windows Settings";
  if (item.detail === "Folder") return "Folder";
  if (item.detail === "File Explorer") return "File Explorer";
  if (item.id === "control-panel") return "Control Panel";
  if (["explorer", "terminal", "task-manager"].includes(item.id)) return "Application";
  if (item.id === "settings") return "Windows Settings";
  return "Windows";
}

function nativeItem(item, score = 0) {
  return {
    ...item,
    detail: "",
    category: nativeCategory(item),
    score,
    run: () => runNative("run_system_action", { action: item.id })
  };
}

function appItem(app, score) {
  return {
    icon: app.name.trim().charAt(0).toUpperCase() || "A",
    image: app.icon,
    title: app.name,
    detail: "",
    category: app.type || "Application",
    score,
    run: () => runNative("launch_start_app", { appId: app.id })
  };
}

function commandItem(command, score = 8) {
  return {
    icon: "N",
    title: command.name,
    detail: command.hotkey || "",
    category: "Command",
    score,
    run: () => runCommand(command, input.value)
  };
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

function buildActions(value) {
  const query = value.trim();

  if (activeCommand) {
    return [{
      icon: "N",
      title: `Run ${activeCommand.name}`,
      detail: commandError || (promptTarget !== null ? "Enter submit · Shift+Enter run again" : "Node.js command"),
      category: "Command",
      score: 0,
      run: () => promptTarget !== null
        ? runPromptCommand(false)
        : runCommand(activeCommand, value)
    }];
  }

  if (!query) {
    return [
      ...systemActions.filter(item => item.default).map(nativeItem),
      manageCommandsItem()
    ];
  }

  const result = [];

  if (windowsPath(value)) {
    const path = toWslPath(value);
    result.push(
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

  for (const command of commands) {
    const score = matchScore(command.name, query);
    matches.push(commandItem(command, Number.isFinite(score) ? score + 0.05 : 8));
  }

  const commandManagerScore = matchScore("commands add command edit command custom automation", query);
  if (Number.isFinite(commandManagerScore)) matches.push(manageCommandsItem(commandManagerScore));

  matches.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
  result.push(...matches);

  result.push(
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
  );

  return result;
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

async function runCommand(command, value) {
  commandError = "";

  try {
    const output = await invoke("run_node_command", { code: command.code, input: value });
    activeCommand = null;
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
    promptTarget = null;
    promptSelectAll = false;
    activeCommand = null;
    input.value = "";
    input.placeholder = defaultPlaceholder;
    selected = 0;
    render();

    await hideLauncher();
    await invoke("submit_prompt_result", {
      target,
      output,
      outputMode: command.outputMode,
      selectAll
    });
  } catch (error) {
    commandError = error?.message || String(error);
    render();
  }
}

async function openPromptMode(command, target, selectAll) {
  if (!commandEditor.hidden) closeCommandEditor();

  activeCommand = command;
  promptTarget = target;
  promptSelectAll = selectAll;
  commandError = "";
  input.disabled = false;
  input.value = "";
  input.placeholder = `${command.name} input…`;
  selected = 0;
  render();

  await currentWindow.show();
  await currentWindow.setFocus();
  input.focus();
}

async function runHotkeyCommand(command) {
  try {
    const prompt = await invoke("run_hotkey_command", {
      code: command.code,
      inputMode: command.inputMode,
      missingInput: command.missingInput,
      outputMode: command.outputMode
    });

    if (Array.isArray(prompt) && prompt.length >= 2) {
      await openPromptMode(command, prompt[0], Boolean(prompt[1]));
    }
  } catch (error) {
    console.error(error);
  }
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

function selectItem(index) {
  if (!items.length) return;

  const next = (index + items.length) % items.length;
  const previousRow = actions.children[selected];
  if (previousRow) {
    previousRow.classList.remove("selected");
    previousRow.setAttribute("aria-selected", "false");
  }

  selected = next;
  const row = actions.children[selected];
  if (row) {
    row.classList.add("selected");
    row.setAttribute("aria-selected", "true");
    row.scrollIntoView({ block: "nearest" });
  }
}

function render() {
  if (!commandEditor.hidden) return;

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

    const title = document.createElement("span");
    title.className = "action-title";
    title.textContent = item.title;
    copy.append(title);

    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "action-detail";
      detail.textContent = item.detail;
      copy.append(detail);
    }

    const category = document.createElement("span");
    category.className = "action-category";
    category.textContent = item.category || "Action";

    row.append(icon, copy, category);
    row.addEventListener("mouseenter", () => {
      if (selected !== index) selectItem(index);
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
      .map(([name, id, icon, type]) => ({
        name: name.trim(),
        id: id.trim(),
        icon: icon?.trim() || "",
        type: type?.trim() || "Application"
      }));
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

async function refreshCommandHotkeys() {
  const failures = new Map();
  if (!globalShortcut) return failures;

  for (const hotkey of registeredCommandHotkeys) {
    try {
      await globalShortcut.unregister(hotkey);
    } catch {}
  }

  registeredCommandHotkeys = [];
  const seen = new Set(["alt+space"]);

  for (const command of commands) {
    const hotkey = normalizeHotkey(command.hotkey || "");
    if (!hotkey) continue;

    const key = hotkey.toLowerCase();
    if (seen.has(key)) {
      failures.set(command.id, "Hotkey is already in use by Hyperact");
      continue;
    }
    seen.add(key);

    try {
      await globalShortcut.register(hotkey, event => {
        if (event.state === "Released") runHotkeyCommand(command).catch(console.error);
      });
      registeredCommandHotkeys.push(hotkey);
    } catch (error) {
      failures.set(command.id, error?.message || String(error));
    }
  }

  return failures;
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
  commandList.replaceChildren();

  if (!commands.length) {
    const empty = document.createElement("div");
    empty.className = "command-list-empty";
    empty.textContent = "No commands yet";
    commandList.append(empty);
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
    commandList.append(row);
  }
}

function loadEditorCommand(id) {
  const command = commands.find(item => item.id === id);
  editingCommandId = command?.id || "";
  commandName.value = command?.name || "";
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
}

function openCommandEditor(id = "") {
  activeCommand = null;
  promptTarget = null;
  promptSelectAll = false;
  commandError = "";
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
}

async function saveEditorCommand() {
  const name = commandName.value.trim();
  const code = commandCode.value.trim();
  const hotkey = normalizeHotkey(commandHotkey.value);
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

  const existing = commands.find(command => command.id === editingCommandId);
  const id = existing?.id || crypto.randomUUID();
  const next = { id, name, hotkey, inputMode, missingInput, outputMode, code };

  if (existing) {
    commands = commands.map(command => command.id === id ? next : command);
  } else {
    commands.push(next);
  }

  editingCommandId = id;
  persistCommands();
  populateCommandList(id);
  commandDelete.hidden = false;

  const failures = await refreshCommandHotkeys();
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
  await refreshCommandHotkeys();

  const next = commands[Math.min(index, commands.length - 1)];
  loadEditorCommand(next?.id || "");
}

input.addEventListener("input", () => {
  selected = 0;
  commandError = "";
  render();
});

dragHandle.addEventListener("mousedown", event => {
  if (event.button === 0) currentWindow.startDragging();
});

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
commandHotkey.addEventListener("keydown", event => {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Backspace" || event.key === "Delete") {
    commandHotkey.value = "";
    return;
  }

  if (event.key === "Escape") {
    commandHotkey.blur();
    return;
  }

  const key = hotkeyKey(event);
  if (!key) return;

  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(key);
  commandHotkey.value = parts.join("+");
  commandHotkey.blur();
});

window.addEventListener("focus", () => {
  if (commandEditor.hidden) {
    input.focus();
    input.select();
  }
});

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

  if (event.key === "Enter" && activeCommand && promptTarget !== null) {
    event.preventDefault();
    runPromptCommand(event.shiftKey).catch(console.error);
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
      promptTarget = null;
      promptSelectAll = false;
      activeCommand = null;
      commandError = "";
      input.value = "";
      input.placeholder = defaultPlaceholder;
      selected = 0;
      render();
      input.focus();
    } else if (activeCommand) {
      activeCommand = null;
      commandError = "";
      input.value = "";
      input.placeholder = defaultPlaceholder;
      render();
    } else if (input.value) {
      setInput("");
    } else {
      hideLauncher().catch(console.error);
    }
  }
});

input.focus();
render();
loadStartApps();
refreshCommandHotkeys().catch(console.error);
