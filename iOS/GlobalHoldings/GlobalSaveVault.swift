import Foundation
import CoreFoundation
import CryptoKit

/// Crash-safe A/B native mirror for the WebApp save.
///
/// Build 242 invariants:
/// - The vault is the recovery authority; browser localStorage is a compatibility cache.
/// - Every envelope is verified after an atomic write.
/// - Runtime version is stored with each save generation so rollback can restore a
///   matching Runtime + Save pair instead of mixing an old runtime with new state.
/// - A specific historical generation can be promoted to a new current generation.
final class GlobalSaveVault {
    static let shared = GlobalSaveVault()

    private struct Envelope: Codable {
        let generation: Int
        let slot: String
        let schemaVersion: String
        let runtimeVersion: String?
        let simSeconds: Double
        let saveRevision: Int?
        let resetEpoch: Double?
        let savedAt: Double
        let sha256: String
        let payload: String
    }

    struct Snapshot {
        let generation: Int
        let runtimeVersion: String?
        let simSeconds: Double
        let saveRevision: Int
        let resetEpoch: Double
        let payload: String
    }

    private struct RollbackCheckpoint: Codable {
        let sourceGeneration: Int
        let runtimeVersion: String?
        let simSeconds: Double
        let saveRevision: Int
        let resetEpoch: Double
        let sha256: String
        let payload: String
    }

    struct ManualSlotMetadata: Codable {
        let index: Int
        let runtimeVersion: String?
        let simSeconds: Double
        let saveRevision: Int
        let resetEpoch: Double
        let savedAt: Double
        let label: String
    }

    private struct ManualSlotEnvelope: Codable {
        let format: String
        let schemaVersion: String
        let metadata: ManualSlotMetadata
        let sha256: String
        let payload: String
    }

    private let fm = FileManager.default
    private let queue = DispatchQueue(label: "com.globalholdings.save-vault", qos: .utility)
    private let schemaVersion = "2.0.0"
    private init() {
        // A crash before reset commit returns to the independently pinned old save.
        // Keep the journal on recovery failure so bootstrap and writes fail closed.
        do { try recoverPendingReset() } catch { print("Native reset recovery blocked: \(error.localizedDescription)") }
    }
    private struct ResetCheckpoint: Codable {
        let payload: String?
        let runtimeVersion: String?
        let sha256: String?
        let clearManualSlots: Bool?
        let manualSlotHashes: [String?]?
    }
    private var resetCheckpointURL: URL { folder.appendingPathComponent("pending-reset.json") }
    private func recoverPendingReset() throws {
        guard fm.fileExists(atPath: resetCheckpointURL.path) else {
            // Backups are unreachable user data once the reset journal is gone.
            discardManualSlotResetBackups()
            return
        }
        let checkpoint = try JSONDecoder().decode(ResetCheckpoint.self, from: Data(contentsOf: resetCheckpointURL))
        if let payload = checkpoint.payload {
            guard checkpoint.sha256 == sha256(Data(payload.utf8)) else { throw VaultError.message("Reset checkpoint hash mismatch.") }
            _ = try commitLocked(payload, runtimeVersion: checkpoint.runtimeVersion, allowRegression: true)
            _ = try commitLocked(payload, runtimeVersion: checkpoint.runtimeVersion, allowRegression: true)
        } else {
            for slot in ["A", "B"] { if fm.fileExists(atPath: url(slot).path) { try fm.removeItem(at: url(slot)) } }
        }
        if checkpoint.clearManualSlots == true {
            guard let hashes = checkpoint.manualSlotHashes, hashes.count == 3 else {
                throw VaultError.message("Manual slot reset checkpoint is incomplete.")
            }
            try restoreManualSlotsAfterResetFailure(expectedHashes: hashes)
        }
        try fm.removeItem(at: resetCheckpointURL)
        discardManualSlotResetBackups()
    }

    private var folder: URL {
        fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GlobalHoldingsSaveVault", isDirectory: true)
    }
    private func url(_ slot: String) -> URL { folder.appendingPathComponent("save-\(slot).json") }
    private func manualSlotURL(_ index: Int) -> URL { folder.appendingPathComponent("manual-slot-\(index + 1).json", isDirectory: false) }
    private func manualSlotBackupURL(_ index: Int) -> URL { folder.appendingPathComponent("pending-manual-slot-\(index + 1).json", isDirectory: false) }
    private var rollbackCheckpointURL: URL { folder.appendingPathComponent("rollback-checkpoint.json", isDirectory: false) }

