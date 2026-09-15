#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

#[cfg(target_os = "windows")]
mod windows_text;

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
    focus: u64,
) -> Result<Vec<u64>, String> {
    windows_text::focus_window(target)?;
    let original_clipboard = windows_text::read_clipboard_text().ok().flatten();
    let mut captured = windows_text::copy_selection()?;
    let mut selected_all = false;

    if captured.is_none()
        && input_mode != "selected"
        && windows_text::focused_is_editable(target)
    {
        windows_text::select_all();
        selected_all = true;
        captured = windows_text::copy_selection()?;
    }

    if let Some(original) = original_clipboard.as_deref() {
        let _ = windows_text::write_clipboard_text(original);
    }

    let Some(input) = captured else {
        if missing_input == "prompt" {
            return Ok(vec![target, u64::from(selected_all), 0, focus]);
        }
        return Ok(Vec::new());
    };

    let output = run_node_command(code, input)?;
    if !windows_text::restore_uia_focus(target) {
        windows_text::restore_control(target, focus)?;
    }
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
        let focus = windows_text::capture_focus(target);

        if missing_input == "prompt" && windows_text::non_ctrl_modifiers_held() {
            return Ok(vec![target, 0, 1, focus]);
        }

        windows_text::wait_for_non_ctrl_modifiers_release();
        return execute_hotkey_command(code, input_mode, missing_input, output_mode, target, focus);
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
    focus: u64,
) -> Result<Vec<u64>, String> {
    #[cfg(target_os = "windows")]
    {
        windows_text::wait_for_non_ctrl_modifiers_release();
        return execute_hotkey_command(code, input_mode, missing_input, output_mode, target, focus);
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
    focus: u64,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let original_clipboard = windows_text::read_clipboard_text().ok().flatten();
        if !windows_text::restore_uia_focus(target) {
            windows_text::restore_control(target, focus)?;
        }
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
            modifiers_held,
            non_ctrl_modifiers_held
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hyperact");
}
