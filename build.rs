fn main() {
    #[cfg(windows)]
    {
        if std::path::Path::new("build/windows/icon.ico").exists() {
            let mut res = winres::WindowsResource::new();
            res.set_icon("build/windows/icon.ico");
            if std::path::Path::new("cmd/finova/finova.exe.manifest").exists() {
                res.set_manifest_file("cmd/finova/finova.exe.manifest");
            }
            let _ = res.compile();
        }
    }
}
