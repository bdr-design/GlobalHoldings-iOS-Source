#!/usr/bin/env python3
"""Execute the production Swift inventory/containment methods on macOS Foundation."""
from pathlib import Path
import subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
source=(ROOT/'iOS/GlobalHoldings/GlobalGameStorage.swift').read_text()
def method(name):
    start=source.index('    private func '+name+'(')
    brace=source.index('{',start);depth=1;i=brace+1
    while depth:
        if source[i]=='{':depth+=1
        elif source[i]=='}':depth-=1
        i+=1
    return source[start:i]
code='''import Foundation
final class InventoryHarness {
    private let fileManager = FileManager.default
    enum UpdateError: Error { case message(String) }
'''+ '\n'.join(method(n) for n in ['runtimeFilePaths','safeRelativePath','isSafePath'])+'''
    func inventory(_ url: URL) throws -> Set<String> { try runtimeFilePaths(at: url) }
    func relative(_ child: URL, _ folder: URL) -> String? { safeRelativePath(of: child, inside: folder) }
}
func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw NSError(domain: message, code: 1) }
}
let fm = FileManager.default
let temp = fm.temporaryDirectory.appendingPathComponent("gh312-" + UUID().uuidString, isDirectory: true)
try fm.createDirectory(at: temp, withIntermediateDirectories: true)
defer { try? fm.removeItem(at: temp) }
let canonical = temp.appendingPathComponent("canonical-runtime-directory", isDirectory: true)
let alias = temp.appendingPathComponent("alias", isDirectory: true)
try fm.createDirectory(at: canonical.appendingPathComponent("assets/images"), withIntermediateDirectories: true)
try Data("index".utf8).write(to: canonical.appendingPathComponent("index.html"))
try Data("image".utf8).write(to: canonical.appendingPathComponent("assets/images/road.png"))
try fm.createSymbolicLink(at: alias, withDestinationURL: canonical)
let h = InventoryHarness(), expected: Set<String> = ["index.html", "assets/images/road.png"]
let canonicalChild = canonical.appendingPathComponent("index.html").resolvingSymlinksInPath().standardizedFileURL
let legacy = String(canonicalChild.path.dropFirst(alias.path.count + 1))
try check(legacy != "index.html", "legacy raw path slicing must reproduce the alias mismatch")
try check(h.relative(canonicalChild, alias) == "index.html", "canonical child with aliased root")
try check(try h.inventory(alias) == expected, "aliased inventory")
try check(try h.inventory(canonical) == expected, "canonical inventory")
try check(try h.inventory(URL(fileURLWithPath: alias.path + "/")) == expected, "trailing slash inventory")
let outside = temp.appendingPathComponent("index.html")
try Data("outside".utf8).write(to: outside)
try check(h.relative(outside, alias) == nil, "outside file must remain rejected")
try Data("extra".utf8).write(to: canonical.appendingPathComponent(".unexpected"))
let extras = try h.inventory(alias).subtracting(expected)
try check(extras == [".unexpected"], "hidden orphan must not be ignored")
try fm.removeItem(at: canonical.appendingPathComponent(".unexpected"))
try fm.removeItem(at: canonical.appendingPathComponent("index.html"))
let missing = expected.subtracting(try h.inventory(alias))
try check(missing == ["index.html"], "missing runtime file")
try Data("index".utf8).write(to: canonical.appendingPathComponent("index.html"))
let link = canonical.appendingPathComponent("injected-link")
try fm.createSymbolicLink(at: link, withDestinationURL: outside)
var rejectedLink = false
do { _ = try h.inventory(alias) } catch { rejectedLink = true }
try check(rejectedLink, "in-runtime symlink must remain rejected")
try fm.removeItem(at: link)
let sourceRoot = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: sourceRoot.appendingPathComponent("runtime-required.json"))) as! [String: Any]
let required = Set(manifest["files"] as! [String])
try check(try h.inventory(sourceRoot) == required, "complete source runtime exact inventory")
print("BUILD312 Foundation runtime inventory: PASS (legacy mismatch reproduced; aliases, nested paths, trailing slash, containment, hidden orphan, missing file, symlink rejection, full runtime)")
'''
# A throwing autoclosure permits the same concise assertions for filesystem calls.
code=code.replace('@autoclosure () -> Bool','@autoclosure () throws -> Bool').replace('if !condition()','if try !condition()')
with tempfile.TemporaryDirectory(prefix='gh312-swift-') as d:
    swift=Path(d)/'main.swift';swift.write_text(code)
    subprocess.run(['swift',str(swift),str(ROOT/'WebApp')],check=True)
