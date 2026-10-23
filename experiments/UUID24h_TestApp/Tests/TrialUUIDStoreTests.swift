import Foundation

let suite = "TrialUUID.TestSuite.\(UUID().uuidString)"
guard let defaults = UserDefaults(suiteName: suite) else {
    fatalError("Could not create test defaults")
}
defer { defaults.removePersistentDomain(forName: suite) }

let store = TrialUUIDStore(defaults: defaults, key: "trial")
let start = Date(timeIntervalSince1970: 1_800_000_000)
let first = store.generateIfExpired(now: start)
assert(first.isValid(at: start))
assert(first.remainingSeconds(at: start) == 86400)
assert(store.load() == first)
assert(store.generateIfExpired(now: start.addingTimeInterval(3600)) == first)
assert(first.isValid(at: start.addingTimeInterval(86399)))
assert(!first.isValid(at: start.addingTimeInterval(86400)))
assert(first.remainingSeconds(at: start.addingTimeInterval(86400)) == 0)
let second = store.generateIfExpired(now: start.addingTimeInterval(86400))
assert(second.value != first.value)
assert(second.isValid(at: start.addingTimeInterval(86400)))
assert(second.expiresAt == start.addingTimeInterval(2 * 86400))
print("PASS: UUID generation, persistence, 24-hour expiry, renewal")
