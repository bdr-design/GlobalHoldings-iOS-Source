import Foundation
import CoreFoundation
import CryptoKit

/// Bounded transport staging only. No save becomes durable here: assembled
/// bytes must still pass the unchanged GlobalSaveVault envelope + A/B commit.
/// Call only from the controller's serial native-stream queue.
final class GlobalSaveStream {
    enum Reply {
        case accepted(index: Int?)
        case ready(json: String, envelope: [String: Any])
    }
    enum StreamError: LocalizedError {
        case invalid(String)
        var errorDescription: String? { switch self { case .invalid(let reason): return reason } }
    }
    private final class Session {
        let id: String
        let ordinal: Int
        let revision: Int
        let epoch: Int
        var data = Data()
        var hash = SHA256()
        var digests: [String] = []
        var lastAt: TimeInterval
        init(id: String, ordinal: Int, revision: Int, epoch: Int, now: TimeInterval) {
            self.id = id; self.ordinal = ordinal; self.revision = revision; self.epoch = epoch; self.lastAt = now
        }
    }
    private var active: Session?
    private var currentDocument: UInt = 0
    private var lastOrdinal = 0
    static let maximumBytes = 30 * 1024 * 1024
    static let maximumChunkBytes = 128 * 1024
    static let maximumChunks = 32768
    private func number(_ value: Any?, maximum: Int = 9_007_199_254_740_991) -> Int? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let x = n.doubleValue
        guard x.isFinite, x >= 0, x <= Double(maximum), x.rounded(.down) == x else { return nil }
        return Int(x)
    }
    private func digest(_ value: Data) -> String { SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined() }
    func invalidate(document: UInt) {
        guard document >= currentDocument else { return }
        active = nil; currentDocument = document; lastOrdinal = 0
    }
    func receive(_ packet: [String: Any], document: UInt, now: TimeInterval) throws -> Reply {
        guard document >= currentDocument else { throw StreamError.invalid("save-stream-stale-document") }
        if document > currentDocument { invalidate(document: document) }
        if let session = active, now - session.lastAt > 60 { active = nil }
        guard number(packet["protocolVersion"], maximum: 1) == 1,
              let action = packet["action"] as? String,
              let id = packet["streamId"] as? String, !id.isEmpty, id.utf8.count <= 160,
              id.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,46,95].contains($0) }),
              let requestId = packet["requestId"] as? String, !requestId.isEmpty, requestId.utf8.count <= 200,
              packet["saveSchemaVersion"] as? String == "2.0.0",
              let revision = number(packet["saveRevision"]), let epoch = number(packet["resetEpoch"]),
              let ordinal = number(packet["streamOrdinal"]), ordinal > 0 else {
            throw StreamError.invalid("save-stream-invalid-envelope")
        }
        if action == "saveStreamBegin" {
            if let session = active {
                guard session.id == id, session.ordinal == ordinal, session.revision == revision, session.epoch == epoch else { throw StreamError.invalid("save-stream-busy") }
                session.lastAt = now
                return .accepted(index: nil)
            }
            guard ordinal > lastOrdinal else { throw StreamError.invalid("save-stream-replayed-begin") }
            lastOrdinal = ordinal; active = Session(id: id, ordinal: ordinal, revision: revision, epoch: epoch, now: now)
            return .accepted(index: nil)
        }
        guard let session = active, session.id == id, session.ordinal == ordinal,
              session.revision == revision, session.epoch == epoch else { throw StreamError.invalid("save-stream-session-mismatch") }
        if action == "saveStreamAbort" { active = nil; return .accepted(index: nil) }
        do {
            if action == "saveStreamChunk" {
                guard let index = number(packet["index"], maximum: Self.maximumChunks - 1),
                      let text = packet["text"] as? String, !text.isEmpty,
                      let bytes = text.data(using: .utf8), bytes.count <= Self.maximumChunkBytes else { throw StreamError.invalid("save-stream-invalid-chunk") }
                let fingerprint = digest(bytes)
                if index < session.digests.count {
                    guard session.digests[index] == fingerprint else { throw StreamError.invalid("save-stream-conflicting-packet") }
                    session.lastAt = now; return .accepted(index: index)
                }
                guard index == session.digests.count, session.data.count + bytes.count <= Self.maximumBytes else { throw StreamError.invalid("save-stream-order-or-size") }
                session.data.append(bytes); session.hash.update(data: bytes); session.digests.append(fingerprint); session.lastAt = now
                return .accepted(index: index)
            }
            if action == "saveStreamCommit" {
                guard let chunks = number(packet["chunks"], maximum: Self.maximumChunks), chunks > 0, chunks == session.digests.count,
                      let byteCount = number(packet["utf8Bytes"], maximum: Self.maximumBytes), byteCount == session.data.count,
                      let json = String(data: session.data, encoding: .utf8) else { throw StreamError.invalid("save-stream-final-digest-mismatch") }
                let hash = session.hash.finalize().map({ String(format: "%02x", $0) }).joined()
                if let supplied = packet["saveHash"] as? String, supplied != hash {
                    throw StreamError.invalid("save-stream-final-digest-mismatch")
                }
                var envelope = packet
                envelope["action"] = "commitSave"; envelope["saveJSON"] = json; envelope["saveHash"] = hash
                active = nil
                return .ready(json: json, envelope: envelope)
            }
            throw StreamError.invalid("save-stream-unknown-action")
        } catch {
            // Conflicting, incomplete or malformed packets can never be resumed
            // into a committed save. A new ordinal is required after rejection.
            active = nil
            throw error
        }
    }
}
