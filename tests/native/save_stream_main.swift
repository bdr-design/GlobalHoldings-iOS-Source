import Foundation
import CryptoKit

var passed = 0
func require(_ condition: @autoclosure () -> Bool, _ label: String) {
    guard condition() else { fatalError(label) }
}
func hash(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
func packet(_ action: String, ordinal: Int = 1, extra: [String: Any] = [:]) -> [String: Any] {
    var value: [String: Any] = ["action": action, "protocolVersion": 1, "streamId": "S-\(ordinal)", "streamOrdinal": ordinal, "requestId": "REQ-\(action)", "saveRevision": 5, "resetEpoch": 2, "saveSchemaVersion": "2.0.0"]
    value.merge(extra) { _, new in new }; return value
}
func accept(_ stream: GlobalSaveStream, _ p: [String: Any], document: UInt = 1, now: Double = 0) throws {
    switch try stream.receive(p, document: document, now: now) {
    case .accepted: return
    case .ready: fatalError("staging ACK must never publish a save")
    }
}
func rejected(_ stream: GlobalSaveStream, _ p: [String: Any], document: UInt = 1, now: Double = 0, label: String) {
    do { _ = try stream.receive(p, document: document, now: now); fatalError("accepted invalid \(label)") }
    catch { passed += 1; print("PASS \(label): \(error.localizedDescription)") }
}
let json = "{\"saveVersion\":\"2.0.0\",\"saveRevision\":5,\"resetEpoch\":2,\"text\":\"عربي🌍\"}"
func final(_ ordinal: Int = 1, _ text: String = json, _ count: Int = 2) -> [String: Any] { packet("saveStreamCommit", ordinal: ordinal, extra: ["saveHash": hash(text), "chunks": count, "utf8Bytes": text.utf8.count]) }
func begin(_ stream: GlobalSaveStream, ordinal: Int = 1) throws { try accept(stream, packet("saveStreamBegin", ordinal: ordinal)) }
func chunk(_ index: Int, _ text: String, ordinal: Int = 1) -> [String: Any] { packet("saveStreamChunk", ordinal: ordinal, extra: ["index": index, "text": text]) }

do {
    let stream = GlobalSaveStream(); try begin(stream); try begin(stream)
    let cut = json.index(json.startIndex, offsetBy: 30), a = String(json[..<cut]), b = String(json[cut...])
    try accept(stream, chunk(0, a)); try accept(stream, chunk(0, a)); try accept(stream, chunk(1, b))
    switch try stream.receive(final(), document: 1, now: 1) {
    case .ready(let text, let envelope):
        require(text == json, "exact UTF8 JSON"); require(envelope["action"] as? String == "commitSave", "reuse existing durable authority")
        require(envelope["saveJSON"] as? String == json, "envelope byte binding"); passed += 1
    case .accepted: fatalError("complete save not assembled")
    }
    rejected(stream, final(), label: "duplicate final cannot re-publish")
    rejected(stream, packet("saveStreamBegin"), label: "closed ordinal cannot restart")
    try begin(stream, ordinal: 2); try accept(stream, packet("saveStreamAbort", ordinal: 2));
    rejected(stream, chunk(0, json, ordinal: 2), label: "aborted stream cannot receive data")
}
for (label, mutation) in [
    ("boolean revision", ["saveRevision": true] as [String: Any]),
    ("negative epoch", ["resetEpoch": -1]),
    ("fractional revision", ["saveRevision": 1.5]),
    ("unsafe integer", ["saveRevision": 9_007_199_254_740_992.0]),
    ("schema mismatch", ["saveSchemaVersion": "3.0.0"]),
    ("protocol mismatch", ["protocolVersion": 2]),
    ("invalid stream name", ["streamId": "../other"])
] {
    let stream = GlobalSaveStream(); rejected(stream, packet("saveStreamBegin", extra: mutation), label: label)
}
do {
    let stream = GlobalSaveStream(); try begin(stream)
    rejected(stream, packet("saveStreamBegin", ordinal: 2), label: "concurrent begin cannot replace active session")
    try accept(stream, chunk(0, "a")); rejected(stream, chunk(0, "b"), label: "conflicting duplicate aborts session")
    rejected(stream, chunk(1, "c"), label: "poisoned session cannot resume")
}
do { let s = GlobalSaveStream(); try begin(s); rejected(s, chunk(1, "a"), label: "out of order packet") }
do { let s = GlobalSaveStream(); try begin(s); rejected(s, chunk(0, String(repeating: "a", count: GlobalSaveStream.maximumChunkBytes + 1)), label: "packet byte cap") }
do { let s = GlobalSaveStream(); try begin(s); rejected(s, final(), label: "incomplete final") }
do { let s = GlobalSaveStream(); try begin(s); try accept(s, chunk(0, json)); rejected(s, final(1, json + "x", 1), label: "final hash and byte mismatch") }
do { let s = GlobalSaveStream(); try begin(s); rejected(s, chunk(0, "a"), now: 61, label: "expired staging cannot commit") }
do {
    let s = GlobalSaveStream(); try begin(s); try accept(s, chunk(0, "a")); s.invalidate(document: 2)
    rejected(s, chunk(1, "b"), document: 1, label: "old document packet rejected after navigation")
    try accept(s, packet("saveStreamBegin"), document: 2); try accept(s, chunk(0, json), document: 2)
    switch try s.receive(final(1, json, 1), document: 2, now: 1) { case .ready(let text, _): require(text == json, "new document owns clean session"); passed += 1; case .accepted: fatalError("no new document result") }
}
do {
    let s = GlobalSaveStream(); try begin(s); let text = String(repeating: "x", count: GlobalSaveStream.maximumChunkBytes)
    for index in 0..<(GlobalSaveStream.maximumBytes / GlobalSaveStream.maximumChunkBytes) { try accept(s, chunk(index, text)) }
    rejected(s, chunk(GlobalSaveStream.maximumBytes / GlobalSaveStream.maximumChunkBytes, "x"), label: "total byte cap cannot be exceeded")
}
require(passed == 22, "expected all 22 checks, got \(passed)")
print("BUILD346_NATIVE_STREAM \(passed)/22 PASS; actual Swift CryptoKit assembler; not physical-device validation")
