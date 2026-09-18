#!/usr/bin/env python3
"""Execute the production GlobalSaveVault manual-slot paths on macOS Foundation/CryptoKit."""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
VAULT = ROOT / "iOS" / "GlobalHoldings" / "GlobalSaveVault.swift"

HARNESS = r'''
import Foundation

enum HarnessError: Error {
    case failed(String)
}

func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw HarnessError.failed(message) }
}

func awaitResult<T>(_ timeout: TimeInterval = 15, _ launch: (@escaping (Result<T, Error>) -> Void) -> Void) throws -> T {
    var outcome: Result<T, Error>?
    launch { result in outcome = result }
    let deadline = Date().addingTimeInterval(timeout)
    while outcome == nil && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.01))
    }
    guard let outcome else { throw HarnessError.failed("Timed out waiting for async vault completion") }
    return try outcome.get()
}

func payload(revision: Int, epoch: Int, sim: Double, noteBytes: Int = 0) throws -> String {
    let root: [String: Any] = [
        "saveVersion": "2.0.0",
        "saveRevision": revision,
        "resetEpoch": epoch,
        "simSeconds": sim,
        "notes": String(repeating: "x", count: noteBytes)
    ]
    let data = try JSONSerialization.data(withJSONObject: root, options: [])
    guard let text = String(data: data, encoding: .utf8) else { throw HarnessError.failed("UTF-8 encoding failed") }
    return text
}

func revision(_ json: String) throws -> Int {
    let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
    return (object["saveRevision"] as! NSNumber).intValue
}

let vault = GlobalSaveVault.shared
vault.reset()
defer { vault.reset() }

let large = try payload(revision: 7, epoch: 1, sim: 86_400, noteBytes: 5 * 1024 * 1024)
try check(Data(large.utf8).count > 4 * 1024 * 1024, "large slot fixture must exceed 4 MB")
let meta: GlobalSaveVault.ManualSlotMetadata = try awaitResult { done in
    vault.saveManualSlotAsync(0, json: large, label: "large-native-slot", runtimeVersion: "3.0.0", completion: done)
}
try check(meta.index == 0 && meta.saveRevision == 7, "manual slot metadata mismatch")
try check(vault.manualSlotMetadata().count == 1, "manual slot must be readable after atomic write")

let current = try payload(revision: 20, epoch: 1, sim: 172_800)
let currentGeneration: Int = try awaitResult { done in
    vault.commitAsync(current, runtimeVersion: "3.0.0", completion: done)
}
let loadedGeneration: Int = try awaitResult { done in
    vault.loadManualSlotAsync(0, runtimeVersion: "3.0.0", completion: done)
}
try check(loadedGeneration > currentGeneration, "manual slot load must promote a fresh native generation")
guard let restored = vault.currentSave() else { throw HarnessError.failed("manual slot load produced no current save") }
let restoredRevision = try revision(restored)
try check(restoredRevision == 7, "manual slot load did not restore the selected payload")

let _: Void = try awaitResult { done in vault.clearManualSlotAsync(0, completion: done) }
try check(vault.manualSlotMetadata().isEmpty, "manual slot clear must remove the slot")

let slotA = try payload(revision: 8, epoch: 1, sim: 200_000)
let slotB = try payload(revision: 9, epoch: 1, sim: 210_000)
let _: GlobalSaveVault.ManualSlotMetadata = try awaitResult { done in vault.saveManualSlotAsync(0, json: slotA, label: "A", runtimeVersion: "3.0.0", completion: done) }
let _: GlobalSaveVault.ManualSlotMetadata = try awaitResult { done in vault.saveManualSlotAsync(1, json: slotB, label: "B", runtimeVersion: "3.0.0", completion: done) }
try check(vault.manualSlotMetadata().count == 2, "two manual slots should exist before New Game reset")
let clean = try payload(revision: 1, epoch: 2, sim: 0)
let _: Int = try awaitResult { done in
    vault.resetToAsync(clean, runtimeVersion: "3.0.0", clearManualSlots: true, completion: done)
}
try check(vault.manualSlotMetadata().isEmpty, "New Game reset must clear all manual slots atomically")

let rev20 = try payload(revision: 20, epoch: 2, sim: 10)
let _: Int = try awaitResult { done in vault.commitAsync(rev20, runtimeVersion: "3.0.0", completion: done) }
let bootstrap20 = vault.bootstrapJavaScript(force: false)
let rev21 = try payload(revision: 21, epoch: 2, sim: 20)
let _: Int = try awaitResult { done in vault.commitAsync(rev21, runtimeVersion: "3.0.0", completion: done) }
let bootstrap21 = vault.bootstrapJavaScript(force: false)
try check(bootstrap20 != bootstrap21, "bootstrap must change after a newer native commit")
try check(bootstrap21.contains("saveRevision:21"), "fresh bootstrap must advertise the latest save revision")

print("BUILD315 Native Save Vault manual slots: PASS (>4MB, load promotion, clear, New Game clear, bootstrap freshness)")
'''

with tempfile.TemporaryDirectory(prefix="gh315-native-slots-") as d:
    temp = Path(d)
    main = temp / "main.swift"
    exe = temp / "native-save-slots"
    main.write_text(HARNESS, encoding="utf-8")
    env = dict(os.environ)
    env["HOME"] = str(temp / "home")
    Path(env["HOME"]).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["xcrun", "swiftc", str(VAULT), str(main), "-o", str(exe)],
        cwd=ROOT,
        env=env,
        check=True,
    )
    subprocess.run([str(exe)], cwd=ROOT, env=env, check=True)
