use std::{
    ffi::c_void,
    ptr,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

const WM_COPYDATA: u32 = 0x004a;
const PM_REMOVE: u32 = 0x0001;
const EVERYTHING_COPYDATA_QUERY_W: usize = 2;
const REPLY_ID: usize = 0x4859_5045;
const FOLDER_FLAG: u32 = 0x0000_0001;
const MAX_RESULTS: u32 = 80;

#[derive(Clone)]
struct FileResult {
    name: String,
    path: String,
    folder: bool,
}

static SEARCH_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static RESULTS: OnceLock<Mutex<Option<Vec<FileResult>>>> = OnceLock::new();

fn search_lock() -> &'static Mutex<()> {
    SEARCH_LOCK.get_or_init(|| Mutex::new(()))
}

fn results() -> &'static Mutex<Option<Vec<FileResult>>> {
    RESULTS.get_or_init(|| Mutex::new(None))
}

#[repr(C)]
struct CopyData {
    data: usize,
    size: u32,
    value: *const c_void,
}

#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
struct Message {
    window: *mut c_void,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    point: Point,
}

#[repr(C)]
struct WindowClass {
    style: u32,
    proc: Option<unsafe extern "system" fn(*mut c_void, u32, usize, isize) -> isize>,
    class_extra: i32,
    window_extra: i32,
    instance: *mut c_void,
    icon: *mut c_void,
    cursor: *mut c_void,
    background: *mut c_void,
    menu_name: *const u16,
    class_name: *const u16,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn FindWindowW(class_name: *const u16, window_name: *const u16) -> *mut c_void;
    fn RegisterClassW(class: *const WindowClass) -> u16;
    fn CreateWindowExW(
        ex_style: u32,
        class_name: *const u16,
        window_name: *const u16,
        style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: *mut c_void,
        menu: *mut c_void,
        instance: *mut c_void,
        parameter: *mut c_void,
    ) -> *mut c_void;
    fn DestroyWindow(window: *mut c_void) -> i32;
    fn DefWindowProcW(window: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
    fn SendMessageW(window: *mut c_void, message: u32, wparam: usize, lparam: isize) -> isize;
    fn PeekMessageW(
        message: *mut Message,
        window: *mut c_void,
        min: u32,
        max: u32,
        remove: u32,
    ) -> i32;
    fn TranslateMessage(message: *const Message) -> i32;
    fn DispatchMessageW(message: *const Message) -> isize;
}

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleW(name: *const u16) -> *mut c_void;
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

unsafe fn read_u32(base: *const u8, size: usize, offset: usize) -> Option<u32> {
    if offset + 4 > size {
        return None;
    }
    Some(ptr::read_unaligned(base.add(offset) as *const u32))
}

unsafe fn read_utf16(base: *const u8, size: usize, offset: usize) -> Option<String> {
    if offset >= size {
        return None;
    }

    let mut units = Vec::new();
    let mut at = offset;
    while at + 2 <= size {
        let unit = ptr::read_unaligned(base.add(at) as *const u16);
        if unit == 0 {
            return Some(String::from_utf16_lossy(&units));
        }
        units.push(unit);
        at += 2;
    }
    None
}

unsafe fn parse_results(data: *const c_void, size: usize) -> Vec<FileResult> {
    if data.is_null() || size < 28 {
        return Vec::new();
    }

    let base = data as *const u8;
    let count = read_u32(base, size, 20).unwrap_or(0).min(MAX_RESULTS) as usize;
    let mut output = Vec::with_capacity(count);

    for index in 0..count {
        let item = 28 + index * 12;
        let Some(flags) = read_u32(base, size, item) else { break };
        let Some(name_offset) = read_u32(base, size, item + 4) else { break };
        let Some(path_offset) = read_u32(base, size, item + 8) else { break };
        let Some(name) = read_utf16(base, size, name_offset as usize) else { continue };
        let Some(path) = read_utf16(base, size, path_offset as usize) else { continue };

        output.push(FileResult {
            name,
            path,
            folder: flags & FOLDER_FLAG != 0,
        });
    }

    output
}

unsafe extern "system" fn window_proc(
    window: *mut c_void,
    message: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if message == WM_COPYDATA && lparam != 0 {
        let copy = &*(lparam as *const CopyData);
        if copy.data == REPLY_ID {
            let parsed = parse_results(copy.value, copy.size as usize);
            if let Ok(mut current) = results().lock() {
                *current = Some(parsed);
            }
            return 1;
        }
    }

    DefWindowProcW(window, message, wparam, lparam)
}

fn make_reply_window() -> Result<*mut c_void, String> {
    let class_name = wide("HYPERACT_EVERYTHING_IPC");
    let instance = unsafe { GetModuleHandleW(ptr::null()) };
    if instance.is_null() {
        return Err("Could not initialize Everything search".into());
    }

    let class = WindowClass {
        style: 0,
        proc: Some(window_proc),
        class_extra: 0,
        window_extra: 0,
        instance,
        icon: ptr::null_mut(),
        cursor: ptr::null_mut(),
        background: ptr::null_mut(),
        menu_name: ptr::null(),
        class_name: class_name.as_ptr(),
    };

    unsafe {
        RegisterClassW(&class);
        let window = CreateWindowExW(
            0,
            class_name.as_ptr(),
            ptr::null(),
            0,
            0,
            0,
            0,
            0,
            ptr::null_mut(),
            ptr::null_mut(),
            instance,
            ptr::null_mut(),
        );
        if window.is_null() {
            Err("Could not initialize Everything search".into())
        } else {
            Ok(window)
        }
    }
}

fn make_query(window: *mut c_void, search: &str) -> Vec<u8> {
    let text: Vec<u16> = search.encode_utf16().chain(Some(0)).collect();
    let mut data = Vec::with_capacity(
        std::mem::size_of::<usize>() * 2 + 12 + text.len() * std::mem::size_of::<u16>(),
    );

    data.extend_from_slice(&(window as usize).to_ne_bytes());
    data.extend_from_slice(&REPLY_ID.to_ne_bytes());
    data.extend_from_slice(&0u32.to_ne_bytes());
    data.extend_from_slice(&0u32.to_ne_bytes());
    data.extend_from_slice(&MAX_RESULTS.to_ne_bytes());
    for unit in text {
        data.extend_from_slice(&unit.to_ne_bytes());
    }
    data
}

fn search_expression(query: &str) -> Result<String, String> {
    let profile = std::env::var("USERPROFILE").map_err(|_| "USERPROFILE is unavailable")?;
    let scope = format!("{}\\", profile.trim_end_matches(['\\', '/']));
    let query = query.replace('"', "").trim().to_string();
    if query.is_empty() {
        return Ok(String::new());
    }

    Ok(format!(
        "\"{scope}\" \"{query}\" !\\AppData !\\node_modules !\\.git !\\target !\\dist !\\build !\\__pycache__ !\\.venv !\\venv !attrib:h !attrib:s"
    ))
}

#[tauri::command]
pub fn search_files(query: String) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let search = search_expression(&query)?;
        if search.is_empty() {
            return Ok(String::new());
        }