    private func validatedManualSlotIndex(_ index: Int) throws -> Int {
        guard (0...2).contains(index) else { throw VaultError.message("Invalid manual save slot.") }
        return index
    }

    private func manualSlotRawHashes() throws -> [String?] {
        try (0...2).map { index in
            let file = manualSlotURL(index)
            guard fm.fileExists(atPath: file.path) else { return nil }
            return sha256(try Data(contentsOf: file))
        }
    }

    private func stageManualSlotsForReset(expectedHashes: [String?]) throws {
        guard expectedHashes.count == 3 else { throw VaultError.message("Invalid manual slot reset hash set.") }
        // Two-phase staging: copy + hash-verify every original before deleting any
        // source. A crash during copy leaves the original authoritative.
        for index in 0...2 {
            let source = manualSlotURL(index), backup = manualSlotBackupURL(index)
            if fm.fileExists(atPath: backup.path) { try fm.removeItem(at: backup) }
            guard let expected = expectedHashes[index] else {
                guard !fm.fileExists(atPath: source.path) else { throw VaultError.message("Manual slot set changed while reset was staged.") }
                continue
            }
            guard fm.fileExists(atPath: source.path),
                  sha256(try Data(contentsOf: source)) == expected else {
                throw VaultError.message("Manual slot source changed before reset staging.")
            }
            try fm.copyItem(at: source, to: backup)
            guard sha256(try Data(contentsOf: backup)) == expected else {
                throw VaultError.message("Manual slot reset backup verification failed.")
            }
        }
        for index in 0...2 {
            let source = manualSlotURL(index)
            if fm.fileExists(atPath: source.path) { try fm.removeItem(at: source) }
        }
    }

    private func restoreManualSlotsAfterResetFailure(expectedHashes: [String?]) throws {
        guard expectedHashes.count == 3 else { throw VaultError.message("Invalid manual slot recovery hash set.") }
        for index in 0...2 {
            let source = manualSlotURL(index), backup = manualSlotBackupURL(index)
            guard let expected = expectedHashes[index] else {
                if fm.fileExists(atPath: source.path) { try fm.removeItem(at: source) }
                if fm.fileExists(atPath: backup.path) { try fm.removeItem(at: backup) }
                continue
            }
            if fm.fileExists(atPath: backup.path),
               sha256(try Data(contentsOf: backup)) == expected {
                if fm.fileExists(atPath: source.path) { try fm.removeItem(at: source) }
                try fm.moveItem(at: backup, to: source)
                continue
            }
            if fm.fileExists(atPath: source.path),
               sha256(try Data(contentsOf: source)) == expected {
                if fm.fileExists(atPath: backup.path) { try fm.removeItem(at: backup) }
                continue
            }
            throw VaultError.message("Manual slot reset recovery could not verify the original slot.")
        }
    }

    private func discardManualSlotResetBackups() {
        for index in 0...2 { try? fm.removeItem(at: manualSlotBackupURL(index)) }
    }

