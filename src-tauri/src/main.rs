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
        let script = r#"[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-StartApps | Sort-Object Name | ForEach-Object { [Console]::WriteLine(('{0}{1}{2}' -f $_.Name,[char]31,$_.AppID)) }"#;
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
        Err(format!("Windows could not open {target:?}"))
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
            run_system_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hyperact");
}
