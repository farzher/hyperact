#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

fn toggle_launcher(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn get_start_apps() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = r#"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
Add-Type -AssemblyName System.Drawing

function Get-IconData([string]$source) {
  if ([string]::IsNullOrWhiteSpace($source)) { return '' }

  $path = [Environment]::ExpandEnvironmentVariables($source.Trim())
  if ($path -match '^(.*),-?\d+$') { $path = $matches[1] }
  $path = $path.Trim('"')
  if (-not (Test-Path -LiteralPath $path)) { return '' }

  $icon = $null
  $bitmap = $null
  $stream = $null
  try {
    if ([IO.Path]::GetExtension($path) -ieq '.ico') {
      $icon = New-Object System.Drawing.Icon($path)
    } else {
      $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
    }

    if (-not $icon) { return '' }
    $bitmap = $icon.ToBitmap()
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    return 'data:image/png;base64,' + [Convert]::ToBase64String($stream.ToArray())
  }
  catch { return '' }
  finally {
    if ($stream) { $stream.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
    if ($icon) { $icon.Dispose() }
  }
}

$meta = @{}
$wsh = New-Object -ComObject WScript.Shell
$roots = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
)

foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }

  Get-ChildItem -LiteralPath $root -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    $key = $_.BaseName.Trim().ToLowerInvariant()

    try {
      $shortcut = $wsh.CreateShortcut($_.FullName)
      $target = [Environment]::ExpandEnvironmentVariables(($shortcut.TargetPath + '').Trim('"'))
      $arguments = $shortcut.Arguments + ''
      $type = 'Application'

      if ($target -match '(?i)\\steam\.exe$' -or
          $arguments -match '(?i)(?:^|\s)-applaunch\s+\d+' -or
          $target -match '(?i)EpicGamesLauncher\.exe$') {
        $type = 'Game'
      }

      $iconSource = $shortcut.IconLocation + ''
      if ([string]::IsNullOrWhiteSpace($iconSource)) { $iconSource = $target }
      $icon = Get-IconData $iconSource
      $existing = $meta[$key]

      if (-not $existing -or $type -eq 'Game' -or (-not $existing.Icon -and $icon)) {
        $meta[$key] = [PSCustomObject]@{ Icon = $icon; Type = $type }
      }
    }
    catch {}
  }

  Get-ChildItem -LiteralPath $root -Recurse -Filter *.url -ErrorAction SilentlyContinue | ForEach-Object {
    $key = $_.BaseName.Trim().ToLowerInvariant()

    try {
      $lines = Get-Content -LiteralPath $_.FullName -ErrorAction Stop
      $urlLine = $lines | Where-Object { $_ -like 'URL=*' } | Select-Object -First 1
      $iconLine = $lines | Where-Object { $_ -like 'IconFile=*' } | Select-Object -First 1
      $url = (($urlLine + '') -replace '^URL=', '').Trim()
      $iconSource = (($iconLine + '') -replace '^IconFile=', '').Trim()
      $type = if ($url -match '(?i)^(steam|com\.epicgames\.launcher|epicgames|xbox):') { 'Game' } else { 'Application' }
      $icon = Get-IconData $iconSource
      $existing = $meta[$key]

      if (-not $existing -or $type -eq 'Game' -or (-not $existing.Icon -and $icon)) {
        $meta[$key] = [PSCustomObject]@{ Icon = $icon; Type = $type }
      }
    }
    catch {}
  }
}

Get-StartApps | Sort-Object Name | ForEach-Object {
  $key = $_.Name.Trim().ToLowerInvariant()
  $entry = $meta[$key]
  $icon = if ($entry) { $entry.Icon } else { '' }
  $type = if ($entry) { $entry.Type } else { 'Application' }
  [Console]::WriteLine(('{0}{1}{2}{1}{3}{1}{4}' -f $_.Name, [char]31, $_.AppID, $icon, $type))
}
"#;
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| error.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }

    #[cfg(not(target_os = "windows"))]
    Err("Start apps are only available on Windows".into())
}

#[tauri::command]
fn launch_start_app(app_id: String) -> Result<(), String> {
    shell_open(&format!("shell:AppsFolder\\{app_id}"))
}

