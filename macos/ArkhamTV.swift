import AppKit
import AVFoundation
import CoreAudio
import WebKit

private func describeCaptureInputs() throws {
    let video = AVCaptureDevice.devices(for: .video)
    let audio = AVCaptureDevice.devices(for: .audio)
    func inputs(_ devices: [AVCaptureDevice], video: Bool) -> [[String: Any]] {
        devices.compactMap { device in
            guard device.transportType == kAudioDeviceTransportTypeUSB ||
                  device.transportType == kAudioDeviceTransportTypeThunderbolt else { return nil }
            let name = device.localizedName
            // FFmpeg parses a numeric prefix as an index and otherwise matches by name prefix.
            guard !name.isEmpty, !name.contains(":"), !name.hasPrefix("default"), !name.hasPrefix("none"),
                  name.range(of: #"^\s*[+-]?\d"#, options: .regularExpression) == nil,
                  devices.filter({ $0.localizedName.hasPrefix(name) }).count == 1 else { return nil }
            if video {
                let external = device.deviceType == .externalUnknown
                if !external {
                    if #available(macOS 14.0, *) {
                        guard device.deviceType == .external else { return nil }
                    } else { return nil }
                }
                let modes = device.formats.flatMap { format -> [[String: Any]] in
                    let size = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
                    guard size.width <= 1920, size.height <= 1080, size.width >= 640 else { return [] }
                    return format.videoSupportedFrameRateRanges.compactMap { range in
                        let duration = range.minFrameDuration
                        guard range.maxFrameRate >= 20, range.maxFrameRate <= 60.1,
                              duration.value > 0, duration.timescale > 0 else { return nil }
                        return ["width": size.width, "height": size.height,
                                "rate": "\(duration.timescale)/\(duration.value)", "fps": range.maxFrameRate]
                    }
                }
                if modes.isEmpty { return nil }
                return ["id": device.uniqueID, "name": name, "modes": modes]
            }
            return ["id": device.uniqueID, "name": name]
        }
    }
    let result: [String: Any] = [
        "video": inputs(video, video: true), "audio": inputs(audio, video: false),
        "authorized": AVCaptureDevice.authorizationStatus(for: .video) == .authorized &&
                      AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
    ]
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
}

private let desktopPort = 8766
private let windowTitleItem = NSToolbarItem.Identifier("ArkhamTV.windowTitle")

final class ArkhamTV: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler, NSToolbarDelegate {
    private var window: NSWindow!
    private var miniWindow: NSPanel?
    private var miniActive = false
    private var webView: WKWebView!
    private var backend: Process?
    private var address: URL?
    private var readyFile: URL?
    private var statusTimer: Timer?
    private var stopping = false
    private var recoveredWebContent = false
    private var language = UserDefaults.standard.string(forKey: "arkhamtv.language") ?? "es"

