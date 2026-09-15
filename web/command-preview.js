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
  const splitKey = "hyperact.commandEditorSplit";

  let runTimer;
  let runVersion = 0;
  let dragging = false;

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
    const minCode = 62;
    const minPreview = 68;
    const usable = Math.max(1, height - handle);
    const min = minCode / usable;
    const max = 1 - minPreview / usable;
    const next = Math.max(min, Math.min(max, ratio));

    codePane.style.flex = `0 0 ${next * usable}px`;
    document.querySelector(".command-preview").style.flex = "1 1 0";
  }

  function savedSplit() {
    const value = Number(localStorage.getItem(splitKey));
    return Number.isFinite(value) && value > 0 ? value : 0.56;
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

  code.addEventListener("input", () => schedulePreview());
  exampleInput.addEventListener("input", () => schedulePreview());
  runButton.addEventListener("click", runPreview);

  resizer.addEventListener("pointerdown", startResize);
  resizer.addEventListener("pointermove", resize);
  resizer.addEventListener("pointerup", stopResize);
  resizer.addEventListener("pointercancel", stopResize);
  resizer.addEventListener("dblclick", () => {
    localStorage.removeItem(splitKey);
    applySplit(0.56);
  });

  new MutationObserver(() => {
    if (!editor.hidden) {
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
})();