#[tauri::command]
fn run_system_action(action: String) -> Result<(), String> {
    match action.as_str() {
        "explorer" => shell_open("explorer.exe"),
        "settings" => shell_open("ms-settings:"),
        "terminal" => shell_open("wt.exe"),
        "task-manager" => shell_open("taskmgr.exe"),
        "control-panel" => shell_open("control.exe"),
        "downloads" => shell_open("shell:Downloads"),
        "documents" => shell_open("shell:Personal"),
        "pictures" => shell_open("shell:My Pictures"),
        "profile" => shell_open("shell:Profile"),
        "this-pc" => shell_open("shell:MyComputerFolder"),
        "recycle-bin" => shell_open("shell:RecycleBinFolder"),
        "windows-update" => shell_open("ms-settings:windowsupdate"),
        "bluetooth" => shell_open("ms-settings:bluetooth"),
        "display" => shell_open("ms-settings:display"),
        "sound" => shell_open("ms-settings:sound"),
        "network" => shell_open("ms-settings:network"),
        "installed-apps" => shell_open("ms-settings:appsfeatures"),
        "default-apps" => shell_open("ms-settings:defaultapps"),
        "personalization" => shell_open("ms-settings:personalization"),
        "power-settings" => shell_open("ms-settings:powersleep"),
        "run" => run_hidden("rundll32.exe", &["shell32.dll,#61"]),
        "lock" => run_hidden("rundll32.exe", &["user32.dll,LockWorkStation"]),
        "sign-out" => run_hidden("shutdown.exe", &["/l"]),
        "restart" => run_hidden("shutdown.exe", &["/r", "/t", "0"]),
        "shutdown" => run_hidden("shutdown.exe", &["/s", "/t", "0"]),
        _ => Err("Unknown system action".into()),
    }
}

#[tauri::command]
fn run_node_command(code: String, input: String) -> Result<String, String> {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };

    const NODE_RUNNER: &str = r#"
const fs = require('fs');
const data = fs.readFileSync(0);
if (data.length < 8) throw new Error('Missing Hyperact command input');

const codeLength = Number(data.readBigUInt64LE(0));
const code = data.subarray(8, 8 + codeLength).toString('utf8');
const input = data.subarray(8 + codeLength).toString('utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

console.log = (...args) => process.stderr.write(args.join(' ') + '\n');

(async () => {
  try {
    const execute = new AsyncFunction('input', 'require', 'process', 'Buffer', `"use strict";\n${code}`);
    const output = await execute(input, require, process, Buffer);
    if (output === undefined) throw new Error('Command must return a value');
    process.stdout.write(String(output));
  } catch (error) {
    process.stderr.write(String(error && error.stack ? error.stack : error));
    process.exitCode = 1;
  }
})();
"#;

    let mut command = Command::new("node");
    command
        .args(["-e", NODE_RUNNER])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "Node.js is not installed or not available on PATH".to_string()
        } else {
            error.to_string()
        }
    })?;

    let code_bytes = code.as_bytes();
    let mut stdin = child.stdin.take().ok_or("Could not open Node.js stdin")?;
    stdin
        .write_all(&(code_bytes.len() as u64).to_le_bytes())
        .and_then(|_| stdin.write_all(code_bytes))
        .and_then(|_| stdin.write_all(input.as_bytes()))
        .map_err(|error| error.to_string())?;
    drop(stdin);

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "Node.js command failed".into()
        } else {
            error
        });
    }

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn execute_hotkey_command(
    code: String,
    input_mode: String,
    missing_input: String,
    output_mode: String,
    target: u64,
) -> Result<Vec<u64>, String> {
    use std::{thread, time::Duration};

    windows_text::focus_window(target)?;
    let original_clipboard = windows_text::read_clipboard_text().ok().flatten();
    let mut captured = windows_text::copy_selection()?;
    let mut selected_all = false;

    if captured.is_none() && input_mode != "selected" {
        windows_text::select_all();
        selected_all = true;
        thread::sleep(Duration::from_millis(10));
        captured = windows_text::copy_selection()?;
    }

    if let Some(original) = original_clipboard.as_deref() {
        let _ = windows_text::write_clipboard_text(original);
    }

    let Some(input) = captured else {
        if missing_input == "prompt" {
            return Ok(vec![target, u64::from(selected_all)]);
        }
        return Ok(Vec::new());
    };

    let output = run_node_command(code, input)?;
    windows_text::insert_result(
        target,
        &output,
        &output_mode,
        selected_all,
        original_clipboard.as_deref(),
    )?;
    Ok(Vec::new())
}

