use std::mem::size_of;

pub const KEY_UP: u32 = 0x0002;
pub const UNICODE: u32 = 0x0004;
const INPUT_KEYBOARD: u32 = 1;

#[derive(Clone, Copy)]
pub struct KeyboardEvent {
    pub virtual_key: u16,
    pub scan_code: u16,
    pub flags: u32,
    pub extra_info: usize,
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
union InputData {
    keyboard: KeyboardInput,
    mouse: MouseInput,
}

#[repr(C)]
struct Input {
    kind: u32,
    data: InputData,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn SendInput(count: u32, inputs: *const Input, size: i32) -> u32;
}

fn inputs(events: &[KeyboardEvent]) -> Vec<Input> {
    events
        .iter()
        .map(|event| Input {
            kind: INPUT_KEYBOARD,
            data: InputData {
                keyboard: KeyboardInput {
                    virtual_key: event.virtual_key,
                    scan_code: event.scan_code,
                    flags: event.flags,
                    time: 0,
                    extra_info: event.extra_info,
                },
            },
        })
        .collect()
}

pub fn send_keyboard(events: &[KeyboardEvent]) -> bool {
    let inputs = inputs(events);
    inputs.is_empty()
        || unsafe {
            SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<Input>() as i32)
                == inputs.len() as u32
        }
}
