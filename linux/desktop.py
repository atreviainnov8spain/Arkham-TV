"""Arkham TV's native GTK window and local server lifecycle."""

import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
TITLE = "Arkham TV"

try:
    import gi

    gi.require_version("Gdk", "3.0")
    gi.require_version("Gtk", "3.0")
    gi.require_version("Gst", "1.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import Gdk, Gio, GLib, Gst, Gtk, WebKit2
except (ImportError, ValueError) as error:
    message = "No se pudo abrir la ventana de Arkham TV."
    print(f"{message} {error}", file=sys.stderr)
    if (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")) and (dialog := shutil.which("zenity")):
        subprocess.run([dialog, "--error", "--title", TITLE, "--text", message], check=False)
    sys.exit(1)


class Desktop(Gtk.Application):
    def __init__(self, data):
        flags = Gio.ApplicationFlags.NON_UNIQUE if os.environ.get("SNAP") else Gio.ApplicationFlags.FLAGS_NONE
        application_id = os.environ.get("FLATPAK_ID", "com.arkhamtv.desktop")
        super().__init__(application_id=application_id, flags=flags)
        self.data = data
        self.window = self.view = self.server = self.lock = None
        self.folder_picker = None
        self.mini = None
        self.mini_active = False
        self.origin = None
        self.failed = False
        self.ready = data / ".desktop-port-ready"
        self.language_file = data / "language"
        try:
            self.language = self.language_file.read_text(encoding="ascii").strip()
        except (OSError, ValueError):
            self.language = "es"

    def tr(self, spanish, english):
        return english if self.language == "en" else spanish

    def change_language(self, _manager, result):
        value = result.get_js_value().to_string()
        if value not in {"es", "en"} or value == self.language:
            return
        self.language = value
        try:
            self.language_file.write_text(value, encoding="ascii")
        except OSError as error:
            print(error, file=sys.stderr)
        label = self.tr("Minimizar", "Minimize")
        self.minimize_button.set_tooltip_text(label)
        self.minimize_button.get_accessible().set_name(label)
        if self.mini:
            self.mini.get_titlebar().set_title(self.tr("Arkham TV · Minirreproductor", "Arkham TV · Mini player"))

    def do_activate(self):
        if self.window:
            if self.mini_active:
                self.restore_window()
            else:
                self.window.present()
            return

        self.window = Gtk.ApplicationWindow(application=self, title=TITLE)
        self.window.set_default_size(1240, 815)
        self.window.set_size_request(440, 360)
        self.window.set_icon_from_file(str(ROOT / "assets" / "arkhamtv-icon.png"))
        header = self.header_bar(TITLE, ":maximize,close")
        minimize = Gtk.Button.new_from_icon_name("window-minimize-symbolic", Gtk.IconSize.BUTTON)
        label = self.tr("Minimizar", "Minimize")
        self.minimize_button = minimize
        minimize.set_tooltip_text(label)
        minimize.get_accessible().set_name(label)
        minimize.connect("clicked", lambda *_: self.minimize())
        header.pack_end(minimize)
        self.window.set_titlebar(header)
        self.window.connect("window-state-event", self.window_state)
        self.window.connect("destroy", lambda *_: self.quit())
        self.window.add(Gtk.Label(label=self.tr("Conectando Arkham TV…", "Connecting to Arkham TV…")))
        self.window.show_all()
        self.window.present()
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, self.quit)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, self.quit)

        Gst.init(None)
        if any(Gst.ElementFactory.find(name) is None for name in ("h264parse", "avdec_h264", "avdec_aac")):
            if os.environ.get("SNAP"):
                self.show_error(self.tr("Arkham TV no pudo cargar los códecs incluidos. Vuelve a abrir la aplicación.",
                                        "Arkham TV could not load the bundled codecs. Reopen the app."))
            else:
                self.show_error(self.tr("Faltan los códecs de vídeo o audio. Ejecuta Arkham TV con --preparar-ventana y vuelve a abrirlo.",
                                        "Video or audio codecs are missing. Run Arkham TV with --preparar-ventana and reopen it."))
            return

        try:
            self.data.mkdir(mode=0o700, parents=True, exist_ok=True)
            self.lock = (self.data / "instance.lock").open("a")
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.ready.unlink(missing_ok=True)
            self.server = subprocess.Popen([
                sys.executable, "-B", str(ROOT / "app.py"), "--port", str(self.preferred_port()),
                "--data-dir", str(self.data), "--ready-file", str(self.ready),
            ], cwd=ROOT, stdin=subprocess.DEVNULL)
        except BlockingIOError:
            self.show_error(self.tr("Ya hay otra instancia de Arkham TV en ejecución. Ciérrala y vuelve a abrir la aplicación.",
                                    "Arkham TV is already running. Close it and reopen the app."))
            return
        except OSError as error:
            print(error, file=sys.stderr)
            self.show_error(self.tr("No se pudo iniciar el servidor local de Arkham TV.",
                                    "Could not start the local Arkham TV server."))
            return

        self.deadline = time.monotonic() + 15
        GLib.timeout_add(100, self.wait_for_server)

    def header_bar(self, title, decoration_layout):
        header = Gtk.HeaderBar(title=title, show_close_button=True)
        header.set_decoration_layout(decoration_layout)
        return header

    def window_state(self, _window, event):
        if event.changed_mask & event.new_window_state & Gdk.WindowState.ICONIFIED:
            self.minimize(from_system=True)
        return False

    def minimize(self, from_system=False):
        if self.mini_active:
            return
        uri = self.view.get_uri() if self.view else None
        if not uri or not uri.startswith(self.origin + "/") or urlsplit(uri).fragment.startswith("grabacion-"):
            if not from_system:
                self.window.iconify()
            return
        if self.mini is None:
            self.mini = Gtk.ApplicationWindow(application=self, title=TITLE)
            self.mini.set_titlebar(self.header_bar(self.tr("Arkham TV · Minirreproductor", "Arkham TV · Mini player"), ":close"))
            self.mini.set_default_size(360, 246)
            self.mini.set_size_request(275, 195)
            self.mini.set_keep_above(True)
            self.mini.set_icon_from_file(str(ROOT / "assets" / "arkhamtv-icon.png"))
            self.mini.connect("delete-event", self.close_mini)
            display = self.window.get_display()
            if monitor := display.get_monitor_at_window(self.window.get_window()):
                area = monitor.get_workarea()
                self.mini.move(area.x + area.width - 378, area.y + 18)
        self.mini_active = True
        self.view.reparent(self.mini)
        self.view.evaluate_javascript("window.arkhamSetMiniMode?.(true);", -1, None, None, None, None, None)
        self.mini.show_all()
        self.window.hide()

    def close_mini(self, *_):
        self.restore_window()
        return True

    def restore_window(self):
        if not self.mini_active:
            return
        self.mini_active = False
        self.view.reparent(self.window)
        self.view.evaluate_javascript("window.arkhamSetMiniMode?.(false);", -1, None, None, None, None, None)
        self.window.deiconify()
        self.window.present()
        self.mini.hide()

    def preferred_port(self):
        try:
            port = int((self.data / "desktop-port").read_text(encoding="ascii"))
            if 1024 <= port <= 65535:
                return port
        except (OSError, ValueError):
            pass
        return 8766

    def wait_for_server(self):
        if self.server.poll() is not None or time.monotonic() >= self.deadline:
            self.show_error(self.tr("El servidor local de Arkham TV no respondió al arrancar.",
                                    "The local Arkham TV server did not respond at startup."))
            return GLib.SOURCE_REMOVE
        try:
            port = int(self.ready.read_text(encoding="ascii"))
        except (OSError, ValueError):
            return GLib.SOURCE_CONTINUE

        self.origin = f"http://127.0.0.1:{port}"
        try:
            self.ready.unlink(missing_ok=True)
            (self.data / "desktop-port").write_text(str(port), encoding="ascii")
        except OSError as error:
            print(error, file=sys.stderr)
        manager = WebKit2.WebsiteDataManager(
            base_data_directory=str(self.data / "webkit" / "data"),
            base_cache_directory=str(self.data / "webkit" / "cache"),
        )
        context = WebKit2.WebContext.new_with_website_data_manager(manager)
        self.view = WebKit2.WebView.new_with_context(context)
        settings = self.view.get_settings()
        settings.set_enable_fullscreen(True)
        settings.set_media_playback_requires_user_gesture(False)
        content = self.view.get_user_content_manager()
        content.register_script_message_handler("arkhamLanguage")
        content.connect("script-message-received::arkhamLanguage", self.change_language)
        content.add_script(WebKit2.UserScript.new(
            "window.arkhamLinux = true;", WebKit2.UserContentInjectedFrames.TOP_FRAME,
            WebKit2.UserScriptInjectionTime.START, None, None,
        ))
        self.view.connect("decide-policy", self.navigation_policy)
        self.view.connect("enter-fullscreen", self.enter_fullscreen)
        self.view.connect("leave-fullscreen", self.leave_fullscreen)
        self.view.connect("web-process-terminated", self.web_process_terminated)
        self.window.remove(self.window.get_child())
        self.window.add(self.view)
        self.view.show()
        self.view.load_uri(self.origin + "/")
        GLib.timeout_add_seconds(1, self.monitor_server)
        return GLib.SOURCE_REMOVE

    def navigation_policy(self, _view, decision, decision_type):
        if decision_type == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            action = decision.get_navigation_action()
            uri = action.get_request().get_uri()
            if uri and uri.startswith(self.origin + "/"):
                path = urlsplit(uri).path
                if path == "/restaurar-ventana" and action.get_navigation_type() == WebKit2.NavigationType.LINK_CLICKED:
                    decision.ignore()
                    self.restore_window()
                    return True
                if path == "/elegir-carpeta-grabacion" and action.get_navigation_type() == WebKit2.NavigationType.LINK_CLICKED:
                    decision.ignore()
                    self.choose_recording_folder()
                    return True
                # The local player needs an explicit autoplay policy in addition to WebKit's gesture setting.
                decision.use_with_policies(WebKit2.WebsitePolicies(autoplay=WebKit2.AutoplayPolicy.ALLOW))
                return True
            if uri and action.get_navigation_type() == WebKit2.NavigationType.LINK_CLICKED:
                target = urlsplit(uri)
                if target.scheme == "https" and target.hostname in {"www.imdb.com", "www.omdbapi.com"}:
                    try:
                        Gio.AppInfo.launch_default_for_uri(uri, None)
                    except GLib.Error as error:
                        print(error, file=sys.stderr)
        elif decision_type != WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION:
            return False
        decision.ignore()
        return True

    def choose_recording_folder(self):
        if self.folder_picker:
            self.folder_picker.present()
            return
        picker = Gtk.FileChooserDialog(
            title=self.tr("Carpeta de grabaciones", "Recording folder"),
            transient_for=self.window, modal=True, destroy_with_parent=True,
            action=Gtk.FileChooserAction.SELECT_FOLDER,
        )
        self.folder_picker = picker
        picker.add_button(self.tr("Cancelar", "Cancel"), Gtk.ResponseType.CANCEL)
        picker.add_button(self.tr("Elegir", "Choose"), Gtk.ResponseType.ACCEPT)
        picker.set_default_response(Gtk.ResponseType.ACCEPT)
        picker.set_create_folders(True)
        videos = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS)
        picker.set_current_folder(videos if videos and Path(videos).is_dir() else str(Path.home()))

        def selected(dialog, response):
            if response == Gtk.ResponseType.ACCEPT and (folder := dialog.get_filename()):
                event = "window.dispatchEvent(new CustomEvent('arkham-recording-folder', {detail: "
                self.view.evaluate_javascript(event + json.dumps(folder) + "}));", -1, None, None, None, None, None)
            dialog.destroy()

        picker.connect("response", selected)
        picker.connect("destroy", lambda *_: setattr(self, "folder_picker", None))
        picker.present()

    def enter_fullscreen(self, _view):
        self.window.fullscreen()
        return True

    def leave_fullscreen(self, _view):
        self.window.unfullscreen()
        return True

    def web_process_terminated(self, _view, _reason):
        self.show_error(self.tr("Se cerró el reproductor de Arkham TV. Vuelve a abrir la aplicación.",
                                "The Arkham TV player stopped. Reopen the app."))

    def monitor_server(self):
        if self.server.poll() is None:
            return GLib.SOURCE_CONTINUE
        self.show_error(self.tr("Se detuvo el servidor local de Arkham TV. Vuelve a abrir la aplicación.",
                                "The local Arkham TV server stopped. Reopen the app."))
        return GLib.SOURCE_REMOVE

    def show_error(self, message):
        if self.failed:
            return
        self.failed = True
        self.restore_window()
        dialog = Gtk.MessageDialog(
            transient_for=self.window, modal=True, message_type=Gtk.MessageType.ERROR,
            buttons=Gtk.ButtonsType.CLOSE, text=message,
        )
        dialog.connect("response", lambda *_: self.quit())
        dialog.show()

    def do_shutdown(self):
        if self.server and self.server.poll() is None:
            self.server.terminate()
            try:
                self.server.wait(timeout=12)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait()
        if self.lock:
            self.lock.close()
        Gtk.Application.do_shutdown(self)


if __name__ == "__main__":
    GLib.set_prgname("arkham-tv")
    GLib.set_application_name(TITLE)
    desktop = Desktop(Path(sys.argv[1]))
    sys.exit(desktop.run([TITLE]) or int(desktop.failed))
