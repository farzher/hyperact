#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Manager};

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

#[cfg(target_os = "windows")]
mod windows_key {
    use super::toggle_launcher;
    use std::{
        mem::{size_of, zeroed},
        ptr::{null, null_mut},
        sync::{
            atomic::{AtomicU32, AtomicU8, Ordering},
            mpsc::sync_channel,
            OnceLock,
        },
        thread,
    };
    use tauri::AppHandle;
    use windows_sys::Win32::{
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT,
                KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN,
                VK_SHIFT,
            },
            WindowsAndMessaging::{
                CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW,
                TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL,
                WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
            },
        },
    };

    const WIN_IDLE: u8 = 0;
    const WIN_PENDING: u8 = 1;
    const WIN_COMBINATION: u8 = 2;
    const HYPERACT_INPUT_TAG: usize = 0x4859_5041;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static WIN_STATE: AtomicU8 = AtomicU8::new(WIN_IDLE);
    static WIN_KEY: AtomicU32 = AtomicU32::new(VK_LWIN as u32);

    pub fn install(app: AppHandle) {
        let _ = APP.set(app);
        let (ready_tx, ready_rx) = sync_channel(1);

        thread::spawn(move || unsafe {
            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_hook),
                GetModuleHandleW(null()),
                0,
            );

            let _ = ready_tx.send(!hook.is_null());
            if hook.is_null() {
                return;
            }

            let mut message: MSG = zeroed();
            while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }

            UnhookWindowsHookEx(hook);
        });

        let _ = ready_rx.recv();
    }

    unsafe extern "system" fn keyboard_hook(code: i32, w_param: usize, l_param: isize) -> isize {
        if code < 0 {
            return CallNextHookEx(null_mut(), code, w_param, l_param);
        }

        let key = &*(l_param as *const KBDLLHOOKSTRUCT);

        // Only ignore input synthesized by Hyperact itself. Other injected input
        // should behave like physical input so remappers and unusual keyboards work.
        if key.dwExtraInfo == HYPERACT_INPUT_TAG {
            return CallNextHookEx(null_mut(), code, w_param, l_param);
        }

        let message = w_param as u32;
        let is_down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        let is_up = message == WM_KEYUP || message == WM_SYSKEYUP;

        if !is_down && !is_up {
            return CallNextHookEx(null_mut(), code, w_param, l_param);
        }

        let is_win = key.vkCode == VK_LWIN as u32 || key.vkCode == VK_RWIN as u32;

        if is_win && is_down {
            if WIN_STATE.load(Ordering::SeqCst) != WIN_IDLE {
                return 1;
            }

            WIN_KEY.store(key.vkCode, Ordering::SeqCst);
            WIN_STATE.store(WIN_PENDING, Ordering::SeqCst);

            // A modifier already held before Win means this cannot be a bare Win tap.
            if modifier_held() {
                promote_to_combination();
            }

            // Always suppress the physical Win-down. If another key joins it, we
            // synthesize the original Win-down immediately before that key continues.
            return 1;
        }

        if is_win && is_up {
            if key.vkCode != WIN_KEY.load(Ordering::SeqCst) {
                return 1;
            }

            match WIN_STATE.swap(WIN_IDLE, Ordering::SeqCst) {
                WIN_PENDING => request_toggle(),
                WIN_COMBINATION => send_win(false),
                _ => {}
            }

            // The physical Win-up always matches a physical Win-down we suppressed.
            return 1;
        }

        if is_down && WIN_STATE.load(Ordering::SeqCst) == WIN_PENDING {
            promote_to_combination();
        }

        CallNextHookEx(null_mut(), code, w_param, l_param)
    }

    unsafe fn modifier_held() -> bool {
        key_held(VK_SHIFT) || key_held(VK_CONTROL) || key_held(VK_MENU)
    }

    unsafe fn key_held(key: u16) -> bool {
        GetAsyncKeyState(key as i32) as u16 & 0x8000 != 0
    }

    unsafe fn promote_to_combination() {
        if WIN_STATE.swap(WIN_COMBINATION, Ordering::SeqCst) == WIN_PENDING {
            send_win(true);
        }
    }

    unsafe fn send_win(down: bool) {
        let input = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: WIN_KEY.load(Ordering::SeqCst) as u16,
                    wScan: 0,
                    dwFlags: KEYEVENTF_EXTENDEDKEY | if down { 0 } else { KEYEVENTF_KEYUP },
                    time: 0,
                    dwExtraInfo: HYPERACT_INPUT_TAG,
                },
            },
        };

        SendInput(1, &input, size_of::<INPUT>() as i32);
    }

    fn request_toggle() {
        if let Some(app) = APP.get() {
            let runner = app.clone();
            let app = app.clone();
            let _ = runner.run_on_main_thread(move || toggle_launcher(&app));
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "windows")]
            windows_key::install(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hyperact");
}
