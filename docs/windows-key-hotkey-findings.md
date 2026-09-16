# Standalone Windows-key hotkey findings

This documents the investigation into using a standalone left or right Windows-key tap to toggle Hyperact without opening Start, while retaining normal chords such as Win+E and Win+Shift+S.

## Current status

Hyperact has been restored to Alt+Space. The experimental Windows-key hook is not compiled or installed. The test harness remains only for a future UIAccess implementation.

## Conclusion

A normal unsigned Hyperact process cannot reproduce Raycast's working behavior. Raycast performs the critical injection from a signed UIAccess executable. If this feature is attempted again, the next credible implementation is a small, signed, installed UIAccess helper—not another variation of `SendInput` in the main process.

Do not claim this feature works until `tools/windows-key-toggle-test.ps1` passes repeatedly.

## Raycast reference implementation

Raycast 2.4.0 was inspected at:

```text
C:\Program Files\WindowsApps\Raycast.Raycast_2.4.0.0_x64__qypenmj9wpt2a
```

Its binaries contain evidence of:

- `SetWindowsHookExW`
- `CallNextHookEx`
- `RegisterHotKey`
- `NtUserInjectKeyboardInput`
- Rust source paths including `shortcuts\src\low_level_hook.rs`
- Hook-liveness monitoring and hook reinstallation

The keyboard hook and injection logic is in `Raycast.UIAccess.exe`, not merely the normal Raycast process. That executable:

- has a valid Microsoft-issued code signature for Raycast Technologies Ltd.;
- embeds `requestedExecutionLevel level="asInvoker" uiAccess="true"`;
- is installed under the protected WindowsApps directory.

## Observed working event sequence

A second low-level keyboard hook was installed before Raycast's hook. For an injected standalone left-Windows tap, the observer received:

```text
Win down:
  msg=0x100 vk=0x5B flags=0x12 extra=0x12345678

Release:
  msg=0x101 vk=0xFF flags=0x90 extra=0x0
  msg=0x101 vk=0x5B flags=0x92 extra=0x12345678
```

Therefore Raycast:

1. forwards the original Win-down;
2. synchronously injects one key-up for unassigned virtual key `0xFF` from its Win-up hook callback;
3. then forwards the original Win-up;
4. does not replace the original Win-up;
5. sets extra-info to zero on the `VK_FF` event.

The original diagnostic script is:

```text
C:\Users\me\AppData\Local\Temp\raycast-key-probe.ps1
```

## `NtUserInjectKeyboardInput` ABI

Binary disassembly of `Raycast.UIAccess.exe` resolved the ambiguity in the private API's input structure.

The observed calls pass:

```text
RCX = pointer to input array
EDX = input count
```

Array iteration in Raycast uses a 24-byte stride. On 64-bit Windows this is the size of `KEYBDINPUT`, not the 40-byte public `INPUT` wrapper.

The inferred declaration is therefore:

```rust
unsafe extern "system" fn(*const KeyboardInput, u32) -> u32
```

where `KeyboardInput` has this layout:

```rust
#[repr(C)]
struct KeyboardInput {
    virtual_key: u16,
    scan_code: u16,
    flags: u32,
    time: u32,
    extra_info: usize,
}
```

An earlier Hyperact implementation incorrectly passed a public `INPUT` wrapper. A return value of `1` from that malformed call did not prove that a `VK_FF` keyboard event had been injected; the syscall interpreted the wrapper bytes as a different direct keyboard-input structure.

With the corrected 24-byte structure, a direct probe from a normal non-UIAccess process returned `0` and emitted no keyboard event.

## Why matching downstream events was insufficient

As a diagnostic, Hyperact called `win32u!NtUserSendInput` directly from the hook. This produced the same observable ordering and low-level-hook fields as Raycast:

```text
Win down (original)
VK_FF up, flags=0x90, extra=0
Win up (original)
```

Start still opened whenever Hyperact hid.

This demonstrates that the fields exposed through `KBDLLHOOKSTRUCT` are not the whole decision. Windows retains information about the origin/trust level of injected input that is not visible in those downstream fields. Raycast's UIAccess injection is treated differently from an otherwise identical normal-process injection.

## Approaches already tried and rejected

Do not repeat these without new evidence:

- Escape polling or closing Start after it appears.
- Delayed Start-menu closing.
- Ctrl masks.
- F24 masks.
- Calling ordinary `SendInput` from the low-level hook callback. Windows silently removed the hook after several presses.
- Sending `VK_FF` from a worker while forwarding the physical Win-up. The mask arrives at the wrong point and does not reliably prevent Start.
- Suppressing the physical Win-up and sending `VK_FF` plus a synthetic Win-up from a worker. The visible event order was correct, but Start still opened.
- Calling `NtUserSendInput` directly to reproduce the visible Raycast sequence. Start still opened.
- Passing public `INPUT` to `NtUserInjectKeyboardInput`. This is the wrong ABI.

Focusing Hyperact when opening can obscure or dismiss Start, which creates a false positive. The hide transition is the important case.

## Required architecture for another attempt

Implement a minimal dedicated helper, for example `Hyperact.UIAccess.exe`, with these responsibilities:

1. Run with an embedded `uiAccess="true"` manifest.
2. Own the `WH_KEYBOARD_LL` hook and its message loop.
3. Track standalone left/right Win taps while allowing Win chords through unchanged.
4. Resolve `win32u!NtUserInjectKeyboardInput` before installing the hook.
5. On standalone Win-up, synchronously inject direct `KEYBDINPUT { vk: 0xFF, flags: KEYEVENTF_KEYUP }`, then call `CallNextHookEx` for the original Win-up.
6. Notify the normal Hyperact process over a minimal IPC mechanism so it can toggle the launcher.
7. Keep the callback extremely small.
8. Monitor hook liveness and reinstall it if Windows removes it.

The helper must also satisfy Windows UIAccess deployment rules:

- be Authenticode-signed by a certificate trusted on the machine;
- be installed in a protected location such as Program Files (or be deployed through an appropriately protected package location);
- retain the `asInvoker` plus `uiAccess="true"` manifest.

An unsigned development executable launched from the repository under Downloads cannot be used to validate this architecture. Development testing needs a trusted test certificate and an elevated installation into a secure location, or the real release-signing/install pipeline.

Using UIAccess for the entire Tauri application is possible but unnecessarily expands the privileged surface. Prefer a very small native helper containing only the hook, injection, and IPC code.

## Automated test

The repository contains:

```text
tools/windows-key-toggle-test.ps1
```

The harness:

1. creates and focuses a neutral native window;
2. closes Start before testing;
3. starts Hyperact hidden;
4. alternates injected left- and right-Windows taps;
5. checks launcher visibility after every tap;
6. checks the foreground process after every tap;
7. fails if `SearchHost` or `StartMenuExperienceHost` becomes foreground.

The last normal-process implementation failed on the first tap with:

```text
1: key=LWin visible=False foreground=SearchHost
Start opened after tap 1
```

Run a larger repeated test before declaring success, for example:

```powershell
cd C:\Users\me\Downloads\hyperact\src-tauri
cargo build
powershell -NoProfile -ExecutionPolicy Bypass -File ..\tools\windows-key-toggle-test.ps1 -Taps 40
```

A passing run must show alternating Hyperact visibility for all taps and must never report either Start process as foreground.
