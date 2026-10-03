fn main() {
    // lld-link avisa que no encuentra los .pdb de la CRT de MSVC (LNK4099).
    // Es inofensivo (no generamos símbolos de debug en release), así que lo silenciamos.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg=/IGNORE:4099");
    }
    tauri_build::build()
}
