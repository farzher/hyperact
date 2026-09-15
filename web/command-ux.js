(() => {
  const commandMatch = document.createElement("input");
  commandMatch.id = "command-match";
  commandMatch.className = "command-hotkey command-match";
  commandMatch.type = "text";
  commandMatch.autocomplete = "off";
  commandMatch.spellcheck = false;
  commandMatch.placeholder = "Input pattern (regex)";
  commandMatch.title = "Optional JavaScript regular expression. Matching launcher text can run this command directly.";
  commandHotkey.before(commandMatch);

  const style = document.createElement("style");
  style.textContent = `
    .command-match {
      width: 210px;
      flex: 0 1 210px;
      text-align: left;
    }

    .action-edit {
      flex: 0 0 auto;
      margin-left: 2px;
      padding: 4px 6px;
      border-radius: 5px;
      color: #777780;
      font-size: 10.5px;
      font-weight: 520;
      opacity: 0;
    }

    .action:hover .action-edit,
    .action.selected .action-edit {
      opacity: 1;
    }

    .action-edit:hover {
      background: rgba(255, 255, 255, 0.07);
      color: #c7c7cd;
    }
  `;
  document.head.append(style);

  let commandSearchQuery = "";

  try {
    const raw = JSON.parse(localStorage.getItem(commandStorageKey) || "[]");
    const patterns = new Map(
      Array.isArray(raw)
        ? raw.filter(command => command?.id).map(command => [command.id, command.match || ""])
        : []
    );
    commands = commands.map(command => ({
      ...command,
      match: patterns.get(command.id) || ""
    }));
  } catch {
    commands = commands.map(command => ({ ...command, match: "" }));
  }

  function inputMatches(command, value) {
    if (!command.match) return false;
    try {
      return new RegExp(command.match).test(value);
    } catch {
      return false;
    }
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

  function commandResult(command, score, mode, value) {
    const direct = mode === "input";
    return {
      icon: "N",
      title: command.name,
      detail: command.hotkey || "",
      category: direct ? "Text Action" : "Command",
      score,
      command,
      commandMode: mode,
      run: () => direct ? runCommand(command, value) : enterCommandMode(command)
    };
  }

  buildActions = function (value) {
    const query = value.trim();

    if (activeCommand) {
      return [{
        icon: "N",
        title: `Run ${activeCommand.name}`,
        detail: commandError || (promptTarget !== null
          ? "Enter submit · Shift+Enter run again"
          : "Enter run · Shift+Enter run again"),
        category: "Command",
        score: 0,
        command: activeCommand,
        commandMode: "active",
        run: () => promptTarget !== null
          ? runPromptCommand(false)
          : runCommandMode(false)
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
      if (inputMatches(command, value)) {
        matches.push(commandResult(command, 0.02, "input", value));
        continue;
      }

      const score = matchScore(command.name, query);
      if (Number.isFinite(score)) {
        matches.push(commandResult(command, score + 0.05, "search", value));
      }
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
  };

  const baseLoadEditorCommand = loadEditorCommand;
  loadEditorCommand = function (id) {
    baseLoadEditorCommand(id);
    commandMatch.value = commands.find(command => command.id === id)?.match || "";
  };

  saveEditorCommand = async function () {
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
      try {
        new RegExp(match);
      } catch {
        setCommandStatus("Input pattern is not a valid regular expression", "error");
        commandMatch.focus();
        return;
      }
    }

    const existing = commands.find(command => command.id === editingCommandId);
    const id = existing?.id || crypto.randomUUID();
    const next = { id, name, hotkey, match, inputMode, missingInput, outputMode, code };

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
  };

  function footerPart(keys, label) {
    const part = document.createElement("span");
    const key = document.createElement("kbd");
    key.textContent = keys;
    part.append(key, document.createTextNode(` ${label}`));
    return part;
  }

  function updateFooter() {
    if (footer.hidden || !commandEditor.hidden) return;

    if (activeCommand && promptTarget === null) {
      footer.replaceChildren(
        footerPart("↵", "run"),
        footerPart("⇧↵", "again"),
        footerPart("Ctrl E", "edit"),
        footerPart("esc", "back")
      );
      return;
    }

    const item = items[selected];
    if (item?.command) {
      footer.replaceChildren(
        footerPart("↵", item.commandMode === "input" ? "run" : "use"),
        footerPart("Ctrl E", "edit"),
        footerPart("esc", "back")
      );
      return;
    }

    const navigate = document.createElement("span");
    const up = document.createElement("kbd");
    const down = document.createElement("kbd");
    up.textContent = "↑";
    down.textContent = "↓";
    navigate.append(up, down, document.createTextNode(" navigate"));
    footer.replaceChildren(
      navigate,
      footerPart("↵", "run"),
      footerPart("esc", "back")
    );
  }

  const baseRender = render;
  render = function () {
    baseRender();
    if (!commandEditor.hidden) return;

    items.forEach((item, index) => {
      if (!item.command) return;
      const row = actions.children[index];
      if (!row) return;

      const edit = document.createElement("span");
      edit.className = "action-edit";
      edit.textContent = "Edit";
      edit.title = "Edit command (Ctrl+E)";
      edit.addEventListener("mousedown", event => event.stopPropagation());
      edit.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        commandSearchQuery = "";
        openCommandEditor(item.command.id);
      });
      row.append(edit);
    });

    updateFooter();
  };

  const baseSelectItem = selectItem;
  selectItem = function (index) {
    baseSelectItem(index);
    updateFooter();
  };

  document.addEventListener("keydown", event => {
    if (!commandEditor.hidden) return;

    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "e") {
      const command = activeCommand && promptTarget === null
        ? activeCommand
        : items[selected]?.command;
      if (!command) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      commandSearchQuery = "";
      openCommandEditor(command.id);
      return;
    }

    if (!activeCommand || promptTarget !== null) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      exitCommandMode();
    } else if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      runCommandMode(true).catch(console.error);
    }
  }, true);

  render();
})();
