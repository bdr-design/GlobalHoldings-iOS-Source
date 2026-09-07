import Foundation
import CryptoKit

/// Owns the only runtime copy of the WebApp. Keeping the bundled and updated
/// content behind one storage API prevents the wrapper from switching between
/// incompatible resource paths after an update or a failed launch.
final class GlobalGameStorage {
    static let shared = GlobalGameStorage()

    struct AppliedUpdate {
        let version: String
        let manifest: [String: Any]
        let operations: [[String: Any]]
        let replacedWebFiles: Bool

        var webPayload: [String: Any] {
            [
                "format": GlobalGameStorage.updateFormat,
                "manifest": manifest,
                "operations": operations,
                "replacedWebFiles": replacedWebFiles
            ]
        }
    }

    private struct UpdateFile {
        let path: String
        let size: Int
        let sha256: String
        let data: Data
    }

    private struct ParsedUpdate {
        let manifest: [String: Any]
        let version: String
        let operations: [[String: Any]]
        let files: [UpdateFile]
        let deletedPaths: [String]
    }

    private struct UpdateJournal: Codable {
        let updateId: String
        let oldVersion: String
        let newVersion: String
        let oldSaveGeneration: Int
        var newSaveGeneration: Int?
        var stage: String
        let createdAt: Double
        var updatedAt: Double
    }

    private enum UpdateError: LocalizedError {
        case message(String)
        var errorDescription: String? {
            switch self { case .message(let value): return value }
        }
    }

    static let updateFormat = "global-holdings-update"
    private static let updateSignatureKeyId = "gh-primary-2026"
    private static let updatePublicKeyBase64 = "evYy4hozGTbgYxWOYn+WKGc9rgK8iPSxnvsxwkhRVLo="

    private let fileManager = FileManager.default
    private let folderName = "GlobalHoldingsRuntime"
    private let currentVersionKey = "GlobalHoldingsContentVersion"
    private let previousVersionKey = "GlobalHoldingsPreviousContentVersion"
    private let pendingBootVersionKey = "GlobalHoldingsPendingContentBootVersion"
    private let pendingBootPreviousVersionKey = "GlobalHoldingsPendingContentBootPreviousVersion"
    private let pendingBootStartedAtKey = "GlobalHoldingsPendingContentBootStartedAt"
    private let currentSaveGenerationKey = "GlobalHoldingsCurrentSaveGeneration"
    private let previousSaveGenerationKey = "GlobalHoldingsPreviousSaveGeneration"
    private let installedBundledBuildKey = "GlobalHoldingsInstalledBundledBuild"
    private let maxPackageBytes = 55 * 1024 * 1024
    private let maxSingleFileBytes = 25 * 1024 * 1024
    private let maxDecodedBytes = 100 * 1024 * 1024
    private let updateLock = NSLock()

    private init() {}

    var rootURL: URL {
        fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(folderName, isDirectory: true)
    }

    var webURL: URL { rootURL.appendingPathComponent("WebApp", isDirectory: true) }
    private var previousWebURL: URL { rootURL.appendingPathComponent("WebApp.previous", isDirectory: true) }
    private var stagingWebURL: URL { rootURL.appendingPathComponent("WebApp.staging", isDirectory: true) }
    private var incomingUpdatesURL: URL { rootURL.appendingPathComponent("IncomingUpdates", isDirectory: true) }
    private var updateJournalURL: URL { rootURL.appendingPathComponent("update-journal.json", isDirectory: false) }

    var currentVersion: String {
        UserDefaults.standard.string(forKey: currentVersionKey) ?? bundledVersion
    }

    var previousVersion: String? {
        guard hasPreviousVersion else { return nil }
        return UserDefaults.standard.string(forKey: previousVersionKey) ?? "النسخة السابقة"
    }

    var hasPreviousVersion: Bool { fileManager.fileExists(atPath: previousWebURL.path) }

