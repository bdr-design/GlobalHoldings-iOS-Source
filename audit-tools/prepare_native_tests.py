#!/usr/bin/env python3
"""Prepare tests against exact native source. UIKit behavior is not emulated as a device test."""
import argparse,json,re,hashlib
from pathlib import Path

def method(text,name):
    start=text.index('    private func '+name+'(')
    end=text.index('\n    }',start)+6
    return text[start:end].replace('private func','func',1)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
    a.output.mkdir(parents=True,exist_ok=True)
    controller=(a.source/'iOS/GlobalHoldings/GameViewController.swift').read_text()
    storage=(a.source/'iOS/GlobalHoldings/GlobalGameStorage.swift').read_text()
    vault=(a.source/'iOS/GlobalHoldings/GlobalSaveVault.swift').read_text()
    changed='validateBridgeEnvelope' in vault
    probes=method(controller,'payloadInteger')+'\n'
    probes+=(method(controller,'isTrustedGameDocument') if 'private func isTrustedGameDocument' in controller else '    func isTrustedGameDocument(_ url: URL?) -> Bool { return true } // baseline has no origin gate')+'\n'
    if not changed:probes+=method(controller,'validSaveEnvelope')+'\n'
    tail=controller[controller.index('    private func applyPendingNativeOperationsIfNeeded()'):]
    script=tail.split('let script = """',1)[1].split('"""',1)[0]
    (a.output/'update-script.swift-string.txt').write_text(script)
    (a.output/'source-checks.json').write_text(json.dumps({'moved_envelope_validation':changed,'handler_origin_gate': 'guard message.webView === webView, message.frameInfo.isMainFrame,' in controller,'raw_operations_forwarded': '"operationsJSON": operationsJSON,' in storage and 'operationsJSON: update.operationsJSON' in storage,'script_sha256':hashlib.sha256(script.encode()).hexdigest(),'swift_files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (a.source/'iOS/GlobalHoldings').glob('*.swift')}},indent=2)+'\n')
    commit='''vault.commitAsync(json, runtimeVersion: "3.0.0", envelope: envelope, completion: completion)''' if changed else '''if !probe.validSaveEnvelope(envelope, json: json) { completion(.failure(TestFailure(message:"Invalid envelope"))); return }
    vault.commitAsync(json, runtimeVersion: "3.0.0", completion: completion)'''
    save='vault.saveManualSlotAsync(index, json: json, label: "اختبار", runtimeVersion: "3.0.0", envelope: envelope, completion: completion)' if changed else '''if !probe.validSaveEnvelope(envelope, json: json) { completion(.failure(TestFailure(message:"Invalid envelope"))); return }
    vault.saveManualSlotAsync(index, json: json, label: "اختبار", runtimeVersion: "3.0.0", completion: completion)'''
    reset='vault.resetToAsync(json, runtimeVersion: "3.0.0", clearManualSlots: clear, envelope: envelope, completion: completion)' if changed else '''if !probe.validSaveEnvelope(envelope, json: json) { completion(.failure(TestFailure(message:"Invalid envelope"))); return }
    vault.resetToAsync(json, runtimeVersion: "3.0.0", clearManualSlots: clear, completion: completion)'''
    rawarg='operationsJSON: operationsJSON, ' if 'let operationsJSON: String' in storage.split('private struct UpdateFile')[0] else ''
    code='''import Foundation
import CoreFoundation
import CryptoKit
struct TestFailure: Error { let message: String }
final class ControllerProbe {
__PROBES__
}
let probe = ControllerProbe()
let fm=FileManager.default
let folder=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("GlobalHoldingsSaveVault")
// On an ephemeral CI runner only. Never delete a pre-existing save directory.
guard ProcessInfo.processInfo.environment["GH_NATIVE_AUDIT_EPHEMERAL"] == "1", !fm.fileExists(atPath:folder.path) else { fatalError("Fresh disposable test directory required") }
let vault=GlobalSaveVault.shared
var rows:[[String:Any]]=[]
func check(_ value:Bool,_ message:String) throws {if !value {throw TestFailure(message:message)}}
func test(_ name:String,_ body:() throws -> Void) {
    do {try body();rows.append(["name":name,"ok":true]);print("PASS: \\(name)")}
    catch {rows.append(["name":name,"ok":false,"error":String(describing:error)]);print("FAIL: \\(name): \\(error)")}
}
func wait<T>(_ body:(@escaping(Result<T,Error>)->Void)->Void) throws -> T {
    var result:Result<T,Error>?;body {result=$0}
    let deadline=Date().addingTimeInterval(60)
    while result == nil && Date()<deadline {RunLoop.current.run(until:Date().addingTimeInterval(0.002))}
    guard let result else {throw TestFailure(message:"Async completion timed out")}
    return try result.get()
}
func makeJSON(_ rev:Int,_ epoch:Int=0,extra:String="") throws -> String {
    let obj:[String:Any]=["saveVersion":"2.0.0","saveRevision":rev,"resetEpoch":epoch,"simSeconds":Double(rev)*60,"label":"العساف / 海 🚢","extra":extra]
    return String(data:try JSONSerialization.data(withJSONObject:obj,options:[.sortedKeys]),encoding:.utf8)!
}
func hash(_ json:String)->String {SHA256.hash(data:Data(json.utf8)).map{String(format:"%02x",$0)}.joined()}
func envelope(_ json:String,action:String="commitSave") throws->[String:Any] {
    let root=try JSONSerialization.jsonObject(with:Data(json.utf8)) as! [String:Any]
    return ["action":action,"requestId":UUID().uuidString,"saveSchemaVersion":"2.0.0","saveRevision":root["saveRevision"]!,"resetEpoch":root["resetEpoch"] ?? 0,"saveHash":hash(json),"saveJSON":json]
}
func commit(_ json:String,_ envelope:[String:Any],_ completion:@escaping(Result<Int,Error>)->Void) {
    __COMMIT__
}
func manual(_ index:Int,_ json:String,_ envelope:[String:Any],_ completion:@escaping(Result<GlobalSaveVault.ManualSlotMetadata,Error>)->Void) {
    __SAVE__
}
func reset(_ json:String,_ envelope:[String:Any],clear:Bool=false,_ completion:@escaping(Result<Int,Error>)->Void) {
    __RESET__
}
func diskDigest() throws -> [String:String] {
    if !fm.fileExists(atPath:folder.path) {return [:]}
    var out:[String:String]=[:]
    for f in try fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil) {
      let d=try Data(contentsOf:f);out[f.lastPathComponent]=SHA256.hash(data:d).map{String(format:"%02x",$0)}.joined()
    };return out
}
func reject(_ name:String, json:String, payload:[String:Any]) {
    test(name){let before=try diskDigest();var failed=false
      do {let _:Int=try wait {commit(json,payload,$0)}}catch{failed=true}
      try check(failed,"Invalid input was accepted");try check(try diskDigest()==before,"Invalid request changed persistent bytes")
    }
}
let first=try makeJSON(1)
test("real UTF8 save, hash, A/B readback") {let gen:Int=try wait {commit(first,try! envelope(first),$0)};try check(gen==1 && vault.currentSave()==first,"Native roundtrip mismatch")}
let next=try makeJSON(2)
var p=try envelope(next);p["saveHash"]=String(repeating:"0",count:64);reject("bad hash leaves disk unchanged",json:next,payload:p)
p=try envelope(next);p["saveRevision"]=999;reject("revision mismatch leaves disk unchanged",json:next,payload:p)
p=try envelope(next);p["resetEpoch"]=99;reject("epoch mismatch leaves disk unchanged",json:next,payload:p)
p=try envelope(next);p["requestId"]="";reject("empty request id",json:next,payload:p)
p=try envelope(next);p["requestId"]=String(repeating:"x",count:201);reject("oversized request id",json:next,payload:p)
p=try envelope(next);p["saveSchemaVersion"]="1.0.0";reject("wrong envelope schema",json:next,payload:p)
p=try envelope(next);p["saveJSON"]=first;reject("raw envelope belongs to different JSON",json:next,payload:p)
p=try envelope(next);p["action"]="resetGameSave";reject("cross-action envelope rejected by commit owner",json:next,payload:p)
let bo="{\\"saveVersion\\":\\"2.0.0\\",\\"saveRevision\\":true,\\"resetEpoch\\":0,\\"simSeconds\\":0}"
reject("boolean revision rejected",json:bo,payload:try envelope(bo))
let frac="{\\"saveVersion\\":\\"2.0.0\\",\\"saveRevision\\":2.5,\\"resetEpoch\\":0,\\"simSeconds\\":0}"
reject("fractional revision rejected",json:frac,payload:try envelope(frac))
var broken=try envelope(next);broken["saveJSON"]="{";broken["saveHash"]=hash("{")
reject("malformed JSON rejected",json:"{",payload:broken)
let huge=try makeJSON(2,extra:String(repeating:"x",count:30*1024*1024))
reject("30 MiB byte limit enforced",json:huge,payload:try envelope(huge))
// Reset test fixture after negative probes; baseline failures may legitimately have mutated it.
vault.reset()
test("FIFO saves and main completion queue") {
    var completions:[Int]=[];var failures:[String]=[]
    for i in 1...6 {let j=try makeJSON(i);commit(j,try envelope(j)){r in
      if !Thread.isMainThread{failures.append("callback not main")}
      switch r {case .success:completions.append(i);case .failure(let e):failures.append(String(describing:e))}
    }}
    let deadline=Date().addingTimeInterval(30)
    while completions.count+failures.count<6 && Date()<deadline {RunLoop.current.run(until:Date().addingTimeInterval(0.002))}
    try check(completions==Array(1...6) && failures.isEmpty,"FIFO completion mismatch")
    try check(vault.currentSave()==makeJSON(6),"Newest save lost")
}
let old=try makeJSON(2);reject("stale revision rejected",json:old,payload:try envelope(old))
test("manual save then load older revision with journal") {
    let slot=try makeJSON(4)
    let _:GlobalSaveVault.ManualSlotMetadata=try wait{manual(0,slot,try! envelope(slot,action:"saveManualSlot"),$0)}
    let gen:Int=try wait{vault.loadManualSlotAsync(0,runtimeVersion:"3.0.0",completion:$0)}
    try check(gen>0 && vault.currentSave()==slot,"Manual load failed")
    try check(!fm.fileExists(atPath:folder.appendingPathComponent("pending-reset.json").path),"Journal left pending")
}
test("invalid manual-slot envelope preserves disk") {
    let j=try makeJSON(7);var env=try envelope(j,action:"saveManualSlot");env["saveHash"]=String(repeating:"a",count:64)
    let before=try diskDigest();var failed=false
    do {let _:GlobalSaveVault.ManualSlotMetadata=try wait{manual(1,j,env,$0)}}catch{failed=true}
    try check(failed && diskDigest()==before,"Invalid manual save mutated disk")
}
test("native pinned rollback survives A/B rotations") {
    let gen=vault.currentGeneration();let saved=vault.currentSave()
    try vault.pinRollbackCheckpoint(generation:gen,runtimeVersion:"3.0.0")
    for i in 10...13 {_ = try vault.commit(makeJSON(i),runtimeVersion:"3.0.0")}
    _ = try vault.restoreRollbackCheckpoint(expectedRuntimeVersion:"3.0.0")
    try check(vault.currentSave()==saved,"Pinned rollback did not restore bytes")
}
test("reset updates both slots, clears manual slots, no resurrection") {
    let clean=try makeJSON(1,100)
    let _:Int=try wait{reset(clean,try! envelope(clean,action:"resetGameSave"),clear:true,$0)}
    try check(vault.currentSave()==clean && vault.manualSlotMetadata().isEmpty,"Reset content/slots wrong")
    for slot in ["A","B"] {
      let file=folder.appendingPathComponent("save-\\(slot).json")
      let obj=try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as! [String:Any]
      try check(obj["payload"] as? String==clean,"Pre-reset slot survived")
    }
}
let staleEpoch=try makeJSON(100,99);reject("pre-reset epoch cannot resurrect",json:staleEpoch,payload:try envelope(staleEpoch))
test("corrupt newest A/B slot falls back to verified peer") {
    let stable=vault.currentSave();let gen=vault.currentGeneration()
    let files=try fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil).filter{$0.lastPathComponent=="save-A.json" || $0.lastPathComponent=="save-B.json"}
    for file in files {let obj=try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as! [String:Any]
      if (obj["generation"] as? Int)==gen {try Data("broken".utf8).write(to:file)}
    }
    try check(vault.currentSave()==stable && vault.currentGeneration()<gen,"Corrupt slot selected")
}
for (name,value,expected) in [("slot integer",NSNumber(value:2) as Any,Optional(2)),("slot fraction",NSNumber(value:1.9) as Any,nil),("slot bool",NSNumber(value:true) as Any,nil),("slot NaN",NSNumber(value:Double.nan) as Any,nil),("slot over-safe-int",NSNumber(value:9_007_199_254_740_992.0) as Any,nil),("legacy integer string","2" as Any,Optional(2))] {
    test(name){try check(probe.payloadInteger(value)==expected,"Coerced invalid integer")}
}
for (url,expected) in [("gh://app/index.html",true),("gh://app/index.html?v=334",true),("https://app/index.html",false),("gh://other/index.html",false),("gh://user@app/index.html",false),("gh://app:123/index.html",false),("file:///index.html",false),("about:blank",false)] {
    test("document URL "+url){try check(probe.isTrustedGameDocument(URL(string:url))==expected,"Untrusted URL accepted")}
}
// Fixture emitted by real AppliedUpdate. Signing is NOT mocked as trusted.
let operationsJSON="[\\n {\\"type\\":\\"content-config\\",\\"label\\":\\"العساف / 海 🚢\\"}\\n]"
let operations=try JSONSerialization.jsonObject(with:Data(operationsJSON.utf8)) as! [[String:Any]]
let manifest:[String:Any]=["id":"native-n1-fixture","version":"3.0.0","build":334,"signaturePayloadVersion":3,"packageType":"full-web","installMode":"clean-snapshot-v1","operationsSha256":hash(operationsJSON)]
let applied=GlobalGameStorage.AppliedUpdate(version:"3.0.0",build:334,manifest:manifest,operations:operations,__RAWARG__replacedWebFiles:true)
try JSONSerialization.data(withJSONObject:applied.webPayload,options:[.sortedKeys]).write(to:URL(fileURLWithPath:"native-web-payload.json"))
test("AppliedUpdate preserves exact operationsJSON and no mirror"){
    try check(applied.webPayload["operationsJSON"] as? String==operationsJSON,"Signed text missing or changed")
    try check(applied.webPayload["operations"]==nil,"Forbidden operations mirror present")
}
// Baseline validation runs in main-thread probe; candidate uses real vault queue.
vault.reset()
let perf=try makeJSON(1,extra:String(repeating:"x",count:14_000_000)),perfEnvelope=try envelope(perf)
let begin=DispatchTime.now().uptimeNanoseconds
var perfDone=false;var perfSuccess=false
commit(perf,perfEnvelope){r in perfSuccess=(try? r.get()) != nil;perfDone=true}
let dispatchMS=Double(DispatchTime.now().uptimeNanoseconds-begin)/1e6
let deadline=Date().addingTimeInterval(60)
while !perfDone && Date()<deadline {RunLoop.current.run(until:Date().addingTimeInterval(0.002))}
let totalMS=Double(DispatchTime.now().uptimeNanoseconds-begin)/1e6
let performance:[String:Any]=["bytes":perf.utf8.count,"handler_validation_and_enqueue_ms":dispatchMS,"completed_ms":totalMS,"success":perfSuccess,"single_sample":true,"iphone_measurement":false,"includes_bootstrap_refresh":false]
try JSONSerialization.data(withJSONObject:performance,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"save-enqueue-measurement.json"))
vault.reset()
let failed=rows.filter{($0["ok"] as? Bool) != true}.count
let report:[String:Any]=["total":rows.count,"passed":rows.count-failed,"failed":failed,"cases":rows,"native_foundation_real_file_io":true,"device_test":false,"scope":"Vault compiled unmodified except candidate fixes. Controller pure helpers extracted; no live WKWebView." ]
try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"native-tests.json"))
print("NATIVE_TESTS \\(rows.count-failed)/\\(rows.count)")
exit(failed==0 ? 0:1)
'''
    code=code.replace('__PROBES__',probes).replace('__COMMIT__',commit).replace('__SAVE__',save).replace('__RESET__',reset).replace('__RAWARG__',rawarg)
    (a.output/'main.swift').write_text(code)
if __name__=='__main__': main()
