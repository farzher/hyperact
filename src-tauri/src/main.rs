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
        mem::zeroed,
        ptr::null,
        sync::{
            atomic::{AtomicBool, AtomicU32, Ordering},
            OnceLock,
        },
        thread,
    };
    use tauri::AppHandle;

    const WH_KEYBOARD_LL: i32 = 13;
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const WM_SYSKEYDOWN: u32 = 0x0104;
    const WM_SYSKEYUP: u32 = 0x0105;
    const VK_SHIFT: i32 = 0x10;
    const VK_CONTROL: i32 = 0x11;
    const VK_MENU: i32 = 0x12;
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;
    const LLKHF_EXTENDED: u32 = 0x01;
    const LLKHF_INJECTED: u32 = 0x10;
    const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static WIN_DOWN: AtomicBool = AtomicBool::new(false);
    static WIN_CHORD: AtomicBool = AtomicBool::new(false);
    static WIN_KEY: AtomicU32 = AtomicU32::new(VK_LWIN);

    #[repr(C)]
    struct KbdLlHookStruct {
        vk_code: u32,
        scan_code: u32,
        flags: u32,
        time: u32,
        extra_info: usize,
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: isize,
        message: u32,
        w_param: usize,
        l_param: isize,
        time: u32,
        point: Point,
        private: u32,
    }

    type HookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowsHookExW(id_hook: i32, proc: Option<HookProc>, module: isize, thread_id: u32) -> isize;
        fn CallNextHookEx(hook: isize, code: i32, w_param: usize, l_param: isize) -> isize;
        fn UnhookWindowsHookEx(hook: isize) -> i32;
        fn GetMessageW(message: *mut Msg, window: isize, min: u32, max: u32) -> i32;
        fn TranslateMessage(message: *const Msg) -> i32;
        fn DispatchMessageW(message: *const Msg) -> isize;
        fn GetAsyncKeyState(key: i32) -> i16;
        fn keybd_event(key: u8, scan: u8, flags: u32, extra_info: usize);
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(module_name: *const u16) -> isize;
    }

    pub fn install(app: AppHandle) {
        let _ = APP.set(app);

        thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_hook),
                GetModuleHandleW(null()),
                0,
            );

            if hook == 0 {
                return;
            }

            let mut message: Msg = zeroed();
            while GetMessageW(&mut message, 0, 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }

            UnhookWindowsHookEx(hook);
        });
    }

    unsafe extern "system" fn keyboard_hook(code: i32, w_param: usize, l_param: isize) -> isize {
        if code < 0 {
            return CallNextHookEx(0, code, w_param, l_param);
        }

        let key = &*(l_param as *const KbdLlHookStruct);
        if key.flags & LLKHF_INJECTED != 0 {
            return CallNextHookEx(0, code, w_param, l_param);
        }

        let message = w_param as u32;
        let is_down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
        let is_up = message == WM_KEYUP || message == WM_SYSKEYUP;

        if !is_down && !is_up {
            return CallNextHookEx(0, code, w_param, l_param);
        }

        let is_win = key.vk_code == VK_LWIN || key.vk_code == VK_RWIN;

        if is_win && is_down {
            if !WIN_DOWN.swap(true, Ordering::SeqCst) {
                WIN_KEY.store(key.vk_code, Ordering::SeqCst);
                let chord = modifier_held(VK_SHIFT)
                    || modifier_held(VK_CONTROL)
                    || modifier_held(VK_MENU);
                WIN_CHORD.store(chord, Ordering::SeqCst);

                if chord {
                    return CallNextHookEx(0, code, w_param, l_param);
                }
            }

            return 1;
        }

        if is_win && is_up {
            if WIN_DOWN.swap(false, Ordering::SeqCst) {
                if WIN_CHORD.swap(false, Ordering::SeqCst) {
                    return CallNextHookEx(0, code, w_param, l_param);
                }

                request_toggle();
                return 1;
            }

            return CallNextHookEx(0, code, w_param, l_param);
        }

        if is_down && WIN_DOWN.load(Ordering::SeqCst) && !WIN_CHORD.swap(true, Ordering::SeqCst) {
            keybd_event(WIN_KEY.load(Ordering::SeqCst) as u8, 0, 0, 0);

            let flags = if key.flags & LLKHF_EXTENDED != 0 {
                KEYEVENTF_EXTENDEDKEY
            } else {
                0
            };
            keybd_event(key.vk_code as u8, key.scan_code as u8, flags, 0);

            return 1;
        }

        CallNextHookEx(0, code, w_param, l_param)
    }

    fn modifier_held(key: i32) -> bool {
        unsafe { GetAsyncKeyState(key) as u16 & 0x8000 != 0 }
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

            if let Some(window) = app.get_webview_window("main") {
                let window_to_hide = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::Focused(false)) {
                        let _ = window_to_hide.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Hyperact");
}