    func commitAsync(_ json: String, runtimeVersion: String? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result { try self.commitLocked(json, runtimeVersion: runtimeVersion) }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    @discardableResult
    func commit(_ json: String, runtimeVersion: String? = nil) throws -> Int {
        try queue.sync { try commitLocked(json, runtimeVersion: runtimeVersion) }
    }

    private func commitLocked(_ json: String, runtimeVersion: String? = nil, allowRegression: Bool = false) throws -> Int {
        if !allowRegression && fm.fileExists(atPath: resetCheckpointURL.path) { throw VaultError.message("Reset recovery is pending.") }
        let validation = try validatePayload(json)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let current = bestEnvelope()
        if !allowRegression && current == nil && ["A", "B"].contains(where: { fm.fileExists(atPath: url($0).path) }) { throw VaultError.message("No valid native save remains; recovery required.") }
        if !allowRegression, let current {
            let epoch = current.resetEpoch ?? 0
            let currentRevision = current.saveRevision ?? 0
            let nativeRevision = validation.saveRevision
            let monotonicRevision = nativeRevision>currentRevision || nativeRevision == currentRevision
            if validation.resetEpoch < epoch || (validation.resetEpoch == epoch && !monotonicRevision) {
                throw VaultError.message("Stale native save rejected.")
            }
        }
        guard (current?.generation ?? 0) < 9_007_199_254_740_991 else { throw VaultError.message("Native save generation exhausted.") }
        let generation = (current?.generation ?? 0) + 1
        let slot = current?.slot == "A" ? "B" : "A"
        let envelope = Envelope(
            generation: generation,
            slot: slot,
            schemaVersion: schemaVersion,
            runtimeVersion: runtimeVersion,
            simSeconds: validation.simSeconds,
            saveRevision: validation.saveRevision,
            resetEpoch: validation.resetEpoch,
            savedAt: Date().timeIntervalSince1970,
            sha256: sha256(Data(json.utf8)),
            payload: json
        )
        let data = try JSONEncoder().encode(envelope)
        // Foundation's atomic option writes an auxiliary file first then replaces
        // the destination only after the write succeeds.
        try data.write(to: url(slot), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard let verified = readEnvelope(url(slot)),
              verified.generation == generation,
              verified.sha256 == envelope.sha256,
              verified.runtimeVersion == envelope.runtimeVersion,
              (verified.saveRevision ?? 0) == validation.saveRevision else {
            throw VaultError.message("Native save verification failed after write.")
        }
        return generation
    }

    func currentSave() -> String? { queue.sync { bestEnvelope()?.payload } }
    func currentGeneration() -> Int { queue.sync { bestEnvelope()?.generation ?? 0 } }
    func currentRuntimeVersion() -> String? { queue.sync { bestEnvelope()?.runtimeVersion } }

    func snapshot(generation: Int) -> Snapshot? { queue.sync { snapshotLocked(generation: generation) } }

    private func snapshotLocked(generation: Int) -> Snapshot? {
        guard generation > 0, let envelope = envelopes().first(where: { $0.generation == generation }) else { return nil }
        return Snapshot(generation: envelope.generation, runtimeVersion: envelope.runtimeVersion, simSeconds: envelope.simSeconds, saveRevision: envelope.saveRevision ?? 0, resetEpoch: envelope.resetEpoch ?? 0, payload: envelope.payload)
    }

    /// Promote a known-good historical generation by writing its verified payload
    /// as a fresh generation. This preserves A/B crash safety while making the
    /// rollback state the newest authoritative save.
    @discardableResult
    func restoreGeneration(_ generation: Int, runtimeVersion: String? = nil) throws -> Int {
        try queue.sync {
            guard let old = snapshotLocked(generation: generation) else {
                throw VaultError.message("Requested save generation \(generation) is not available for rollback.")
            }
            return try commitLocked(old.payload, runtimeVersion: runtimeVersion ?? old.runtimeVersion, allowRegression: true)
        }
    }

    /// Pins the pre-update save outside the rolling A/B pair. Ordinary autosaves
    /// during a pending update can rotate A/B without destroying rollback state.
    func pinRollbackCheckpoint(generation: Int, runtimeVersion: String? = nil) throws {
        try queue.sync {
            guard let old = snapshotLocked(generation: generation) else {
                throw VaultError.message("Cannot pin missing rollback generation \(generation).")
            }
            try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            let checkpoint = RollbackCheckpoint(sourceGeneration: old.generation, runtimeVersion: runtimeVersion ?? old.runtimeVersion, simSeconds: old.simSeconds, saveRevision: old.saveRevision, resetEpoch: old.resetEpoch, sha256: sha256(Data(old.payload.utf8)), payload: old.payload)
            let data = try JSONEncoder().encode(checkpoint)
            try data.write(to: rollbackCheckpointURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            guard let verified = readRollbackCheckpoint(), verified.sha256 == checkpoint.sha256, verified.sourceGeneration == generation else {
                throw VaultError.message("Rollback checkpoint verification failed.")
            }
        }
    }

    func hasRollbackCheckpoint(for runtimeVersion: String? = nil) -> Bool {
        queue.sync {
            guard let checkpoint = readRollbackCheckpoint() else { return false }
            guard let runtimeVersion else { return true }
            return checkpoint.runtimeVersion == runtimeVersion
        }
    }

    /// Returns a verified immutable copy of the pinned rollback save. This lets
    /// manual Runtime restore preserve the target payload in memory, then repin
    /// the *current* Runtime/Save pair before filesystem mutation.
    func rollbackCheckpointSnapshot(expectedRuntimeVersion: String? = nil) -> Snapshot? {
        queue.sync {
            guard let checkpoint = readRollbackCheckpoint() else { return nil }
            if let expectedRuntimeVersion, checkpoint.runtimeVersion != expectedRuntimeVersion { return nil }
            return Snapshot(
                generation: checkpoint.sourceGeneration,
                runtimeVersion: checkpoint.runtimeVersion,
                simSeconds: checkpoint.simSeconds,
                saveRevision: checkpoint.saveRevision,
                resetEpoch: checkpoint.resetEpoch,
                payload: checkpoint.payload
            )
        }
    }

    @discardableResult
    func restoreRollbackCheckpoint(expectedRuntimeVersion: String? = nil) throws -> Int {
        try queue.sync {
            guard let checkpoint = readRollbackCheckpoint() else { throw VaultError.message("Rollback checkpoint is unavailable.") }
            if let expectedRuntimeVersion, checkpoint.runtimeVersion != expectedRuntimeVersion {
                throw VaultError.message("Rollback checkpoint runtime mismatch.")
            }
            return try commitLocked(checkpoint.payload, runtimeVersion: checkpoint.runtimeVersion ?? expectedRuntimeVersion, allowRegression: true)
        }
    }

    private func readRollbackCheckpoint() -> RollbackCheckpoint? {
        guard let data = try? Data(contentsOf: rollbackCheckpointURL),
              let checkpoint = try? JSONDecoder().decode(RollbackCheckpoint.self, from: data),
              checkpoint.sourceGeneration > 0, checkpoint.simSeconds.isFinite, checkpoint.simSeconds >= 0, checkpoint.saveRevision >= 0,
              sha256(Data(checkpoint.payload.utf8)) == checkpoint.sha256,
              let validated = try? validatePayload(checkpoint.payload),
              validated.saveRevision == checkpoint.saveRevision else { return nil }
        return checkpoint
    }

    func manualSlotMetadata() -> [ManualSlotMetadata] {
        queue.sync { (0...2).compactMap { readManualSlot($0)?.metadata } }
    }

    func saveManualSlotAsync(_ index: Int, json: String, label: String, runtimeVersion: String? = nil, completion: ((Result<ManualSlotMetadata, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<ManualSlotMetadata, Error> {
                let index = try self.validatedManualSlotIndex(index)
                let validation = try self.validatePayload(json)
                try self.fm.createDirectory(at: self.folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                let metadata = ManualSlotMetadata(
                    index: index,
                    runtimeVersion: runtimeVersion,
                    simSeconds: validation.simSeconds,
                    saveRevision: validation.saveRevision,
                    resetEpoch: validation.resetEpoch,
                    savedAt: Date().timeIntervalSince1970,
                    label: String(label.prefix(120))
                )
                let envelope = ManualSlotEnvelope(
                    format: "global-holdings-native-slot-v1",
                    schemaVersion: self.schemaVersion,
                    metadata: metadata,
                    sha256: self.sha256(Data(json.utf8)),
                    payload: json
                )
                let data = try JSONEncoder().encode(envelope)
                try data.write(to: self.manualSlotURL(index), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard let verified = self.readManualSlot(index),
                      verified.sha256 == envelope.sha256,
                      verified.metadata.saveRevision == metadata.saveRevision,
                      verified.metadata.resetEpoch == metadata.resetEpoch else {
                    throw VaultError.message("Manual save slot verification failed.")
                }
                return verified.metadata
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    func loadManualSlotAsync(_ index: Int, runtimeVersion: String? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Int, Error> {
                let index = try self.validatedManualSlotIndex(index)
                guard let envelope = self.readManualSlot(index) else { throw VaultError.message("Manual save slot is unavailable.") }
                try self.recoverPendingReset()
                try self.fm.createDirectory(at: self.folder, withIntermediateDirectories: true)
                let current = self.bestEnvelope()
                let checkpoint = ResetCheckpoint(payload: current?.payload, runtimeVersion: current?.runtimeVersion, sha256: current?.sha256, clearManualSlots: false, manualSlotHashes: nil)
                let checkpointData = try JSONEncoder().encode(checkpoint)
                try checkpointData.write(to: self.resetCheckpointURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard try Data(contentsOf: self.resetCheckpointURL) == checkpointData else { throw VaultError.message("Manual slot load checkpoint verification failed.") }
                do {
                    _ = try self.commitLocked(envelope.payload, runtimeVersion: runtimeVersion ?? envelope.metadata.runtimeVersion, allowRegression: true)
                    let generation = try self.commitLocked(envelope.payload, runtimeVersion: runtimeVersion ?? envelope.metadata.runtimeVersion, allowRegression: true)
                    try self.fm.removeItem(at: self.resetCheckpointURL)
                    return generation
                } catch {
                    let failure = error
                    do { try self.recoverPendingReset() }
                    catch { throw VaultError.message("CRITICAL: manual slot load compensation failed: \(error.localizedDescription)") }
                    throw failure
                }
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    func clearManualSlotAsync(_ index: Int, completion: ((Result<Void, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Void, Error> {
                let index = try self.validatedManualSlotIndex(index)
                let file = self.manualSlotURL(index)
                if self.fm.fileExists(atPath: file.path) { try self.fm.removeItem(at: file) }
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    private func readManualSlot(_ index: Int) -> ManualSlotEnvelope? {
        guard (0...2).contains(index),
              let data = try? Data(contentsOf: manualSlotURL(index)),
              let envelope = try? JSONDecoder().decode(ManualSlotEnvelope.self, from: data),
              envelope.format == "global-holdings-native-slot-v1",
              envelope.schemaVersion == schemaVersion,
              envelope.metadata.index == index,
              envelope.metadata.simSeconds.isFinite, envelope.metadata.simSeconds >= 0,
              envelope.metadata.saveRevision >= 0,
              envelope.metadata.resetEpoch >= 0,
              sha256(Data(envelope.payload.utf8)) == envelope.sha256,
              let validated = try? validatePayload(envelope.payload),
              validated.simSeconds == envelope.metadata.simSeconds,
              validated.saveRevision == envelope.metadata.saveRevision,
              validated.resetEpoch == envelope.metadata.resetEpoch else { return nil }
        return envelope
    }

    func reset() {
        queue.sync { try? fm.removeItem(at: folder) }
    }

    /// Reset without a resurrection window: write the pristine reset save twice
    /// so both A/B slots become members of the new reset epoch. The previous
    /// game can never become authoritative merely because one clean slot is lost.
    func resetToAsync(_ json: String, runtimeVersion: String? = nil, clearManualSlots: Bool = false, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Int, Error> {
                _ = try self.validatePayload(json)
                try self.recoverPendingReset()
                try self.fm.createDirectory(at: self.folder, withIntermediateDirectories: true)
                let current = self.bestEnvelope()
                let manualSlotHashes = clearManualSlots ? try self.manualSlotRawHashes() : nil
                let checkpoint = ResetCheckpoint(payload: current?.payload, runtimeVersion: current?.runtimeVersion, sha256: current?.sha256, clearManualSlots: clearManualSlots, manualSlotHashes: manualSlotHashes)
                let data = try JSONEncoder().encode(checkpoint)
                try data.write(to: self.resetCheckpointURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard try Data(contentsOf: self.resetCheckpointURL) == data else { throw VaultError.message("Reset checkpoint verification failed.") }
                do {
                    if let manualSlotHashes { try self.stageManualSlotsForReset(expectedHashes: manualSlotHashes) }
                    _ = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true)
                    let generation = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true)
                    try self.fm.removeItem(at: self.resetCheckpointURL)
                    if clearManualSlots { self.discardManualSlotResetBackups() }
                    return generation
                } catch {
                    let failure = error
                    do { try self.recoverPendingReset() }
                    catch { throw VaultError.message("CRITICAL: reset compensation failed: \(error.localizedDescription)") }
                    throw failure
                }
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    /// Native commits are durable authority after restart; unacknowledged browser
    /// revisions cannot promote themselves merely by having a larger clock.
    func bootstrapJavaScript(force: Bool, pause: Bool = false) -> String {
        let nativeBuild = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
        let compatibility = "window.GH_NATIVE_BUILD=\(nativeBuild);"
        if fm.fileExists(atPath: resetCheckpointURL.path) { return compatibility + "window.GH_NATIVE_RECOVERY_BLOCKED=true;" }
        guard let envelope = queue.sync(execute: { bestEnvelope() }), let data = envelope.payload.data(using: .utf8) else { return compatibility + (["A", "B"].contains(where: { fm.fileExists(atPath: url($0).path) }) ? "window.GH_NATIVE_RECOVERY_BLOCKED=true;" : "") }
        let b64 = data.base64EncodedString()
        let forceValue = force ? "true" : "false"
        let pauseValue = pause ? "true" : "false"
        let nativeSim = String(format: "%.6f", envelope.simSeconds)
        let nativeRevision = envelope.saveRevision ?? 0
        let nativeReset = String(format: "%.0f", envelope.resetEpoch ?? 0)
        let nativeGeneration = envelope.generation
        let slotMetadata = manualSlotMetadata()
        let slotJSON = (try? JSONEncoder().encode(slotMetadata)) ?? Data("[]".utf8)
        let slotB64 = slotJSON.base64EncodedString()
        return compatibility + """
        (()=>{try{
          let raw=new TextDecoder().decode(Uint8Array.from(atob('\(b64)'),c=>c.charCodeAt(0)));
          if(\(pauseValue)){const parsed=JSON.parse(raw);parsed.speed=0;raw=JSON.stringify(parsed);}
          // Native Save Vault is the authoritative iOS store. Keep the complete
          // payload out of WebKit localStorage so large worlds are not constrained
          // by the browser quota. Migration Core consumes this value once at boot.
          window.__GH_NATIVE_SAVE_JSON__=raw;
          window.__GH_NATIVE_SAVE_META__=Object.freeze({source:'native-save-vault',generation:\(nativeGeneration),saveRevision:\(nativeRevision),resetEpoch:Number(\(nativeReset)),simSeconds:Number(\(nativeSim)),forced:\(forceValue),paused:\(pauseValue)});
          window.__GH_NATIVE_SLOT_META__=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(slotB64)'),c=>c.charCodeAt(0))));
          try{sessionStorage.setItem('gh-native-save-restored','1');}catch(_e){}
        }catch(e){window.GH_NATIVE_RECOVERY_BLOCKED=true;console.error('GH native save bootstrap failed',e);}})();
        """
    }

    private func envelopes() -> [Envelope] { ["A", "B"].compactMap { readEnvelope(url($0)) } }
    private func bestEnvelope() -> Envelope? { envelopes().max { $0.generation < $1.generation } }

    private func readEnvelope(_ file: URL) -> Envelope? {
        guard let data = try? Data(contentsOf: file),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.schemaVersion == schemaVersion,
              envelope.slot == "A" || envelope.slot == "B",
              envelope.generation > 0, envelope.generation <= 9_007_199_254_740_991,
              envelope.simSeconds.isFinite, envelope.simSeconds >= 0,
              sha256(Data(envelope.payload.utf8)) == envelope.sha256,
              let validated = try? validatePayload(envelope.payload),
              validated.simSeconds == envelope.simSeconds,
              validated.saveRevision == (envelope.saveRevision ?? 0),
              validated.resetEpoch == (envelope.resetEpoch ?? 0) else { return nil }
        return envelope
    }

    private func validatePayload(_ json: String) throws -> (simSeconds: Double, saveRevision: Int, resetEpoch: Double) {
        guard let data = json.data(using: .utf8), data.count <= 30 * 1024 * 1024,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw VaultError.message("Save payload is not valid JSON.")
        }
        guard (root["saveVersion"] as? String) == schemaVersion else {
            throw VaultError.message("Unsupported save schema.")
        }
        func validNumber(_ key: String, fallback: Double?, strings: Bool = false) -> Double? {
            guard let value = root[key] else { return fallback }
            if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { return n.doubleValue }
            if strings, let text = value as? String { return Double(text) }
            return nil
        }
        guard let sim = validNumber("simSeconds", fallback: nil, strings: true), sim.isFinite, sim >= 0 else { throw VaultError.message("Invalid simulation clock in save.") }
        guard let revisionValue = validNumber("saveRevision", fallback: 0), revisionValue.isFinite, revisionValue >= 0, revisionValue <= 9_007_199_254_740_991, revisionValue.rounded(.down) == revisionValue else { throw VaultError.message("Invalid save revision.") }
        let revision = Int(revisionValue)
        guard let reset = validNumber("resetEpoch", fallback: 0), reset.isFinite, reset >= 0, reset <= 9_007_199_254_740_991, reset.rounded(.down) == reset else { throw VaultError.message("Invalid reset epoch.") }
        return (sim, revision, reset)
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private enum VaultError: LocalizedError {
        case message(String)
        var errorDescription: String? { switch self { case .message(let value): value } }
    }
}
