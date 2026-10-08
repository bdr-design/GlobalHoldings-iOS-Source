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

    /// The envelope without its payload: encoded by JSONEncoder, then the payload is appended as an escaped JSON string
    /// (encodeEnvelope). Decoding the result with JSONDecoder gives exactly the Envelope.
    private struct EnvelopeHeader: Encodable {
        let generation: Int
        let slot: String
        let schemaVersion: String
        let runtimeVersion: String?
        let simSeconds: Double
        let saveRevision: Int?
        let resetEpoch: Double?
        let savedAt: Double
        let sha256: String
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
        /// fleet.rows.chunks of a 'chunks-v1' manifest and stateCodec.chunks (text chunks of sealed collections);
        /// [] without them; nil when either list is invalid.
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

    /// Chunk cleanup never runs in the save commit path. The commit queue only captures a small immutable snapshot and
    /// removes a bounded number of files after the background scanner proves that no durable vault file references
    /// them. Every delete batch rechecks the identity of every protecting file, so a save/manual-slot/reset written
    /// while a scan is running invalidates the plan instead of risking collection of a newly referenced chunk.
    private struct ChunkReferences {
        let file: FileIdentity
        let ids: Set<String>
    }
    private struct ChunkGarbageSnapshot {
        let generation: Int
        let startedAt: UInt64
        let recent: Set<String>
        let headers: [String: ChunkReferences]
        let presence: [String: ChunkReferences]
    }
    private struct ChunkGarbagePlan {
        let generation: Int
        let startedAt: UInt64
        let candidates: Set<String>
        let vaultFiles: [String: FileIdentity]
        let filesToScan: [URL]
    }
    private struct ChunkGarbageReport {
        let generation: Int
        let durationMs: Double
        let scannedBytes: Int
        let candidates: Int
        let protected: Int
        let deleted: Int
        let aborted: Bool
    }
    private let garbageQueue = DispatchQueue(label: "com.globalholdings.save-vault-gc", qos: .background)
    private var chunkGarbageScheduled = false
    private var chunkGarbageWaiters: [() -> Void] = []
    private var lastChunkGarbageReport: ChunkGarbageReport?
    private static let chunkGarbageDeleteBatch = 8

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
        let enqueuedAt = DispatchTime.now().uptimeNanoseconds
        queue.async {
            let result = Result<Int, Error> {
                let startedAt = DispatchTime.now().uptimeNanoseconds
                let prepared = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "commitSave") }
                let checkedAt = DispatchTime.now().uptimeNanoseconds
                return try self.commitLocked(json, runtimeVersion: runtimeVersion, prepared: prepared, extraStages: ["queueWaitMs": Double(startedAt - enqueuedAt) / 1e6, "bridgeMs": Double(checkedAt - startedAt) / 1e6])
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    @discardableResult
    func commit(_ json: String, runtimeVersion: String? = nil) throws -> Int {
        try queue.sync { try commitLocked(json, runtimeVersion: runtimeVersion) }
    }

    private func commitLocked(_ json: String, runtimeVersion: String? = nil, allowRegression: Bool = false, prepared: PreparedPayload? = nil, extraStages: [String: Double] = [:]) throws -> Int {
        var stages: [String: Double] = extraStages
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
        let header = EnvelopeHeader(
            generation: generation,
            slot: slot,
            schemaVersion: schemaVersion,
            runtimeVersion: runtimeVersion,
            simSeconds: validation.simSeconds,
            saveRevision: validation.saveRevision,
            resetEpoch: validation.resetEpoch,
            savedAt: Date().timeIntervalSince1970,
            sha256: payload.sha256
        )
        let data = try encodeEnvelope(header, payload: payload.data)
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
        scheduleChunkGarbageLocked(generation: generation)
        lap("chunkGcScheduleMs")
        // Kept for diagnostics compatibility: foreground GC is deliberately zero. The completed background pass is
        // attached to a later commit through the backgroundChunkGc* fields below.
        stages["chunkGcMs"] = 0
        stages["chunkGcDeferred"] = 1
        if let report = lastChunkGarbageReport {
            stages["backgroundChunkGcGeneration"] = Double(report.generation)
            stages["backgroundChunkGcMs"] = report.durationMs
            stages["backgroundChunkGcScannedBytes"] = Double(report.scannedBytes)
            stages["backgroundChunkGcCandidates"] = Double(report.candidates)
            stages["backgroundChunkGcProtected"] = Double(report.protected)
            stages["backgroundChunkGcDeleted"] = Double(report.deleted)
            stages["backgroundChunkGcAborted"] = report.aborted ? 1 : 0
        }
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
          // Build 358 (million-asset save): fleet records kept in vault chunks are fetched before app.js runs, and so
          // are the text chunks of sealed collections (stateCodec.chunks). app.js defers itself to __GH_BOOT_GATE__
          // until every chunk has arrived (or one failed: the load then reports a corrupt save and the recovery path
          // takes over).
          try{if(raw.includes('"$ghBinary":"chunks-v1"')||raw.includes('"$ghText":"chunk-v1"')||raw.includes('"$ghCold":"chunk-v1"')){const parsed=JSON.parse(raw),rows=parsed?.fleet?.rows,ids=[...(rows&&rows.$ghBinary==='chunks-v1'&&Array.isArray(rows.chunks)?rows.chunks:[]),...(Array.isArray(parsed?.stateCodec?.chunks)?parsed.stateCodec.chunks:[])];if(ids.length){
            const chunks=new Map(),gate={ready:false,failed:null,deferred:null,defer(script){this.deferred=(script&&script.src)||'app.js';}};
            window.__GH_NATIVE_SAVE_CHUNKS__=chunks;window.__GH_BOOT_GATE__=gate;
            Promise.all(ids.map(id=>fetch('gh://app/save-chunk/'+encodeURIComponent(id),{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('save-chunk-'+r.status);return r.arrayBuffer();}).then(buffer=>{chunks.set(id,buffer);})))
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
              // Build 358 (iPhone diagnostic: 1.5 s of this check per commit of a 21 MB save): the envelope must carry
              // exactly this text. String == tests canonical equivalence (Unicode normalization), which is costly for
              // Arabic text; the vault needs the same characters, compared literally.
              let envelopeJSON = payload["saveJSON"] as? NSString, envelopeJSON.isEqual(to: json),
              let hash = payload["saveHash"] as? String, hash.utf8.count == 64,
              hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              let data = json.data(using: .utf8), data.count <= 30 * 1024 * 1024 else { throw VaultError.message("Invalid save envelope.") }
        let root = try SaveJSONHeader.inspect(data)
        func rootInteger(_ value: SaveJSONHeader.Value, absent: Double?) -> Double? {
            switch value {
            case .absent: return absent
            case .number(let v): return v.isFinite && v >= 0 && v <= 9_007_199_254_740_991 && v.rounded(.down) == v ? v : nil
            default: return nil
            }
        }
        guard case .string(let rootVersion) = root.saveVersion, rootVersion == saveSchemaVersion,
              let revision = integer(payload["saveRevision"]),
              let rootRevision = rootInteger(root.saveRevision, absent: nil), revision == rootRevision,
              let epoch = integer(payload["resetEpoch"]),
              let rootEpoch = rootInteger(root.resetEpoch, absent: 0), epoch == rootEpoch else { throw VaultError.message("Invalid save envelope.") }
        let digest = sha256(data)
        guard digest == hash else { throw VaultError.message("Invalid save envelope.") }
        return PreparedPayload(data: data, sha256: digest, info: try payloadInfo(root))
    }

    /// One scan of a payload: its UTF-8 bytes and what its root holds.
    private func parsedPayload(_ json: String) throws -> (data: Data, info: PayloadInfo) {
        guard let data = json.data(using: .utf8), data.count <= 30 * 1024 * 1024 else {
            throw VaultError.message("Save payload is not valid JSON.")
        }
        return (data, try payloadInfo(SaveJSONHeader.inspect(data)))
    }

    private func preparePayload(_ json: String) throws -> PreparedPayload {
        let parsed = try parsedPayload(json)
        return PreparedPayload(data: parsed.data, sha256: sha256(parsed.data), info: parsed.info)
    }

    private func validatePayload(_ json: String) throws -> (simSeconds: Double, saveRevision: Int, resetEpoch: Double) {
        let info = try parsedPayload(json).info
        return (info.simSeconds, info.saveRevision, info.resetEpoch)
    }

    private func payloadInfo(_ root: SaveJSONHeader) throws -> PayloadInfo {
        guard case .string(let saveSchemaVersion) = root.saveVersion, supportedSaveSchemaVersions.contains(saveSchemaVersion) else {
            throw VaultError.message("Unsupported save schema.")
        }
        func validNumber(_ value: SaveJSONHeader.Value, fallback: Double?, strings: Bool = false) -> Double? {
            switch value {
            case .absent: return fallback
            case .number(let n): return n
            case .string(let text): return strings ? Double(text) : nil
            default: return nil
            }
        }
        guard let sim = validNumber(root.simSeconds, fallback: nil, strings: true), sim.isFinite, sim >= 0 else { throw VaultError.message("Invalid simulation clock in save.") }
        guard let revisionValue = validNumber(root.saveRevision, fallback: 0), revisionValue.isFinite, revisionValue >= 0, revisionValue <= 9_007_199_254_740_991, revisionValue.rounded(.down) == revisionValue else { throw VaultError.message("Invalid save revision.") }
        let revision = Int(revisionValue)
        guard let reset = validNumber(root.resetEpoch, fallback: 0), reset.isFinite, reset >= 0, reset <= 9_007_199_254_740_991, reset.rounded(.down) == reset else { throw VaultError.message("Invalid reset epoch.") }
        return PayloadInfo(simSeconds: sim, saveRevision: revision, resetEpoch: reset, chunkIds: chunkManifest(root))
    }

    /// The A/B envelope as JSON: the header encoded by JSONEncoder, then `"payload":"<the payload escaped>"` (quote,
    /// backslash and control characters escaped; every other byte is the payload's own UTF-8). JSONDecoder reads it back
    /// as the Envelope with this exact payload. JSONEncoder escaping a 15 MB string cost 450-550 ms on iPhone.
    private func encodeEnvelope(_ header: EnvelopeHeader, payload: Data) throws -> Data {
        var head = try JSONEncoder().encode(header)
        guard head.count >= 2, head.last == UInt8(ascii: "}") else { throw VaultError.message("Native save envelope encoding failed.") }
        head.removeLast()
        var out = Data(capacity: head.count + payload.count + payload.count / 8 + 16)
        out.append(head)
        out.append(contentsOf: Array(",\"payload\":\"".utf8))
        let hex = Array("0123456789abcdef".utf8)
        payload.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let bytes = raw.bindMemory(to: UInt8.self)
            var run = 0
            for index in 0..<bytes.count {
                let byte = bytes[index]
                guard byte == 0x22 || byte == 0x5C || byte < 0x20 else { continue }
                out.append(UnsafeBufferPointer(rebasing: bytes[run..<index]))
                if byte < 0x20 { out.append(contentsOf: [0x5C, 0x75, 0x30, 0x30, hex[Int(byte >> 4)], hex[Int(byte & 0x0F)]]) }
                else { out.append(contentsOf: [0x5C, byte]) }
                run = index + 1
            }
            out.append(UnsafeBufferPointer(rebasing: bytes[run..<bytes.count]))
        }
        out.append(contentsOf: [0x22, 0x7D])
        return out
    }

    /// Test access: the header fields a payload's scan yields, or nil when the scan refuses it.
    static func inspectSaveJSONForTesting(_ data: Data) -> [String: String]? {
        guard let root = try? SaveJSONHeader.inspect(data) else { return nil }
        func text(_ value: SaveJSONHeader.Value) -> String {
            switch value {
            case .absent: return "absent"
            case .null: return "null"
            case .bool(let b): return "bool:\(b)"
            case .number(let n): return "number:\(n)"
            case .string(let t): return "string:\(t)"
            case .container: return "container"
            }
        }
        return ["saveVersion": text(root.saveVersion), "saveRevision": text(root.saveRevision), "resetEpoch": text(root.resetEpoch), "simSeconds": text(root.simSeconds), "binary": text(root.rowsBinary), "chunks": root.chunks.map { $0.joined(separator: ",") } ?? (root.chunksSeen ? "invalid" : "absent"), "stateChunks": root.stateChunks.map { $0.joined(separator: ",") } ?? (root.stateChunksSeen ? "invalid" : "absent"), "fleetRows": root.fleetRows ? "yes" : "no"]
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

    /// Chunk ids a payload lists (fleet.rows.chunks of a 'chunks-v1' manifest, then stateCodec.chunks); [] without them.
    func referencedChunks(_ json: String) throws -> [String] {
        guard let data = json.data(using: .utf8) else { throw VaultError.message("Save payload is not valid JSON.") }
        guard let ids = chunkManifest(try SaveJSONHeader.inspect(data)) else { throw VaultError.message("Invalid save chunk manifest.") }
        return ids
    }

    /// fleet.rows.chunks of a 'chunks-v1' manifest followed by stateCodec.chunks (the text chunks of sealed
    /// collections); [] for a root without either; nil when either list is present but invalid.
    private func chunkManifest(_ root: SaveJSONHeader) -> [String]? {
        var ids: [String] = []
        if root.fleetRows, case .string("chunks-v1") = root.rowsBinary {
            guard let fleet = root.chunks, fleet.allSatisfy({ isValidChunkId($0) }) else { return nil }
            ids = fleet
        }
        if root.stateChunksSeen {
            guard let text = root.stateChunks, text.allSatisfy({ isValidChunkId($0) }) else { return nil }
            ids += text
        }
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

    /// Schedules a mark/sweep pass after the current commit has become durable. Marking runs on a background queue;
    /// sweeping returns to the serial vault queue and removes at most eight chunks per batch. No directory scan, large
    /// vault-file read, or unbounded unlink loop is part of the save acknowledgement path.
    private func scheduleChunkGarbageLocked(generation: Int) {
        guard !chunkGarbageScheduled else { return }
        chunkGarbageScheduled = true
        let cutoff = Date().addingTimeInterval(-GlobalSaveVault.chunkGracePeriod)
        recentChunkUploads = recentChunkUploads.filter { $0.value > cutoff }
        var headers: [String: ChunkReferences] = [:]
        for slot in ["A", "B"] where slotHeaders[slot] != nil {
            let header = slotHeaders[slot]!
            headers[url(slot).path] = ChunkReferences(file: header.file, ids: Set(header.chunkIds))
        }
        let presence = chunkPresence.mapValues { ChunkReferences(file: $0.file, ids: $0.ids) }
        let snapshot = ChunkGarbageSnapshot(generation: generation, startedAt: DispatchTime.now().uptimeNanoseconds, recent: Set(recentChunkUploads.keys), headers: headers, presence: presence)
        garbageQueue.async { [weak self] in
            guard let self else { return }
            guard let plan = self.makeChunkGarbagePlan(snapshot) else {
                self.queue.async { self.chunkGarbageScheduled = false; self.finishChunkGarbageLocked() }
                return
            }
            var protected = Set<String>(), protectedByFile: [String: Set<String>] = [:], scannedBytes = 0, scanSucceeded = true
            for file in plan.filesToScan {
                guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { scanSucceeded = false; break }
                scannedBytes += data.count
                var found = Set<String>()
                for id in plan.candidates {
                    if data.range(of: Data(id.utf8)) != nil { protected.insert(id); found.insert(id) }
                }
                if !found.isEmpty { protectedByFile[file.path] = found }
            }
            self.queue.async {
                self.applyChunkGarbagePlanLocked(plan, protected: protected, protectedByFile: protectedByFile, scannedBytes: scannedBytes, scanSucceeded: scanSucceeded, remaining: plan.candidates.subtracting(protected), deleted: 0)
            }
        }
    }

    /// Directory enumeration, file identities and the candidate set are all computed off the vault/save queue.
    private func makeChunkGarbagePlan(_ snapshot: ChunkGarbageSnapshot) -> ChunkGarbagePlan? {
        guard let names = try? fm.contentsOfDirectory(atPath: chunkFolder.path) else { return nil }
        var candidates = Set(names.filter { $0.hasSuffix(".chunk") }.map { String($0.dropLast(6)) })
        candidates.subtract(snapshot.recent)
        guard !candidates.isEmpty else { return nil }
        let vaultFiles = ((try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "json" }
        var identities: [String: FileIdentity] = [:]
        for file in vaultFiles { if let identity = fileIdentity(file) { identities[file.path] = identity } }
        // An unreadable protector is not proof that it has no references. Leak safely and retry on a later pass.
        guard identities.count == vaultFiles.count else { return nil }
        for (path, entry) in snapshot.headers where identities[path] == entry.file { candidates.subtract(entry.ids) }
        for (path, entry) in snapshot.presence where identities[path] == entry.file { candidates.subtract(entry.ids) }
        guard !candidates.isEmpty else { return nil }
        // Verified A/B headers already contain every referenced id. Scanning them again would reread the largest files.
        let filesToScan = vaultFiles.filter { file in !(snapshot.headers[file.path].map { identities[file.path] == $0.file } ?? false) }
        return ChunkGarbagePlan(generation: snapshot.generation, startedAt: snapshot.startedAt, candidates: candidates, vaultFiles: identities, filesToScan: filesToScan)
    }

    private func applyChunkGarbagePlanLocked(_ plan: ChunkGarbagePlan, protected: Set<String>, protectedByFile: [String: Set<String>], scannedBytes: Int, scanSucceeded: Bool, remaining: Set<String>, deleted: Int) {
        // The complete set and identity of protecting JSON files must still match the mark phase. This also catches a
        // newly created manual slot/reset journal, not only a replacement of an existing A/B file.
        let files = ((try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter { $0.pathExtension == "json" }
        var identities: [String: FileIdentity] = [:]
        for file in files { if let identity = fileIdentity(file) { identities[file.path] = identity } }
        guard scanSucceeded, identities.count == files.count, identities == plan.vaultFiles else {
            recordChunkGarbageLocked(plan, scannedBytes: scannedBytes, protected: protected.count, deleted: deleted, aborted: true)
            chunkGarbageScheduled = false
            queue.asyncAfter(deadline: .now() + .milliseconds(250)) { self.scheduleChunkGarbageLocked(generation: self.currentSlotHeaderLocked()?.generation ?? plan.generation) }
            return
        }
        let cutoff = Date().addingTimeInterval(-GlobalSaveVault.chunkGracePeriod)
        recentChunkUploads = recentChunkUploads.filter { $0.value > cutoff }
        let safe = remaining.filter { recentChunkUploads[$0] == nil }
        let batch = safe.sorted().prefix(GlobalSaveVault.chunkGarbageDeleteBatch)
        var removed = 0
        for id in batch {
            let file = chunkURL(id)
            guard fm.fileExists(atPath: file.path) else { continue }
            do { try fm.removeItem(at: file); removed += 1 } catch { /* A later pass retries a transient failure. */ }
        }
        let rest = safe.subtracting(batch)
        if !rest.isEmpty {
            garbageQueue.asyncAfter(deadline: .now() + .milliseconds(25)) { [weak self] in
                guard let self else { return }
                self.queue.async { self.applyChunkGarbagePlanLocked(plan, protected: protected, protectedByFile: protectedByFile, scannedBytes: scannedBytes, scanSucceeded: scanSucceeded, remaining: rest, deleted: deleted + removed) }
            }
            return
        }
        for file in plan.filesToScan {
            guard let identity = plan.vaultFiles[file.path], let found = protectedByFile[file.path] else { continue }
            if !found.isEmpty { chunkPresence[file.path] = (file: identity, ids: (chunkPresence[file.path]?.ids ?? []).union(found)) }
        }
        recordChunkGarbageLocked(plan, scannedBytes: scannedBytes, protected: protected.count, deleted: deleted + removed, aborted: false)
        chunkGarbageScheduled = false
        finishChunkGarbageLocked()
    }

    private func recordChunkGarbageLocked(_ plan: ChunkGarbagePlan, scannedBytes: Int, protected: Int, deleted: Int, aborted: Bool) {
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - plan.startedAt) / 1e6
        lastChunkGarbageReport = ChunkGarbageReport(generation: plan.generation, durationMs: elapsed, scannedBytes: scannedBytes, candidates: plan.candidates.count, protected: protected, deleted: deleted, aborted: aborted)
    }

    private func finishChunkGarbageLocked() {
        guard !chunkGarbageScheduled else { return }
        let waiters = chunkGarbageWaiters
        chunkGarbageWaiters.removeAll(keepingCapacity: true)
        for waiter in waiters { DispatchQueue.main.async(execute: waiter) }
    }

    /// Used by maintenance/tests that need an explicit cleanup barrier. Gameplay saves never wait for this callback.
    func drainChunkGarbageAsync(completion: @escaping () -> Void) {
        queue.async {
            self.chunkGarbageWaiters.append(completion)
            if self.chunkGarbageScheduled { return }
            self.scheduleChunkGarbageLocked(generation: self.currentSlotHeaderLocked()?.generation ?? 0)
            self.finishChunkGarbageLocked()
        }
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Build 358: what the vault reads from a save payload, found in one pass over its UTF-8 bytes. The whole text is
    /// checked against the JSON grammar (RFC 8259, the root an object), but only the root's saveVersion, saveRevision,
    /// resetEpoch and simSeconds and fleet.rows' $ghBinary and chunks are decoded; nothing becomes an object.
    /// JSONSerialization built the whole 15 MB save as objects to read these (about 1.2 s per commit on iPhone).
    /// The bytes come from a Swift String, so they are valid UTF-8. Of a repeated key, the last one counts.
    private struct SaveJSONHeader {
        enum Value { case absent, null, bool(Bool), number(Double), string(String), container }
        var saveVersion: Value = .absent
        var saveRevision: Value = .absent
        var resetEpoch: Value = .absent
        var simSeconds: Value = .absent
        /// root.fleet is an object holding an object `rows`; rowsBinary and chunks are read from that object.
        var fleetRows = false
        var rowsBinary: Value = .absent
        /// rows.chunks when it is an array of strings, nil otherwise; chunksSeen: rows has a `chunks` key.
        var chunks: [String]? = nil
        var chunksSeen = false
        /// Build 358 (save size): root.stateCodec.chunks, the text chunks of sealed collections, read like rows.chunks.
        var stateChunks: [String]? = nil
        var stateChunksSeen = false

        static func inspect(_ data: Data) throws -> SaveJSONHeader {
            try data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) throws -> SaveJSONHeader in
                var scanner = Scanner(bytes: raw.bindMemory(to: UInt8.self))
                return try scanner.document()
            }
        }

        private struct Scanner {
            let bytes: UnsafeBufferPointer<UInt8>
            var i = 0

            init(bytes: UnsafeBufferPointer<UInt8>) { self.bytes = bytes }

            private var invalid: VaultError { VaultError.message("Save payload is not valid JSON.") }
            private var peek: UInt8 { i < bytes.count ? bytes[i] : 0 }

            mutating func document() throws -> SaveJSONHeader {
                var header = SaveJSONHeader()
                skipSpace()
                guard peek == 0x7B else { throw invalid }
                i += 1
                var first = true
                while try nextMember(&first) {
                    let key = try string()
                    try colon()
                    switch key {
                    case "saveVersion": header.saveVersion = try value()
                    case "saveRevision": header.saveRevision = try value()
                    case "resetEpoch": header.resetEpoch = try value()
                    case "simSeconds": header.simSeconds = try value()
                    case "fleet":
                        header.fleetRows = false; header.rowsBinary = .absent; header.chunks = nil; header.chunksSeen = false
                        if peek == 0x7B { try fleet(&header) } else { try skipValue() }
                    case "stateCodec":
                        header.stateChunks = nil; header.stateChunksSeen = false
                        if peek == 0x7B { try stateCodec(&header) } else { try skipValue() }
                    default: try skipValue()
                    }
                }
                skipSpace()
                guard i == bytes.count else { throw invalid }
                return header
            }

            private mutating func fleet(_ header: inout SaveJSONHeader) throws {
                i += 1
                var first = true
                while try nextMember(&first) {
                    let key = try string()
                    try colon()
                    guard key == "rows" else { try skipValue(); continue }
                    header.fleetRows = false; header.rowsBinary = .absent; header.chunks = nil; header.chunksSeen = false
                    guard peek == 0x7B else { try skipValue(); continue }
                    header.fleetRows = true
                    i += 1
                    var firstRow = true
                    while try nextMember(&firstRow) {
                        let rowKey = try string()
                        try colon()
                        switch rowKey {
                        case "$ghBinary": header.rowsBinary = try value()
                        case "chunks":
                            header.chunksSeen = true
                            header.chunks = try stringArray()
                        default: try skipValue()
                        }
                    }
                }
            }

            private mutating func stateCodec(_ header: inout SaveJSONHeader) throws {
                i += 1
                var first = true
                while try nextMember(&first) {
                    let key = try string()
                    try colon()
                    guard key == "chunks" else { try skipValue(); continue }
                    header.stateChunksSeen = true
                    header.stateChunks = try stringArray()
                }
            }

            /// An array of strings as [String]; nil (after checking it) for any other value.
            private mutating func stringArray() throws -> [String]? {
                guard peek == 0x5B else { try skipValue(); return nil }
                i += 1
                var items: [String] = [], allStrings = true, first = true
                while try nextElement(&first) {
                    if peek == 0x22 { items.append(try string()) } else { try skipValue(); allStrings = false }
                }
                return allStrings ? items : nil
            }

            /// A value read for the header: scalars decoded, an object or array checked and passed over.
            private mutating func value() throws -> Value {
                switch peek {
                case 0x22: return .string(try string())
                case 0x7B, 0x5B: try skipValue(); return .container
                case 0x74: try literal(Scanner.trueWord); return .bool(true)
                case 0x66: try literal(Scanner.falseWord); return .bool(false)
                case 0x6E: try literal(Scanner.nullWord); return .null
                default:
                    let start = i
                    try number()
                    let text = String(decoding: UnsafeBufferPointer(rebasing: bytes[start..<i]), as: UTF8.self)
                    return .number(Double(text) ?? .nan)
                }
            }

            /// Checks one value of any depth and passes over it without decoding it (an explicit stack, no recursion).
            mutating func skipValue() throws {
                var open: [Bool] = []   // true: object, false: array
                var first = false
                while true {
                    switch peek {
                    case 0x7B: i += 1; open.append(true); first = true
                    case 0x5B: i += 1; open.append(false); first = true
                    case 0x22: try skipString()
                    case 0x74: try literal(Scanner.trueWord)
                    case 0x66: try literal(Scanner.falseWord)
                    case 0x6E: try literal(Scanner.nullWord)
                    default: try number()
                    }
                    // Move to the next value in the innermost open container, closing the finished ones.
                    while let isObject = open.last {
                        if isObject {
                            if try nextMember(&first) { try skipString(); try colon(); break }
                        } else if try nextElement(&first) {
                            break
                        }
                        open.removeLast()
                        first = false
                    }
                    if open.isEmpty { return }
                }
            }

            /// Inside an object: false at its closing brace (passed over), true when a member's key follows.
            private mutating func nextMember(_ first: inout Bool) throws -> Bool {
                skipSpace()
                guard i < bytes.count else { throw invalid }
                if bytes[i] == 0x7D { i += 1; return false }
                if first { first = false; return true }
                guard bytes[i] == 0x2C else { throw invalid }
                i += 1
                skipSpace()
                return true
            }

            /// Inside an array: false at its closing bracket (passed over), true when an element follows.
            private mutating func nextElement(_ first: inout Bool) throws -> Bool {
                skipSpace()
                guard i < bytes.count else { throw invalid }
                if bytes[i] == 0x5D { i += 1; return false }
                if first { first = false; return true }
                guard bytes[i] == 0x2C else { throw invalid }
                i += 1
                skipSpace()
                return true
            }

            private mutating func colon() throws {
                skipSpace()
                guard peek == 0x3A else { throw invalid }
                i += 1
                skipSpace()
            }

            private mutating func skipSpace() {
                while i < bytes.count {
                    let c = bytes[i]
                    guard c == 0x20 || c == 0x0A || c == 0x0D || c == 0x09 else { return }
                    i += 1
                }
            }

            private static let trueWord = Array("true".utf8), falseWord = Array("false".utf8), nullWord = Array("null".utf8)

            private mutating func literal(_ word: [UInt8]) throws {
                guard bytes.count - i >= word.count else { throw invalid }
                for byte in word {
                    guard bytes[i] == byte else { throw invalid }
                    i += 1
                }
            }

            /// -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)?
            private mutating func number() throws {
                if peek == 0x2D { i += 1 }
                if peek == 0x30 { i += 1 } else if peek >= 0x31 && peek <= 0x39 { skipDigits() } else { throw invalid }
                if peek == 0x2E {
                    i += 1
                    guard peek >= 0x30 && peek <= 0x39 else { throw invalid }
                    skipDigits()
                }
                if peek == 0x65 || peek == 0x45 {
                    i += 1
                    if peek == 0x2B || peek == 0x2D { i += 1 }
                    guard peek >= 0x30 && peek <= 0x39 else { throw invalid }
                    skipDigits()
                }
            }

            private mutating func skipDigits() {
                while i < bytes.count, bytes[i] >= 0x30, bytes[i] <= 0x39 { i += 1 }
            }

            /// Checks a string and passes over it: no raw control character, only JSON's escapes.
            private mutating func skipString() throws {
                guard peek == 0x22 else { throw invalid }
                i += 1
                while i < bytes.count {
                    let c = bytes[i]
                    if c == 0x22 { i += 1; return }
                    if c == 0x5C { try escape(); continue }
                    guard c >= 0x20 else { throw invalid }
                    i += 1
                }
                throw invalid
            }

            /// At a backslash: checks the escape, passes over it and returns the UTF-16 code unit it stands for.
            @discardableResult
            private mutating func escape() throws -> UInt32 {
                guard bytes.count - i >= 2 else { throw invalid }
                let c = bytes[i + 1]
                i += 2
                switch c {
                case 0x22, 0x5C, 0x2F: return UInt32(c)
                case 0x62: return 0x08
                case 0x66: return 0x0C
                case 0x6E: return 0x0A
                case 0x72: return 0x0D
                case 0x74: return 0x09
                case 0x75:
                    guard bytes.count - i >= 4 else { throw invalid }
                    var unit: UInt32 = 0
                    for _ in 0..<4 {
                        let h = bytes[i]
                        let digit: UInt8
                        switch h {
                        case 0x30...0x39: digit = h - 0x30
                        case 0x41...0x46: digit = h - 0x37
                        case 0x61...0x66: digit = h - 0x57
                        default: throw invalid
                        }
                        unit = unit << 4 | UInt32(digit)
                        i += 1
                    }
                    return unit
                default: throw invalid
                }
            }

            /// A string decoded; a lone surrogate escape becomes U+FFFD.
            private mutating func string() throws -> String {
                let start = i + 1
                try skipString()
                let end = i - 1
                let body = UnsafeBufferPointer(rebasing: bytes[start..<end])
                guard body.contains(0x5C) else { return String(decoding: body, as: UTF8.self) }
                var out: [UInt8] = []
                out.reserveCapacity(body.count)
                i = start
                while i < end {
                    guard bytes[i] == 0x5C else { out.append(bytes[i]); i += 1; continue }
                    let unit = try escape()
                    var scalar = Unicode.Scalar(unit)
                    if unit >= 0xD800 && unit <= 0xDBFF && end - i >= 6 && bytes[i] == 0x5C && bytes[i + 1] == 0x75 {
                        let mark = i
                        let low = try escape()
                        if low >= 0xDC00 && low <= 0xDFFF { scalar = Unicode.Scalar(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)) } else { i = mark }
                    }
                    let decoded: Unicode.Scalar = scalar ?? "\u{FFFD}"
                    out.append(contentsOf: String(Character(decoded)).utf8)
                }
                i = end + 1
                return String(decoding: out, as: UTF8.self)
            }
        }
    }

    private enum VaultError: LocalizedError {
        case message(String)
        var errorDescription: String? { switch self { case .message(let value): value } }
    }
}
