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
        // Physical storage evolves independently from the logical Save Schema.
        let storageVersion: Int?
        let manifestFile: String?
        let payloadSHA256: String?
        // Older A/B files stored a UTF-8 payload string inline. New files keep
        // compact manifests whose content-addressed sections are sibling files.
        let payload: String?
        let payloadFile: String?
    }

    private struct ManifestChunk: Codable {
        let file: String
        let sha256: String
        let byteCount: Int
    }

    private struct ManifestSection: Codable {
        let key: String
        let kind: String
        let itemCount: Int
        let chunks: [ManifestChunk]
    }

    private struct StateManifest: Codable {
        let format: String
        let storageVersion: Int
        let schemaVersion: String
        let generation: Int
        let slot: String
        let resetEpoch: Double
        let saveRevision: Int
        let sha256: String
        let sections: [ManifestSection]
    }

    private struct StoredPayload {
        let manifestFile: String
        let manifestDigest: String
        let createdFiles: [URL]
    }

    private struct PayloadValidation {
        let simSeconds: Double
        let saveRevision: Int
        let resetEpoch: Double
        let payloadSHA256: String
        let payloadData: Data
    }

    private struct VaultHead: Codable {
        let generation: Int
        let slot: String
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
    private let storageVersion = 2
    private let manifestChunkItems = 1_000
    // The queue is the sole writer. Reuse the most recently verified A/B
    // envelope while the cheap file stamps remain unchanged; a changed slot
    // forces a full recovery scan and hash/schema validation.
    private var cachedBestEnvelope: Envelope?
    private var cachedSlotStamps: [String: String]?
    private init() {
        // A crash before reset commit returns to the independently pinned old save.
        // Keep the journal on recovery failure so bootstrap and writes fail closed.
        do { try queue.sync { try recoverPendingReset() } }
        catch { print("Native reset recovery blocked: \(error.localizedDescription)") }
    }
    private struct ResetCheckpoint: Codable {
        let payload: String?
        let runtimeVersion: String?
        let sha256: String?
        let clearManualSlots: Bool?
        let manualSlotHashes: [String?]?
    }
    private var resetCheckpointURL: URL { folder.appendingPathComponent("pending-reset.json") }
    private var headURL: URL { folder.appendingPathComponent("save-head.json") }
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
            if fm.fileExists(atPath: headURL.path) { try fm.removeItem(at: headURL) }
            if let files = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
                for file in files where ["save-payload-", "save-manifest-", "save-section-"].contains(where: { file.lastPathComponent.hasPrefix($0) }) { try? fm.removeItem(at: file) }
            }
            cachedBestEnvelope = nil
            cachedSlotStamps = nil
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
    private var coldArchiveFolder: URL {
        fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("GlobalHoldingsColdArchive", isDirectory: true)
    }
    private func url(_ slot: String) -> URL { folder.appendingPathComponent("save-\(slot).json") }
    private func manifestURL(_ name: String) -> URL? {
        guard name.hasPrefix("save-manifest-"), name.hasSuffix(".json"),
              !name.contains("/"), !name.contains("\\"),
              name.range(of: "[^A-Za-z0-9._-]", options: .regularExpression) == nil else { return nil }
        return folder.appendingPathComponent(name, isDirectory: false)
    }
    private func sectionURL(_ name: String) -> URL? {
        guard name.hasPrefix("save-section-"), name.hasSuffix(".bin"),
              !name.contains("/"), !name.contains("\\"),
              name.range(of: "[^A-Za-z0-9._-]", options: .regularExpression) == nil else { return nil }
        return folder.appendingPathComponent(name, isDirectory: false)
    }
    private func manualSlotURL(_ index: Int) -> URL { folder.appendingPathComponent("manual-slot-\(index + 1).json", isDirectory: false) }
    private func manualSlotBackupURL(_ index: Int) -> URL { folder.appendingPathComponent("pending-manual-slot-\(index + 1).json", isDirectory: false) }
    private var rollbackCheckpointURL: URL { folder.appendingPathComponent("rollback-checkpoint.json", isDirectory: false) }

    private func payloadURL(_ name: String) -> URL? {
        guard name.hasPrefix("save-payload-"), name.hasSuffix(".bin"),
              !name.contains("/"), !name.contains("\\"),
              name.range(of: "[^A-Za-z0-9._-]", options: .regularExpression) == nil else { return nil }
        return folder.appendingPathComponent(name, isDirectory: false)
    }

    private func payloadFileName(generation: Int, slot: String, sha256: String) -> String {
        "save-payload-\(slot)-g\(generation)-\(sha256).bin"
    }

    private func coldArchiveURL(_ name: String) -> URL? {
        guard name.utf8.count <= 180,
              name.range(of: "^gh-cold-[A-Za-z0-9._-]{1,80}-(?:[AB]\\.json|item-[a-f0-9]{64}\\.json)$", options: .regularExpression) != nil,
              !name.contains("/"), !name.contains("\\") else { return nil }
        return coldArchiveFolder.appendingPathComponent(name, isDirectory: false)
    }

    func readColdArchiveAsync(_ name: String, completion: ((Result<String?, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<String?, Error> {
                guard let file = self.coldArchiveURL(name) else { throw VaultError.message("Invalid cold archive path.") }
                guard self.fm.fileExists(atPath: file.path) else { return nil }
                let data = try Data(contentsOf: file, options: .mappedIfSafe)
                guard data.count <= 16 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else {
                    throw VaultError.message("Cold archive record is too large or is not UTF-8.")
                }
                return text
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    func writeColdArchiveAsync(_ name: String, value: String, completion: ((Result<Void, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Void, Error> {
                guard let file = self.coldArchiveURL(name), let data = value.data(using: .utf8),
                      data.count <= 16 * 1024 * 1024,
                      (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) != nil else {
                    throw VaultError.message("Invalid cold archive write.")
                }
                try self.fm.createDirectory(at: self.coldArchiveFolder, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
                try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard let verified = try? Data(contentsOf: file, options: .mappedIfSafe), verified == data else {
                    throw VaultError.message("Cold archive write verification failed.")
                }
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    func removeColdArchiveAsync(_ name: String, completion: ((Result<Void, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Void, Error> {
                guard let file = self.coldArchiveURL(name) else { throw VaultError.message("Invalid cold archive path.") }
                if self.fm.fileExists(atPath: file.path) { try self.fm.removeItem(at: file) }
                guard !self.fm.fileExists(atPath: file.path) else { throw VaultError.message("Cold archive removal verification failed.") }
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    func coldArchiveKeysAsync(completion: ((Result<[String], Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<[String], Error> {
                guard self.fm.fileExists(atPath: self.coldArchiveFolder.path) else { return [] }
                return try self.fm.contentsOfDirectory(at: self.coldArchiveFolder, includingPropertiesForKeys: nil)
                    .map(\.lastPathComponent).filter { self.coldArchiveURL($0) != nil }.sorted()
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

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
                let validated = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "commitSave") }
                return try self.commitLocked(json, runtimeVersion: runtimeVersion, validated: validated)
            }
            if let completion { DispatchQueue.main.async { completion(result) } }
        }
    }

    private func manifestStorageDigest(_ sections: [ManifestSection], generation: Int, slot: String, resetEpoch: Double, saveRevision: Int) -> String {
        let canonical = sections.sorted { $0.key < $1.key }.map { section in
            let chunks = section.chunks.map { "\($0.file)|\($0.sha256)|\($0.byteCount)" }.joined(separator: ",")
            return "\(section.key.utf8.count):\(section.key)|\(section.kind)|\(section.itemCount)|\(chunks)"
        }.joined(separator: "\n")
        let metadata = "gh-state-manifest-v2|\(storageVersion)|\(schemaVersion)|\(generation)|\(slot)|\(String(resetEpoch))|\(saveRevision)\n"
        return sha256(Data((metadata + canonical).utf8))
    }

    private func encodeManifestPath(_ components: [String]) -> String {
        components.map { component in
            component.utf8.map { byte -> String in
                if (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || byte == 45 || byte == 95 || byte == 126 {
                    return String(decoding: [byte], as: UTF8.self)
                }
                return String(format: "%%%02X", Int(byte))
            }.joined()
        }.joined(separator: ".")
    }

    private func decodeManifestPath(_ path: String) -> [String]? {
        let encoded = path.components(separatedBy: ".")
        guard !encoded.isEmpty, encoded.allSatisfy({ !$0.isEmpty }) else { return nil }
        var decodedPath: [String] = []
        for component in encoded {
            let bytes = Array(component.utf8)
            var decoded: [UInt8] = [], index = 0
            while index < bytes.count {
                if bytes[index] == 37 {
                    guard index + 2 < bytes.count,
                          let high = Self.hexNibble(bytes[index + 1]),
                          let low = Self.hexNibble(bytes[index + 2]) else { return nil }
                    decoded.append(high << 4 | low); index += 3
                } else {
                    let byte = bytes[index]
                    guard (65...90).contains(byte) || (97...122).contains(byte) || (48...57).contains(byte) || byte == 45 || byte == 95 || byte == 126 else { return nil }
                    decoded.append(byte); index += 1
                }
            }
            guard let value = String(bytes: decoded, encoding: .utf8), !value.isEmpty else { return nil }
            decodedPath.append(value)
        }
        return decodedPath
    }

    private static func hexNibble(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 48...57: return byte - 48
        case 65...70: return byte - 55
        case 97...102: return byte - 87
        default: return nil
        }
    }

    private func assigningManifestValue(_ value: Any, components: ArraySlice<String>, to root: [String: Any]) -> [String: Any]? {
        guard let key = components.first, !key.isEmpty else { return nil }
        var copy = root
        if components.count == 1 { copy[key] = value; return copy }
        let child = copy[key] as? [String: Any] ?? [:]
        guard let updated = assigningManifestValue(value, components: components.dropFirst(), to: child) else { return nil }
        copy[key] = updated
        return copy
    }

    private func readManifestNamed(_ name: String) -> StateManifest? {
        guard let file = manifestURL(name),
              let data = try? Data(contentsOf: file), data.count <= 8 * 1024 * 1024,
              let manifest = try? JSONDecoder().decode(StateManifest.self, from: data),
              manifest.format == "gh-state-manifest-v2",
              manifest.storageVersion == storageVersion,
              manifest.schemaVersion == schemaVersion,
              manifest.generation > 0, manifest.generation <= 9_007_199_254_740_991,
              manifest.resetEpoch.isFinite, manifest.resetEpoch >= 0,
              manifest.saveRevision >= 0, manifest.saveRevision <= 9_007_199_254_740_991,
              manifest.slot == "A" || manifest.slot == "B",
              manifest.sections.count <= 4_096,
              manifest.sha256 == manifestStorageDigest(manifest.sections, generation: manifest.generation, slot: manifest.slot,
                resetEpoch: manifest.resetEpoch, saveRevision: manifest.saveRevision),
              name == "save-manifest-\(manifest.slot)-g\(manifest.generation)-\(manifest.sha256).json" else { return nil }
        let keys = manifest.sections.map(\.key)
        guard Set(keys).count == keys.count,
              keys.allSatisfy({ !$0.isEmpty && $0.range(of: "[^A-Za-z0-9._%~-]", options: .regularExpression) == nil && decodeManifestPath($0) != nil }) else { return nil }
        return manifest
    }

    private func writeChunkedPayloadLocked(_ payloadData: Data, generation: Int, slot: String, current: Envelope?, resetEpoch: Double, saveRevision: Int) throws -> StoredPayload {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let root = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any] else {
            throw VaultError.message("Save payload root is not an object.")
        }
        let priorManifest = current?.manifestFile.flatMap { readManifestNamed($0) }
        let reusableFiles = Set((priorManifest?.sections ?? []).flatMap { $0.chunks.map(\.file) })
        var sections: [ManifestSection] = [], createdFiles: [URL] = [], written = Set<String>()

        func persistChunk(_ data: Data) throws -> ManifestChunk {
            let digest = sha256(data), name = "save-section-\(digest).bin"
            guard let file = sectionURL(name) else { throw VaultError.message("Invalid state section path.") }
            if reusableFiles.contains(name),
               let existing = try? Data(contentsOf: file, options: .mappedIfSafe),
               existing.count == data.count, sha256(existing) == digest {
                return ManifestChunk(file: name, sha256: digest, byteCount: data.count)
            }
            if !written.contains(name) {
                try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard let readback = try? Data(contentsOf: file, options: .mappedIfSafe),
                      readback.count == data.count, sha256(readback) == digest else {
                    throw VaultError.message("State section failed verification after atomic write.")
                }
                written.insert(name); createdFiles.append(file)
            }
            return ManifestChunk(file: name, sha256: digest, byteCount: data.count)
        }

        var arrays: [String: [Any]] = [:]
        func extractArrays(_ value: Any, path: [String]) -> Any {
            guard let object = value as? [String: Any] else { return value }
            var stripped: [String: Any] = [:]
            for key in object.keys.sorted() {
                guard let child = object[key] else { continue }
                let childPath = path + [key]
                if let rows = child as? [Any] {
                    arrays[encodeManifestPath(childPath)] = rows
                } else {
                    stripped[key] = extractArrays(child, path: childPath)
                }
            }
            return stripped
        }
        var strippedRoot: [String: Any] = [:]
        for key in root.keys.sorted() {
            guard let value = root[key] else { continue }
            if let rows = value as? [Any] { arrays[encodeManifestPath([key])] = rows }
            else { strippedRoot[key] = extractArrays(value, path: [key]) }
        }

        func appendArraySection(_ key: String, rows: [Any]) throws {
                var chunks: [ManifestChunk] = []
                if rows.isEmpty {
                    let data = try JSONSerialization.data(withJSONObject: [Any](), options: [.sortedKeys, .fragmentsAllowed])
                    chunks.append(try persistChunk(data))
                } else {
                    var start = 0
                    while start < rows.count {
                        let end = min(rows.count, start + manifestChunkItems)
                        let data = try JSONSerialization.data(withJSONObject: Array(rows[start..<end]), options: [.sortedKeys, .fragmentsAllowed])
                        chunks.append(try persistChunk(data)); start = end
                    }
                }
            sections.append(ManifestSection(key: key, kind: "array", itemCount: rows.count, chunks: chunks))
        }
        for key in arrays.keys.sorted() {
            guard let rows = arrays[key] else { continue }
            try appendArraySection(key, rows: rows)
        }
        for key in strippedRoot.keys.sorted() {
            guard let value = strippedRoot[key] else { continue }
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed])
            sections.append(ManifestSection(key: encodeManifestPath([key]), kind: "value", itemCount: 1, chunks: [try persistChunk(data)]))
        }

        let manifestDigest = manifestStorageDigest(sections, generation: generation, slot: slot,
            resetEpoch: resetEpoch, saveRevision: saveRevision)
        let manifest = StateManifest(format: "gh-state-manifest-v2", storageVersion: storageVersion,
            schemaVersion: schemaVersion, generation: generation, slot: slot,
            resetEpoch: resetEpoch, saveRevision: saveRevision, sha256: manifestDigest, sections: sections)
        let manifestData = try JSONEncoder().encode(manifest)
        let manifestName = "save-manifest-\(slot)-g\(generation)-\(manifestDigest).json"
        guard let manifestFile = manifestURL(manifestName) else { throw VaultError.message("Invalid state manifest path.") }
        try manifestData.write(to: manifestFile, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard let readback = try? Data(contentsOf: manifestFile), readback == manifestData,
              readManifestNamed(manifestName) != nil else {
            throw VaultError.message("State manifest failed verification after atomic write.")
        }
        createdFiles.append(manifestFile)
        return StoredPayload(manifestFile: manifestName, manifestDigest: manifestDigest, createdFiles: createdFiles)
    }

    private func materializeChunkedPayload(_ manifest: StateManifest) throws -> Data {
        dispatchPrecondition(condition: .onQueue(queue))
        var root: [String: Any] = [:]
        var nestedValues: [([String], Any)] = []
        for section in manifest.sections {
            guard section.itemCount >= 0, !section.chunks.isEmpty, let path = decodeManifestPath(section.key) else { throw VaultError.message("Invalid state manifest section.") }
            var values: [Any] = []
            for chunk in section.chunks {
                guard let file = sectionURL(chunk.file),
                      chunk.byteCount >= 0, chunk.byteCount <= 30 * 1024 * 1024,
                      chunk.file == "save-section-\(chunk.sha256).bin",
                      let data = try? Data(contentsOf: file, options: .mappedIfSafe),
                      data.count == chunk.byteCount, sha256(data) == chunk.sha256,
                      let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
                    throw VaultError.message("A stored state section is missing or corrupt.")
                }
                values.append(value)
            }
            if section.kind == "array" {
                var rows: [Any] = []
                for value in values { guard let chunkRows = value as? [Any] else { throw VaultError.message("Invalid array section chunk.") }; rows.append(contentsOf: chunkRows) }
                guard rows.count == section.itemCount else { throw VaultError.message("State section item count mismatch.") }
                nestedValues.append((path, rows))
            } else if section.kind == "value", section.itemCount == 1, values.count == 1 {
                guard path.count == 1 else { throw VaultError.message("Invalid value section path.") }
                root[path[0]] = values[0]
            } else { throw VaultError.message("Invalid state section kind.") }
        }
        for (path, value) in nestedValues.sorted(by: { $0.0.count < $1.0.count }) {
            guard let updated = assigningManifestValue(value, components: path[...], to: root) else { throw VaultError.message("Invalid state section path.") }
            root = updated
        }
        return try JSONSerialization.data(withJSONObject: root, options: [.sortedKeys])
    }

    @discardableResult
    func commit(_ json: String, runtimeVersion: String? = nil) throws -> Int {
        try queue.sync { try commitLocked(json, runtimeVersion: runtimeVersion) }
    }

    private func commitLocked(_ json: String, runtimeVersion: String? = nil, allowRegression: Bool = false, validated suppliedValidation: PayloadValidation? = nil) throws -> Int {
        if !allowRegression && fm.fileExists(atPath: resetCheckpointURL.path) { throw VaultError.message("Reset recovery is pending.") }
        let validation = try suppliedValidation ?? validatePayload(json)
        try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let current = bestEnvelope()
        if !allowRegression && current == nil &&
            ["A", "B"].contains(where: { fm.fileExists(atPath: url($0).path) }) &&
            !hasEmptyHeadLocked() {
            throw VaultError.message("No valid native save remains; recovery required.")
        }
        try ensureHeadLocked(current: current, allowRecovery: allowRegression)
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
        let stored = try writeChunkedPayloadLocked(validation.payloadData, generation: generation, slot: slot, current: current,
            resetEpoch: validation.resetEpoch, saveRevision: validation.saveRevision)
        let header = Envelope(
            generation: generation,
            slot: slot,
            schemaVersion: schemaVersion,
            runtimeVersion: runtimeVersion,
            simSeconds: validation.simSeconds,
            saveRevision: validation.saveRevision,
            resetEpoch: validation.resetEpoch,
            savedAt: Date().timeIntervalSince1970,
            sha256: stored.manifestDigest,
            storageVersion: storageVersion,
            manifestFile: stored.manifestFile,
            payloadSHA256: validation.payloadSHA256,
            payload: nil,
            payloadFile: nil
        )
        let headerData = try JSONEncoder().encode(header)
        // Content-addressed sections and the compact manifest are durable first.
        // The save-head changes last, so an interrupted write cannot promote a staged generation.
        try headerData.write(to: url(slot), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard let writtenHeader = try? Data(contentsOf: url(slot)), writtenHeader == headerData else {
            throw VaultError.message("Native save verification failed after write.")
        }
        do {
            try writeHeadLocked(VaultHead(generation: generation, slot: slot))
        } catch {
            let pointerError = error
            do {
                if let current {
                    try writeHeadLocked(VaultHead(generation: current.generation, slot: current.slot))
                } else {
                    try writeHeadLocked(VaultHead(generation: 0, slot: "none"))
                    try fm.removeItem(at: url(slot))
                    for file in stored.createdFiles { try? fm.removeItem(at: file) }
                }
            } catch {
                cachedBestEnvelope = nil
                cachedSlotStamps = nil
                throw VaultError.message("Native save pointer rollback failed; recovery is required: \(error.localizedDescription)")
            }
            cachedBestEnvelope = current
            cachedSlotStamps = slotStamps()
            throw pointerError
        }
        cachedBestEnvelope = Envelope(generation: generation, slot: slot, schemaVersion: schemaVersion,
            runtimeVersion: runtimeVersion, simSeconds: validation.simSeconds, saveRevision: validation.saveRevision,
            resetEpoch: validation.resetEpoch, savedAt: header.savedAt, sha256: validation.payloadSHA256,
            storageVersion: storageVersion, manifestFile: stored.manifestFile, payloadSHA256: validation.payloadSHA256,
            payload: json, payloadFile: nil)
        cachedSlotStamps = slotStamps()
        cleanupUnreferencedStorageFiles()
        return generation
    }

    func currentSave() -> String? { queue.sync { bestEnvelope()?.payload } }
    func currentGeneration() -> Int { queue.sync { bestEnvelope()?.generation ?? 0 } }
    func currentRuntimeVersion() -> String? { queue.sync { bestEnvelope()?.runtimeVersion } }

    func snapshot(generation: Int) -> Snapshot? { queue.sync { snapshotLocked(generation: generation) } }

    private func snapshotLocked(generation: Int) -> Snapshot? {
        guard generation > 0, let envelope = envelopes().first(where: { $0.generation == generation }), let payload = envelope.payload else { return nil }
        return Snapshot(generation: envelope.generation, runtimeVersion: envelope.runtimeVersion, simSeconds: envelope.simSeconds, saveRevision: envelope.saveRevision ?? 0, resetEpoch: envelope.resetEpoch ?? 0, payload: payload)
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
              let validated = try? validatePayload(checkpoint.payload),
              validated.payloadSHA256 == checkpoint.sha256,
              validated.saveRevision == checkpoint.saveRevision else { return nil }
        return checkpoint
    }

    func manualSlotMetadata() -> [ManualSlotMetadata] {
        queue.sync { (0...2).compactMap { readManualSlot($0)?.metadata } }
    }

    func saveManualSlotAsync(_ index: Int, json: String, label: String, runtimeVersion: String? = nil, envelope: [String: Any]? = nil, completion: ((Result<ManualSlotMetadata, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<ManualSlotMetadata, Error> {
                let suppliedValidation = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "saveManualSlot") }
                let index = try self.validatedManualSlotIndex(index)
                let validation = try suppliedValidation ?? self.validatePayload(json)
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
                    sha256: validation.payloadSHA256,
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
                let payloadHash = current.flatMap { saved in saved.payload.map { self.sha256(Data($0.utf8)) } }
                let checkpoint = ResetCheckpoint(payload: current?.payload, runtimeVersion: current?.runtimeVersion, sha256: payloadHash, clearManualSlots: false, manualSlotHashes: nil)
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
              let validated = try? validatePayload(envelope.payload),
              validated.payloadSHA256 == envelope.sha256,
              validated.simSeconds == envelope.metadata.simSeconds,
              validated.saveRevision == envelope.metadata.saveRevision,
              validated.resetEpoch == envelope.metadata.resetEpoch else { return nil }
        return envelope
    }

    func reset() {
        queue.sync { try? fm.removeItem(at: folder); cachedBestEnvelope = nil; cachedSlotStamps = nil }
    }

    /// Reset without a resurrection window: write the pristine reset save twice
    /// so both A/B slots become members of the new reset epoch. The previous
    /// game can never become authoritative merely because one clean slot is lost.
    func resetToAsync(_ json: String, runtimeVersion: String? = nil, clearManualSlots: Bool = false, envelope: [String: Any]? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {
        queue.async {
            let result = Result<Int, Error> {
                let validation = try envelope.map { try self.validateBridgeEnvelope($0, json: json, action: "resetGameSave") } ?? self.validatePayload(json)
                try self.recoverPendingReset()
                try self.fm.createDirectory(at: self.folder, withIntermediateDirectories: true)
                let current = self.bestEnvelope()
                let manualSlotHashes = clearManualSlots ? try self.manualSlotRawHashes() : nil
                let payloadHash = current.flatMap { saved in saved.payload.map { self.sha256(Data($0.utf8)) } }
                let checkpoint = ResetCheckpoint(payload: current?.payload, runtimeVersion: current?.runtimeVersion, sha256: payloadHash, clearManualSlots: clearManualSlots, manualSlotHashes: manualSlotHashes)
                let data = try JSONEncoder().encode(checkpoint)
                try data.write(to: self.resetCheckpointURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                guard try Data(contentsOf: self.resetCheckpointURL) == data else { throw VaultError.message("Reset checkpoint verification failed.") }
                do {
                    if let manualSlotHashes { try self.stageManualSlotsForReset(expectedHashes: manualSlotHashes) }
                    _ = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true, validated: validation)
                    let generation = try self.commitLocked(json, runtimeVersion: runtimeVersion, allowRegression: true, validated: validation)
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
        guard let envelope = bestEnvelope(), let payload = envelope.payload, let data = payload.data(using: .utf8) else { return compatibility + (["A", "B"].contains(where: { fm.fileExists(atPath: url($0).path) }) ? "window.GH_NATIVE_RECOVERY_BLOCKED=true;" : "") }
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
          window.__GH_NATIVE_SAVE_META__=Object.freeze({source:'native-save-vault',generation:\(nativeGeneration),saveRevision:\(nativeRevision),resetEpoch:Number(\(nativeReset)),simSeconds:Number(\(nativeSim)),forced:\(forceValue),paused:\(pauseValue)});
          window.__GH_NATIVE_SLOT_META__=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('\(slotB64)'),c=>c.charCodeAt(0))));
          try{sessionStorage.setItem('gh-native-save-restored','1');}catch(_e){}
        }catch(e){window.GH_NATIVE_RECOVERY_BLOCKED=true;console.error('GH native save bootstrap failed',e);}})();
        """
    }

    private func slotStamps() -> [String: String] {
        var stamps: [String: String] = [:]
        func addStamp(_ key: String, _ file: URL) {
            guard let attributes = try? fm.attributesOfItem(atPath: file.path) else { return }
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? -1
            let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? -1
            let fileNumber = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0
            stamps[key] = "\(size):\(String(format: "%.6f", modified)):\(fileNumber)"
        }
        for (slot, file) in [("A", url("A")), ("B", url("B")), ("head", headURL)] {
            addStamp(slot, file)
            guard slot != "head",
                  let attributes = try? fm.attributesOfItem(atPath: file.path),
                  ((attributes[.size] as? NSNumber)?.int64Value ?? Int64.max) <= 16 * 1024,
                  let data = try? Data(contentsOf: file),
                  let envelope = try? JSONDecoder().decode(Envelope.self, from: data) else { continue }
            if let name = envelope.payloadFile, let payload = payloadURL(name) { addStamp("payload:\(name)", payload) }
            if let name = envelope.manifestFile, let manifestFile = manifestURL(name) {
                addStamp("manifest:\(name)", manifestFile)
                if let manifest = readManifestNamed(name) {
                    for chunk in manifest.sections.flatMap(\.chunks) {
                        if let sectionFile = sectionURL(chunk.file) { addStamp("section:\(chunk.file)", sectionFile) }
                    }
                }
            }
        }
        return stamps
    }

    private func envelopes() -> [Envelope] { ["A", "B"].compactMap { readEnvelope(url($0)) } }
    private func writeHeadLocked(_ head: VaultHead) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        let data = try JSONEncoder().encode(head)
        try data.write(to: headURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        guard let verified = try? Data(contentsOf: headURL), verified == data else {
            throw VaultError.message("Native save generation pointer verification failed.")
        }
    }

    private func ensureHeadLocked(current: Envelope?, allowRecovery: Bool) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        if fm.fileExists(atPath: headURL.path),
           let data = try? Data(contentsOf: headURL),
           let head = try? JSONDecoder().decode(VaultHead.self, from: data) {
            if head.generation == 0 && head.slot == "none" && current == nil { return }
            if let current, head.generation == current.generation && head.slot == current.slot { return }
            if !allowRecovery { throw VaultError.message("Native save generation pointer does not match the verified save.") }
        } else if fm.fileExists(atPath: headURL.path) && !allowRecovery {
            throw VaultError.message("Native save generation pointer is invalid; recovery is required.")
        }
        if let current {
            try writeHeadLocked(VaultHead(generation: current.generation, slot: current.slot))
        } else {
            let hasSlots = ["A", "B"].contains { fm.fileExists(atPath: url($0).path) }
            if hasSlots && !allowRecovery {
                throw VaultError.message("Native save slots exist without a valid generation pointer.")
            }
            try writeHeadLocked(VaultHead(generation: 0, slot: "none"))
        }
    }

    private func hasEmptyHeadLocked() -> Bool {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let data = try? Data(contentsOf: headURL),
              let head = try? JSONDecoder().decode(VaultHead.self, from: data) else { return false }
        return head.generation == 0 && head.slot == "none"
    }

    private func bestEnvelope() -> Envelope? {
        dispatchPrecondition(condition: .onQueue(queue))
        let stamps = slotStamps()
        if let cachedSlotStamps, cachedSlotStamps == stamps { return cachedBestEnvelope }
        var best: Envelope?
        if fm.fileExists(atPath: headURL.path) {
            let decodedHead = (try? Data(contentsOf: headURL)).flatMap { try? JSONDecoder().decode(VaultHead.self, from: $0) }
            if let head = decodedHead {
                if head.generation == 0 && head.slot == "none" {
                    best = nil
                } else if head.generation > 0, head.slot == "A" || head.slot == "B",
                          let candidate = readEnvelope(url(head.slot)), candidate.generation == head.generation {
                    best = candidate
                } else {
                    // A committed slot can be damaged after a crash or filesystem
                    // fault. Recover only the verified peer; never promote a staged
                    // higher generation while a valid head still identifies the
                    // previously committed slot.
                    best = envelopes().filter { $0.generation < head.generation }.max { $0.generation < $1.generation }
                    if let best { try? writeHeadLocked(VaultHead(generation: best.generation, slot: best.slot)) }
                }
            } else {
                // A corrupt pointer carries no trustworthy generation boundary.
                // Select only a fully verified A/B envelope and repair the pointer.
                best = envelopes().max { $0.generation < $1.generation }
                if let best { try? writeHeadLocked(VaultHead(generation: best.generation, slot: best.slot)) }
            }
        } else {
            best = envelopes().max { $0.generation < $1.generation }
        }
        cachedBestEnvelope = best
        cachedSlotStamps = slotStamps()
        return best
    }

    private func readEnvelope(_ file: URL) -> Envelope? {
        guard let data = try? Data(contentsOf: file),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.schemaVersion == schemaVersion,
              envelope.slot == "A" || envelope.slot == "B",
              file.lastPathComponent == "save-\(envelope.slot).json",
              envelope.generation > 0, envelope.generation <= 9_007_199_254_740_991,
              envelope.simSeconds.isFinite, envelope.simSeconds >= 0 else { return nil }
        let payloadData: Data
        let payload: String
        if let manifestName = envelope.manifestFile {
            guard envelope.storageVersion == storageVersion,
                  let manifest = readManifestNamed(manifestName),
                  manifest.generation == envelope.generation, manifest.slot == envelope.slot,
                  manifest.resetEpoch == (envelope.resetEpoch ?? 0), manifest.saveRevision == (envelope.saveRevision ?? 0),
                  envelope.sha256 == manifest.sha256,
                  let reconstructed = try? materializeChunkedPayload(manifest),
                  let decoded = String(data: reconstructed, encoding: .utf8) else { return nil }
            payloadData = reconstructed
            payload = decoded
        } else if envelope.storageVersion == storageVersion {
            return nil
        } else if let name = envelope.payloadFile {
            guard let file = payloadURL(name), let raw = try? Data(contentsOf: file, options: .mappedIfSafe),
                  let decoded = String(data: raw, encoding: .utf8) else { return nil }
            payloadData = raw
            payload = decoded
        } else if let legacy = envelope.payload {
            payload = legacy
            payloadData = Data(legacy.utf8)
        } else { return nil }
        guard let validated = try? validatePayload(data: payloadData),
              (envelope.manifestFile != nil || validated.payloadSHA256 == envelope.sha256),
              validated.simSeconds == envelope.simSeconds,
              validated.saveRevision == (envelope.saveRevision ?? 0),
              validated.resetEpoch == (envelope.resetEpoch ?? 0) else { return nil }
        return Envelope(generation: envelope.generation, slot: envelope.slot, schemaVersion: envelope.schemaVersion,
            runtimeVersion: envelope.runtimeVersion, simSeconds: envelope.simSeconds, saveRevision: envelope.saveRevision,
            resetEpoch: envelope.resetEpoch, savedAt: envelope.savedAt, sha256: validated.payloadSHA256,
            storageVersion: envelope.storageVersion, manifestFile: envelope.manifestFile,
            payloadSHA256: validated.payloadSHA256,
            payload: payload, payloadFile: envelope.payloadFile)
    }

    private func cleanupUnreferencedStorageFiles() {
        let slotData = [url("A"), url("B")].compactMap { file -> Data? in
            guard let attrs = try? fm.attributesOfItem(atPath: file.path),
                  ((attrs[.size] as? NSNumber)?.int64Value ?? Int64.max) <= 16 * 1024,
                  let data = try? Data(contentsOf: file) else { return nil }
            return data
        }
        // Do not parse a legacy inline envelope during an ordinary save. Once both
        // A/B headers are compact, stale immutable payloads and sections are unreachable.
        guard slotData.count == 2 else { return }
        var referenced = Set<String>()
        for data in slotData {
            guard let row = try? JSONDecoder().decode(Envelope.self, from: data) else { return }
            if let payloadFile = row.payloadFile { referenced.insert(payloadFile) }
            if let manifestName = row.manifestFile {
                guard let manifest = readManifestNamed(manifestName) else { return }
                referenced.insert(manifestName)
                for chunk in manifest.sections.flatMap(\.chunks) { referenced.insert(chunk.file) }
            }
        }
        guard let files = try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return }
        for file in files where !referenced.contains(file.lastPathComponent) {
            let name = file.lastPathComponent
            if (name.hasPrefix("save-payload-") && file.pathExtension == "bin") ||
                (name.hasPrefix("save-manifest-") && file.pathExtension == "json") ||
                (name.hasPrefix("save-section-") && file.pathExtension == "bin") {
                try? fm.removeItem(at: file)
            }
        }
    }

    /// Browser envelopes are authenticated inside the same FIFO queue as the write.
    /// Large JSON/SHA work must not execute in WKScriptMessageHandler on the UI thread.
    private func validateBridgeEnvelope(_ payload: [String: Any], json: String, action: String) throws -> PayloadValidation {
        dispatchPrecondition(condition: .onQueue(queue))
        func integer(_ value: Any?) -> Double? {
            guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            let v = n.doubleValue
            return v.isFinite && v >= 0 && v <= 9_007_199_254_740_991 && v.rounded(.down) == v ? v : nil
        }
        guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
              payload["action"] as? String == action,
              payload["saveSchemaVersion"] as? String == schemaVersion,
              payload["saveJSON"] as? String == json,
              let hash = payload["saveHash"] as? String, hash.utf8.count == 64,
              hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              json.utf8.count <= 30 * 1024 * 1024,
              let data = json.data(using: .utf8),
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["saveVersion"] as? String == schemaVersion,
              let revision = integer(payload["saveRevision"]),
              let rootRevision = integer(root["saveRevision"]), revision == rootRevision,
              let epoch = integer(payload["resetEpoch"]),
              let rootEpoch = integer(root["resetEpoch"] ?? NSNumber(value: 0)), epoch == rootEpoch else { throw VaultError.message("Invalid save envelope.") }
        let validated = try validatePayloadRoot(root, data: data)
        guard Double(validated.saveRevision) == revision, validated.resetEpoch == epoch, validated.payloadSHA256 == hash else {
            throw VaultError.message("Invalid save envelope.")
        }
        return validated
    }

    private func validatePayload(_ json: String) throws -> PayloadValidation {
        guard let data = json.data(using: .utf8) else { throw VaultError.message("Save payload is not valid JSON.") }
        return try validatePayload(data: data)
    }

    private func validatePayload(data: Data) throws -> PayloadValidation {
        guard data.count <= 30 * 1024 * 1024,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw VaultError.message("Save payload is not valid JSON.")
        }
        return try validatePayloadRoot(root, data: data)
    }

    private func validatePayloadRoot(_ root: [String: Any], data: Data) throws -> PayloadValidation {
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
        return PayloadValidation(simSeconds: sim, saveRevision: revision, resetEpoch: reset, payloadSHA256: sha256(data), payloadData: data)
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private enum VaultError: LocalizedError {
        case message(String)
        var errorDescription: String? { switch self { case .message(let value): value } }
    }
}