#[tauri::command]
fn run_hotkey_command(
    code: String,
    input_mode: String,
    missing_input: String,
    output_mode: String,
) -> Result<Vec<u64>, String> {
    #[cfg(target_os = "windows")]
    {
        let target = windows_text::foreground_window()?;

        if missing_input == "prompt" && windows_text::non_ctrl_modifiers_held() {
            return Ok(vec![target, 0, 1]);
        }

        windows_text::wait_for_non_ctrl_modifiers_release();
        return execute_hotkey_command(code, input_mode, missing_input, output_mode, target);
    }

    #[cfg(not(target_os = "windows"))]
    Err("Focused-text hotkeys are only available on Windows".into())
}

#[tauri::command]
fn resume_hotkey_command(
    code: String,
    input_mode: String,
    missing_input: String,
    output_mode: String,
    target: u64,
) -> Result<Vec<u64>, String> {
    #[cfg(target_os = "windows")]
    {
        windows_text::wait_for_non_ctrl_modifiers_release();
        return execute_hotkey_command(code, input_mode, missing_input, output_mode, target);
    }

    #[cfg(not(target_os = "windows"))]
    Err("Focused-text hotkeys are only available on Windows".into())
}

#[tauri::command]
fn submit_prompt_result(
    target: u64,
    output: String,
    output_mode: String,
    select_all: bool,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let original_clipboard = windows_text::read_clipboard_text().ok().flatten();
        return windows_text::insert_result(
            target,
            &output,
            &output_mode,
            select_all,
            original_clipboard.as_deref(),
        );
    }

    #[cfg(not(target_os = "windows"))]
    Err("Focused-text hotkeys are only available on Windows".into())
}

