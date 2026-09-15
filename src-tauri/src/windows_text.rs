use std::{
    ffi::c_void,
    ptr,
    slice,
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

use uiautomation::{types::{ControlType, Point}, UIAutomation};

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

#[derive(Clone, Copy)]
struct FocusSnapshot {
    target: u64,
    point: Option<(i32, i32)>,
    editable: bool,
}

static FOCUS_SNAPSHOT: OnceLock<Mutex<Option<FocusSnapshot>>> = OnceLock::new();

fn focus_snapshot() -> &'static Mutex<Option<FocusSnapshot>> {
    FOCUS_SNAPSHOT.get_or_init(|| Mutex::new(None))
}

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

#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct GuiThreadInfo {
    cb_size: u32,
    flags: u32,
    hwnd_active: *mut c_void,
    hwnd_focus: *mut c_void,
    hwnd_capture: *mut c_void,
    hwnd_menu_owner: *mut c_void,
    hwnd_move_size: *mut c_void,
    hwnd_caret: *mut c_void,
    rc_caret: Rect,
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
    fn GetWindowThreadProcessId(window: *mut c_void, process_id: *mut u32) -> u32;
    fn GetGUIThreadInfo(thread_id: u32, info: *mut GuiThreadInfo) -> i32;
    fn AttachThreadInput(from: u32, to: u32, attach: i32) -> i32;
    fn SetFocus(window: *mut c_void) -> *mut c_void;
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
    fn GetCurrentThreadId() -> u32;
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

pub fn capture_focus(target: u64) -> u64 {
    let native_focus = focused_control(target);

    if let Ok(mut current) = focus_snapshot().lock() {
        *current = Some(FocusSnapshot {
            target,
            point: None,
            editable: false,
        });
    }

    thread::spawn(move || {
        let detected = (|| {
            if unsafe { GetForegroundWindow() } as usize as u64 != target {
                return None;
            }

            let automation = UIAutomation::new().ok()?;
            let element = automation.get_focused_element().ok()?;
            let control_type = element.get_control_type().ok()?;
            let rect = element.get_bounding_rectangle().ok()?;

            if rect.get_width() <= 1 || rect.get_height() <= 1 {
                return None;
            }

            let point = (
                (rect.get_left() + rect.get_right()) / 2,
                (rect.get_top() + rect.get_bottom()) / 2,
            );
            let editable = matches!(control_type, ControlType::Edit | ControlType::ComboBox);
            Some((point, editable))
        })();

        let snapshot = match detected {
            Some((point, editable)) => FocusSnapshot {
                target,
                point: Some(point),
                editable,
            },
            None => FocusSnapshot {
                target,
                point: None,
                editable: false,
            },
        };

        if unsafe { GetForegroundWindow() } as usize as u64 != target {
            return;
        }

        if let Ok(mut current) = focus_snapshot().lock() {
            if current.is_some_and(|snapshot| snapshot.target == target) {
                *current = Some(snapshot);
            }
        }
    });

    native_focus
}

pub fn focused_is_editable(target: u64) -> bool {
    focus_snapshot()
        .lock()
        .ok()
        .and_then(|current| *current)
        .is_some_and(|snapshot| snapshot.target == target && snapshot.editable)
}

pub fn restore_uia_focus(target: u64) -> bool {
    let snapshot = focus_snapshot()
        .lock()
        .ok()
        .and_then(|current| *current);
    let Some(snapshot) = snapshot else {
        return false;
    };
    if snapshot.target != target || !snapshot.editable {
        return false;
    }
    let Some((x, y)) = snapshot.point else {
        return false;
    };

    thread::spawn(move || {
        let Ok(automation) = UIAutomation::new() else {
            return false;
        };
        let Ok(mut element) = automation.element_from_point(Point::new(x, y)) else {
            return false;
        };
        let walker = automation.get_control_view_walker().ok();

        for _ in 0..5 {
            if matches!(
                element.get_control_type(),
                Ok(ControlType::Edit) | Ok(ControlType::ComboBox)
            ) {
                return element.set_focus().is_ok();
            }

            let Some(walker) = walker.as_ref() else {
                break;
            };
            let Ok(parent) = walker.get_parent(&element) else {
                break;
            };
            element = parent;
        }

        false
    })
    .join()
    .unwrap_or(false)
}

pub fn focused_control(target: u64) -> u64 {
    let window = target as usize as *mut c_void;
    if window.is_null() {
        return 0;
    }

    let thread_id = unsafe { GetWindowThreadProcessId(window, ptr::null_mut()) };
    if thread_id == 0 {
        return 0;
    }

    let mut info: GuiThreadInfo = unsafe { std::mem::zeroed() };
    info.cb_size = std::mem::size_of::<GuiThreadInfo>() as u32;
    if unsafe { GetGUIThreadInfo(thread_id, &mut info) } == 0 || info.hwnd_focus.is_null() {
        0
    } else {
        info.hwnd_focus as usize as u64
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

pub fn restore_control(target: u64, focus: u64) -> Result<(), String> {
    focus_window(target)?;
    if focus == 0 {
        return Ok(());
    }

    let window = focus as usize as *mut c_void;
    if window.is_null() {
        return Ok(());
    }

    let target_thread = unsafe { GetWindowThreadProcessId(window, ptr::null_mut()) };
    let current_thread = unsafe { GetCurrentThreadId() };
    let attached = target_thread != 0
        && target_thread != current_thread
        && unsafe { AttachThreadInput(current_thread, target_thread, 1) } != 0;

    unsafe { SetFocus(window) };

    if attached {
        unsafe { AttachThreadInput(current_thread, target_thread, 0) };
    }
    thread::sleep(Duration::from_millis(5));
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
        thread::sleep(Duration::from_millis(1));
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
