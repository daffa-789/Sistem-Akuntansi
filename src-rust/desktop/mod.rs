use std::path::PathBuf;
use tao::{
    dpi::LogicalSize,
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    window::WindowBuilder,
};
use wry::WebViewBuilder;

pub const WINDOW_TITLE: &str = "Finova — Sistem Akuntansi";

#[cfg(windows)]
pub fn hide_console() {
    unsafe {
        let hwnd = windows_sys::Win32::System::Console::GetConsoleWindow();
        if hwnd != std::ptr::null_mut() {
            windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                hwnd,
                windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn hide_console() {}

#[cfg(windows)]
pub fn focus_existing(title: &str) -> bool {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    let wide_title: Vec<u16> = OsStr::new(title).encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        let hwnd = windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW(
            std::ptr::null(),
            wide_title.as_ptr(),
        );
        if hwnd != std::ptr::null_mut() {
            windows_sys::Win32::UI::WindowsAndMessaging::ShowWindow(
                hwnd,
                windows_sys::Win32::UI::WindowsAndMessaging::SW_RESTORE,
            );
            windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow(hwnd);
            return true;
        }
    }
    false
}

#[cfg(not(windows))]
pub fn focus_existing(_title: &str) -> bool {
    false
}

pub fn open_browser(url: &str) {
    let _ = webbrowser::open(url);
}

const ICON_RGBA_64: &[u8] = include_bytes!("icon_64x64.rgba");

fn load_window_icon() -> Option<tao::window::Icon> {
    tao::window::Icon::from_rgba(ICON_RGBA_64.to_vec(), 64, 64).ok()
}

pub fn run_window(
    url: &str,
    user_data_dir: PathBuf,
    devtools: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let event_loop = EventLoop::new();

    let mut window_builder = WindowBuilder::new()
        .with_title(WINDOW_TITLE)
        .with_inner_size(LogicalSize::new(1280.0, 800.0));

    if let Some(icon) = load_window_icon() {
        window_builder = window_builder.with_window_icon(Some(icon));
    }

    let window = window_builder.build(&event_loop)?;

    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use tao::platform::windows::WindowExtWindows;
        use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            LoadImageW, SendMessageW, HICON, ICON_BIG, ICON_SMALL, IMAGE_ICON,
            LR_DEFAULTCOLOR, WM_SETICON,
        };
        use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

        let aumid: Vec<u16> = OsStr::new("Finova.Accounting.App")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let _ = SetCurrentProcessExplicitAppUserModelID(aumid.as_ptr());
            let hwnd = window.hwnd() as windows_sys::Win32::Foundation::HWND;
            let hinstance = GetModuleHandleW(std::ptr::null());
            let hicon_big = LoadImageW(
                hinstance,
                1 as _,
                IMAGE_ICON,
                48,
                48,
                LR_DEFAULTCOLOR,
            ) as HICON;
            let hicon_small = LoadImageW(
                hinstance,
                1 as _,
                IMAGE_ICON,
                16,
                16,
                LR_DEFAULTCOLOR,
            ) as HICON;
            if hicon_big != std::ptr::null_mut() {
                SendMessageW(hwnd, WM_SETICON, ICON_BIG as _, hicon_big as _);
            }
            if hicon_small != std::ptr::null_mut() {
                SendMessageW(hwnd, WM_SETICON, ICON_SMALL as _, hicon_small as _);
            }
        }
    }

    let mut web_context = wry::WebContext::new(Some(user_data_dir));

    #[cfg(windows)]
    let builder = {
        use wry::WebViewBuilderExtWindows;
        let mut b = WebViewBuilder::new_with_web_context(&mut web_context);
        b = b.with_additional_browser_args("--autoplay-policy=no-user-gesture-required");
        b = b.with_devtools(devtools);
        b = b.with_url(url);
        b
    };

    #[cfg(not(windows))]
    let builder = {
        let mut b = WebViewBuilder::new_with_web_context(&mut web_context);
        b = b.with_devtools(devtools);
        b = b.with_url(url);
        b
    };

    let _webview = builder.build(&window)?;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::NewEvents(StartCause::Init) => {}
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control_flow = ControlFlow::Exit,
            _ => (),
        }
    });
}