        let _guard = search_lock()
            .lock()
            .map_err(|_| "Everything search is unavailable")?;
        if let Ok(mut current) = results().lock() {
            *current = None;
        }

        let everything_class = wide("EVERYTHING_TASKBAR_NOTIFICATION");
        let everything = unsafe { FindWindowW(everything_class.as_ptr(), ptr::null()) };
        if everything.is_null() {
            return Err("Everything is not running".into());
        }

        let reply = make_reply_window()?;
        let query_data = make_query(reply, &search);
        let copy = CopyData {
            data: EVERYTHING_COPYDATA_QUERY_W,
            size: query_data.len() as u32,
            value: query_data.as_ptr() as *const c_void,
        };

        let sent = unsafe {
            SendMessageW(
                everything,
                WM_COPYDATA,
                reply as usize,
                &copy as *const CopyData as isize,
            )
        };

        if sent == 0 {
            unsafe { DestroyWindow(reply) };
            return Err("Everything IPC is unavailable".into());
        }

        let deadline = Instant::now() + Duration::from_millis(120);
        while Instant::now() < deadline {
            if results().lock().ok().is_some_and(|current| current.is_some()) {
                break;
            }

            let mut message: Message = unsafe { std::mem::zeroed() };
            while unsafe { PeekMessageW(&mut message, ptr::null_mut(), 0, 0, PM_REMOVE) } != 0 {
                unsafe {
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
            thread::sleep(Duration::from_millis(1));
        }

        unsafe { DestroyWindow(reply) };
        let found = results()
            .lock()
            .ok()
            .and_then(|mut current| current.take())
            .ok_or("Everything did not respond")?;

        Ok(found
            .into_iter()
            .map(|item| {
                format!(
                    "{}\x1f{}\x1f{}",
                    item.name,
                    item.path,
                    if item.folder { "1" } else { "0" }
                )
            })
            .collect::<Vec<_>>()
            .join("\n"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = query;
        Err("Everything search is only available on Windows".into())
    }
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;

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

        let value: Vec<u16> = std::ffi::OsStr::new(&path)
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                ptr::null_mut(),
                ptr::null(),
                value.as_ptr(),
                ptr::null(),
                ptr::null(),
                1,
            )
        };
        if result <= 32 {
            Err("Windows could not open the file".into())
        } else {
            Ok(())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Opening files is only available on Windows".into())
    }
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        Command::new("explorer.exe")
            .arg("/select,")
            .arg(path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("File Explorer is only available on Windows".into())
    }
}