    var bundledVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2.9.0"
    }

    var bundledBuild: Int {
        Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
    }

    func isSupportedUpdate(_ url: URL) -> Bool {
        ["saneiupdate", "ghupdate"].contains(url.pathExtension.lowercased())
    }

    /// Creates the initial mutable runtime package and repairs an interrupted
    /// filesystem swap before WebKit is allowed to load anything.
    func ensureInitialized() throws {
        guard try prepareRuntimeForUpdate() else {
            throw UpdateError.message("ملفات Global Holdings الأساسية غير موجودة داخل التطبيق.")
        }
    }

    func fileURL(for relativePath: String) -> URL? {
        guard isSafePath(relativePath) else { return nil }
        let candidate = webURL.appendingPathComponent(relativePath)
        return fileManager.fileExists(atPath: candidate.path) ? candidate : nil
    }

    func copyIncomingUpdate(from url: URL) throws -> URL {
        guard isSupportedUpdate(url) else {
            throw UpdateError.message("امتداد ملف التحديث غير مدعوم.")
        }
        try fileManager.createDirectory(at: incomingUpdatesURL, withIntermediateDirectories: true)
        let destination = incomingUpdatesURL.appendingPathComponent(UUID().uuidString + "." + url.pathExtension.lowercased())
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        do {
            try fileManager.copyItem(at: url, to: destination)
        } catch {
            try Data(contentsOf: url).write(to: destination, options: .atomic)
        }
        return destination
    }

    /// Removes only stale, already-imported update packages. Fresh incoming
    /// packages are deliberately preserved so cleanup can never race a user
    /// selection that has just been copied into the protected inbox.
    private func cleanupIncomingUpdates() {
        let cutoff = Date().addingTimeInterval(-24 * 60 * 60)
        guard let items = try? fileManager.contentsOfDirectory(
            at: incomingUpdatesURL,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        for item in items {
            guard isSupportedUpdate(item) else { continue }
            guard let values = try? item.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                  values.isRegularFile == true,
                  let modified = values.contentModificationDate,
                  modified < cutoff else { continue }
            try? fileManager.removeItem(at: item)
        }

        if let remaining = try? fileManager.contentsOfDirectory(atPath: incomingUpdatesURL.path),
           remaining.isEmpty {
            try? fileManager.removeItem(at: incomingUpdatesURL)
        }
    }

    func applyUpdatePackage(at packageURL: URL, preUpdateSaveGeneration: Int) throws -> AppliedUpdate {
        updateLock.lock()
        defer { updateLock.unlock() }
        let raw: Data
        do {
            let size = try packageURL.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= maxPackageBytes else {
                throw UpdateError.message("حجم حزمة التحديث يتجاوز الحد الآمن.")
            }
            raw = try Data(contentsOf: packageURL, options: [.mappedIfSafe])
        } catch let error as UpdateError {
            throw error
        } catch {
            throw UpdateError.message("تعذر قراءة ملف التحديث: \(error.localizedDescription)")
        }
        guard raw.count <= maxPackageBytes else {
            throw UpdateError.message("حجم حزمة التحديث يتجاوز الحد الآمن.")
        }
        let parsed = try parseUpdate(data: raw, requiresFormat: true)
        let result = try apply(parsed, preUpdateSaveGeneration: preUpdateSaveGeneration)
        try? fileManager.removeItem(at: packageURL)
        cleanupIncomingUpdates()
        return result
    }

    /// Keeps the existing in-game update center compatible while applying the
    /// exact same native validation, staging and rollback rules.
    func applyWebBridgeUpdate(manifest: [String: Any], files: [[String: Any]], operationsJSON: String, preUpdateSaveGeneration: Int) throws -> AppliedUpdate {
        updateLock.lock()
        defer { updateLock.unlock() }
        guard let data = operationsJSON.data(using: .utf8),
              let expected = manifest["operationsSha256"] as? String,
              sha256(data) == expected.lowercased(),
              let operations = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw UpdateError.message("تعليمات التحديث لا تطابق البصمة الموقعة.")
        }
        let parsed = try parse(manifest: manifest, operations: operations, rawFiles: files, rawDeletes: [])
        return try apply(parsed, preUpdateSaveGeneration: preUpdateSaveGeneration)
    }


    /// The only installer path. Package verification may have happened before
    /// this point, but no runtime mutation is allowed until a verified save
    /// checkpoint exists and PREPARED has been durably journaled.
    private func apply(_ update: ParsedUpdate, preUpdateSaveGeneration: Int) throws -> AppliedUpdate {
        guard preUpdateSaveGeneration > 0,
              GlobalSaveVault.shared.snapshot(generation: preUpdateSaveGeneration) != nil else {
            throw UpdateError.message("رفض التحديث: لم يتم تثبيت نقطة حفظ Native موثقة قبل التحديث.")
        }
        let hasCurrentRuntime = try prepareRuntimeForUpdate()
        if let pending = readUpdateJournal(), pending.stage != "COMMITTED" {
            throw UpdateError.message("يوجد انتقال Runtime غير مكتمل (\(pending.stage)). أكمل الاسترجاع/الإقلاع قبل تثبيت تحديث آخر.")
        }
        guard !update.files.isEmpty else {
            throw UpdateError.message("حزم Operations-only مرفوضة؛ القناة المستقرة تقبل Clean Snapshot كاملًا فقط.")
        }
        guard update.deletedPaths.isEmpty else {
            throw UpdateError.message("Overlay/Delete updates مرفوضة؛ استخدم Clean Snapshot كاملًا.")
        }

        let oldVersion = currentVersion
        let journal = UpdateJournal(
            updateId: (update.manifest["id"] as? String) ?? UUID().uuidString,
            oldVersion: oldVersion,
            newVersion: update.version,
            oldSaveGeneration: preUpdateSaveGeneration,
            newSaveGeneration: nil,
            stage: "PREPARED",
            createdAt: Date().timeIntervalSince1970,
            updatedAt: Date().timeIntervalSince1970
        )
        try writeUpdateJournal(journal)
        do {
            try GlobalSaveVault.shared.pinRollbackCheckpoint(generation: preUpdateSaveGeneration, runtimeVersion: oldVersion)
        } catch {
            clearUpdateJournal()
            throw UpdateError.message("تعذر تثبيت Rollback Checkpoint قبل التحديث: \(error.localizedDescription)")
        }

        // Always start from an empty staging directory. Never overlay the current Runtime.
        try? fileManager.removeItem(at: stagingWebURL)
        try fileManager.createDirectory(at: stagingWebURL, withIntermediateDirectories: true)
        for file in update.files {
            let relative = String(file.path.dropFirst("WebApp/".count))
            guard isSafePath(relative) else { throw UpdateError.message("مسار تحديث غير آمن: \(file.path)") }
            let destination = stagingWebURL.appendingPathComponent(relative)
            try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try file.data.write(to: destination, options: .atomic)
            guard let written = try? Data(contentsOf: destination), written.count == file.size, sha256(written) == file.sha256 else {
                throw UpdateError.message("فشل التحقق بعد كتابة الملف: \(file.path)")
            }
        }
        try validateStagedWebApp(at: stagingWebURL)
        try validateExactSnapshot(at: stagingWebURL, expectedFiles: update.files)
        try advanceUpdateJournal(stage: "STAGED")

        // Remove a stale rollback candidate while Current is still intact. Once
        // SWAP_STARTED is durable, any Previous directory is guaranteed to be
        // the exact runtime paired with journal.oldVersion.
        try? fileManager.removeItem(at: previousWebURL)
        try advanceUpdateJournal(stage: "SWAP_STARTED")
        if hasCurrentRuntime && fileManager.fileExists(atPath: webURL.path) {
            try fileManager.moveItem(at: webURL, to: previousWebURL)
            UserDefaults.standard.set(oldVersion, forKey: previousVersionKey)
        } else {
            UserDefaults.standard.removeObject(forKey: previousVersionKey)
        }
        do {
            try fileManager.moveItem(at: stagingWebURL, to: webURL)
            try advanceUpdateJournal(stage: "RUNTIME_SWAPPED")
        } catch {
            _ = try? rollbackJournalLocked(journal, reason: "runtime-swap-failed")
            throw UpdateError.message("فشل استبدال Runtime وتمت محاولة الاسترجاع: \(error.localizedDescription)")
        }

        UserDefaults.standard.set(update.version, forKey: currentVersionKey)
        UserDefaults.standard.set(preUpdateSaveGeneration, forKey: previousSaveGenerationKey)
        UserDefaults.standard.set(update.version, forKey: pendingBootVersionKey)
        UserDefaults.standard.set(oldVersion, forKey: pendingBootPreviousVersionKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: pendingBootStartedAtKey)
        return AppliedUpdate(version: update.version, manifest: update.manifest, operations: update.operations, replacedWebFiles: true)
    }

    private func readUpdateJournal() -> UpdateJournal? {
        guard let data = try? Data(contentsOf: updateJournalURL),
              let journal = try? JSONDecoder().decode(UpdateJournal.self, from: data),
              !journal.updateId.isEmpty, !journal.oldVersion.isEmpty, !journal.newVersion.isEmpty,
              journal.oldSaveGeneration >= 0, !journal.stage.isEmpty else { return nil }
        return journal
    }

    private func writeUpdateJournal(_ journal: UpdateJournal) throws {
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(journal)
        try data.write(to: updateJournalURL, options: .atomic)
        guard let verified = readUpdateJournal(), verified.updateId == journal.updateId,
              verified.stage == journal.stage, verified.oldVersion == journal.oldVersion,
              verified.newVersion == journal.newVersion else {
            throw UpdateError.message("فشل تثبيت Update Journal على التخزين.")
        }
    }

    private func advanceUpdateJournal(stage: String, newSaveGeneration: Int? = nil) throws {
        guard var journal = readUpdateJournal() else { throw UpdateError.message("Update Journal مفقود.") }
        journal.stage = stage
        if let newSaveGeneration { journal.newSaveGeneration = newSaveGeneration }
        journal.updatedAt = Date().timeIntervalSince1970
        try writeUpdateJournal(journal)
    }

    private func clearUpdateJournal() { try? fileManager.removeItem(at: updateJournalURL) }

    func markUpdateStateCommitted(version: String, saveGeneration: Int) throws {
        updateLock.lock(); defer { updateLock.unlock() }
        guard saveGeneration > 0 else { throw UpdateError.message("Save Generation الناتجة غير صالحة.") }
        guard currentVersion == version else { throw UpdateError.message("Runtime version تغيّر قبل تثبيت حالة التحديث.") }
        guard let journal = readUpdateJournal(), journal.newVersion == version,
              ["RUNTIME_SWAPPED", "OPERATIONS_APPLYING"].contains(journal.stage) else {
            throw UpdateError.message("Update Journal ليس في حالة تسمح بتثبيت State.")
        }
        guard GlobalSaveVault.shared.snapshot(generation: saveGeneration) != nil else {
            throw UpdateError.message("Save Generation الناتجة غير موجودة في Native Vault.")
        }
        try advanceUpdateJournal(stage: "STATE_COMMITTED", newSaveGeneration: saveGeneration)
    }

    @discardableResult
    func confirmCurrentUpdateBoot(version: String) throws -> Bool {
        updateLock.lock(); defer { updateLock.unlock() }
        guard UserDefaults.standard.string(forKey: pendingBootVersionKey) == version,
              currentVersion == version else { return false }
        try validateStagedWebApp(at: webURL)
        guard let journal = readUpdateJournal(), journal.newVersion == version, journal.stage == "STATE_COMMITTED" else {
            throw UpdateError.message("رفض Boot Confirm: حالة التحديث لم تُحفظ ذريًا بعد.")
        }
        if !journal.updateId.hasPrefix("BUNDLED-") {
            guard let generation = journal.newSaveGeneration, generation > 0,
                  GlobalSaveVault.shared.snapshot(generation: generation) != nil else {
                throw UpdateError.message("رفض Boot Confirm: Save Generation النهائية غير موثقة.")
            }
            UserDefaults.standard.set(generation, forKey: currentSaveGenerationKey)
        }
        // The previous Runtime/Save pair must already have been pinned before
        // filesystem mutation. Never recreate it here from the rolling A/B vault:
        // ordinary autosaves may have rotated the original generation away.
        if journal.oldSaveGeneration > 0, !GlobalSaveVault.shared.hasRollbackCheckpoint(for: journal.oldVersion) {
            throw UpdateError.message("رفض Boot Confirm: Rollback Checkpoint للنسخة السابقة مفقودة.")
        }
        if journal.updateId.hasPrefix("BUNDLED-") {
            UserDefaults.standard.set(bundledBuild, forKey: installedBundledBuildKey)
        }
        try advanceUpdateJournal(stage: "COMMITTED")
        clearPendingBootMarker()
        clearUpdateJournal()
        return true
    }

    @discardableResult
    func rollbackPendingUpdate(reason: String) throws -> String {
        updateLock.lock(); defer { updateLock.unlock() }
        if let journal = readUpdateJournal() {
            if journal.stage == "COMMITTED" {
                try finishCommittedJournalHousekeeping(journal)
                return currentVersion
            }
            return try rollbackJournalLocked(journal, reason: reason)
        }
        try recoverLegacyPendingBootIfNeeded()
        return currentVersion
    }

    private func clearPendingBootMarker() {
        UserDefaults.standard.removeObject(forKey: pendingBootVersionKey)
        UserDefaults.standard.removeObject(forKey: pendingBootPreviousVersionKey)
        UserDefaults.standard.removeObject(forKey: pendingBootStartedAtKey)
    }

    private func recoverUnconfirmedUpdateIfNeeded() throws {
        if let journal = readUpdateJournal() {
            if journal.stage == "COMMITTED" {
                // COMMITTED is the durable commit marker. A crash after writing it
                // but before UserDefaults/marker housekeeping must complete the new
                // pair, never reinterpret it as an unconfirmed update.
                try finishCommittedJournalHousekeeping(journal)
                return
            }
            _ = try rollbackJournalLocked(journal, reason: "startup-recovery")
            return
        }
        try recoverLegacyPendingBootIfNeeded()
    }

    private func finishCommittedJournalHousekeeping(_ journal: UpdateJournal) throws {
        guard journal.stage == "COMMITTED" else { return }
        UserDefaults.standard.set(journal.newVersion, forKey: currentVersionKey)
        UserDefaults.standard.set(journal.oldVersion, forKey: previousVersionKey)
        if let generation = journal.newSaveGeneration, generation > 0 {
            guard GlobalSaveVault.shared.snapshot(generation: generation) != nil else {
                throw UpdateError.message("COMMITTED journal references a missing final Save Generation.")
            }
            UserDefaults.standard.set(generation, forKey: currentSaveGenerationKey)
        }
        if journal.oldSaveGeneration > 0 {
            UserDefaults.standard.set(journal.oldSaveGeneration, forKey: previousSaveGenerationKey)
        }
        if journal.updateId.hasPrefix("BUNDLED-") {
            UserDefaults.standard.set(bundledBuild, forKey: installedBundledBuildKey)
        }
        clearPendingBootMarker()
        clearUpdateJournal()
    }

    private func recoverLegacyPendingBootIfNeeded() throws {
        guard UserDefaults.standard.string(forKey: pendingBootVersionKey) != nil else { return }
        let prior = UserDefaults.standard.string(forKey: pendingBootPreviousVersionKey)
            ?? UserDefaults.standard.string(forKey: previousVersionKey)
            ?? bundledVersion
        if fileManager.fileExists(atPath: previousWebURL.path) {
            try? fileManager.removeItem(at: webURL)
            try fileManager.moveItem(at: previousWebURL, to: webURL)
            UserDefaults.standard.set(prior, forKey: currentVersionKey)
            let oldSave = UserDefaults.standard.integer(forKey: previousSaveGenerationKey)
            if oldSave > 0, GlobalSaveVault.shared.snapshot(generation: oldSave) != nil {
                let promoted = try GlobalSaveVault.shared.restoreGeneration(oldSave, runtimeVersion: prior)
                UserDefaults.standard.set(promoted, forKey: currentSaveGenerationKey)
            }
        }
        clearPendingBootMarker()
    }

    @discardableResult
    private func rollbackJournalLocked(_ journal: UpdateJournal, reason: String) throws -> String {
        try? fileManager.removeItem(at: stagingWebURL)
        let runtimeMayHaveMoved = ["SWAP_STARTED", "RUNTIME_SWAPPED", "STATE_COMMITTED"].contains(journal.stage)
        if runtimeMayHaveMoved {
            if fileManager.fileExists(atPath: previousWebURL.path) {
                try? fileManager.removeItem(at: webURL)
                try fileManager.moveItem(at: previousWebURL, to: webURL)
            } else if !fileManager.fileExists(atPath: webURL.path),
                      let bundled = Bundle.main.resourceURL?.appendingPathComponent("WebApp", isDirectory: true),
                      fileManager.fileExists(atPath: bundled.path) {
                try fileManager.copyItem(at: bundled, to: webURL)
            }
            UserDefaults.standard.set(journal.oldVersion, forKey: currentVersionKey)
            UserDefaults.standard.removeObject(forKey: previousVersionKey)
            UserDefaults.standard.removeObject(forKey: previousSaveGenerationKey)
        }
        // PREPARED/STAGED are pre-mutation stages: leave Current/Previous exactly
        // as they were. Restoring the checkpoint is only necessary once a runtime
        // swap/state commit could have exposed a different browser state.
        if runtimeMayHaveMoved && journal.oldSaveGeneration > 0 {
            let restored: Int
            if GlobalSaveVault.shared.hasRollbackCheckpoint(for: journal.oldVersion) {
                restored = try GlobalSaveVault.shared.restoreRollbackCheckpoint(expectedRuntimeVersion: journal.oldVersion)
            } else {
                // Legacy fallback only; new Build242 transitions pin an independent
                // checkpoint before any Runtime mutation.
                restored = try GlobalSaveVault.shared.restoreGeneration(journal.oldSaveGeneration, runtimeVersion: journal.oldVersion)
            }
            UserDefaults.standard.set(restored, forKey: currentSaveGenerationKey)
        }
        clearPendingBootMarker()
        clearUpdateJournal()
        return journal.oldVersion
    }

    func noteCurrentSaveGeneration(_ generation: Int) {
        guard generation > 0 else { return }
        UserDefaults.standard.set(generation, forKey: currentSaveGenerationKey)
    }

    @discardableResult
    func restorePreviousVersion() throws -> String {
        updateLock.lock()
        defer { updateLock.unlock() }
        return try restorePreviousVersionLocked()
    }

    private func restorePreviousVersionLocked() throws -> String {
        try ensureInitialized()
        guard hasPreviousVersion else {
            throw UpdateError.message("لا توجد نسخة محتوى سابقة قابلة للاستعادة.")
        }

        let current = currentVersion
        let target = previousVersion ?? "النسخة السابقة"
        let currentSaveGeneration = UserDefaults.standard.integer(forKey: currentSaveGenerationKey)
        guard currentSaveGeneration > 0, GlobalSaveVault.shared.snapshot(generation: currentSaveGeneration) != nil else {
            throw UpdateError.message("رفض الاسترجاع: الحالة الحالية لا تملك Save Generation موثقة يمكن الرجوع إليها عند فشل الاسترجاع.")
        }
        guard let targetSave = GlobalSaveVault.shared.rollbackCheckpointSnapshot(expectedRuntimeVersion: target) else {
            throw UpdateError.message("رفض الاسترجاع: لا توجد Rollback Checkpoint دائمة ومطابقة للنسخة السابقة.")
        }

        var journal = UpdateJournal(
            updateId: "RESTORE-\(target)-\(UUID().uuidString)",
            oldVersion: current,
            newVersion: target,
            oldSaveGeneration: currentSaveGeneration,
            newSaveGeneration: nil,
            stage: "PREPARED",
            createdAt: Date().timeIntervalSince1970,
            updatedAt: Date().timeIntervalSince1970
        )
        try writeUpdateJournal(journal)
        do {
            // The target payload is already held in verified memory. Repin the
            // current pair now so any failed/manual reverse transition restores
            // the Runtime that is about to become Previous.
            try GlobalSaveVault.shared.pinRollbackCheckpoint(generation: currentSaveGeneration, runtimeVersion: current)
        } catch {
            clearUpdateJournal()
            throw UpdateError.message("تعذر تثبيت نقطة رجوع للحالة الحالية: \(error.localizedDescription)")
        }

        // Copy the requested previous runtime into clean staging first. Current
        // remains untouched until staging is validated and SWAP_STARTED is durable.
        try? fileManager.removeItem(at: stagingWebURL)
        try fileManager.copyItem(at: previousWebURL, to: stagingWebURL)
        try validateStagedWebApp(at: stagingWebURL)
        try advanceUpdateJournal(stage: "STAGED")
        try? fileManager.removeItem(at: previousWebURL)
        try advanceUpdateJournal(stage: "SWAP_STARTED")

        if fileManager.fileExists(atPath: webURL.path) {
            try fileManager.moveItem(at: webURL, to: previousWebURL)
        }
        do {
            try fileManager.moveItem(at: stagingWebURL, to: webURL)
            try advanceUpdateJournal(stage: "RUNTIME_SWAPPED")
            let promoted = try GlobalSaveVault.shared.commit(targetSave.payload, runtimeVersion: target)
            journal.newSaveGeneration = promoted
            journal.stage = "STATE_COMMITTED"
            journal.updatedAt = Date().timeIntervalSince1970
            try writeUpdateJournal(journal)
            UserDefaults.standard.set(target, forKey: currentVersionKey)
            UserDefaults.standard.set(current, forKey: previousVersionKey)
            UserDefaults.standard.set(currentSaveGeneration, forKey: previousSaveGenerationKey)
            UserDefaults.standard.set(target, forKey: pendingBootVersionKey)
            UserDefaults.standard.set(current, forKey: pendingBootPreviousVersionKey)
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: pendingBootStartedAtKey)
            return target
        } catch {
            _ = try? rollbackJournalLocked(journal, reason: "manual-restore-failed")
            throw UpdateError.message("تعذر استعادة النسخة السابقة: \(error.localizedDescription)")
        }
    }

    private func validateExactSnapshot(at folder: URL, expectedFiles: [UpdateFile]) throws {
        let expected = Set(expectedFiles.map { $0.path })
        guard !expected.isEmpty else { throw UpdateError.message("Clean Snapshot لا يحتوي أي ملفات.") }
        guard let enumerator = fileManager.enumerator(
            at: folder,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { throw UpdateError.message("تعذر فهرسة مجلد Staging للتحقق من نظافة التحديث.") }

        var actual = Set<String>()
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            guard values.isRegularFile == true else { continue }
            guard let relative = safeRelativePath(of: url, inside: folder) else {
                throw UpdateError.message("مسار ملف Staging غير متوقع.")
            }
            guard isSafePath(relative) else { throw UpdateError.message("مسار غير آمن داخل Staging: \(relative)") }
            actual.insert("WebApp/" + relative)
        }
        let missing = expected.subtracting(actual).sorted()
        let orphaned = actual.subtracting(expected).sorted()
        guard missing.isEmpty, orphaned.isEmpty else {
            let m = missing.prefix(6).joined(separator: ", ")
            let o = orphaned.prefix(6).joined(separator: ", ")
            throw UpdateError.message("فشل تطابق Clean Snapshot. مفقود: [\(m)] · ملفات يتيمة: [\(o)]")
        }
    }

    /// Returns false only when neither a healthy runtime nor the bundled
    /// WebApp exists. `apply(_:)` can then bootstrap from a complete update.
    private func prepareRuntimeForUpdate() throws -> Bool {
        try fileManager.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try recoverUnconfirmedUpdateIfNeeded()

        if !fileManager.fileExists(atPath: webURL.path), fileManager.fileExists(atPath: previousWebURL.path) {
            try fileManager.moveItem(at: previousWebURL, to: webURL)
            if let prior = UserDefaults.standard.string(forKey: previousVersionKey) {
                UserDefaults.standard.set(prior, forKey: currentVersionKey)
            }
            UserDefaults.standard.removeObject(forKey: previousVersionKey)
        }

        guard let bundled = Bundle.main.resourceURL?.appendingPathComponent("WebApp", isDirectory: true),
              fileManager.fileExists(atPath: bundled.path) else {
            return fileManager.fileExists(atPath: webURL.path)
        }

        // A newly signed IPA may contain a newer clean baseline than the mutable
        // runtime left by an older installation. Promote the bundled baseline
        // atomically instead of silently continuing to execute stale web files.
        if fileManager.fileExists(atPath: webURL.path) {
            let recorded = UserDefaults.standard.string(forKey: currentVersionKey) ?? "0.0.0"
            let installedBuild = UserDefaults.standard.integer(forKey: installedBundledBuildKey)
            let semanticUpgrade = isVersion(bundledVersion, newerThan: recorded)
            let sameSemantic = !isVersion(bundledVersion, newerThan: recorded) && !isVersion(recorded, newerThan: bundledVersion)
            let buildUpgrade = sameSemantic && bundledBuild > installedBuild
            // Never replace a runtime whose semantic content version is newer
            // than the IPA baseline. Equal semantic versions may be refreshed by
            // a higher signed IPA build generation (e.g. Build241 -> Build242).
            if semanticUpgrade || buildUpgrade {
                try installBundledBaseline(from: bundled, replacingVersion: recorded)
            }
            return true
        }

        try fileManager.copyItem(at: bundled, to: webURL)
        UserDefaults.standard.set(bundledVersion, forKey: currentVersionKey)
        UserDefaults.standard.set(bundledBuild, forKey: installedBundledBuildKey)
        return true
    }


    private func isVersion(_ lhs: String, newerThan rhs: String) -> Bool {
        func parts(_ value: String) -> [Int] {
            value.split(separator: ".").prefix(4).map { part in
                Int(part.prefix { $0.isNumber }) ?? 0
            }
        }
        let a = parts(lhs), b = parts(rhs)
        for index in 0..<max(a.count, b.count) {
            let av = index < a.count ? a[index] : 0
            let bv = index < b.count ? b[index] : 0
            if av != bv { return av > bv }
        }
        return false
    }

    private func installBundledBaseline(from bundled: URL, replacingVersion: String) throws {
        let oldSaveGeneration = GlobalSaveVault.shared.currentGeneration()
        var journal = UpdateJournal(
            updateId: "BUNDLED-\(bundledVersion)-\(UUID().uuidString)",
            oldVersion: replacingVersion,
            newVersion: bundledVersion,
            oldSaveGeneration: oldSaveGeneration,
            newSaveGeneration: nil,
            stage: "PREPARED",
            createdAt: Date().timeIntervalSince1970,
            updatedAt: Date().timeIntervalSince1970
        )
        try writeUpdateJournal(journal)
        if oldSaveGeneration > 0 {
            do {
                try GlobalSaveVault.shared.pinRollbackCheckpoint(generation: oldSaveGeneration, runtimeVersion: replacingVersion)
            } catch {
                clearUpdateJournal()
                throw UpdateError.message("تعذر تثبيت Rollback Checkpoint قبل ترقية الـIPA: \(error.localizedDescription)")
            }
        }
        try? fileManager.removeItem(at: stagingWebURL)
        try fileManager.copyItem(at: bundled, to: stagingWebURL)
        try validateStagedWebApp(at: stagingWebURL)
        try advanceUpdateJournal(stage: "STAGED")

        // Exactly the same crash contract as an imported update: stale rollback
        // content is removed while Current is intact, then SWAP_STARTED is
        // journaled before Current is moved.
        try? fileManager.removeItem(at: previousWebURL)
        try advanceUpdateJournal(stage: "SWAP_STARTED")
        if fileManager.fileExists(atPath: webURL.path) {
            try fileManager.moveItem(at: webURL, to: previousWebURL)
            UserDefaults.standard.set(replacingVersion, forKey: previousVersionKey)
        }
        do {
            try fileManager.moveItem(at: stagingWebURL, to: webURL)
        } catch {
            try? fileManager.removeItem(at: webURL)
            if fileManager.fileExists(atPath: previousWebURL.path) {
                try? fileManager.moveItem(at: previousWebURL, to: webURL)
                UserDefaults.standard.set(replacingVersion, forKey: currentVersionKey)
            }
            clearUpdateJournal()
            throw error
        }
        try advanceUpdateJournal(stage: "RUNTIME_SWAPPED")
        UserDefaults.standard.set(bundledVersion, forKey: currentVersionKey)
        UserDefaults.standard.set(replacingVersion, forKey: pendingBootPreviousVersionKey)
        UserDefaults.standard.set(bundledVersion, forKey: pendingBootVersionKey)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: pendingBootStartedAtKey)
        if oldSaveGeneration > 0 {
            UserDefaults.standard.set(oldSaveGeneration, forKey: previousSaveGenerationKey)
            journal.newSaveGeneration = oldSaveGeneration
            journal.stage = "STATE_COMMITTED"
            journal.updatedAt = Date().timeIntervalSince1970
            try writeUpdateJournal(journal)
        } else {
            // A pristine install can have no prior save; bootstrap is allowed to
            // use the clean default state, represented by generation 0.
            journal.newSaveGeneration = 0
            journal.stage = "STATE_COMMITTED"
            journal.updatedAt = Date().timeIntervalSince1970
            try writeUpdateJournal(journal)
        }
    }

    private func parseUpdate(data: Data, requiresFormat: Bool) throws -> ParsedUpdate {
        let normalized = try normalizedJSONData(from: data)
        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: normalized, options: [.fragmentsAllowed])
        } catch {
            throw UpdateError.message("صيغة ملف التحديث غير صالحة.")
        }

        let root: [String: Any]
        if let wrapped = object as? String,
           let wrappedData = wrapped.data(using: .utf8),
           let nested = try? JSONSerialization.jsonObject(with: wrappedData, options: [.fragmentsAllowed]),
           let value = nested as? [String: Any] {
            root = value
        } else if let value = object as? [String: Any] {
            root = value
        } else {
            throw UpdateError.message("غلاف حزمة التحديث غير صالح.")
        }

        if requiresFormat, (root["format"] as? String) != Self.updateFormat {
            throw UpdateError.message("هذا ليس ملف تحديث Global Holdings.")
        }

        let manifest: [String: Any]
        if let rawManifest = root["manifest"] {
            guard let value = rawManifest as? [String: Any] else {
                throw UpdateError.message("بيانات تعريف التحديث غير صالحة.")
            }
            manifest = value
        } else {
            manifest = [:]
        }

        let operations: [[String: Any]]
        guard let operationsJSON = root["operationsJSON"] as? String else {
            // The bytes executed by the WebApp must be exactly the signed bytes,
            // even when the canonical operation list is simply [].
            throw UpdateError.message("حزمة التحديث الموقعة يجب أن تحتوي operationsJSON المطابق للبصمة.")
        }
        guard let operationsData = operationsJSON.data(using: .utf8),
              let expectedOperationsHash = manifest["operationsSha256"] as? String,
              isSHA256(expectedOperationsHash),
              sha256(operationsData) == expectedOperationsHash.lowercased(),
              let operationsValue = try? JSONSerialization.jsonObject(with: operationsData) as? [[String: Any]] else {
            throw UpdateError.message("تعليمات التحديث لا تطابق البصمة الموقعة.")
        }
        guard root["operations"] == nil else {
            throw UpdateError.message("مصفوفة operations المنفردة مرفوضة؛ operationsJSON هو المصدر الوحيد للتنفيذ.")
        }
        operations = operationsValue

        let files: [[String: Any]]
        if let rawFiles = root["files"] {
            guard let value = rawFiles as? [[String: Any]] else {
                throw UpdateError.message("فهرس ملفات التحديث غير صالح.")
            }
            files = value
        } else {
            files = []
        }

        let deleted: [String]
        if let rawDeletes = root["delete"] {
            guard let value = rawDeletes as? [String] else {
                throw UpdateError.message("قائمة حذف ملفات التحديث غير صالحة.")
            }
            deleted = value
        } else {
            deleted = []
        }
        return try parse(manifest: manifest, operations: operations, rawFiles: files, rawDeletes: deleted)
    }

    private func parse(
        manifest: [String: Any],
        operations: [[String: Any]],
        rawFiles: [[String: Any]],
        rawDeletes: [String]
    ) throws -> ParsedUpdate {
        guard let rawVersion = manifest["version"] as? String else {
            throw UpdateError.message("رقم إصدار التحديث مفقود.")
        }
        let version = rawVersion.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !version.isEmpty, version.count <= 100 else {
            throw UpdateError.message("رقم إصدار التحديث غير صالح.")
        }

        try verifyManifestSignature(manifest)
        guard (manifest["packageType"] as? String) == "full-web",
              (manifest["installMode"] as? String) == "clean-snapshot-v1" else {
            throw UpdateError.message("Overlay القديمة مرفوضة؛ Native يقبل full-web / clean-snapshot-v1 فقط.")
        }

        // Stable release channel accepts one exact package contract. The values
        // are signed and are also enforced here so a differently typed, but
        // otherwise validly signed, package cannot enter the clean installer.
        guard (manifest["packageType"] as? String) == "full-web",
              (manifest["installMode"] as? String) == "clean-snapshot-v1" else {
            throw UpdateError.message("القناة المستقرة تقبل full-web / clean-snapshot-v1 فقط.")
        }

        let minimum = (manifest["minGameVersion"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let minimum, !minimum.isEmpty, compareVersion(minimum, bundledVersion) == .orderedDescending {
            throw UpdateError.message("تحتاج هذه الحزمة إلى إصدار تطبيق \(minimum) أو أحدث.")
        }
        if compareVersion(version, currentVersion) != .orderedDescending {
            throw UpdateError.message("تم رفض التحديث: الإصدار الهدف يجب أن يكون أحدث من الإصدار الحالي. استخدم آلية الاسترجاع الأصلية للرجوع إلى نسخة سابقة.")
        }

        if let declaredCount = integer(manifest["fileCount"]), declaredCount != rawFiles.count {
            throw UpdateError.message("عدد ملفات التحديث لا يطابق الفهرس المعلن.")
        }

        if !operations.isEmpty {
            guard let operationsHash = manifest["operationsSha256"] as? String, isSHA256(operationsHash) else {
                throw UpdateError.message("بصمة عمليات التحديث الموقعة مفقودة.")
            }
        }

        var paths = Set<String>()
        var files: [UpdateFile] = []
        var decodedTotal = 0

        for raw in rawFiles {
            guard let path = raw["path"] as? String,
                  path.hasPrefix("WebApp/"),
                  isSafePath(String(path.dropFirst("WebApp/".count))),
                  paths.insert(path).inserted,
                  let declaredSize = integer(raw["size"]), declaredSize >= 0,
                  let hash = raw["sha256"] as? String,
                  isSHA256(hash),
                  let base64 = raw["base64"] as? String,
                  let decoded = Data(base64Encoded: base64, options: []) else {
                throw UpdateError.message("أحد ملفات التحديث غير صالح أو غير آمن.")
            }

            guard decoded.count == declaredSize else {
                throw UpdateError.message("حجم الملف لا يطابق الفهرس: \(path)")
            }
            guard decoded.count <= maxSingleFileBytes else {
                throw UpdateError.message("ملف التحديث كبير جدًا: \(path)")
            }
            decodedTotal += decoded.count
            guard decodedTotal <= maxDecodedBytes else {
                throw UpdateError.message("إجمالي ملفات التحديث يتجاوز الحد الآمن.")
            }
            guard sha256(decoded) == hash.lowercased() else {
                throw UpdateError.message("بصمة الملف غير مطابقة: \(path)")
            }
            files.append(UpdateFile(path: path, size: declaredSize, sha256: hash.lowercased(), data: decoded))
        }

        if let declaredBytes = integer(manifest["unpackedBytes"]), declaredBytes != decodedTotal {
            throw UpdateError.message("حجم محتوى التحديث لا يطابق الفهرس المعلن.")
        }

        if let expectedIndexHash = manifest["filesIndexSha256"] as? String, !expectedIndexHash.isEmpty {
            let index: [[Any]] = files.map { [$0.path, $0.sha256, $0.size] }
            guard let indexData = try? JSONSerialization.data(withJSONObject: index, options: []),
                  sha256(indexData) == expectedIndexHash.lowercased() else {
                throw UpdateError.message("فهرس ملفات التحديث غير مطابق.")
            }
        }

        var deleted = Set<String>()
        for path in rawDeletes {
            guard path.hasPrefix("WebApp/"),
                  isSafePath(String(path.dropFirst("WebApp/".count))),
                  deleted.insert(path).inserted,
                  !paths.contains(path) else {
                throw UpdateError.message("مسار حذف التحديث غير صالح أو متعارض.")
            }
        }

        return ParsedUpdate(
            manifest: manifest,
            version: version,
            operations: operations,
            files: files,
            deletedPaths: Array(deleted)
        )
    }

    private func validateStagedWebApp(at folder: URL) throws {
        let manifestURL = folder.appendingPathComponent("runtime-required.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let manifest = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              manifest["format"] as? String == "gh-runtime-required-v1",
              manifest["saveSchemaVersion"] as? String == "2.0.0",
              let minimumBuild = manifest["minimumNativeBuild"] as? Int, minimumBuild >= 251,
              (Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0) >= minimumBuild,
              let required = manifest["files"] as? [String], !required.isEmpty,
              Set(required).count == required.count,
              required.contains("runtime-required.json") else {
            throw UpdateError.message("Runtime manifest مفقود أو غير صالح.")
        }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("WebApp/runtime-required.json"),
           bundled.standardizedFileURL != manifestURL.standardizedFileURL {
            guard let data = try? Data(contentsOf: bundled),
                  let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let baseline = root["files"] as? [String],
                  Set(required).isSuperset(of: Set(baseline)) else {
                throw UpdateError.message("Runtime manifest لا يحافظ على الوحدات الأساسية المثبتة.")
            }
        }
        for file in required {
            guard isSafePath(file) else { throw UpdateError.message("Unsafe runtime path.") }
            let url = folder.appendingPathComponent(file)
            guard fileManager.fileExists(atPath: url.path) else {
                throw UpdateError.message("ملف أساسي مفقود في التحديث: \(file)")
            }
            let fileSize = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            guard fileSize > 0 else {
                throw UpdateError.message("ملف أساسي مفقود في التحديث: \(file)")
            }
        }

        guard let entries = fileManager.enumerator(at: folder, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]) else {
            throw UpdateError.message("تعذر تعداد ملفات Runtime.")
        }
        var actual = Set<String>()
        for case let entry as URL in entries {
            let values = try entry.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            if values.isSymbolicLink == true { throw UpdateError.message("Runtime symlinks are forbidden.") }
            if values.isRegularFile == true { actual.insert(String(entry.path.dropFirst(folder.path.count + 1))) }
        }
        guard actual == Set(required) else { throw UpdateError.message("Runtime file set differs from its manifest.") }

        let indexURL = folder.appendingPathComponent("index.html")
        guard let html = try? String(contentsOf: indexURL, encoding: .utf8) else {
            throw UpdateError.message("تعذر فحص صفحة تشغيل اللعبة.")
        }
        let pattern = #"""(?:src|href)\s*=\s*["']([^"'?#]+)(?:\?[^"']*)?["']"""#
        let regex = try NSRegularExpression(pattern: pattern, options: [.caseInsensitive])
        let range = NSRange(html.startIndex..<html.endIndex, in: html)
        for match in regex.matches(in: html, options: [], range: range) {
            guard match.numberOfRanges > 1,
                  let swiftRange = Range(match.range(at: 1), in: html) else { continue }
            let raw = String(html[swiftRange])
            if raw.hasPrefix("http://") || raw.hasPrefix("https://") || raw.hasPrefix("data:") || raw.hasPrefix("//") || raw.hasPrefix("#") {
                continue
            }
            let relative = raw.removingPercentEncoding ?? raw
            guard isSafePath(relative), fileManager.fileExists(atPath: folder.appendingPathComponent(relative).path) else {
                throw UpdateError.message("ملف واجهة مشار إليه غير موجود: \(relative)")
            }
        }
    }

    private func normalizedJSONData(from original: Data) throws -> Data {
        guard !original.isEmpty else {
            throw UpdateError.message("ملف التحديث فارغ.")
        }
        var data = original
        if data.count >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
            data.removeFirst(3)
        }
        if data.count >= 2 && ((data[0] == 0xFF && data[1] == 0xFE) || (data[0] == 0xFE && data[1] == 0xFF)) {
            let encoding: String.Encoding = data[0] == 0xFF ? .utf16LittleEndian : .utf16BigEndian
            guard let decoded = String(data: data.dropFirst(2), encoding: encoding), let utf8 = decoded.data(using: .utf8) else {
                throw UpdateError.message("تعذر قراءة ترميز ملف التحديث.")
            }
            data = utf8
        }
        guard let text = String(data: data, encoding: .utf8) else {
            throw UpdateError.message("ملف التحديث لا يستخدم ترميز UTF-8 صالحًا.")
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\0")))
        guard !trimmed.isEmpty else { throw UpdateError.message("ملف التحديث فارغ.") }
        let direct = Data(trimmed.utf8)
        if let first = direct.first, first == 0x7B || first == 0x5B || first == 0x22 { return direct }

        if let decoded = Data(base64Encoded: trimmed, options: [.ignoreUnknownCharacters]) {
            var candidate = decoded
            if candidate.count >= 3 && candidate[0] == 0xEF && candidate[1] == 0xBB && candidate[2] == 0xBF {
                candidate.removeFirst(3)
            }
            if candidate.count >= 2 && ((candidate[0] == 0xFF && candidate[1] == 0xFE) || (candidate[0] == 0xFE && candidate[1] == 0xFF)) {
                let encoding: String.Encoding = candidate[0] == 0xFF ? .utf16LittleEndian : .utf16BigEndian
                if let decodedText = String(data: candidate.dropFirst(2), encoding: encoding), let utf8 = decodedText.data(using: .utf8) {
                    candidate = utf8
                }
            }
            if let candidateText = String(data: candidate, encoding: .utf8) {
                let cleaned = candidateText.trimmingCharacters(in: .whitespacesAndNewlines.union(CharacterSet(charactersIn: "\0")))
                let cleanedData = Data(cleaned.utf8)
                if let first = cleanedData.first, first == 0x7B || first == 0x5B || first == 0x22 { return cleanedData }
            }
        }
        return direct
    }

    private func verifyManifestSignature(_ manifest: [String: Any]) throws {
        guard let algorithm = manifest["signatureAlgorithm"] as? String, algorithm.lowercased() == "ed25519",
              let keyId = manifest["signatureKeyId"] as? String, keyId == Self.updateSignatureKeyId,
              let signatureText = manifest["signature"] as? String,
              let signature = Data(base64Encoded: signatureText), signature.count == 64,
              let publicKeyData = Data(base64Encoded: Self.updatePublicKeyBase64), publicKeyData.count == 32 else {
            throw UpdateError.message("حزمة التحديث غير موقعة بمفتاح Global Holdings الموثوق.")
        }
        guard let id = manifest["id"] as? String,
              let version = manifest["version"] as? String,
              let fileCount = integer(manifest["fileCount"]),
              let unpackedBytes = integer(manifest["unpackedBytes"]),
              let filesIndex = manifest["filesIndexSha256"] as? String, isSHA256(filesIndex),
              let operationsHash = manifest["operationsSha256"] as? String, isSHA256(operationsHash) else {
            throw UpdateError.message("حقول التوقيع في manifest غير مكتملة.")
        }
        let payloadVersion = integer(manifest["signaturePayloadVersion"]) ?? 0
        guard payloadVersion == 2 else {
            throw UpdateError.message("قناة التحديث المستقرة تقبل توقيع Clean Snapshot v2 فقط.")
        }
        let payload: String
        if payloadVersion == 2 {
            guard let minimum = manifest["minGameVersion"] as? String,
                  let packageType = manifest["packageType"] as? String,
                  let installMode = manifest["installMode"] as? String else {
                throw UpdateError.message("حقول توقيع Clean Snapshot غير مكتملة.")
            }
            payload = [
                "gh-update-signature-v2", id, version, minimum, packageType, installMode,
                String(fileCount), String(unpackedBytes), filesIndex.lowercased(), operationsHash.lowercased()
            ].joined(separator: "\n")
        } else {
            throw UpdateError.message("إصدار حمولة توقيع التحديث غير مدعوم.")
        }
        do {
            let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData)
            guard publicKey.isValidSignature(signature, for: Data(payload.utf8)) else {
                throw UpdateError.message("توقيع حزمة التحديث غير صالح أو تم تعديل الحزمة.")
            }
        } catch let error as UpdateError { throw error }
        catch { throw UpdateError.message("تعذر التحقق من توقيع حزمة التحديث.") }
    }

    /// Returns a safe relative path after canonicalizing both URLs.
    /// iOS may expose the same sandbox through aliases such as /var and /private/var;
    /// raw String.hasPrefix checks therefore reject legitimate files. Resolving symlinks
    /// preserves containment security while accepting equivalent filesystem paths.
    private func safeRelativePath(of child: URL, inside folder: URL) -> String? {
        let base = folder.resolvingSymlinksInPath().standardizedFileURL.path
        let candidate = child.resolvingSymlinksInPath().standardizedFileURL.path
        let prefix = base.hasSuffix("/") ? base : base + "/"
        guard candidate.hasPrefix(prefix) else { return nil }
        let relative = String(candidate.dropFirst(prefix.count))
        return isSafePath(relative) ? relative : nil
    }

    private func isSafePath(_ path: String) -> Bool {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0") else { return false }
        return path.split(separator: "/").allSatisfy { $0 != "." && $0 != ".." && !$0.isEmpty }
    }

    private func isSHA256(_ value: String) -> Bool {
        value.count == 64 && value.unicodeScalars.allSatisfy {
            CharacterSet(charactersIn: "0123456789abcdefABCDEF").contains($0)
        }
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func integer(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? NSNumber { return value.intValue }
        if let value = value as? String { return Int(value) }
        return nil
    }

    private func compareVersion(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let left = lhs.split(whereSeparator: { !$0.isNumber }).map { Int($0) ?? 0 }
        let right = rhs.split(whereSeparator: { !$0.isNumber }).map { Int($0) ?? 0 }
        let count = max(left.count, right.count)
        for index in 0..<count {
            let a = index < left.count ? left[index] : 0
            let b = index < right.count ? right[index] : 0
            if a != b { return a < b ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }
}
