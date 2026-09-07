import UIKit
import WebKit
import CryptoKit
import UniformTypeIdentifiers

/// A native owner for the WebApp lifecycle. It remains available when the web
/// interface cannot load, so update, recovery and diagnostics never depend on
/// the game page being healthy.
final class GameViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, UIDocumentPickerDelegate {
    private var webView: WKWebView!
    private let schemeHandler = GlobalGameSchemeHandler()
    private var launchOverlay: UIView?
    private var pendingIncomingUpdateURL: URL?
    private var pendingSaveJSON: String?
    private var pendingNativeUpdate: GlobalGameStorage.AppliedUpdate?
    private var updateStateCommittedVersion: String?
    private var updateStateSaveGeneration: Int?
    private var updateBootConfirmedVersion: String?
    private var operationsApplyingVersion: String?
    private var preUpdateSaveGeneration: Int = 0
    private var recoveredWebProcess = false

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(self, name: "updateBridge")
        configuration.userContentController.add(self, name: "saveBridge")
        configuration.userContentController.add(self, name: "diagnosticBridge")
        let bootstrap = GlobalSaveVault.shared.bootstrapJavaScript(force: false)
        if !bootstrap.isEmpty { configuration.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: "gh")

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.allowsBackForwardNavigationGestures = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.024, green: 0.063, blue: 0.094, alpha: 1)
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        initializeRuntime()
    }

    private func initializeRuntime() {
        do {
            try GlobalGameStorage.shared.ensureInitialized()
            showLaunchOverlay()
        } catch {
            // Keep update and recovery controls available even if a bad build
            // omitted the bundled WebApp. A complete package can bootstrap it.
            showLaunchOverlay(recoveryMessage: error.localizedDescription)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if let url = pendingIncomingUpdateURL {
            pendingIncomingUpdateURL = nil
            confirmAndApplyUpdate(url)
        }
    }

    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('resize'));")
        }
    }

    private func showLaunchOverlay(recoveryMessage: String? = nil) {
        launchOverlay?.removeFromSuperview()
        let overlay = UIView()
        overlay.backgroundColor = UIColor(red: 0.024, green: 0.063, blue: 0.094, alpha: 1)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay)

        let title = UILabel()
        title.text = recoveryMessage == nil ? "GLOBAL HOLDINGS" : "استرداد Global Holdings"
        title.textColor = .white
        title.font = .systemFont(ofSize: 31, weight: .bold)
        title.textAlignment = .center
        title.adjustsFontSizeToFitWidth = true

        let subtitle = UILabel()
        subtitle.text = recoveryMessage ?? "مركز القيادة والاستثمار العالمي"
        subtitle.textColor = UIColor.white.withAlphaComponent(0.68)
        subtitle.font = .systemFont(ofSize: 14, weight: .medium)
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 3

        let version = UILabel()
        version.text = "محتوى اللعبة: \(GlobalGameStorage.shared.currentVersion)"
        version.textColor = UIColor(red: 0.15, green: 0.84, blue: 0.74, alpha: 1)
        version.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        version.textAlignment = .center

        let recovering = recoveryMessage != nil
        let play = makeButton(title: recovering ? "إعادة محاولة التشغيل" : "دخول اللعبة", primary: true)
        if recovering {
            play.addTarget(self, action: #selector(retryRuntimeInitialization), for: .touchUpInside)
        } else {
            play.addTarget(self, action: #selector(enterGame), for: .touchUpInside)
        }

        let update = makeButton(title: "تثبيت تحديث من الملفات", primary: false)
        update.addTarget(self, action: #selector(openUpdatePicker), for: .touchUpInside)

        var views: [UIView] = [title, subtitle, version, play, update]
        if GlobalGameStorage.shared.hasPreviousVersion {
            let restore = UIButton(type: .system)
            restore.setTitle("استرجاع النسخة السابقة", for: .normal)
            restore.setTitleColor(UIColor.white.withAlphaComponent(0.75), for: .normal)
            restore.titleLabel?.font = .systemFont(ofSize: 14, weight: .medium)
            restore.addTarget(self, action: #selector(confirmRestorePreviousVersion), for: .touchUpInside)
            views.append(restore)
        }

        let stack = UIStackView(arrangedSubviews: views)
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 13
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)

        NSLayoutConstraint.activate([
            overlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            overlay.topAnchor.constraint(equalTo: view.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.safeAreaLayoutGuide.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 360),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: overlay.safeAreaLayoutGuide.leadingAnchor, constant: 26),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: overlay.safeAreaLayoutGuide.trailingAnchor, constant: -26),
            play.heightAnchor.constraint(equalToConstant: 52),
            update.heightAnchor.constraint(equalToConstant: 48)
        ])
        launchOverlay = overlay
    }

    private func makeButton(title: String, primary: Bool) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.setTitleColor(primary ? UIColor(red: 0.01, green: 0.12, blue: 0.11, alpha: 1) : .white, for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
        button.backgroundColor = primary
            ? UIColor(red: 0.15, green: 0.84, blue: 0.74, alpha: 1)
            : UIColor.white.withAlphaComponent(0.10)
        button.layer.cornerRadius = 14
        button.layer.borderWidth = primary ? 0 : 1
        button.layer.borderColor = UIColor.white.withAlphaComponent(0.18).cgColor
        return button
    }

    @objc private func enterGame() {
        launchOverlay?.removeFromSuperview()
        launchOverlay = nil
        loadGame()
    }

    @objc private func retryRuntimeInitialization() {
        launchOverlay?.removeFromSuperview()
        launchOverlay = nil
        initializeRuntime()
    }

    @objc private func openUpdatePicker() {
        let types = ["saneiupdate", "ghupdate"].compactMap { UTType(filenameExtension: $0) }
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: types.isEmpty ? [.data] : types, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        importUpdate(from: url)
    }

    func importUpdate(from url: URL) {
        do {
            let local = try GlobalGameStorage.shared.copyIncomingUpdate(from: url)
            guard isViewLoaded, view.window != nil else {
                pendingIncomingUpdateURL = local
                return
            }
            confirmAndApplyUpdate(local)
        } catch {
            showMessage(title: "فشل استلام التحديث", message: error.localizedDescription)
        }
    }

    private func confirmAndApplyUpdate(_ url: URL) {
        let alert = UIAlertController(
            title: "تحديث Global Holdings",
            message: "تم العثور على حزمة تحديث. الإصدار الحالي: \(GlobalGameStorage.shared.currentVersion)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel) { _ in try? FileManager.default.removeItem(at: url) })
        alert.addAction(UIAlertAction(title: "تحديث الآن", style: .default) { [weak self] _ in self?.applyNativeUpdate(url) })
        present(alert, animated: true)
    }

    private func applyNativeUpdate(_ url: URL) {
        webView.stopLoading()
        captureVerifiedPreUpdateCheckpoint { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error):
                self.showMessage(title: "فشل نقطة الاستعادة", message: error.localizedDescription)
            case .success(let generation):
                self.preUpdateSaveGeneration = generation
                self.reportUpdateLifecycle(phase: "PRE_SAVE_COMMITTED", message: "Verified pre-update save generation \(generation)")
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    do {
                        let result = try GlobalGameStorage.shared.applyUpdatePackage(at: url, preUpdateSaveGeneration: generation)
                        DispatchQueue.main.async {
                            guard let self else { return }
                            self.preparePendingUpdate(result)
                            self.reportUpdateLifecycle(phase: "RUNTIME_SWAPPED", version: result.version)
                            self.showMessage(
                                title: "تم التحقق من ملفات التحديث",
                                message: "تم تجهيز الإصدار \(result.version) مبدئيًا. سيُعتمد فقط بعد نجاح العمليات والحفظ الدائم وفحص سلامة التشغيل."
                            ) { [weak self] in
                                self?.launchOverlay?.removeFromSuperview()
                                self?.launchOverlay = nil
                                self?.loadGame(cacheBuster: result.version)
                            }
                        }
                    } catch {
                        DispatchQueue.main.async { [weak self] in
                            self?.reportUpdateLifecycle(phase: "FAILED", message: error.localizedDescription)
                            self?.showMessage(title: "فشل التحديث", message: error.localizedDescription)
                        }
                    }
                }
            }
        }
    }

    private func captureVerifiedPreUpdateCheckpoint(completion: @escaping (Result<Int, Error>) -> Void) {
        let commit: (String?) -> Void = { save in
            guard let save, !save.isEmpty else {
                let generation = GlobalSaveVault.shared.currentGeneration()
                guard generation > 0 else {
                    completion(.failure(NSError(domain: "GlobalHoldings.Update", code: 1001, userInfo: [NSLocalizedDescriptionKey: "لا توجد نقطة حفظ Native موثقة قبل التحديث. افتح اللعبة واحفظ الحالة أولاً ثم أعد المحاولة."])))
                    return
                }
                completion(.success(generation))
                return
            }
            GlobalSaveVault.shared.commitAsync(save, runtimeVersion: GlobalGameStorage.shared.currentVersion) { result in
                if case .success(let generation) = result { GlobalGameStorage.shared.noteCurrentSaveGeneration(generation) }
                completion(result)
            }
        }
        // If the runtime is loaded, capture the freshest browser state. Otherwise
        // the latest verified native generation is the authoritative checkpoint.
        guard isViewLoaded, webView.url != nil else { commit(GlobalSaveVault.shared.currentSave()); return }
        webView.evaluateJavaScript("localStorage.getItem('global-holdings-world-v2.0.0')") { value, error in
            if let error {
                if let native = GlobalSaveVault.shared.currentSave() { commit(native) }
                else { completion(.failure(error)) }
                return
            }
            commit(value as? String ?? GlobalSaveVault.shared.currentSave())
        }
    }

    private func preparePendingUpdate(_ update: GlobalGameStorage.AppliedUpdate) {
        pendingNativeUpdate = update
        updateStateCommittedVersion = nil
        updateStateSaveGeneration = nil
        updateBootConfirmedVersion = nil
        operationsApplyingVersion = nil
    }

    @objc private func confirmRestorePreviousVersion() {
        guard GlobalGameStorage.shared.hasPreviousVersion else { return }
        let version = GlobalGameStorage.shared.previousVersion ?? "النسخة السابقة"
        let alert = UIAlertController(
            title: "استرجاع النسخة السابقة",
            message: "سيتم استرجاع إصدار \(version) مع الاحتفاظ بالنسخة الحالية للتبديل لاحقًا.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "إلغاء", style: .cancel))
        alert.addAction(UIAlertAction(title: "استرجاع", style: .destructive) { [weak self] _ in self?.restorePreviousVersion() })
        present(alert, animated: true)
    }

    private func restorePreviousVersion() {
        webView.stopLoading()
        // Manual rollback must checkpoint the freshest browser state first so
        // toggling back later restores an exact Runtime + Save pair.
        captureVerifiedPreUpdateCheckpoint { [weak self] checkpoint in
            guard let self else { return }
            switch checkpoint {
            case .failure(let error):
                self.showMessage(title: "فشل الاسترجاع", message: "تعذر تثبيت نقطة حفظ قبل الاسترجاع: \(error.localizedDescription)")
            case .success:
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    do {
                        let version = try GlobalGameStorage.shared.restorePreviousVersion()
                        DispatchQueue.main.async {
                            self?.showMessage(title: "تم تجهيز الاسترجاع", message: "تم تجهيز الإصدار \(version). لن يُعتمد نهائيًا إلا بعد اجتياز Boot + Integrity.") { [weak self] in
                                self?.loadGame(cacheBuster: UUID().uuidString)
                            }
                        }
                    } catch {
                        DispatchQueue.main.async { [weak self] in self?.showMessage(title: "فشل الاسترجاع", message: error.localizedDescription) }
                    }
                }
            }
        }
    }

    private func loadGame(cacheBuster: String = UUID().uuidString) {
        guard let url = URL(string: "gh://app/index.html?v=\(cacheBuster.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cacheBuster)") else { return }
        webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        if message.name == "saveBridge" {
            guard action == "commitSave", let json = payload["saveJSON"] as? String else { return }
            guard validSaveEnvelope(payload, json: json) else {
                reportSaveAck(payload: payload, success: false, generation: nil, message: "Invalid save envelope.")
                return
            }
            GlobalSaveVault.shared.commitAsync(json, runtimeVersion: GlobalGameStorage.shared.currentVersion) { [weak self] result in
                switch result {
                case .success(let generation):
                    GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                    self?.reportSaveAck(payload: payload, success: true, generation: generation, message: nil)
                case .failure(let error):
                    print("GlobalSaveVault commit failed: \(error.localizedDescription)")
                    self?.reportSaveAck(payload: payload, success: false, generation: nil, message: error.localizedDescription)
                }
            }
            return
        }
        if message.name == "diagnosticBridge" {
            guard action == "exportDiagnostic", let json = payload["json"] as? String else { return }
            exportDiagnosticBundle(json: json, requestedName: payload["filename"] as? String)
            return
        }
        guard message.name == "updateBridge" else { return }
        switch action {
        case "installWebPack":
            guard let manifest = payload["manifest"] as? [String: Any],
                  let files = payload["files"] as? [[String: Any]],
                  let operationsJSON = payload["operationsJSON"] as? String,
                  let save = payload["saveJSON"] as? String else {
                reportToWeb(success: false, message: "بيانات التحديث أو نقطة الحفظ الوقائية غير مكتملة.")
                return
            }
            pendingSaveJSON = save
            // A verified Save Vault generation is a hard precondition for replacing WebApp files.
            GlobalSaveVault.shared.commitAsync(save, runtimeVersion: GlobalGameStorage.shared.currentVersion) { [weak self] result in
                switch result {
                case .success(let generation):
                    self?.preUpdateSaveGeneration = generation
                    self?.reportUpdateLifecycle(phase: "PRE_SAVE_COMMITTED", message: "Verified pre-update save generation \(generation)")
                    GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                    self?.applyWebBridgeUpdate(manifest: manifest, files: files, operationsJSON: operationsJSON, preUpdateSaveGeneration: generation)
                case .failure(let error):
                    self?.pendingSaveJSON = nil
                    self?.reportToWeb(success: false, message: "فشل إنشاء نقطة الاستعادة قبل التحديث: \(error.localizedDescription)")
                }
            }
        case "commitUpdateState":
            guard let version = payload["version"] as? String,
                  let save = payload["saveJSON"] as? String,
                  pendingNativeUpdate?.version == version else {
                reportToWeb(success: false, message: "رفض Native اعتماد حالة تحديث غير مطابقة للإصدار المعلق.")
                return
            }
            GlobalSaveVault.shared.commitAsync(save, runtimeVersion: version) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let generation):
                    do {
                        try GlobalGameStorage.shared.markUpdateStateCommitted(version: version, saveGeneration: generation)
                        self.updateStateCommittedVersion = version
                        self.updateStateSaveGeneration = generation
                        self.operationsApplyingVersion = nil
                        self.reportUpdateLifecycle(phase: "STATE_COMMITTED", version: version, message: "Save generation \(generation)")
                        self.tryFinalizeNativeUpdate(version: version)
                    } catch {
                        self.reportToWeb(success: false, message: error.localizedDescription)
                        self.rollbackFailedUpdate(reason: "update-journal-state-commit-failed")
                    }
                case .failure(let error):
                    self.reportToWeb(success: false, message: "فشل الحفظ الدائم بعد عمليات التحديث: \(error.localizedDescription)")
                    self.rollbackFailedUpdate(reason: "durable-save-failed")
                }
            }
        case "updateOperationsFailed":
            rollbackFailedUpdate(reason: payload["message"] as? String ?? "operations-failed")
        case "rollbackWebPack":
            rollbackFailedUpdate(reason: payload["reason"] as? String ?? "web-requested-rollback")
        case "openNativeUpdatePicker":
            openUpdatePicker()
        case "confirmUpdateBoot":
            guard let version = payload["version"] as? String else { return }
            confirmNativeUpdateBoot(version: version)
        case "resetGameSave":
            guard let cleanSave = payload["saveJSON"] as? String, validSaveEnvelope(payload, json: cleanSave) else {
                reportSaveAck(payload: payload, success: false, generation: nil, message: "Invalid reset envelope.")
                return
            }
            let version = GlobalGameStorage.shared.currentVersion
            GlobalSaveVault.shared.resetToAsync(cleanSave, runtimeVersion: version) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let generation):
                    GlobalGameStorage.shared.noteCurrentSaveGeneration(generation)
                    self.reportSaveAck(payload: payload, success: true, generation: generation, message: nil)
                case .failure(let error):
                    self.reportSaveAck(payload: payload, success: false, generation: nil, message: error.localizedDescription)
                }
            }
        default:
            break
        }
    }

    private func confirmNativeUpdateBoot(version: String) {
        if pendingNativeUpdate?.version == version {
            updateBootConfirmedVersion = version
            reportUpdateLifecycle(phase: "BOOT_CONFIRMED", version: version)
            tryFinalizeNativeUpdate(version: version)
            return
        }
        // Bundled IPA baseline promotion has no .saneiupdate operations object,
        // but it still uses the same durable journal and must wait for WebApp
        // bootstrap confirmation before the runtime swap becomes final.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            do {
                let confirmed = try GlobalGameStorage.shared.confirmCurrentUpdateBoot(version: version)
                if confirmed { DispatchQueue.main.async { self?.reportUpdateLifecycle(phase: "BOOT_CONFIRMED", version: version) } }
            } catch {
                DispatchQueue.main.async { self?.rollbackFailedUpdate(reason: "bundled-baseline-boot-confirm-failed") }
            }
        }
    }

    private func tryFinalizeNativeUpdate(version: String) {
        guard updateStateCommittedVersion == version,
              updateBootConfirmedVersion == version,
              updateStateSaveGeneration != nil else { return }
        finalizeNativeUpdate(version: version)
    }

    private func finalizeNativeUpdate(version: String) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            do {
                let confirmed = try GlobalGameStorage.shared.confirmCurrentUpdateBoot(version: version)
                DispatchQueue.main.async {
                    guard confirmed, let self else { return }
                    self.pendingNativeUpdate = nil
                    self.pendingSaveJSON = nil
                    self.updateStateCommittedVersion = nil
                    self.updateStateSaveGeneration = nil
                    self.updateBootConfirmedVersion = nil
                    self.operationsApplyingVersion = nil
                    self.reportUpdateLifecycle(phase: "FINALIZED", version: version)
                    self.reportToWeb(success: true, message: "تم تثبيت الإصدار \(version) واعتماد العمليات والحفظ الدائم بنجاح.")
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.reportUpdateLifecycle(phase: "BOOT_CONFIRM_FAILED", version: version, message: error.localizedDescription)
                    self?.rollbackFailedUpdate(reason: "boot-confirm-failed: \(error.localizedDescription)")
                }
            }
        }
    }

    private func exportDiagnosticBundle(json: String, requestedName: String?) {
        let rawName = (requestedName?.isEmpty == false ? requestedName! : "GlobalHoldings_Diagnostics.ghdiag")
        let safeName = rawName.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: "\\", with: "-")
        let allowedExtensions: Set<String> = ["ghdiag", "ghincident", "ghdiagnostic", "ghtrace", "ghhealth", "ghsupport"]
        let requestedExtension = URL(fileURLWithPath: safeName).pathExtension.lowercased()
        let finalName = allowedExtensions.contains(requestedExtension) ? safeName : safeName + ".ghdiag"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(finalName, isDirectory: false)
        do {
            guard let data = json.data(using: .utf8), data.count <= 8_000_000 else {
                showMessage(title: "تعذر التصدير", message: "ملف التشخيص أكبر من الحد الوقائي 8 MB.")
                return
            }
            try data.write(to: url, options: .atomic)
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = share.popoverPresentationController { popover.sourceView = view; popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1) }
            present(share, animated: true)
        } catch {
            showMessage(title: "فشل تصدير التشخيص", message: error.localizedDescription)
        }
    }

    private func applyWebBridgeUpdate(manifest: [String: Any], files: [[String: Any]], operationsJSON: String, preUpdateSaveGeneration: Int) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let update = try GlobalGameStorage.shared.applyWebBridgeUpdate(manifest: manifest, files: files, operationsJSON: operationsJSON, preUpdateSaveGeneration: preUpdateSaveGeneration)
                DispatchQueue.main.async {
                    self?.reportUpdateLifecycle(phase: "RUNTIME_SWAPPED", version: update.version)
                    // Apply update operations only from the newly staged runtime,
                    // not from the page that requested its own replacement.
                    self?.preparePendingUpdate(update)
                    self?.loadGame(cacheBuster: update.version)
                }
            } catch {
                DispatchQueue.main.async { [weak self] in
                    self?.reportUpdateLifecycle(phase: "FAILED", message: error.localizedDescription)
                    self?.reportToWeb(success: false, message: error.localizedDescription)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if restorePendingSaveIfNeeded() { return }
        applyPendingNativeOperationsIfNeeded()
        if recoveredWebProcess {
            recoveredWebProcess = false
            webView.configuration.userContentController.removeAllUserScripts()
            let bootstrap = GlobalSaveVault.shared.bootstrapJavaScript(force: false)
            if !bootstrap.isEmpty { webView.configuration.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
            webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('gh-native-recovery',{detail:{source:'native-save-vault',paused:true}}));")
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        recoveredWebProcess = true
        webView.configuration.userContentController.removeAllUserScripts()
        let recovery = GlobalSaveVault.shared.bootstrapJavaScript(force: true, pause: true)
        if !recovery.isEmpty {
            webView.configuration.userContentController.addUserScript(WKUserScript(source: recovery, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        loadGame(cacheBuster: "recovery-\(GlobalSaveVault.shared.currentGeneration())-\(UUID().uuidString)")
    }

    @discardableResult
    private func restorePendingSaveIfNeeded() -> Bool {
        guard let save = pendingSaveJSON, let data = save.data(using: .utf8) else { return false }
        let encoded = data.base64EncodedString()
        let script = "(()=>{const b=Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0));localStorage.setItem('global-holdings-world-v2.0.0',new TextDecoder().decode(b));setTimeout(()=>location.reload(),0);return true;})()"
        webView.evaluateJavaScript(script) { [weak self] _, error in
            guard let self else { return }
            if let error {
                self.rollbackFailedUpdate(reason: "restore-pending-save-failed: \(error.localizedDescription)")
            } else {
                self.pendingSaveJSON = nil
            }
        }
        return true
    }

    private func applyPendingNativeOperationsIfNeeded() {
        guard let update = pendingNativeUpdate else { return }
        guard operationsApplyingVersion != update.version, updateStateCommittedVersion != update.version else { return }
        operationsApplyingVersion = update.version
        reportUpdateLifecycle(phase: "OPERATIONS_STARTED", version: update.version)
        guard JSONSerialization.isValidJSONObject(update.webPayload),
              let data = try? JSONSerialization.data(withJSONObject: update.webPayload),
              let json = String(data: data, encoding: .utf8),
              let encoded = json.data(using: .utf8)?.base64EncodedString() else {
            rollbackFailedUpdate(reason: "invalid-native-payload")
            return
        }
        let version = update.version.replacingOccurrences(of: "'", with: "\\'")
        let script = """
        (()=>{
          const b=Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0));
          const p=JSON.parse(new TextDecoder().decode(b));
          Promise.resolve(window.GH_RUNTIME?.applyNativeUpdate?.(p)).then(()=>{
            const integrity=window.GH_RUNTIME?.businessIntegrity?.();
            if(integrity&&integrity.status==='critical') throw new Error('Critical integrity failure after update operations: '+JSON.stringify(integrity.counts||{}));
            const save=localStorage.getItem('global-holdings-world-v2.0.0');
            if(!save) throw new Error('Durable update save payload missing');
            window.webkit?.messageHandlers?.updateBridge?.postMessage({action:'commitUpdateState',version:'\(version)',saveJSON:save});
          }).catch(error=>{
            window.webkit?.messageHandlers?.updateBridge?.postMessage({action:'updateOperationsFailed',version:'\(version)',message:String(error?.message||error)});
          });
        })();
        """
        webView.evaluateJavaScript(script) { [weak self] _, error in
            if let error {
                self?.operationsApplyingVersion = nil
                self?.rollbackFailedUpdate(reason: "native-operation-launch-failed: \(error.localizedDescription)")
            }
        }
    }

    private func rollbackFailedUpdate(reason: String) {
        reportUpdateLifecycle(phase: "ROLLBACK_STARTED", version: pendingNativeUpdate?.version, message: reason)
        do {
            let restoredVersion = try GlobalGameStorage.shared.rollbackPendingUpdate(reason: reason)
            pendingNativeUpdate = nil
            updateStateCommittedVersion = nil
            updateStateSaveGeneration = nil
            updateBootConfirmedVersion = nil
            operationsApplyingVersion = nil
            pendingSaveJSON = nil
            reportUpdateLifecycle(phase: "ROLLED_BACK", version: restoredVersion, message: reason)
            reportToWeb(success: false, message: "تم إلغاء التحديث واستعادة النسخة السابقة بسبب فشل وقائي: \(reason)")
            loadGame(cacheBuster: "rollback-\(UUID().uuidString)")
        } catch {
            reportUpdateLifecycle(phase: "FAILED", version: pendingNativeUpdate?.version, message: error.localizedDescription)
            reportToWeb(success: false, message: "فشل التحديث وتعذر الاسترجاع التلقائي: \(error.localizedDescription)")
        }
    }

    private func reportUpdateLifecycle(phase: String, version: String? = nil, message: String? = nil) {
        var detail: [String: Any] = ["phase": phase]
        if let version, !version.isEmpty { detail["version"] = version }
        if let message, !message.isEmpty { detail["message"] = message }
        guard JSONSerialization.isValidJSONObject(detail),
              let data = try? JSONSerialization.data(withJSONObject: detail, options: [.sortedKeys]) else { return }
        let encoded = data.base64EncodedString()
        let script = "(()=>{const b=Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0));const d=JSON.parse(new TextDecoder().decode(b));window.dispatchEvent(new CustomEvent('gh-update-lifecycle',{detail:d}));})();"
        webView.evaluateJavaScript(script)
    }

    private func validSaveEnvelope(_ payload: [String: Any], json: String) -> Bool {
        guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
              payload["saveSchemaVersion"] as? String == "2.0.0",
              let hash = payload["saveHash"] as? String,
              let data = json.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              root["saveVersion"] as? String == "2.0.0",
              let revision = payload["saveRevision"] as? NSNumber,
              let epoch = payload["resetEpoch"] as? NSNumber,
              revision.doubleValue == (root["saveRevision"] as? NSNumber)?.doubleValue,
              epoch.doubleValue == ((root["resetEpoch"] as? NSNumber)?.doubleValue ?? 0) else { return false }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() == hash
    }

    private func reportBridgeEvent(_ name: String, detail: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: detail, options: [.sortedKeys]) else { return }
        let encoded = data.base64EncodedString()
        // Both event name and envelope are JSON encoded; no user text is interpolated as code.
        guard let nameData = try? JSONSerialization.data(withJSONObject: [name]),
              let names = String(data: nameData, encoding: .utf8) else { return }
        let script = "(()=>{const d=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(encoded)'),c=>c.charCodeAt(0))));window.dispatchEvent(new CustomEvent(\(names)[0],{detail:d}));})();"
        webView.evaluateJavaScript(script)
    }

    private func reportSaveAck(payload: [String: Any], success: Bool, generation: Int?, message: String?) {
        var detail: [String: Any] = ["success": success, "message": message ?? ""]
        for key in ["requestId", "action", "saveRevision", "resetEpoch", "saveSchemaVersion", "saveHash"] {
            if let value = payload[key] { detail[key] = value }
        }
        if let generation { detail["generation"] = generation }
        let event = payload["action"] as? String == "resetGameSave" ? "gh-native-reset-ack" : "gh-native-save-ack"
        reportBridgeEvent(event, detail: detail)
    }

    private func reportToWeb(success: Bool, message: String) {
        reportBridgeEvent("gh-native-update", detail: ["success": success, "message": message])
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, navigationAction.navigationType == .linkActivated, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    private func showMessage(title: String, message: String, completion: (() -> Void)? = nil) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "حسنًا", style: .default) { _ in completion?() })
        present(alert, animated: true)
    }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
}

private final class GlobalGameSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            finish404(urlSchemeTask, url: URL(string: "gh://app/")!)
            return
        }
        var path = url.path.removingPercentEncoding ?? url.path
        if path.hasPrefix("/") { path.removeFirst() }
        if path.isEmpty { path = "index.html" }
        guard let file = GlobalGameStorage.shared.fileURL(for: path), let data = try? Data(contentsOf: file) else {
            finish404(urlSchemeTask, url: url)
            return
        }
        let type = mimeType(for: path)
        let contentType = isText(path) ? "\(type); charset=utf-8" : type
        let headers = ["Content-Type": contentType, "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", "Pragma": "no-cache", "Expires": "0"]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            finish404(urlSchemeTask, url: url)
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func finish404(_ task: WKURLSchemeTask, url: URL) {
        let body = Data("Game files not found.".utf8)
        if let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain; charset=utf-8"]) {
            task.didReceive(response)
        }
        task.didReceive(body)
        task.didFinish()
    }

    private func isText(_ path: String) -> Bool {
        ["html", "css", "js", "json", "txt", "svg", "geojson"].contains((path as NSString).pathExtension.lowercased())
    }

    private func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js": return "application/javascript"
        case "json": return "application/json"
        case "geojson": return "application/geo+json"
        case "webp": return "image/webp"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "txt": return "text/plain"
        default:
            let type = UTType(filenameExtension: (path as NSString).pathExtension)
            return type?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
