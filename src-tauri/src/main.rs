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
            atomic::{AtomicBool, Ordering},
            mpsc::sync_channel,
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
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;
    const VK_MASK: u8 = 0xE8;
    const LLKHF_INJECTED: u32 = 0x10;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static WIN_DOWN: AtomicBool = AtomicBool::new(false);
    static WIN_CHORD: AtomicBool = AtomicBool::new(false);
    static SHIFT_DOWN: AtomicBool = AtomicBool::new(false);
    static CTRL_DOWN: AtomicBool = AtomicBool::new(false);
    static ALT_DOWN: AtomicBool = AtomicBool::new(false);

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
        fn keybd_event(key: u8, scan: u8, flags: u32, extra_info: usize);
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(module_name: *const u16) -> isize;
    }

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

            let _ = ready_tx.send(hook != 0);
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

        let _ = ready_rx.recv();
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

        update_modifier_state(key.vk_code, is_down, is_up);

        let is_win = key.vk_code == VK_LWIN || key.vk_code == VK_RWIN;

        if is_win && is_down {
            if !WIN_DOWN.swap(true, Ordering::SeqCst) {
                WIN_CHORD.store(modifier_held(), Ordering::SeqCst);

                // Let Windows receive the real Win key, but insert an inert keypress
                // so releasing Win is not interpreted as a bare Start-menu tap.
                mask_start_menu();
            }

            return CallNextHookEx(0, code, w_param, l_param);
        }

        if is_win && is_up {
            if WIN_DOWN.swap(false, Ordering::SeqCst) {
                let chord = WIN_CHORD.swap(false, Ordering::SeqCst);
                if !chord {
                    request_toggle();
                }
            }

            return CallNextHookEx(0, code, w_param, l_param);
        }

        if is_down && WIN_DOWN.load(Ordering::SeqCst) {
            WIN_CHORD.store(true, Ordering::SeqCst);
        }

        CallNextHookEx(0, code, w_param, l_param)
    }

    fn update_modifier_state(key: u32, down: bool, up: bool) {
        let state = down && !up;
        match key {
            0x10 | 0xA0 | 0xA1 => SHIFT_DOWN.store(state, Ordering::SeqCst),
            0x11 | 0xA2 | 0xA3 => CTRL_DOWN.store(state, Ordering::SeqCst),
            0x12 | 0xA4 | 0xA5 => ALT_DOWN.store(state, Ordering::SeqCst),
            _ => {}
        }
    }

    fn modifier_held() -> bool {
        SHIFT_DOWN.load(Ordering::SeqCst)
            || CTRL_DOWN.load(Ordering::SeqCst)
            || ALT_DOWN.load(Ordering::SeqCst)
    }

    unsafe fn mask_start_menu() {
        keybd_event(VK_MASK, 0, 0, 0);
        keybd_event(VK_MASK, 0, KEYEVENTF_KEYUP, 0);
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
