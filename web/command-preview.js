(() => {
  const editor = document.querySelector("#command-editor");
  const workbench = document.querySelector("#command-workbench");
  const codePane = document.querySelector("#command-code-pane");
  const previewPane = document.querySelector(".command-preview");
  const code = document.querySelector("#command-code");
  const resizer = document.querySelector("#command-resizer");
  const exampleInput = document.querySelector("#command-example-input");
  const exampleOutput = document.querySelector("#command-example-output");
  const runButton = document.querySelector("#command-preview-run");
  const invoke = window.__TAURI__.core.invoke;
  const hyperWindow = window.__TAURI__.window.getCurrentWindow();
  const LogicalSize = window.__TAURI__.dpi?.LogicalSize;
  const splitKey = "hyperact.commandEditorSplit";

  let runTimer;
  let runVersion = 0;
  let dragging = false;
  let launcherSize = null;

  function showOutput(value, state = "") {
    exampleOutput.textContent = value;
    exampleOutput.className = `command-example-output${state ? ` ${state}` : ""}`;
  }

  async function runPreview() {
    clearTimeout(runTimer);
    if (editor.hidden) return;

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
      if (version === runVersion) showOutput(String(output));
    } catch (error) {
      if (version === runVersion) showOutput(error?.message || String(error), "error");
    } finally {
      if (version === runVersion) runButton.textContent = "Run";
    }
  }

  function schedulePreview(delay = 400) {
    clearTimeout(runTimer);
    runTimer = setTimeout(runPreview, delay);
  }

  function savedSplit() {
    const value = Number(localStorage.getItem(splitKey));
    return Number.isFinite(value) && value > 0 ? value : 0.64;
  }

  function applySplit(ratio = savedSplit()) {
    const height = workbench.clientHeight;
    if (!height) return;

    const handle = resizer.offsetHeight;
    const usable = Math.max(1, height - handle);
    const min = 130 / usable;
    const max = 1 - 110 / usable;
    const next = Math.max(min, Math.min(max, ratio));
    codePane.style.flex = `0 0 ${next * usable}px`;
    previewPane.style.flex = "1 1 0";
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
    const usable = Math.max(1, rect.height - resizer.offsetHeight);
    applySplit((event.clientY - rect.top) / usable);
  }

  function stopResize() {
    if (!dragging) return;
    dragging = false;
    workbench.classList.remove("resizing");
    const usable = Math.max(1, workbench.clientHeight - resizer.offsetHeight);
    localStorage.setItem(splitKey, String(codePane.getBoundingClientRect().height / usable));
  }

  async function logicalWindowSize() {
    const size = await hyperWindow.innerSize();
    const scale = await hyperWindow.scaleFactor();
    return { width: size.width / scale, height: size.height / scale };
  }

  async function resizeForEditor(open) {
    if (!LogicalSize) return;

    try {
      if (open) {
        if (launcherSize) return;
        launcherSize = await logicalWindowSize();
        const width = Math.max(920, launcherSize.width);
        const height = Math.max(620, launcherSize.height);
        if (width !== launcherSize.width || height !== launcherSize.height) {
          await hyperWindow.setSize(new LogicalSize(width, height));
          await hyperWindow.center();
        }
      } else if (launcherSize) {
        await hyperWindow.setSize(new LogicalSize(launcherSize.width, launcherSize.height));
        await hyperWindow.center();
        launcherSize = null;
      }
    } catch (error) {
      console.error(error);
    }
  }

  window.hyperactEditorVisibilityChanged = open => {
    resizeForEditor(open).catch(console.error);
    if (open) {
      requestAnimationFrame(() => {
        applySplit();
        schedulePreview(0);
      });
    } else {
      clearTimeout(runTimer);
      runVersion++;
    }
  };

  window.hyperactCommandLoaded = () => {
    if (!editor.hidden) schedulePreview(0);
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
  window.addEventListener("resize", () => {
    if (!editor.hidden) applySplit();
  });
})();
