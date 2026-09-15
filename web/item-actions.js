(() => {
  const preferencesKey = "hyperact.itemPreferences";
  const reservedHotkeys = new Set(["alt+space", "ctrl+k"]);
  const registeredItemHotkeys = [];
  const pressedItemHotkeys = new Set();
  let preferences = loadPreferences();
  let menuState = null;
  let settingMode = "";
  let menuSelected = 0;
  let appHotkeysRefreshed = false;

  const style = document.createElement("style");
  style.textContent = `
    .action-edit { display: none !important; }

    .item-actions-popover {
      position: absolute;
      z-index: 50;
      top: 76px;
      right: 14px;
      width: min(350px, calc(100% - 28px));
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 10px;
      background: #252529;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.28);
    }

    .item-actions-popover[hidden] { display: none; }

    .item-actions-head {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 31px;
      padding: 7px 10px 5px;
      color: #9a9aa2;
      font-size: 11px;
      font-weight: 560;
    }

    .item-actions-title {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      color: #aaaab2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-actions-hint {
      overflow: hidden;
      color: #777780;
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-actions-list {
      max-height: 236px;
      overflow: hidden auto;
      padding: 0 6px 5px;
      scrollbar-width: none;
    }

    .item-actions-list::-webkit-scrollbar { display: none; }

    .item-actions-row {
      width: 100%;
      min-height: 35px;
      display: flex;
      align-items: center;
      gap: 9px;
      border: 0;
      border-radius: 6px;
      padding: 4px 7px;
      background: transparent;
      color: #e5e5e8;
      font: inherit;
      text-align: left;
      cursor: default;
    }

    .item-actions-row:hover,
    .item-actions-row.selected {
      background: rgba(255, 255, 255, 0.085);
    }

    .item-actions-icon {
      width: 18px;
      flex: 0 0 18px;
      display: grid;
      place-items: center;
      color: #b9b0e8;
      font-size: 13px;
    }

    .item-actions-label {
      min-width: 0;
      flex: 1;
      overflow: hidden;
      font-size: 12.5px;
      font-weight: 550;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-actions-detail {
      max-width: 145px;
      overflow: hidden;
      color: #8a8a93;
      font-size: 10.5px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-actions-search-wrap {
      display: flex;
      align-items: center;
      gap: 7px;
      height: 35px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding: 0 10px;
      color: #777780;
    }

    .item-actions-search {
      min-width: 0;
      flex: 1;
      border: 0;
      outline: 0;
      padding: 0;
      background: transparent;
      color: #e6e6e9;
      font: inherit;
      font-size: 12px;
      user-select: text;
    }

    .item-actions-search::placeholder { color: #777780; }
  `;
  document.head.append(style);

  const popover = document.createElement("div");
  popover.className = "item-actions-popover";
  popover.hidden = true;

  const menuHead = document.createElement("div");
  menuHead.className = "item-actions-head";
  const menuTitle = document.createElement("span");
  menuTitle.className = "item-actions-title";
  const menuHint = document.createElement("span");
  menuHint.className = "item-actions-hint";
  menuHead.append(menuTitle, menuHint);

  const menuList = document.createElement("div");
  menuList.className = "item-actions-list";
  menuList.setAttribute("role", "listbox");

  const searchWrap = document.createElement("div");
  searchWrap.className = "item-actions-search-wrap";
  const searchIcon = document.createElement("span");
  searchIcon.textContent = "⌕";
  const menuInput = document.createElement("input");
  menuInput.className = "item-actions-search";
  menuInput.type = "text";
  menuInput.autocomplete = "off";
  menuInput.spellcheck = false;
  searchWrap.append(searchIcon, menuInput);

  popover.append(menuHead, menuList, searchWrap);
  palette.append(popover);

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

  function decorateMetadata(item) {
    if (!item?.itemKey) return item;
    const meta = [];
    const alias = aliasFor(item);
    const hotkey = hotkeyFor(item);
    if (alias) meta.push(`@${alias}`);
    if (hotkey) meta.push(hotkey);
    item.detail = meta.join(" · ");
    return item;
  }

  const baseNativeItem = nativeItem;
  nativeItem = function (item, score = 0) {
    return decorateMetadata({
      ...baseNativeItem(item, score),
      itemKey: systemKey(item),
      itemType: "system",
      itemSource: item
    });
  };

  const baseAppItem = appItem;
  appItem = function (app, score) {
    return decorateMetadata({
      ...baseAppItem(app, score),
      itemKey: appKey(app),
      itemType: "app",
      itemSource: app
    });
  };

  function annotate(item) {
    if (item?.command) {
      item.itemKey = commandKey(item.command);
      item.itemType = "command";
      item.itemSource = item.command;
    }
    return decorateMetadata(item);
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
    return decorateMetadata({
      icon: "N",
      title: command.name,
      detail: "",
      category: "Text Action",
      score: 8,
      command,
      commandMode: "input",
      itemKey: commandKey(command),
      itemType: "command",
      itemSource: command,
      run: () => runCommand(command, value)
    });
  }

  function aliasCommandResult(command, score) {
    return decorateMetadata({
      icon: "N",
      title: command.name,
      detail: "",
      category: "Command",
      score,
      command,
      commandMode: "search",
      itemKey: commandKey(command),
      itemType: "command",
      itemSource: command,
      run: () => useCommandByName(command)
    });
  }

  const baseBuildActions = buildActions;
  buildActions = function (value) {
    const query = value.trim();
    const result = baseBuildActions(value).map(annotate);
    if (!query || activeCommand) return result;

    const present = new Set(result.map(item => item.itemKey).filter(Boolean));

    for (const command of commands) {
      const key = commandKey(command);
      const nameScore = matchScore(command.name, query);
      const alias = preference(key).alias || "";
      const aliasScore = alias ? matchScore(alias, query) : Infinity;

      if (!present.has(key) && Number.isFinite(aliasScore)) {
        result.push(aliasCommandResult(command, aliasScore + 0.04));
        present.add(key);
        continue;
      }

      if (!present.has(key) && !command.match && !Number.isFinite(nameScore)) {
        result.push(genericCommandResult(command, value));
        present.add(key);
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

  function primaryLabel(item) {
    if (item.commandMode === "input") return "Run";
    if (item.itemType === "app") return "Open";
    if (item.commandMode === "search") return "Use";
    return "Run";
  }

  function menuOptions() {
    const target = menuState.item;
    const options = [{
      icon: "↵",
      title: primaryLabel(target),
      detail: "Enter",
      run: () => {
        const run = target.run;
        closeMenu(false);
        run();
      }
    }];

    if (target.itemKey) {
      options.push(
        {
          icon: "⌨",
          title: "Set Hotkey",
          detail: hotkeyFor(target) || "None",
          run: () => beginSetting("hotkey")
        },
        {
          icon: "@",
          title: "Set Alias",
          detail: aliasFor(target) || "None",
          run: () => beginSetting("alias")
        }
      );
    }

    if (target.command) {
      options.push({
        icon: "⚙",
        title: "Edit Command",
        detail: "",
        run: () => {
          const id = target.command.id;
          closeMenu(false);
          openCommandEditor(id);
        }
      });
    }

    const query = menuInput.value.trim();
    if (!query || settingMode) return options;
    return options
      .map(option => ({
        ...option,
        score: matchScore(`${option.title} ${option.detail}`, query)
      }))
      .filter(option => Number.isFinite(option.score))
      .sort((a, b) => a.score - b.score);
  }

  function renderMenu() {
    if (!menuState) return;

    menuTitle.textContent = settingMode === "alias"
      ? `Alias · ${menuState.item.title}`
      : settingMode === "hotkey"
        ? `Hotkey · ${menuState.item.title}`
        : menuState.item.title;

    if (settingMode === "alias") {
      menuHint.textContent = "Enter to save";
      menuList.replaceChildren();
      const row = document.createElement("button");
      row.type = "button";
      row.className = "item-actions-row selected";
      row.innerHTML = `<span class="item-actions-icon">@</span><span class="item-actions-label">${menuInput.value.trim() ? "Save Alias" : "Clear Alias"}</span>`;
      row.addEventListener("click", saveAlias);
      menuList.append(row);
      return;
    }

    if (settingMode === "hotkey") {
      menuHint.textContent = "Press shortcut";
      menuList.replaceChildren();
      const row = document.createElement("div");
      row.className = "item-actions-row selected";
      const icon = document.createElement("span");
      icon.className = "item-actions-icon";
      icon.textContent = "⌨";
      const label = document.createElement("span");
      label.className = "item-actions-label";
      label.textContent = menuInput.value || "Press a shortcut";
      const detail = document.createElement("span");
      detail.className = "item-actions-detail";
      detail.textContent = "Backspace clears";
      row.append(icon, label, detail);
      menuList.append(row);
      return;
    }

    menuHint.textContent = "Ctrl K";
    const options = menuOptions();
    menuSelected = Math.min(menuSelected, Math.max(0, options.length - 1));
    menuList.replaceChildren();

    if (!options.length) {
      const empty = document.createElement("div");
      empty.className = "item-actions-hint";
      empty.style.padding = "12px 10px 16px";
      empty.textContent = "No actions";
      menuList.append(empty);
      return;
    }

    options.forEach((option, index) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `item-actions-row${index === menuSelected ? " selected" : ""}`;

      const icon = document.createElement("span");
      icon.className = "item-actions-icon";
      icon.textContent = option.icon;
      const label = document.createElement("span");
      label.className = "item-actions-label";
      label.textContent = option.title;
      const detail = document.createElement("span");
      detail.className = "item-actions-detail";
      detail.textContent = option.detail;

      row.append(icon, label, detail);
      row.addEventListener("mouseenter", () => {
        menuSelected = index;
        renderMenu();
      });
      row.addEventListener("click", option.run);
      menuList.append(row);
    });
  }

  function openMenu(item) {
    if (!item) return;
    menuState = { item: { ...item } };
    settingMode = "";
    menuSelected = 0;
    menuInput.readOnly = false;
    menuInput.value = "";
    menuInput.placeholder = "Search for actions…";
    popover.hidden = false;
    renderMenu();
    updateFooter();
    menuInput.focus();
  }

  function closeMenu(focusMain = true) {
    if (!menuState) return;
    menuState = null;
    settingMode = "";
    menuSelected = 0;
    menuInput.readOnly = false;
    menuInput.value = "";
    popover.hidden = true;
    updateFooter();
    if (focusMain) input.focus();
  }

  function returnToMenu() {
    settingMode = "";
    menuSelected = 0;
    menuInput.readOnly = false;
    menuInput.value = "";
    menuInput.placeholder = "Search for actions…";
    render();
    renderMenu();
    updateFooter();
    menuInput.focus();
  }

  function beginSetting(kind) {
    settingMode = kind;
    menuSelected = 0;

    if (kind === "alias") {
      menuInput.readOnly = false;
      menuInput.value = aliasFor(menuState.item);
      menuInput.placeholder = "Type alias…";
      renderMenu();
      menuInput.focus();
      menuInput.select();
    } else {
      menuInput.readOnly = true;
      menuInput.value = hotkeyFor(menuState.item);
      menuInput.placeholder = "Press shortcut…";
      renderMenu();
      menuInput.focus();
    }
    updateFooter();
  }

  function saveAlias() {
    if (!menuState?.item?.itemKey) return;
    setPreference(menuState.item.itemKey, "alias", menuInput.value.trim());
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

    if (menuState) {
      if (settingMode === "hotkey") {
        footer.replaceChildren(footerPart("keys", "set hotkey"), footerPart("esc", "back"));
      } else if (settingMode === "alias") {
        footer.replaceChildren(footerPart("↵", "save"), footerPart("esc", "back"));
      } else {
        footer.replaceChildren(footerPart("↵", "select"), footerPart("esc", "close actions"));
      }
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
      if (!row) return;
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

  function activateSelectedMenuAction() {
    const options = menuOptions();
    options[menuSelected]?.run();
  }

  menuInput.addEventListener("input", () => {
    menuSelected = 0;
    renderMenu();
  });

  menuInput.addEventListener("keydown", event => {
    if (!menuState) return;

    if (settingMode === "hotkey") {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        returnToMenu();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        setHotkey(menuState.item, "").then(returnToMenu).catch(console.error);
        return;
      }

      const hotkey = shortcutFromEvent(event);
      if (!hotkey || reservedHotkeys.has(hotkey.toLowerCase())) return;
      menuInput.value = hotkey;
      renderMenu();
      setHotkey(menuState.item, hotkey).then(success => {
        if (success) returnToMenu();
        else {
          menuHint.textContent = "Already in use";
          menuInput.focus();
        }
      }).catch(console.error);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (settingMode) returnToMenu();
      else closeMenu(true);
      return;
    }

    if (settingMode === "alias" && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      saveAlias();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const count = menuOptions().length;
      if (!count) return;
      menuSelected = (menuSelected + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
      renderMenu();
      menuList.children[menuSelected]?.scrollIntoView({ block: "nearest" });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      activateSelectedMenuAction();
    }
  });

  document.addEventListener("mousedown", event => {
    if (!menuState || popover.contains(event.target)) return;
    closeMenu(false);
  }, true);

  document.addEventListener("keydown", event => {
    if (!commandEditor.hidden) return;
    if (!event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "k") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (menuState) {
      closeMenu(true);
      return;
    }

    const item = items[selected];
    if (item) openMenu(item);
  }, true);

  window.addEventListener("hyperact-blur", () => closeMenu(false));

  render();
  refreshCommandHotkeys().catch(console.error);
})();
