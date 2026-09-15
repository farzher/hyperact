# Hyperact agent guidelines

Hyperact is a pre-release (version 0) project with no users yet. Optimize for the simplest clean implementation intended for the first public release.

## Development priorities

- Optimize for fast iteration, minimal code, and minimal direct changes.
- Prefer the simplest implementation that cleanly solves the current problem.
- Do not preserve backwards compatibility with existing builds, launchers, configuration formats, caches, or internal contracts.
- Replace obsolete designs directly instead of adding migrations, compatibility layers, fallbacks, or deprecated paths.
- Do not add or run tests or verification unless explicitly requested.
- Avoid speculative abstractions, framework layers, and infrastructure for hypothetical future requirements.
- Keep dependencies few and justified.
- Keep the codebase easy to understand and modify.

## Stack

- Tauri 2 for the desktop shell.
- Rust for native/Windows integration and application infrastructure.
- Plain HTML, CSS, and vanilla JavaScript for the UI.
- Do not introduce TypeScript, a JavaScript framework, npm, Vite, or another frontend build system unless explicitly requested.

## Product and UI

- Hyperact is keyboard-first and should feel immediate.
- Keep the UI clean and minimal, with few words and a polished user experience.
- Prefer sensible defaults over settings and configuration screens.
- Avoid unnecessary dialogs, onboarding, labels, explanatory copy, and persistent UI.
- Make common actions fast and obvious while keeping advanced functionality out of the way.
