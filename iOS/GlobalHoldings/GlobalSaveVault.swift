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

    /// Build 358 (iPhone diagnostic, 21 MB save: every commit took 3.4-5.3 s and each player command waited for it).
    /// A commit parsed the payload five times (bridge check, payload check, chunk manifest, then the A and B files read
    /// back to find the current slot), re-read both slot files before writing, decoded the new file again to verify it,
    /// and read every vault file as text to collect chunks. A payload is now parsed once; the current slot is known from
    /// the header of the envelope this process last verified (read in full, or written and compared byte for byte) as
    /// long as the file is the same one (inode, size and modification date); the write is verified by comparing the
    /// bytes on disk with the envelope encoded; chunk collection reads files as bytes and only when a chunk is not
    /// already known to be referenced. The on-disk format and every check are unchanged.
    private struct PayloadInfo {
        let simSeconds: Double
        let saveRevision: Int
        let resetEpoch: Double
        /// fleet.rows.chunks of a 'chunks-v1' manifest; [] without one; nil when the manifest is invalid.
        let chunkIds: [String]?
    }
    /// A payload checked once: its UTF-8 bytes, their SHA-256 and what its JSON root holds.
    private struct PreparedPayload {
        let data: Data
        let sha256: String
        let info: PayloadInfo
    }
    private struct FileIdentity: Equatable {
        let number: UInt64
        let size: UInt64
        let modified: Date
    }
    /// The header of a verified A/B envelope and the identity of the file it was verified in.
    private struct SlotHeader {
        let generation: Int
        let slot: String
        let saveRevision: Int
        let resetEpoch: Double
        let chunkIds: [String]
        let file: FileIdentity
    }
    private var slotHeaders: [String: SlotHeader] = [:]
    /// Chunk ids found in a vault file, by path, while the file stays the same one.
    private var chunkPresence: [String: (file: FileIdentity, ids: Set<String>)] = [:]
    private let timingLock = NSLock()
    private var commitTimings: [Int: [String: Double]] = [:]

    private let fm = FileManager.default
    private let queue = DispatchQueue(label: "com.globalholdings.save-vault", qos: .utility)
    private let schemaVersion = "2.0.0"
    // The vault's on-disk A/B envelope remains v2 while the game-state payload
    // migrates independently. Save Schema 3 still uses the existing JSON path
    // until the chunked binary store lands.
    private let supportedSaveSchemaVersions: Set<String> = ["2.0.0", "3.0.0"]
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
            let prepared = try preparePayload(payload)
            guard checkpoint.sha256 == prepared.sha256 else { throw VaultError.message("Reset checkpoint hash mismatch.") }
            _ = try commitLocked(payload, runtimeVersion: checkpoint.runtimeVersion, allowRegression: true, prepared: prepared)
            _ = try commitLocked(payload, runtimeVersion: checkpoint.runtimeVersion, allowRegression: true, prepared: prepared)
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

    func commitAsync(_ json: String, runtimeVersion: String? = nil, envelope: [String: Any]? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Int, Error> {
                let prepared = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "commitSave") }
                return try self.commitLocked(json, runtimeVersion: runtimeVersion, prepared: prepared)
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    @discardableResult
    func commit(_ json: String, runtimeVersion: String? = nil) throws -> Int {
        try queue.sync { try commitLocked(json, runtimeVersion: runtimeVersion) }
    }

    private func commitLocked(_ json: String, runtimeVersion: String? = nil, allowRegression: Bool = false, prepared: PreparedPayload? = nil) throws -> Int {
        var stages: [String: Double] = [:]
        var mark = DispatchTime.now().uptimeNanoseconds
        func lap(_ name: String) {
            let now = DispatchTime.now().uptimeNanoseconds
            stages[name] = (stages[name] ?? 0) + Double(now - mark) / 1e6
            mark = now
        }
        if !allowRegression && fm.fileExists(atPath: resetCheckpointURL.path) { throw VaultError.message("Reset recovery is pending.") }
        let payload = try prepared ?? preparePayload(json)
        let validation = payload.info
        lap("parseMs")
        let chunkIds = try requireChunksLocked(validation.chunkIds)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let current = currentSlotHeaderLocked()
        lap("currentSlotMs")
        if !allowRegression && current == nil && ["A", "B"].contains(where: { fm.fileExists(atPath: url($0).path) }) { throw VaultError.message("No valid native save remains; recovery required.") }
        if !allowRegression, let current {
            let epoch = current.resetEpoch
            let currentRevision = current.saveRevision
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
            sha256: payload.sha256,
            payload: json
        )
        let data = try JSONEncoder().encode(envelope)
        lap("encodeMs")
        // Foundation's atomic option writes an auxiliary file first then replaces
        // the destination only after the write succeeds.
        slotHeaders[slot] = nil
        try data.write(to: url(slot), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        lap("writeMs")
        // The file must hold exactly the envelope encoded above from the checked payload: comparing the bytes read back
        // proves what decoding them again did (generation, hash, runtime version and revision come from these bytes).
        guard let written = try? Data(contentsOf: url(slot)), written == data, let file = fileIdentity(url(slot)) else {
            throw VaultError.message("Native save verification failed after write.")
        }
        slotHeaders[slot] = SlotHeader(generation: generation, slot: slot, saveRevision: validation.saveRevision, resetEpoch: validation.resetEpoch, chunkIds: chunkIds, file: file)
        lap("verifyMs")
        collectChunkGarbageLocked()
        lap("chunkGcMs")
        stages["payloadBytes"] = Double(payload.data.count)
        stages["envelopeBytes"] = Double(data.count)
        timingLock.lock()
        commitTimings[generation] = stages
        // Bounded: the oldest other entry goes (generations restart at 1 after reset(), which also clears these).
        if commitTimings.count > 8, let oldest = commitTimings.keys.filter({ $0 != generation }).min() { commitTimings.removeValue(forKey: oldest) }
        timingLock.unlock()
        return generation
    }

    /// Stage timings of the commit that produced `generation` (milliseconds, and the payload and envelope sizes), once.
    func takeCommitTimings(generation: Int) -> [String: Double]? {
        timingLock.lock()
        defer { timingLock.unlock() }
        return commitTimings.removeValue(forKey: generation)
    }

    /// The newest verified A/B header. A slot file this process verified (read in full or written and compared) and that
    /// is still the same file is not read again; any other file is read and verified in full, as bestEnvelope() does.
    private func currentSlotHeaderLocked() -> SlotHeader? {
        var best: SlotHeader?
        for slot in ["A", "B"] {
            guard let header = slotHeaderLocked(slot) else { continue }
            if let current = best, header.generation <= current.generation { continue }
            best = header
        }
        return best
    }

    private func slotHeaderLocked(_ slot: String) -> SlotHeader? {
        let file = url(slot)
        guard let identity = fileIdentity(file) else { slotHeaders[slot] = nil; return nil }
        if let cached = slotHeaders[slot], cached.file == identity { return cached }
        slotHeaders[slot] = nil
        guard let read = readVerifiedEnvelope(file) else { return nil }
        let header = SlotHeader(generation: read.envelope.generation, slot: read.envelope.slot, saveRevision: read.envelope.saveRevision ?? 0, resetEpoch: read.envelope.resetEpoch ?? 0, chunkIds: read.info.chunkIds ?? [], file: identity)
        slotHeaders[slot] = header
        return header
    }

    private func fileIdentity(_ file: URL) -> FileIdentity? {
        guard let attributes = try? fm.attributesOfItem(atPath: file.path),
              let size = (attributes[.size] as? NSNumber)?.uint64Value,
              let modified = attributes[.modificationDate] as? Date else { return nil }
        return FileIdentity(number: (attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0, size: size, modified: modified)
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

    func saveManualSlotAsync(_ index: Int, json: String, label: String, runtimeVersion: String? = nil, envelope: [String: Any]? = nil, completion: ((Result<ManualSlotMetadata, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<ManualSlotMetadata, Error> {
                let bridged = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "saveManualSlot") }
                let index = try self.validatedManualSlotIndex(index)
                let payload = try bridged ?? self.preparePayload(json)
                let validation = payload.info
                _ = try self.requireChunksLocked(validation.chunkIds)
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
                let stored = ManualSlotEnvelope(
                    format: "global-holdings-native-slot-v1",
                    schemaVersion: self.schemaVersion,
                    metadata: metadata,
                    sha256: payload.sha256,
                    payload: json
                )
                let data = try JSONEncoder().encode(stored)
                try data.write(to: self.manualSlotURL(index), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                // As for A/B commits: the slot holds exactly the envelope encoded from the checked payload.
                guard let written = try? Data(contentsOf: self.manualSlotURL(index)), written == data else {
                    throw VaultError.message("Manual save slot verification failed.")
                }
                return metadata
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
                    let prepared = try self.preparePayload(envelope.payload)
                    _ = try self.commitLocked(envelope.payload, runtimeVersion: runtimeVersion ?? envelope.metadata.runtimeVersion, allowRegression: true, prepared: prepared)
                    let generation = try self.commitLocked(envelope.payload, runtimeVersion: runtimeVersion ?? envelope.metadata.runtimeVersion, allowRegression: true, prepared: prepared)
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
        queue.sync {
            try? fm.removeItem(at: folder)
            slotHeaders = [:]
            chunkPresence = [:]
            timingLock.lock()
            commitTimings = [:]
            timingLock.unlock()
        }
    }

    /// Reset without a resurrection window: write the pristine reset save twice
    /// so both A/B slots become members of the new reset epoch. The previous
    /// game can never become authoritative merely because one clean slot is lost.
    func resetToAsync(_ json: String, runtimeVersion: String? = nil, clearManualSlots: Bool = false, envelope: [String: Any]? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Int, Error> {
                let prepared = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "resetGameSave") } ?? self.preparePayload(json)
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
                    _ = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true, prepared: prepared)
                    let generation = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true, prepared: prepared)
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
    // All bootstrap material belongs to the same serial owner as commits and
    // resets. No A/B reads, validation or base64 work is performed on the UI
    // callback; navigation waits for the exact queued recovery snapshot.
    func bootstrapJavaScriptAsync(force: Bool, pause: Bool = false, completion: @escaping (String) -> Void) {
        queue.async {
            let script = self.bootstrapJavaScriptLocked(force: force, pause: pause)
            DispatchQueue.main.async { completion(script) }
        }
    }

    func bootstrapJavaScript(force: Bool, pause: Bool = false) -> String {
        queue.sync { bootstrapJavaScriptLocked(force: force, pause: pause) }
    }

    private func bootstrapJavaScriptLocked(force: Bool, pause: Bool) -> String {
        dispatchPrecondition(condition: .onQueue(queue))
        let nativeBuild = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0") ?? 0
        let compatibility = "window.GH_NATIVE_BUILD=\(nativeBuild);"
        if fm.fileExists(atPath: resetCheckpointURL.path) { return compatibility + "window.GH_NATIVE_RECOVERY_BLOCKED=true;" }
        guard let envelope = bestEnvelope(), let data = envelope.payload.data(using: .utf8) else { return compatibility + (["A", "B"].contains(where: { fm.fileExists(atPath: url($0).path) }) ? "window.GH_NATIVE_RECOVERY_BLOCKED=true;" : "") }
        let b64 = data.base64EncodedString()
        let forceValue = force ? "true" : "false"
        let pauseValue = pause ? "true" : "false"
        let nativeSim = String(format: "%.6f", envelope.simSeconds)
        let nativeRevision = envelope.saveRevision ?? 0
        let nativeReset = String(format: "%.0f", envelope.resetEpoch ?? 0)
        let nativeGeneration = envelope.generation
        let slotMetadata = (0...2).compactMap { readManualSlot($0)?.metadata }
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
          // Build 358 (million-asset save): fleet records kept in vault chunks are fetched before app.js runs.
          // app.js defers itself to __GH_BOOT_GATE__ until every chunk has arrived (or one failed: the load then
          // reports a corrupt save and the recovery path takes over).
          try{if(raw.includes('"$ghBinary":"chunks-v1"')){const rows=JSON.parse(raw)?.fleet?.rows;if(rows&&rows.$ghBinary==='chunks-v1'&&Array.isArray(rows.chunks)){
            const chunks=new Map(),gate={ready:false,failed:null,deferred:null,defer(script){this.deferred=(script&&script.src)||'app.js';}};
            window.__GH_NATIVE_SAVE_CHUNKS__=chunks;window.__GH_BOOT_GATE__=gate;
            Promise.all(rows.chunks.map(id=>fetch('gh://app/save-chunk/'+encodeURIComponent(id),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('save-chunk-'+r.status);return r.arrayBuffer();}).then(buffer=>{chunks.set(id,buffer);})))
              .catch(error=>{gate.failed=String(error&&error.message||error);console.error('GH native save chunks failed',error);})
              .finally(()=>{gate.ready=true;if(gate.deferred){const s=document.createElement('script');s.src=gate.deferred;(document.body||document.documentElement).appendChild(s);}});
          }}}catch(e){console.error('GH native save chunk manifest failed',e);}
          window.__GH_NATIVE_SAVE_META__=Object.freeze({source:'native-save-vault',generation:\(nativeGeneration),saveRevision:\(nativeRevision),resetEpoch:Number(\(nativeReset)),simSeconds:Number(\(nativeSim)),forced:\(forceValue),paused:\(pauseValue)});
          window.__GH_NATIVE_SLOT_META__=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(slotB64)'),c=>c.charCodeAt(0))));
          try{sessionStorage.setItem('gh-native-save-restored','1');}catch(_e){}
        }catch(e){window.GH_NATIVE_RECOVERY_BLOCKED=true;console.error('GH native save bootstrap failed',e);}})();
        """
    }

    private func envelopes() -> [Envelope] {
        ["A", "B"].compactMap { slot -> Envelope? in
            let file = url(slot)
            guard let identity = fileIdentity(file), let read = readVerifiedEnvelope(file) else { slotHeaders[slot] = nil; return nil }
            slotHeaders[slot] = SlotHeader(generation: read.envelope.generation, slot: read.envelope.slot, saveRevision: read.envelope.saveRevision ?? 0, resetEpoch: read.envelope.resetEpoch ?? 0, chunkIds: read.info.chunkIds ?? [], file: identity)
            return read.envelope
        }
    }
    private func bestEnvelope() -> Envelope? { envelopes().max { $0.generation < $1.generation } }

    private func readVerifiedEnvelope(_ file: URL) -> (envelope: Envelope, info: PayloadInfo)? {
        guard let data = try? Data(contentsOf: file),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.schemaVersion == schemaVersion,
              envelope.slot == "A" || envelope.slot == "B",
              envelope.generation > 0, envelope.generation <= 9_007_199_254_740_991,
              envelope.simSeconds.isFinite, envelope.simSeconds >= 0,
              let parsed = try? parsedPayload(envelope.payload),
              sha256(parsed.data) == envelope.sha256,
              parsed.info.simSeconds == envelope.simSeconds,
              parsed.info.saveRevision == (envelope.saveRevision ?? 0),
              parsed.info.resetEpoch == (envelope.resetEpoch ?? 0) else { return nil }
        return (envelope, parsed.info)
    }

    /// Browser envelopes are authenticated inside the same FIFO queue as the write.
    /// Large JSON/SHA work must not execute in WKScriptMessageHandler on the UI thread.
    /// The payload is parsed and hashed here once; the commit uses what this returns.
    @discardableResult
    private func validateBridgeEnvelope(_ payload: [String: Any], json: String, action: String) throws -> PreparedPayload {
        dispatchPrecondition(condition: .onQueue(queue))
        func integer(_ value: Any?) -> Double? {
            guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            let v = n.doubleValue
            return v.isFinite && v >= 0 && v <= 9_007_199_254_740_991 && v.rounded(.down) == v ? v : nil
        }
        guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
              payload["action"] as? String == action,
              let saveSchemaVersion = payload["saveSchemaVersion"] as? String, supportedSaveSchemaVersions.contains(saveSchemaVersion),
              payload["saveJSON"] as? String == json,
              let hash = payload["saveHash"] as? String, hash.utf8.count == 64,
              hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let data = json.data(using: .utf8), data.count <= 30 * 1024 * 1024,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["saveVersion"] as? String == saveSchemaVersion,
              let revision = integer(payload["saveRevision"]),
              let rootRevision = integer(root["saveRevision"]), revision == rootRevision,
              let epoch = integer(payload["resetEpoch"]),
              let rootEpoch = integer(root["resetEpoch"] ?? NSNumber(value: 0)), epoch == rootEpoch else { throw VaultError.message("Invalid save envelope.") }
        let digest = sha256(data)
        guard digest == hash else { throw VaultError.message("Invalid save envelope.") }
        return PreparedPayload(data: data, sha256: digest, info: try payloadInfo(root))
    }

    /// One parse of a payload: its UTF-8 bytes and what its root holds.
    private func parsedPayload(_ json: String) throws -> (data: Data, info: PayloadInfo) {
        guard let data = json.data(using: .utf8), data.count <= 30 * 1024 * 1024,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw VaultError.message("Save payload is not valid JSON.")
        }
        return (data, try payloadInfo(root))
    }

    private func preparePayload(_ json: String) throws -> PreparedPayload {
        let parsed = try parsedPayload(json)
        return PreparedPayload(data: parsed.data, sha256: sha256(parsed.data), info: parsed.info)
    }

    private func validatePayload(_ json: String) throws -> (simSeconds: Double, saveRevision: Int, resetEpoch: Double) {
        let info = try parsedPayload(json).info
        return (info.simSeconds, info.saveRevision, info.resetEpoch)
    }

    private func payloadInfo(_ root: [String: Any]) throws -> PayloadInfo {
        guard let saveSchemaVersion = root["saveVersion"] as? String, supportedSaveSchemaVersions.contains(saveSchemaVersion) else {
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
        return PayloadInfo(simSeconds: sim, saveRevision: revision, resetEpoch: reset, chunkIds: chunkManifest(root))
    }

    // MARK: - Build 358 chunked fleet records (million-asset saves)
    //
    // A Save Schema 3 payload may hold the fleet record buffer as a 'chunks-v1' manifest (fleet.rows.chunks: ids of
    // 4 MiB chunks) instead of base64 inside the JSON. Chunks are stored once per id in `chunks/<id>.chunk`:
    //   "GHCHUNK1" | SHA-256 of the raw bytes (32) | raw length (UInt64 LE) | LZFSE-compressed bytes
    // Every read decompresses and checks length and SHA-256. A payload is committed only when every chunk it lists is
    // on disk. After each commit, chunks no vault file mentions (A/B, manual slots and their reset backups, rollback and
    // reset checkpoints) and that were not uploaded in the last 10 minutes are deleted; a chunk is kept if its id
    // appears anywhere in those files, so a referenced chunk is never collected.
    private var chunkFolder: URL { folder.appendingPathComponent("chunks", isDirectory: true) }
    private var recentChunkUploads: [String: Date] = [:]
    private static let chunkMagic = Data("GHCHUNK1".utf8)
    private static let chunkGracePeriod: TimeInterval = 600

    func isValidChunkId(_ id: String) -> Bool {
        guard !id.isEmpty, id.utf8.count <= 160, id != ".", id != ".." else { return false }
        return id.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 46 || $0 == 95 || $0 == 45 }
    }
    private func chunkURL(_ id: String) -> URL { chunkFolder.appendingPathComponent(id + ".chunk", isDirectory: false) }

    func storeChunkAsync(id: String, data: Data, completion: ((Result<String, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<String, Error> { try self.storeChunkLocked(id: id, data: data) }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    @discardableResult
    func storeChunk(id: String, data: Data) throws -> String { try queue.sync { try storeChunkLocked(id: id, data: data) } }

    private func storeChunkLocked(id: String, data: Data) throws -> String {
        guard isValidChunkId(id) else { throw VaultError.message("Invalid save chunk id.") }
        guard !data.isEmpty, data.count <= 64 * 1024 * 1024 else { throw VaultError.message("Invalid save chunk size.") }
        let digest = sha256(data)
        if fm.fileExists(atPath: chunkURL(id).path) {
            guard let existing = try? readChunkLocked(id: id), existing == data else { throw VaultError.message("Save chunk id reused with other bytes.") }
            recentChunkUploads[id] = Date()
            return digest
        }
        try fm.createDirectory(at: chunkFolder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let compressed = try (data as NSData).compressed(using: .lzfse) as Data
        var file = Data(GlobalSaveVault.chunkMagic)
        file.append(contentsOf: SHA256.hash(data: data))
        var length = UInt64(data.count).littleEndian
        withUnsafeBytes(of: &length) { file.append(contentsOf: $0) }
        file.append(compressed)
        try file.write(to: chunkURL(id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard let verified = try? readChunkLocked(id: id), verified == data else {
            try? fm.removeItem(at: chunkURL(id))
            throw VaultError.message("Save chunk verification failed after write.")
        }
        recentChunkUploads[id] = Date()
        return digest
    }

    func chunkData(id: String) throws -> Data { try queue.sync { try readChunkLocked(id: id) } }
    func chunkDataAsync(id: String, completion: @escaping (Result<Data, Error>) -> Void) {
        queue.async {
            let result = Result<Data, Error> { try self.readChunkLocked(id: id) }
            DispatchQueue.main.async { completion(result) }
        }
    }

    private func readChunkLocked(id: String) throws -> Data {
        guard isValidChunkId(id) else { throw VaultError.message("Invalid save chunk id.") }
        let file = try Data(contentsOf: chunkURL(id))
        guard file.count >= 48, file.prefix(8) == GlobalSaveVault.chunkMagic else { throw VaultError.message("Save chunk is corrupt.") }
        let digest = file.subdata(in: 8..<40)
        var length: UInt64 = 0
        _ = withUnsafeMutableBytes(of: &length) { file.subdata(in: 40..<48).copyBytes(to: $0) }
        length = UInt64(littleEndian: length)
        let raw = try (file.subdata(in: 48..<file.count) as NSData).decompressed(using: .lzfse) as Data
        guard UInt64(raw.count) == length, Data(SHA256.hash(data: raw)) == digest else { throw VaultError.message("Save chunk is corrupt.") }
        return raw
    }

    /// Chunk ids a payload lists (fleet.rows.chunks of a 'chunks-v1' manifest); [] for a payload without one.
    func referencedChunks(_ json: String) throws -> [String] {
        guard let data = json.data(using: .utf8), let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw VaultError.message("Save payload is not valid JSON.")
        }
        guard let ids = chunkManifest(root) else { throw VaultError.message("Invalid save chunk manifest.") }
        return ids
    }

    /// fleet.rows.chunks of a 'chunks-v1' manifest; [] for a root without one; nil for an invalid manifest.
    private func chunkManifest(_ root: [String: Any]) -> [String]? {
        guard let fleet = root["fleet"] as? [String: Any], let rows = fleet["rows"] as? [String: Any],
              rows["$ghBinary"] as? String == "chunks-v1" else { return [] }
        guard let ids = rows["chunks"] as? [String], ids.allSatisfy({ isValidChunkId($0) }) else { return nil }
        return ids
    }

    /// The manifest's chunk ids once every one is on disk.
    private func requireChunksLocked(_ manifest: [String]?) throws -> [String] {
        guard let ids = manifest else { throw VaultError.message("Invalid save chunk manifest.") }
        for id in ids where !fm.fileExists(atPath: chunkURL(id).path) {
            throw VaultError.message("Missing save chunk: \(id)")
        }
        return ids
    }

    /// Deletes chunks no vault file mentions and that were not uploaded in the grace period. A chunk is kept when its id
    /// appears anywhere in a vault file, as before. Ids listed by the current A/B headers, or found earlier in a file that
    /// is still the same file, are known to be referenced without reading anything; other files are read as bytes (not
    /// decoded as text) and only while some chunk is still unaccounted for.
    private func collectChunkGarbageLocked() {
        guard let names = try? fm.contentsOfDirectory(atPath: chunkFolder.path) else { return }
        let cutoff = Date().addingTimeInterval(-GlobalSaveVault.chunkGracePeriod)
        recentChunkUploads = recentChunkUploads.filter { $0.value > cutoff }
        var candidates = Set(names.filter { $0.hasSuffix(".chunk") }.map { String($0.dropLast(6)) })
        candidates.subtract(recentChunkUploads.keys)
        for slot in ["A", "B"] {
            if let header = slotHeaders[slot], fileIdentity(url(slot)) == header.file { candidates.subtract(header.chunkIds) }
        }
        guard !candidates.isEmpty else { return }
        let vaultFiles = ((try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "json" }
        var identities: [String: FileIdentity] = [:]
        for file in vaultFiles { if let identity = fileIdentity(file) { identities[file.path] = identity } }
        chunkPresence = chunkPresence.filter { identities[$0.key] == $0.value.file }
        for entry in chunkPresence.values { candidates.subtract(entry.ids) }
        for file in vaultFiles where !candidates.isEmpty {
            guard let identity = identities[file.path], let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { continue }
            let found = candidates.filter { data.range(of: Data($0.utf8)) != nil }
            guard !found.isEmpty else { continue }
            chunkPresence[file.path] = (file: identity, ids: (chunkPresence[file.path]?.ids ?? []).union(found))
            candidates.subtract(found)
        }
        for id in candidates { try? fm.removeItem(at: chunkFolder.appendingPathComponent(id + ".chunk")) }
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private enum VaultError: LocalizedError {
        case message(String)
        var errorDescription: String? { switch self { case .message(let value): value } }
    }
}
