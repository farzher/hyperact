(() => {
  const editor = document.querySelector("#command-editor");
  const workbench = document.querySelector("#command-workbench");
  const codePane = document.querySelector("#command-code-pane");
  const code = document.querySelector("#command-code");
  const resizer = document.querySelector("#command-resizer");
  const exampleInput = document.querySelector("#command-example-input");
  const exampleOutput = document.querySelector("#command-example-output");
  const runButton = document.querySelector("#command-preview-run");
  const commandList = document.querySelector("#command-list");
  const commandNew = document.querySelector("#command-new");
  const invoke = window.__TAURI__.core.invoke;
  const hyperWindow = window.__TAURI__.window.getCurrentWindow();
  const LogicalSize = window.__TAURI__.dpi?.LogicalSize;
  const splitKey = "hyperact.commandEditorSplit";

  let runTimer;
  let runVersion = 0;
  let dragging = false;
  let promptInputLocked = false;

  function showOutput(value, state = "") {
    exampleOutput.textContent = value;
    exampleOutput.className = `command-example-output${state ? ` ${state}` : ""}`;
  }

  async function runPreview() {
    clearTimeout(runTimer);
    const source = code.value.trim();
    if (!source) {
      showOutput("No code", "empty");
      return;
    }

    const version = ++runVersion;
    showOutput("Running…", "running");
    runButton.textContent = "…";

    try {
      const output = await invoke("run_node_command", {
        code: source,
        input: exampleInput.value
      });
      if (version !== runVersion) return;
      showOutput(String(output));
    } catch (error) {
      if (version !== runVersion) return;
      showOutput(error?.message || String(error), "error");
    } finally {
      if (version === runVersion) runButton.textContent = "Run";
    }
  }

  function schedulePreview(delay = 280) {
    clearTimeout(runTimer);
    runTimer = setTimeout(runPreview, delay);
  }

  function applySplit(ratio) {
    const height = workbench.clientHeight;
    if (!height) return;

    const handle = resizer.offsetHeight;
    const minCode = 130;
    const minPreview = 110;
    const usable = Math.max(1, height - handle);
    const min = minCode / usable;
    const max = 1 - minPreview / usable;
    const next = Math.max(min, Math.min(max, ratio));

    codePane.style.flex = `0 0 ${next * usable}px`;
    document.querySelector(".command-preview").style.flex = "1 1 0";
  }

  function savedSplit() {
    const value = Number(localStorage.getItem(splitKey));
    return Number.isFinite(value) && value > 0 ? value : 0.64;
  }

  function startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    workbench.classList.add("resizing");
    resizer.setPointerCapture?.(event.pointerId);
  }

  function resize(event) {
    if (!dragging) return;
    const rect = workbench.getBoundingClientRect();
    const handle = resizer.offsetHeight;
    const usable = Math.max(1, rect.height - handle);
    applySplit((event.clientY - rect.top) / usable);
  }

  function stopResize() {
    if (!dragging) return;
    dragging = false;
    workbench.classList.remove("resizing");

    const usable = Math.max(1, workbench.clientHeight - resizer.offsetHeight);
    const ratio = codePane.getBoundingClientRect().height / usable;
    localStorage.setItem(splitKey, String(ratio));
  }

  async function resizeForEditor(open) {
    if (!LogicalSize) return;

    try {
      await hyperWindow.setSize(new LogicalSize(open ? 920 : 720, open ? 620 : 430));
      await hyperWindow.center();
    } catch (error) {
      console.error(error);
    }
  }

  function unlockPromptInput() {
    promptInputLocked = false;
    input.readOnly = false;
    if (promptTarget !== null) input.focus();
  }

  async function waitForPromptModifiers() {
    while (promptInputLocked && promptTarget !== null) {
      try {
        if (!await invoke("modifiers_held")) {
          unlockPromptInput();
          return;
        }
      } catch {
        unlockPromptInput();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 8));
    }

    if (promptInputLocked) unlockPromptInput();
  }

  const baseOpenPromptMode = openPromptMode;
  openPromptMode = async function (command, target, selectAll) {
    promptInputLocked = true;
    input.readOnly = true;
    await baseOpenPromptMode(command, target, selectAll);
    input.readOnly = true;
    waitForPromptModifiers();
  };

  document.addEventListener("keydown", event => {
    if (!promptInputLocked || promptTarget === null) return;
    if (["Control", "Shift", "Alt", "Meta", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const pressedHotkeys = new Set();

  refreshCommandHotkeys = async function () {
    const failures = new Map();
    if (!globalShortcut) return failures;

    for (const hotkey of registeredCommandHotkeys) {
      try {
        await globalShortcut.unregister(hotkey);
      } catch {}
    }

    registeredCommandHotkeys = [];
    pressedHotkeys.clear();
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
          if (event.state === "Pressed") {
            if (pressedHotkeys.has(key)) return;
            pressedHotkeys.add(key);
            runHotkeyCommand(command).catch(console.error);
          } else if (event.state === "Released") {
            pressedHotkeys.delete(key);
          }
        });
        registeredCommandHotkeys.push(hotkey);
      } catch (error) {
        failures.set(command.id, error?.message || String(error));
      }
    }

    return failures;
  };

  code.addEventListener("input", () => schedulePreview());
  exampleInput.addEventListener("input", () => schedulePreview());
  runButton.addEventListener("click", runPreview);

  resizer.addEventListener("pointerdown", startResize);
  resizer.addEventListener("pointermove", resize);
  resizer.addEventListener("pointerup", stopResize);
  resizer.addEventListener("pointercancel", stopResize);
  resizer.addEventListener("dblclick", () => {
    localStorage.removeItem(splitKey);
    applySplit(0.64);
  });

  new MutationObserver(() => {
    const open = !editor.hidden;
    resizeForEditor(open);

    if (open) {
      requestAnimationFrame(() => {
        applySplit(savedSplit());
        schedulePreview(0);
      });
    }
  }).observe(editor, { attributes: true, attributeFilter: ["hidden"] });

  new MutationObserver(() => {
    if (!editor.hidden) schedulePreview(0);
  }).observe(commandList, { childList: true, subtree: true });

  commandNew.addEventListener("click", () => setTimeout(() => schedulePreview(0)));
  window.addEventListener("resize", () => {
    if (!editor.hidden) applySplit(savedSplit());
  });

  setTimeout(() => refreshCommandHotkeys().catch(console.error), 100);
})();
