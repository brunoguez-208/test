// Evita la ventana de consola en release en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    snip_lib::run();
}
