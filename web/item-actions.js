(() => {
  const preferencesKey = "hyperact.itemPreferences";
  const reservedHotkeys = new Set(["alt+space", "ctrl+k"]);
  const registeredItemHotkeys = [];
  const pressedItemHotkeys = new Set();
  let preferences = loadPreferences();
  let menuState = null;
  let settingMode = "";
  let menuQuery = "";
  let appHotkeysRefreshed = false;

  const style = document.createElement("style");
  style.textContent = `.action-edit { display: none !important; }`;
  document.head.append(style);

  function loadPreferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(preferencesKey) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }

  function savePreferences() {
    localStorage.setItem(preferencesKey, JSON.stringify(preferences));
  }

  function preference(key) {
    return preferences[key] || {};
  }

  function setPreference(key, field, value) {
    const next = { ...preference(key), [field]: value };
    if (!next.alias && !next.hotkey) delete preferences[key];
    else preferences[key] = next;
    savePreferences();
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

  const baseNativeItem = nativeItem;
  nativeItem = function (item, score = 0) {
    return {
      ...baseNativeItem(item, score),
      itemKey: systemKey(item),
      itemType: "system",
      itemSource: item
    };
  };

  const baseAppItem = appItem;
  appItem = function (app, score) {
    return {
      ...baseAppItem(app, score),
      itemKey: appKey(app),
      itemType: "app",
      itemSource: app
    };
  };

  function annotate(item) {
    if (item?.command) {
      item.itemKey = commandKey(item.command);
      item.itemType = "command";
      item.itemSource = item.command;
    }
    return item;
  }

  function useCommandByName(command) {
    const originalMatch = command.match;
    const current = input.value;
    command.match = "";
    try {
      const result = baseBuildActions(command.name)
        .map(annotate)
        .find(item => item.command?.id === command.id && item.commandMode === "search");
      if (result) {
        input.value = current;
        result.run();
      }
    } finally {
      command.match = originalMatch;
    }
  }

  function genericCommandResult(command, value) {
    return {
      icon: "N",
      title: command.name,
      detail: command.hotkey || "",
      category: "Text Action",
      score: 8,
      command,
      commandMode: "input",
      itemKey: commandKey(command),
      itemType: "command",
      itemSource: command,
      run: () => runCommand(command, value)
    };
  }

  function aliasCommandResult(command, score) {
    return {
      icon: "N",
      title: command.name,
      detail: command.hotkey || "",
      category: "Command",
      score,
      command,
      commandMode: "search",
      itemKey: commandKey(command),
      itemType: "command",
      itemSource: command,
      run: () => useCommandByName(command)
    };
  }

  function menuAction(title, detail, run, score = 0) {
    return {
      icon: "›",
      title,
      detail,
      category: "Action",
      score,
      menuAction: true,
      run
    };
  }

  function buildMenuActions(value) {
    const target = menuState.item;
    const query = value.trim();
    const options = [
      menuAction(target.commandMode === "input" ? "Run" : "Open", "", () => {
        const run = target.run;
        closeMenu(false);
        run();
      }, 0)
    ];

    if (target.itemKey) {
      options.push(
        menuAction("Set hotkey", hotkeyFor(target) || "None", () => beginSetting("hotkey"), 1),
        menuAction("Set alias", aliasFor(target) || "None", () => beginSetting("alias"), 2)
      );
    }

    if (target.command) {
      options.push(menuAction("Edit command", "", () => {
        const id = target.command.id;
        closeMenu(false);
        openCommandEditor(id);
      }, 3));
    }

    if (!query) return options;
    return options
      .map(item => ({ ...item, score: matchScore(`${item.title} ${item.detail}`, query) }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => a.score - b.score);
  }

  function buildSettingActions(value) {
    if (settingMode === "alias") {
      return [menuAction("Save alias", value.trim() || "Clear alias", () => saveAlias(), 0)];
    }
    return [menuAction("Press a shortcut", "Backspace clears · Esc cancels", () => {}, 0)];
  }

  const baseBuildActions = buildActions;
  buildActions = function (value) {
    if (menuState) {
      return settingMode ? buildSettingActions(value) : buildMenuActions(value);
    }

    const query = value.trim();
    const result = baseBuildActions(value).map(annotate);
    if (!query || activeCommand) return result;

    const present = new Set(result.map(item => item.itemKey).filter(Boolean));

    for (const command of commands) {
      const nameScore = matchScore(command.name, query);
      const alias = preference(commandKey(command)).alias || "";
      const aliasScore = alias ? matchScore(alias, query) : Infinity;

      if (!present.has(commandKey(command)) && Number.isFinite(aliasScore)) {
        result.push(aliasCommandResult(command, aliasScore + 0.04));
        present.add(commandKey(command));
        continue;
      }

      if (!present.has(commandKey(command)) && !command.match && !Number.isFinite(nameScore)) {
        result.push(genericCommandResult(command, value));
        present.add(commandKey(command));
      }
    }

    for (const item of systemActions) {
      const key = systemKey(item);
      const alias = preference(key).alias || "";
      if (!alias || present.has(key)) continue;
      const score = matchScore(alias, query);
      if (Number.isFinite(score)) result.push(nativeItem(item, score + 0.03));
    }

    for (const app of startApps) {
      const key = appKey(app);
      const alias = preference(key).alias || "";
      if (!alias || present.has(key)) continue;
      const score = matchScore(alias, query);
      if (Number.isFinite(score)) result.push(appItem(app, score + 0.03));
    }

    result.sort((a, b) => (a.score ?? 99) - (b.score ?? 99) || a.title.localeCompare(b.title));
    return result;
  };

  const baseDetectKind = detectKind;
  detectKind = function (value) {
    if (menuState) return settingMode === "alias" ? "Alias" : settingMode === "hotkey" ? "Hotkey" : "Actions";
    return baseDetectKind(value);
  };

  function openMenu(item) {
    if (!item || item.menuAction) return;
    menuState = {
      item: { ...item },
      previousInput: input.value,
      previousPlaceholder: input.placeholder
    };
    settingMode = "";
    menuQuery = "";
    input.readOnly = false;
    input.value = "";
    input.placeholder = `${item.title} actions…`;
    selected = 0;
    render();
    input.focus();
  }

  function closeMenu(restore = true) {
    if (!menuState) return;
    const previous = menuState;
    menuState = null;
    settingMode = "";
    menuQuery = "";
    input.readOnly = false;
    if (restore) {
      input.value = previous.previousInput;
      input.placeholder = previous.previousPlaceholder;
      selected = 0;
      render();
      input.focus();
    }
  }

  function returnToMenu() {
    settingMode = "";
    input.readOnly = false;
    input.value = menuQuery;
    input.placeholder = `${menuState.item.title} actions…`;
    selected = 0;
    render();
    input.focus();
  }

  function beginSetting(kind) {
    settingMode = kind;
    menuQuery = input.value;
    selected = 0;

    if (kind === "alias") {
      input.readOnly = false;
      input.value = aliasFor(menuState.item);
      input.placeholder = `Alias for ${menuState.item.title}…`;
      render();
      input.focus();
      input.select();
    } else {
      input.readOnly = true;
      input.value = hotkeyFor(menuState.item);
      input.placeholder = "Press shortcut…";
      render();
      input.focus();
    }
  }

  function saveAlias() {
    const target = menuState.item;
    setPreference(target.itemKey, "alias", input.value.trim());
    returnToMenu();
  }

  async function setHotkey(target, hotkey) {
    const previous = hotkeyFor(target);

    if (target.command) {
      commands = commands.map(command => command.id === target.command.id
        ? { ...command, hotkey }
        : command);
      target.command.hotkey = hotkey;
      persistCommands();
    } else {
      setPreference(target.itemKey, "hotkey", hotkey);
    }

    const failures = await refreshCommandHotkeys();
    const failureKey = target.command ? target.command.id : target.itemKey;
    if (!failures.has(failureKey)) return true;

    if (target.command) {
      commands = commands.map(command => command.id === target.command.id
        ? { ...command, hotkey: previous }
        : command);
      target.command.hotkey = previous;
      persistCommands();
    } else {
      setPreference(target.itemKey, "hotkey", previous);
    }
    await refreshCommandHotkeys();
    return false;
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

  async function launchConfiguredItem(key) {
    if (key.startsWith("system:")) {
      await invoke("run_system_action", { action: key.slice(7) });
      return;
    }
    if (key.startsWith("app:")) {
      await invoke("launch_start_app", { appId: key.slice(4) });
    }
  }

  const baseRefreshCommandHotkeys = refreshCommandHotkeys;
  refreshCommandHotkeys = async function () {
    const failures = await baseRefreshCommandHotkeys();

    for (const hotkey of registeredItemHotkeys.splice(0)) {
      try { await globalShortcut.unregister(hotkey); } catch {}
    }
    pressedItemHotkeys.clear();

    const seen = new Set([
      ...reservedHotkeys,
      ...commands.map(command => normalizeHotkey(command.hotkey || "").toLowerCase()).filter(Boolean)
    ]);

    for (const [key, pref] of Object.entries(preferences)) {
      if (!key.startsWith("app:") && !key.startsWith("system:")) continue;
      const hotkey = normalizeHotkey(pref.hotkey || "");
      if (!hotkey) continue;

      const normalized = hotkey.toLowerCase();
      if (seen.has(normalized)) {
        failures.set(key, "Hotkey is already in use by Hyperact");
        continue;
      }
      seen.add(normalized);

      try {
        await globalShortcut.register(hotkey, event => {
          if (event.state === "Pressed") {
            if (pressedItemHotkeys.has(normalized)) return;
            pressedItemHotkeys.add(normalized);
            launchConfiguredItem(key).catch(console.error);
          } else if (event.state === "Released") {
            pressedItemHotkeys.delete(normalized);
          }
        });
        registeredItemHotkeys.push(hotkey);
      } catch (error) {
        failures.set(key, error?.message || String(error));
      }
    }

    return failures;
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

    if (settingMode === "hotkey") {
      footer.replaceChildren(footerPart("keys", "set hotkey"), footerPart("esc", "back"));
      return;
    }
    if (settingMode === "alias") {
      footer.replaceChildren(footerPart("↵", "save"), footerPart("esc", "back"));
      return;
    }
    if (menuState) {
      footer.replaceChildren(footerPart("↵", "select"), footerPart("esc", "back"));
      return;
    }

    const item = items[selected];
    if (item?.itemKey) {
      footer.replaceChildren(
        footerPart("↵", item.commandMode === "search" ? "use" : "run"),
        footerPart("Ctrl K", "actions"),
        footerPart("esc", "back")
      );
    }
  }

  const baseRender = render;
  render = function () {
    baseRender();
    if (!commandEditor.hidden) return;

    for (const edit of actions.querySelectorAll(".action-edit")) edit.remove();

    items.forEach((item, index) => {
      const row = actions.children[index];
      if (!row || item.menuAction) return;
      row.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        if (selected !== index) selectItem(index);
        openMenu(item);
      });
    });

    updateFooter();

    if (!appHotkeysRefreshed && startApps.length) {
      appHotkeysRefreshed = true;
      queueMicrotask(() => refreshCommandHotkeys().catch(console.error));
    }
  };

  const baseSelectItem = selectItem;
  selectItem = function (index) {
    baseSelectItem(index);
    updateFooter();
  };

  document.addEventListener("keydown", event => {
    if (!commandEditor.hidden) return;

    if (settingMode === "hotkey") {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        returnToMenu();
        return;
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setHotkey(menuState.item, "").then(returnToMenu).catch(console.error);
        return;
      }

      const hotkey = shortcutFromEvent(event);
      if (!hotkey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (reservedHotkeys.has(hotkey.toLowerCase())) return;
      input.value = hotkey;
      setHotkey(menuState.item, hotkey).then(success => {
        if (success) returnToMenu();
        else input.value = hotkey;
      }).catch(console.error);
      return;
    }

    if (menuState && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (settingMode) returnToMenu();
      else closeMenu(true);
      return;
    }

    if (settingMode === "alias" && event.key === "Enter") {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveAlias();
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (menuState) {
        closeMenu(true);
        return;
      }
      const item = items[selected];
      if (item && !item.menuAction) openMenu(item);
    }
  }, true);

  render();
  refreshCommandHotkeys().catch(console.error);
})();
