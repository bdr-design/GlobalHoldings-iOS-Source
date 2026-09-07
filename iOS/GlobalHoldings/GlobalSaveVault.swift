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

    private let fm = FileManager.default
    private let queue = DispatchQueue(label: "com.globalholdings.save-vault", qos: .utility)
    private let schemaVersion = "2.0.0"
    private init() {
        // A crash before reset commit returns to the independently pinned old save.
        // Keep the journal on recovery failure so bootstrap and writes fail closed.
        do { try recoverPendingReset() } catch { print("Native reset recovery blocked: \(error.localizedDescription)") }
    }
    private struct ResetCheckpoint: Codable { let payload: String?; let runtimeVersion: String?; let sha256: String? }
    private var resetCheckpointURL: URL { folder.appendingPathComponent("pending-reset.json") }
    private func recoverPendingReset() throws {
        guard fm.fileExists(atPath: resetCheckpointURL.path) else { return }
        let checkpoint = try JSONDecoder().decode(ResetCheckpoint.self, from: Data(contentsOf: resetCheckpointURL))
        if let payload = checkpoint.payload {
            guard checkpoint.sha256 == sha256(Data(payload.utf8)) else { throw VaultError.message("Reset checkpoint hash mismatch.") }
            _ = try commitLocked(payload, runtimeVersion: checkpoint.runtimeVersion, allowRegression: true)
            _ = try commitLocked(payload, runtimeVersion: checkpoint.runtimeVersion, allowRegression: true)
        } else {
            for slot in ["A", "B"] { if fm.fileExists(atPath: url(slot).path) { try fm.removeItem(at: url(slot)) } }
        }
        try fm.removeItem(at: resetCheckpointURL)
    }

    private var folder: URL {
        fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GlobalHoldingsSaveVault", isDirectory: true)
    }
    private func url(_ slot: String) -> URL { folder.appendingPathComponent("save-\(slot).json") }
    private var rollbackCheckpointURL: URL { folder.appendingPathComponent("rollback-checkpoint.json", isDirectory: false) }

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
            let epoch = current.resetEpoch ?? 0, revision = current.saveRevision ?? 0
            if validation.resetEpoch < epoch || (validation.resetEpoch == epoch && validation.saveRevision < revision) {
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

    func reset() {
        queue.sync { try? fm.removeItem(at: folder) }
    }

    /// Reset without a resurrection window: write the pristine reset save twice
    /// so both A/B slots become members of the new reset epoch. The previous
    /// game can never become authoritative merely because one clean slot is lost.
    func resetToAsync(_ json: String, runtimeVersion: String? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Int, Error> {
                _ = try self.validatePayload(json)
                try self.recoverPendingReset()
                try self.fm.createDirectory(at: self.folder, withIntermediateDirectories: true)
                let current = self.bestEnvelope()
                let checkpoint = ResetCheckpoint(payload: current?.payload, runtimeVersion: current?.runtimeVersion, sha256: current?.sha256)
                let data = try JSONEncoder().encode(checkpoint)
                try data.write(to: self.resetCheckpointURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard try Data(contentsOf: self.resetCheckpointURL) == data else { throw VaultError.message("Reset checkpoint verification failed.") }
                do {
                    _ = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true)
                    let generation = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true)
                    try self.fm.removeItem(at: self.resetCheckpointURL)
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
        return compatibility + """
        (()=>{try{
          const raw=new TextDecoder().decode(Uint8Array.from(atob('\(b64)'),c=>c.charCodeAt(0)));
          const key='global-holdings-world-v2.0.0';
          const existing=localStorage.getItem(key);
          let shouldRestore=!existing;
          if(existing){
            try{
              const current=JSON.parse(existing), currentSim=Number(current?.simSeconds), currentRevision=Number(current?.saveRevision||0), currentReset=Number(current?.resetEpoch||0), nativeReset=Number(\(nativeReset)), nativeRevision=Number(\(nativeRevision));
              if(current?.saveVersion!=='2.0.0'){window.GH_NATIVE_RECOVERY_BLOCKED=true;return;}
              const nativeAhead=nativeReset>currentReset || (nativeReset===currentReset && (nativeRevision>currentRevision || (nativeRevision===currentRevision && (!Number.isFinite(currentSim)||Number(\(nativeSim))>currentSim))));
              shouldRestore=\(forceValue) || nativeAhead || existing!==raw;
            }catch(_e){ shouldRestore=true; }
          }
          if(shouldRestore){let value=raw;if(\(pauseValue)){const parsed=JSON.parse(raw);parsed.speed=0;value=JSON.stringify(parsed);}localStorage.setItem(key,value);if(localStorage.getItem(key)!==value)throw new Error('native-bootstrap-readback');sessionStorage.setItem('gh-native-save-restored','1');}
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