#[tauri::command]
fn show_launcher_no_activate(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;

        const SWP_NOSIZE: u32 = 0x0001;
        const SWP_NOMOVE: u32 = 0x0002;
        const SWP_NOACTIVATE: u32 = 0x0010;
        const SWP_SHOWWINDOW: u32 = 0x0040;

        #[link(name = "user32")]
        unsafe extern "system" {
            fn SetWindowPos(
                window: *mut c_void,
                insert_after: *mut c_void,
                x: i32,
                y: i32,
                width: i32,
                height: i32,
                flags: u32,
            ) -> i32;
        }

        let window = app
            .get_webview_window("main")
            .ok_or("Hyperact window is unavailable")?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let topmost = -1isize as *mut c_void;
        let result = unsafe {
            SetWindowPos(
                hwnd.0 as *mut c_void,
                topmost,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        };

        if result == 0 {
            Err("Windows could not show Hyperact without activation".into())
        } else {
            Ok(())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let window = app
            .get_webview_window("main")
            .ok_or("Hyperact window is unavailable")?;
        window.show().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn modifiers_held() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_text::modifiers_held()
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[tauri::command]
fn non_ctrl_modifiers_held() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_text::non_ctrl_modifiers_held()
    }

    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
mod windows_text {
    use std::{
        ffi::c_void,
        ptr,
        slice,
        thread,
        time::Duration,
    };

    const CF_UNICODETEXT: u32 = 13;
    const GMEM_MOVEABLE: u32 = 0x0002;
    const INPUT_KEYBOARD: u32 = 1;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_UNICODE: u32 = 0x0004;
    const VK_CONTROL: u8 = 0x11;
    const VK_SHIFT: i32 = 0x10;
    const VK_MENU: i32 = 0x12;
    const VK_LWIN: i32 = 0x5B;
    const VK_RWIN: i32 = 0x5C;
    const VK_A: u8 = 0x41;
    const VK_C: u8 = 0x43;
    const VK_V: u8 = 0x56;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct KeyboardInput {
        virtual_key: u16,
        scan_code: u16,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    union InputData {
        mouse: MouseInput,
        keyboard: KeyboardInput,
    }

    #[repr(C)]
    struct Input {
        kind: u32,
        data: InputData,
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn OpenClipboard(window: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn GetClipboardData(format: u32) -> *mut c_void;
        fn SetClipboardData(format: u32, memory: *mut c_void) -> *mut c_void;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
        fn GetClipboardSequenceNumber() -> u32;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn GetForegroundWindow() -> *mut c_void;
        fn SetForegroundWindow(window: *mut c_void) -> i32;
        fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
        fn keybd_event(key: u8, scan: u8, flags: u32, extra_info: usize);
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
        fn GlobalSize(memory: *mut c_void) -> usize;
    }

    fn open_clipboard() -> Result<(), String> {
        for _ in 0..20 {
            if unsafe { OpenClipboard(ptr::null_mut()) } != 0 {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(5));
        }
        Err("Could not open the Windows clipboard".into())
    }

    pub fn read_clipboard_text() -> Result<Option<String>, String> {
        open_clipboard()?;

        let result = unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
                Ok(None)
            } else {
                let memory = GetClipboardData(CF_UNICODETEXT);
                if memory.is_null() {
                    Err("Could not read the Windows clipboard".into())
                } else {
                    let text = GlobalLock(memory) as *const u16;
                    if text.is_null() {
                        Err("Could not lock clipboard text".into())
                    } else {
                        let max = GlobalSize(memory) / std::mem::size_of::<u16>();
                        let mut len = 0;
                        while len < max && *text.add(len) != 0 {
                            len += 1;
                        }
                        let value = String::from_utf16_lossy(slice::from_raw_parts(text, len));
                        GlobalUnlock(memory);
                        Ok(Some(value))
                    }
                }
            }
        };

        unsafe { CloseClipboard() };
        result
    }

    pub fn write_clipboard_text(value: &str) -> Result<(), String> {
        let utf16: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        let bytes = utf16.len() * std::mem::size_of::<u16>();
        let memory = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes) };
        if memory.is_null() {
            return Err("Could not allocate clipboard text".into());
        }

        let destination = unsafe { GlobalLock(memory) } as *mut u16;
        if destination.is_null() {
            unsafe { GlobalFree(memory) };
            return Err("Could not lock clipboard text".into());
        }

        unsafe {
            ptr::copy_nonoverlapping(utf16.as_ptr(), destination, utf16.len());
            GlobalUnlock(memory);
        }

        if let Err(error) = open_clipboard() {
            unsafe { GlobalFree(memory) };
            return Err(error);
        }

        let result = unsafe {
            if EmptyClipboard() == 0 {
                Err("Could not clear the Windows clipboard".to_string())
            } else if SetClipboardData(CF_UNICODETEXT, memory).is_null() {
                Err("Could not write the Windows clipboard".to_string())
            } else {
                Ok(())
            }
        };

        unsafe { CloseClipboard() };
        if result.is_err() {
            unsafe { GlobalFree(memory) };
        }
        result
    }

    fn send_ctrl_key(key: u8) {
        let ctrl_held = unsafe { key_down(VK_CONTROL as i32) };

        unsafe {
            if !ctrl_held {
                keybd_event(VK_CONTROL, 0, 0, 0);
            }
            keybd_event(key, 0, 0, 0);
            keybd_event(key, 0, KEYEVENTF_KEYUP, 0);
            if !ctrl_held {
                keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0);
            }
        }
    }

    pub fn foreground_window() -> Result<u64, String> {
        let window = unsafe { GetForegroundWindow() };
        if window.is_null() {
            Err("No foreground window is available".into())
        } else {
            Ok(window as usize as u64)
        }
    }

    pub fn focus_window(target: u64) -> Result<(), String> {
        let window = target as usize as *mut c_void;
        if window.is_null() {
            return Err("Could not restore the original window".into());
        }

        if unsafe { GetForegroundWindow() } == window {
            return Ok(());
        }

        if unsafe { SetForegroundWindow(window) } == 0 {
            return Err("Could not restore the original window".into());
        }
        thread::sleep(Duration::from_millis(25));
        Ok(())
    }

    pub fn select_all() {
        send_ctrl_key(VK_A);
    }

    pub fn paste() {
        send_ctrl_key(VK_V);
    }

    pub fn copy_selection() -> Result<Option<String>, String> {
        let sequence = unsafe { GetClipboardSequenceNumber() };
        send_ctrl_key(VK_C);

        for _ in 0..12 {
            thread::sleep(Duration::from_millis(5));
            if unsafe { GetClipboardSequenceNumber() } != sequence {
                return read_clipboard_text();
            }
        }

        Ok(None)
    }

    pub fn type_text(value: &str) -> Result<(), String> {
        let mut inputs = Vec::with_capacity(value.encode_utf16().count() * 2);

        for character in value.encode_utf16() {
            inputs.push(Input {
                kind: INPUT_KEYBOARD,
                data: InputData {
                    keyboard: KeyboardInput {
                        virtual_key: 0,
                        scan_code: character,
                        flags: KEYEVENTF_UNICODE,
                        time: 0,
                        extra_info: 0,
                    },
                },
            });
            inputs.push(Input {
                kind: INPUT_KEYBOARD,
                data: InputData {
                    keyboard: KeyboardInput {
                        virtual_key: 0,
                        scan_code: character,
                        flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                        time: 0,
                        extra_info: 0,
                    },
                },
            });
        }

        if inputs.is_empty() {
            return Ok(());
        }

        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<Input>() as i32,
            )
        };

        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err("Windows could not type the command result".into())
        }
    }

    pub fn insert_result(
        target: u64,
        value: &str,
        output_mode: &str,
        select_all_first: bool,
        original_clipboard: Option<&str>,
    ) -> Result<(), String> {
        focus_window(target)?;
        wait_for_non_ctrl_modifiers_release();

        if select_all_first {
            select_all();
            thread::sleep(Duration::from_millis(10));
        }

        if output_mode == "paste" {
            write_clipboard_text(value)?;
            paste();
            thread::sleep(Duration::from_millis(80));
            if let Some(original) = original_clipboard {
                let _ = write_clipboard_text(original);
            }
            Ok(())
        } else {
            wait_for_modifiers_release();
            type_text(value)
        }
    }

    pub fn non_ctrl_modifiers_held() -> bool {
        unsafe {
            key_down(VK_SHIFT)
                || key_down(VK_MENU)
                || key_down(VK_LWIN)
                || key_down(VK_RWIN)
        }
    }

    pub fn wait_for_non_ctrl_modifiers_release() {
        while non_ctrl_modifiers_held() {
            thread::sleep(Duration::from_millis(5));
        }
    }

    pub fn modifiers_held() -> bool {
        unsafe { key_down(VK_CONTROL as i32) || non_ctrl_modifiers_held() }
    }

    pub fn wait_for_modifiers_release() {
        while modifiers_held() {
            thread::sleep(Duration::from_millis(5));
        }
    }

    unsafe fn key_down(key: i32) -> bool {
        GetAsyncKeyState(key) < 0
    }
}

