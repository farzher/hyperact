# Hyperact

A keyboard-first action launcher for Windows. Give Hyperact text, a path, a URL, or another piece of context and run the actions that make sense for it.

## Stack

- Tauri 2
- Rust
- HTML + CSS + vanilla JavaScript
- No frontend package manager or build step

## Development

Install the Tauri CLI once:

```powershell
cargo install tauri-cli --version "^2.0.0" --locked
```

Run Hyperact:

```powershell
cargo tauri dev
```

Build it:

```powershell
cargo tauri build
```

Tauri reads the static frontend directly from `web/`; there is no npm install or frontend compilation step.