    private func tr(_ spanish: String, _ english: String) -> String {
        language == "en" ? english : spanish
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "arkhamLanguage", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "127.0.0.1",
              let value = message.body as? String, ["es", "en"].contains(value), value != language else { return }
        language = value
        UserDefaults.standard.set(value, forKey: "arkhamtv.language")
        installMenu()
        miniWindow?.title = tr("Arkham TV · Minirreproductor", "Arkham TV · Mini player")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let settings = WKWebViewConfiguration()
        settings.mediaTypesRequiringUserActionForPlayback = []
        settings.preferences.isElementFullscreenEnabled = true
        settings.userContentController.add(self, name: "arkhamLanguage")
        settings.userContentController.addUserScript(WKUserScript(
            source: "window.arkhamNative = true; window.arkhamPicture = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        webView = WKWebView(frame: .zero, configuration: settings)
        webView.navigationDelegate = self

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1240, height: 815),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Arkham TV"
        window.delegate = self
        window.titleVisibility = .hidden
        let toolbar = NSToolbar(identifier: "ArkhamTV.titleBar")
        toolbar.delegate = self
        if #available(macOS 13, *) {
            toolbar.centeredItemIdentifiers = [windowTitleItem]
        } else {
            toolbar.centeredItemIdentifier = windowTitleItem
        }
        window.toolbar = toolbar
        window.toolbarStyle = .unifiedCompact
        window.contentMinSize = NSSize(width: 440, height: 360)
        window.setFrameAutosaveName("Arkham TV")
        window.contentView = loadingView()
        window.center()
        if let visible = (window.screen ?? NSScreen.main)?.visibleFrame {
            var frame = window.frame
            frame.origin.x = visible.minX
            frame.size.width = visible.width
            frame.size.height = min(frame.height, visible.height)
            frame.origin.y = max(visible.minY, min(frame.minY, visible.maxY - frame.height))
            window.setFrame(frame, display: false)
        }
        installMenu()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do {
            try startServer()
        } catch {
            showError(error.localizedDescription)
        }
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [windowTitleItem] }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { [windowTitleItem] }

    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier,
                 willBeInsertedIntoToolbar: Bool) -> NSToolbarItem? {
        guard identifier == windowTitleItem else { return nil }
        let title = NSTextField(labelWithString: window.title)
        title.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .semibold)
        title.sizeToFit()
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.label = window.title
        item.view = title
        return item
    }

    private func loadingView() -> NSView {
        let container = NSView()
        let text = NSTextField(labelWithString: tr("Conectando Arkham TV…", "Connecting to Arkham TV…"))
        text.textColor = .secondaryLabelColor
        text.font = .systemFont(ofSize: 16, weight: .medium)
        text.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(text)
        NSLayoutConstraint.activate([
            text.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            text.centerYAnchor.constraint(equalTo: container.centerYAnchor),
        ])
        return container
    }

    private func startServer() throws {
        let files = FileManager.default
        let resources = Bundle.main.resourceURL!
        let tools = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers")
        let appSupport = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                       appropriateFor: nil, create: true)
        let data = appSupport.appendingPathComponent("Arkham TV Desktop")
        try files.createDirectory(at: data, withIntermediateDirectories: true)
        let oldData = appSupport.appendingPathComponent("Arkham TV/.datos")
        for name in ["canales.json", "ultimo-canal"] {
            let original = oldData.appendingPathComponent(name)
            let destination = data.appendingPathComponent(name)
            if files.fileExists(atPath: original.path) && !files.fileExists(atPath: destination.path) {
                try? files.copyItem(at: original, to: destination)
            }
        }

        let readiness = files.temporaryDirectory.appendingPathComponent("arkhamtv-" + UUID().uuidString)
        readyFile = readiness
        let logURL = data.appendingPathComponent("servidor.log")
        try Data().write(to: logURL)
        let log = try FileHandle(forWritingTo: logURL)

        let service = Process()
        service.executableURL = tools.appendingPathComponent("python3")
        service.currentDirectoryURL = resources.appendingPathComponent("arkham")
        service.arguments = [
            "-B", resources.appendingPathComponent("arkham/app.py").path,
            "--port", String(desktopPort), "--data-dir", data.path, "--ready-file", readiness.path,
        ]
        service.environment = [
            "PATH": tools.path + ":/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONHOME": Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/Python.framework/Versions/3.13").path,
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "SSL_CERT_FILE": "/etc/ssl/cert.pem",
            "ARKHAM_USB_LIBRARY": Bundle.main.bundleURL.appendingPathComponent("Contents/Frameworks/a835-usb.dylib").path,
            "ARKHAM_FIRMWARE": resources.appendingPathComponent("dvb-usb-af9035-02.fw").path,
            "ARKHAM_VIDEOTOOLBOX": "1",
            "ARKHAM_CAPTURE_HOST": Bundle.main.executableURL!.path,
        ]
        service.standardOutput = log
        service.standardError = log
        service.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self, !self.stopping else { return }
                self.showError(self.tr("El servidor local se ha detenido. El registro está en ",
                                       "The local server stopped. The log is at ") + logURL.path + ".")
            }
        }
        try service.run()
        backend = service

        let deadline = Date().addingTimeInterval(12)
        statusTimer = Timer.scheduledTimer(withTimeInterval: 0.12, repeats: true) { [weak self] timer in
            guard let self = self else { timer.invalidate(); return }
            if let value = try? String(contentsOf: readiness, encoding: .ascii),
               let port = UInt16(value),
               let url = URL(string: "http://127.0.0.1:\(port)/") {
                timer.invalidate()
                try? files.removeItem(at: readiness)
                self.address = url
                self.window.contentView = self.webView
                self.webView.load(URLRequest(url: url))
            } else if Date() >= deadline {
                timer.invalidate()
                self.showError(self.tr("El servidor de Arkham TV no respondió a tiempo.", "The Arkham TV server did not respond in time."))
            }
        }
    }

    private func installMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let app = NSMenu(title: "Arkham TV")
        let about = app.addItem(withTitle: tr("Acerca de Arkham TV", "About Arkham TV"), action: #selector(showAbout), keyEquivalent: "")
        about.target = self
        app.addItem(.separator())
        app.addItem(withTitle: tr("Salir de Arkham TV", "Quit Arkham TV"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = app

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: tr("Edición", "Edit"))
        edit.addItem(withTitle: tr("Cortar", "Cut"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: tr("Copiar", "Copy"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: tr("Pegar", "Paste"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(.separator())
        edit.addItem(withTitle: tr("Seleccionar todo", "Select All"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let view = NSMenu(title: tr("Visualización", "View"))
        let reload = view.addItem(withTitle: tr("Recargar", "Reload"), action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        let minimize = view.addItem(withTitle: tr("Minimizar", "Minimize"), action: #selector(minimizeWindow), keyEquivalent: "m")
        minimize.target = self
        let full = view.addItem(withTitle: tr("Pantalla completa", "Full Screen"), action: #selector(toggleFullscreen), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        full.target = self
        viewItem.submenu = view
        NSApp.mainMenu = main
    }

    @objc private func showAbout() {
        let author = tr("Desarrollada por Óscar Peña de San Antonio, 2026.", "Developed by Óscar Peña de San Antonio, 2026.")
        let description = tr("Aplicación de sintonización, reproducción y grabación de canales para AverTV Volar A835. El modelo A835B es compatible con la edición para Ubuntu.",
                             "Tune, watch and record channels with an AVerTV Volar A835. The Ubuntu edition also supports the A835B.")
        let compatibility = tr("Para Mac con procesador Intel o Apple Silicon.", "For Intel and Apple Silicon Macs.")
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.paragraphSpacing = 8
        let size = NSFont.smallSystemFontSize
        let credits = NSMutableAttributedString(string: "\(author)\n\(description)\n\(compatibility)", attributes: [
            .font: NSFont.systemFont(ofSize: size),
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: paragraph,
        ])
        credits.addAttribute(.font, value: NSFont.systemFont(ofSize: size, weight: .semibold),
                             range: NSRange(location: 0, length: author.utf16.count))
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }

    @objc private func reloadPage() {
        restoreWindow()
        webView.reload()
    }
    @objc private func minimizeWindow() { if !miniActive { window.miniaturize(nil) } }
    @objc private func toggleFullscreen() { window.toggleFullScreen(nil) }

    func windowDidMiniaturize(_ notification: Notification) {
        guard let source = notification.object as? NSWindow, source === window,
              let url = webView.url, url.port == address?.port, window.contentView === webView,
              url.fragment?.hasPrefix("grabacion-") != true else { return }
        let panel: NSPanel
        if let existing = miniWindow {
            panel = existing
        } else {
            panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 246),
                            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            panel.title = tr("Arkham TV · Minirreproductor", "Arkham TV · Mini player")
            panel.delegate = self
            panel.isReleasedWhenClosed = false
            panel.isFloatingPanel = true
            panel.level = .floating
            panel.hidesOnDeactivate = false
            panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
            panel.contentMinSize = NSSize(width: 275, height: 195)
            if let bounds = (window.screen ?? NSScreen.main)?.visibleFrame {
                panel.setFrameTopLeftPoint(NSPoint(x: bounds.maxX - panel.frame.width - 18, y: bounds.maxY - 18))
            }
            miniWindow = panel
        }
        miniActive = true
        window.contentView = NSView()
        panel.contentView = webView
        webView.evaluateJavaScript("window.arkhamSetMiniMode?.(true)")
        panel.orderFrontRegardless()
    }

    private func restoreWindow() {
        guard miniActive else { return }
        miniActive = false
        miniWindow?.contentView = NSView()
        window.contentView = webView
        webView.evaluateJavaScript("window.arkhamSetMiniMode?.(false)")
        window.deminiaturize(nil)
        window.makeKeyAndOrderFront(nil)
        miniWindow?.orderOut(nil)
    }

    func windowDidDeminiaturize(_ notification: Notification) {
        if let source = notification.object as? NSWindow, source === window { restoreWindow() }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if sender === miniWindow {
            restoreWindow()
            return false
        }
        return true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if miniActive {
            restoreWindow()
            return false
        }
        return true
    }

    private func chooseRecordingFolder() {
        let picker = NSOpenPanel()
        picker.title = tr("Carpeta de grabaciones", "Recording folder")
        picker.prompt = tr("Elegir", "Choose")
        picker.canChooseDirectories = true
        picker.canChooseFiles = false
        picker.canCreateDirectories = true
        picker.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let folder = picker.url?.path else { return }
            self?.webView.callAsyncJavaScript(
                "window.dispatchEvent(new CustomEvent('arkham-recording-folder', { detail: folder }));",
                arguments: ["folder": folder], in: nil, in: .page, completionHandler: nil)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = navigationAction.request.url
        let local = url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == address?.port
        if local, url?.path == "/restaurar-ventana", navigationAction.navigationType == .linkActivated {
            decisionHandler(.cancel)
            restoreWindow()
            return
        }
        if local, url?.path == "/elegir-carpeta-grabacion", navigationAction.navigationType == .linkActivated {
            decisionHandler(.cancel)
            chooseRecordingFolder()
            return
        }
        if local, url?.path == "/autorizar-captura-hdmi", navigationAction.navigationType == .linkActivated {
            decisionHandler(.cancel)
            AVCaptureDevice.requestAccess(for: .video) { camera in
                guard camera else {
                    DispatchQueue.main.async { self.capturePermissions(video: false, audio: false) }
                    return
                }
                AVCaptureDevice.requestAccess(for: .audio) { audio in
                    DispatchQueue.main.async { self.capturePermissions(video: true, audio: audio) }
                }
            }
            return
        }
        if navigationAction.navigationType == .linkActivated, let url, url.scheme == "https",
           ["www.imdb.com", "www.omdbapi.com"].contains(url.host ?? "") {
            NSWorkspace.shared.open(url)
        }
        decisionHandler(local ? .allow : .cancel)
    }

    private func capturePermissions(video: Bool, audio: Bool) {
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('arkham-hdmi-permissions', { detail: { video, audio } }));",
            arguments: ["video": video, "audio": audio], in: nil, in: .page, completionHandler: nil)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard !stopping, let address = address else { return }
        if recoveredWebContent {
            showError(tr("La ventana de vídeo dejó de responder. Vuelve a abrir Arkham TV.",
                         "The video window stopped responding. Reopen Arkham TV."))
        } else {
            recoveredWebContent = true
            restoreWindow()
            webView.load(URLRequest(url: webView.url ?? address))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        stopping = true
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "arkhamLanguage")
        statusTimer?.invalidate()
        if let readyFile = readyFile { try? FileManager.default.removeItem(at: readyFile) }
        if let service = backend, service.isRunning {
            service.terminate()
            service.waitUntilExit()
        }
    }

    private func showError(_ message: String) {
        guard !stopping else { return }
        restoreWindow()
        stopping = true
        statusTimer?.invalidate()
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = tr("No se pudo abrir Arkham TV", "Could not open Arkham TV")
        alert.informativeText = message
        alert.addButton(withTitle: tr("Cerrar", "Close"))
        alert.beginSheetModal(for: window) { _ in NSApp.terminate(nil) }
    }
}

if CommandLine.arguments == [CommandLine.arguments[0], "--capture-devices"] {
    do { try describeCaptureInputs(); exit(0) }
    catch { fputs("\(error)\n", stderr); exit(1) }
}

let app = NSApplication.shared
let delegate = ArkhamTV()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