#[cfg(target_os = "windows")]
fn shell_open(target: &str) -> Result<(), String> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> isize;
    }

    let target: Vec<u16> = std::ffi::OsStr::new(target)
        .encode_wide()
        .chain(Some(0))
        .collect();

    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            ptr::null(),
            target.as_ptr(),
            ptr::null(),
            ptr::null(),
            1,
        )
    };

    if result <= 32 {
        Err("Windows could not open the requested item".into())
    } else {
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_open(_target: &str) -> Result<(), String> {
    Err("This action is only available on Windows".into())
}

#[cfg(target_os = "windows")]
fn run_hidden(program: &str, args: &[&str]) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn run_hidden(_program: &str, _args: &[&str]) -> Result<(), String> {
    Err("This action is only available on Windows".into())
}

fn main() {
    let shortcuts = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcut("alt+space")
        .expect("failed to register Alt+Space shortcut")
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed
                && shortcut.matches(Modifiers::ALT, Code::Space)
            {
                toggle_launcher(app);
            }
        })
        .build();

    tauri::Builder::default()
        .plugin(shortcuts)
        .invoke_handler(tauri::generate_handler![
            get_start_apps,
            launch_start_app,
            run_system_action,
            run_node_command,
            run_hotkey_command,
            resume_hotkey_command,
            submit_prompt_result,
            show_launcher_no_activate,
            modifiers_held,
            non_ctrl_modifiers_held
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hyperact");
}
