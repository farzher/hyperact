(() => {
  const config = {
    commands: [],
    preferences: {},
    fileHistory: {},
    editorSplit: 0.64
  };

  window.hyperactConfig = config;

  let saveQueue = Promise.resolve();
  window.saveHyperactConfig = () => {
    const json = JSON.stringify(config, null, 2);
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => invoke("save_config", { json }));
    return saveQueue;
  };

  function normalizeCommands(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(command => command?.id && command?.name && typeof command.code === "string")
      .map(command => ({
        id: command.id,
        name: command.name,
        hotkey: command.hotkey || "",
        match: command.match || "",
        inputMode: command.inputMode === "selected" ? "selected" : "focused",
        missingInput: command.missingInput === "nothing" ? "nothing" : "prompt",
        outputMode: command.outputMode === "paste" ? "paste" : "type",
        code: command.code
      }));
  }

  function objectOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  window.hyperactConfigReady = (async () => {
    try {
      const raw = await invoke("load_config");
      const loaded = raw.trim() ? JSON.parse(raw) : config;

      config.commands = normalizeCommands(loaded.commands);
      config.preferences = objectOrEmpty(loaded.preferences);
      config.fileHistory = objectOrEmpty(loaded.fileHistory);
      config.editorSplit = Number.isFinite(Number(loaded.editorSplit)) && Number(loaded.editorSplit) > 0
        ? Number(loaded.editorSplit)
        : 0.64;

      commands = config.commands;
      preferences = config.preferences;

      if (!raw.trim()) await window.saveHyperactConfig();

      render();
      await refreshHotkeys();
    } catch (error) {
      console.error("Could not load Hyperact config", error);
    }
  })();
})();
