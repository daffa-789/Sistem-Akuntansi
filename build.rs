fn main() {
    println!("cargo:rerun-if-changed=build/windows/icon.ico");
    println!("cargo:rerun-if-changed=build.rs");
    #[cfg(windows)]
    {
        if std::path::Path::new("build/windows/icon.ico").exists() {
            let mut res = winres::WindowsResource::new();
            res.set_icon("build/windows/icon.ico");
            if let Err(e) = res.compile() {
                eprintln!("cargo:warning=Failed to compile Windows icon resource: {}", e);
            }
        }
    }
}
