import Foundation

/// App-local experimental UUID, valid for 24 hours.
/// Does not affect UDID, IDFV, or identifiers of other apps.
struct TrialUUIDRecord: Codable, Equatable {
    let value: UUID
    let createdAt: Date
    let expiresAt: Date

    func isValid(at date: Date = Date()) -> Bool {
        date >= createdAt && date < expiresAt
    }

    func remainingSeconds(at date: Date = Date()) -> Int {
        max(0, Int(ceil(expiresAt.timeIntervalSince(date))))
    }
}

final class TrialUUIDStore {
    private let defaults: UserDefaults
    private let key: String
    private let validity: TimeInterval = 24 * 60 * 60

    init(defaults: UserDefaults = .standard, key: String = "TrialUUID.Record.v1") {
        self.defaults = defaults
        self.key = key
    }

    func load() -> TrialUUIDRecord? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(TrialUUIDRecord.self, from: data)
    }

    /// Keeps the current UUID for its full 24-hour validity.
    /// Generates a new one on first use or after expiry by explicit button press.
    @discardableResult
    func generateIfExpired(now: Date = Date()) -> TrialUUIDRecord {
        if let existing = load(), existing.isValid(at: now) { return existing }
        let next = TrialUUIDRecord(
            value: UUID(),
            createdAt: now,
            expiresAt: now.addingTimeInterval(validity)
        )
        guard let data = try? JSONEncoder().encode(next) else {
            assertionFailure("Failed to encode trial UUID")
            return next
        }
        defaults.set(data, forKey: key)
        return next
    }
}
