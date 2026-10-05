use tauri::{
  menu::{Menu, MenuItem},
  tray::TrayIconBuilder,
  Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const ADMIN_URL: &str = "https://madcactus-dashboard.fly.dev/admin";
const ALLOWED_HOST: &str = "madcactus-dashboard.fly.dev";

fn show_main(app: &tauri::AppHandle) {
  if let Some(win) = app.get_webview_window("main") {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Same-origin navigation stays in the window; anything else (e.g.
      // YouTube embeds, docs links) opens in the default browser.
      let handle = app.handle().clone();
      let url: tauri::Url = ADMIN_URL.parse().expect("valid admin url");
      WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("aspectrr Admin")
        .inner_size(1400.0, 900.0)
        // Kill the rubber-band bounce so it feels like an app pane, not a page.
        .initialization_script(
          "(function(){var s=document.createElement('style');s.textContent='html,body{overscroll-behavior:none!important}';(document.head||document.documentElement).appendChild(s)})();",
        )
        .on_navigation(move |nav| {
          let keep = nav.host_str() == Some(ALLOWED_HOST) || nav.scheme() == "about";
          if !keep {
            let _ = handle.opener().open_url(nav.to_string(), None::<&str>);
          }
          keep
        })
        .build()?;

      let open = MenuItem::with_id(app, "open", "Open aspectrr Admin", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit aspectrr Admin", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &quit])?;
      let tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().expect("default window icon").clone())
        .tooltip("aspectrr Admin")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => show_main(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .build(app)?;
      // The tray icon must outlive setup; leaking one small struct for the
      // app lifetime is the simplest way to guarantee it.
      std::mem::forget(tray);

      Ok(())
    })
    // Closing the window hides to the tray; quitting happens from the tray menu.
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
