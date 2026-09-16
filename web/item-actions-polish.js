(() => {
  const preferencesKey = "hyperact.itemPreferences";
  const popover = document.querySelector(".item-actions-popover");
  const menuInput = popover?.querySelector(".item-actions-search");
  const menuTitle = popover?.querySelector(".item-actions-title");
  const menuHint = popover?.querySelector(".item-actions-hint");
  if (!popover || !menuInput || !menuTitle || !menuHint) return;

  const style = document.createElement("style");
  style.textContent = `
    .action-alias-badge {
      flex: 0 0 auto;
      max-width: 150px;
      overflow: hidden;
      border-radius: 4px;
      padding: 1px 5px;
      background: rgba(255, 255, 255, 0.09);
      color: #a7a7ae;
      font-size: 10.5px;
      font-weight: 560;
      line-height: 16px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.append(style);

  let pendingHotkey = null;
  let originalHotkey = "";
  let hotkeyEditing = false;
  let replayingHotkey = false;

  function preferences() {
    try {
      const saved = JSON.parse(localStorage.getItem(preferencesKey) || "{}");
      return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }

  function hotkeyMode() {
    return !popover.hidden && menuTitle.textContent.startsWith("Hotkey ·");
  }

  function shortcutFromEvent(event) {
    if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return "";
    const key = event.key === " "
      ? "Space"
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key;
    const parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Super");
    parts.push(key);
    return parts.join("+");
  }

  function showPendingHotkey() {
    const value = pendingHotkey ?? "";
    menuInput.value = value;
    const label = popover.querySelector(".item-actions-list .item-actions-label");
    if (label) label.textContent = value || "No hotkey";
    const detail = popover.querySelector(".item-actions-list .item-actions-detail");
    if (detail) detail.textContent = "Backspace clears";
    menuHint.textContent = "Enter to save · Esc to cancel";
  }

  async function suspendOriginalHotkey() {
    if (hotkeyEditing || !hotkeyMode()) return;
    hotkeyEditing = true;
    originalHotkey = menuInput.value.trim();
    pendingHotkey = originalHotkey;
    showPendingHotkey();

    if (originalHotkey) {
      try {
        await globalShortcut.unregister(originalHotkey);
      } catch {}
    }
  }

  function restoreRegisteredHotkeys() {
    if (!hotkeyEditing) return;
    hotkeyEditing = false;
    pendingHotkey = null;
    originalHotkey = "";
    refreshCommandHotkeys().catch(console.error);
  }

  function replayShortcut(value) {
    replayingHotkey = true;
    try {
      if (!value) {
        menuInput.dispatchEvent(new KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true
        }));
        return;
      }

      const parts = value.split("+");
      const key = parts.pop() || "";
      const modifiers = new Set(parts.map(part => part.toLowerCase()));
      menuInput.dispatchEvent(new KeyboardEvent("keydown", {
        key,
        ctrlKey: modifiers.has("ctrl"),
        altKey: modifiers.has("alt"),
        shiftKey: modifiers.has("shift"),
        metaKey: modifiers.has("super"),
        bubbles: true,
        cancelable: true
      }));
    } finally {
      replayingHotkey = false;
    }
  }

  menuInput.addEventListener("keydown", event => {
    if (replayingHotkey || !hotkeyMode()) return;

    if (!hotkeyEditing) suspendOriginalHotkey().catch(console.error);

    if (event.key === "Escape") {
      restoreRegisteredHotkeys();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.key === "Enter") {
      replayShortcut(pendingHotkey ?? originalHotkey);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      pendingHotkey = "";
      showPendingHotkey();
      return;
    }

    const hotkey = shortcutFromEvent(event);
    if (!hotkey) return;
    if (["alt+space", "ctrl+k"].includes(hotkey.toLowerCase())) {
      menuHint.textContent = "Reserved by Hyperact";
      return;
    }

    pendingHotkey = hotkey;
    showPendingHotkey();
  }, true);

  new MutationObserver(() => {
    if (!hotkeyMode()) {
      restoreRegisteredHotkeys();
      return;
    }

    if (!hotkeyEditing) {
      suspendOriginalHotkey().catch(console.error);
      return;
    }

    if (menuHint.textContent === "Already in use" && originalHotkey) {
      globalShortcut.unregister(originalHotkey).catch(() => {});
    }
  }).observe(popover, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });

  function decorateRows() {
    if (typeof items === "undefined" || typeof actions === "undefined") return;
    const prefs = preferences();

    items.forEach((item, index) => {
      const row = actions.children[index];
      if (!row || !item?.itemKey) return;

      const alias = prefs[item.itemKey]?.alias || "";
      const hotkey = item.command?.hotkey || prefs[item.itemKey]?.hotkey || "";
      const copy = row.querySelector(".action-copy");
      const title = row.querySelector(".action-title");
      if (!copy || !title) return;

      row.querySelector(".action-alias-badge")?.remove();
      if (alias) {
        const badge = document.createElement("span");
        badge.className = "action-alias-badge";
        badge.textContent = alias;
        title.after(badge);
      }

      let detail = row.querySelector(".action-detail");
      if (hotkey) {
        if (!detail) {
          detail = document.createElement("span");
          detail.className = "action-detail";
          copy.append(detail);
        }
        detail.textContent = hotkey;
      } else {
        detail?.remove();
      }
    });
  }

  const baseRender = render;
  render = function () {
    baseRender();
    decorateRows();
  };

  decorateRows();
})();
