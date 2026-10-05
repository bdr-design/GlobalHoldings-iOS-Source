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
    # Capture exactly the JavaScript executed by the native controller, not an independent reimplementation.
    tail=controller[controller.index('    private func applyPendingNativeOperationsIfNeeded()'):]
    script=tail.split('let script = """',1)[1].split('"""',1)[0]
    (a.output/'update-script.swift-string.txt').write_text(script)
    origin_gate=all(token in controller for token in (
        'message.webView === webView',
        'message.frameInfo.isMainFrame',
        'isTrustedGameDocument(message.frameInfo.request.url)',
        'url.scheme?.lowercased() == "gh"',
        'url.host?.lowercased() == "app"',
        'url.user == nil && url.password == nil && url.port == nil'
    ))
    (a.output/'source-checks.json').write_text(json.dumps({'moved_envelope_validation':changed,'handler_origin_gate':origin_gate,'raw_operations_forwarded': '"operationsJSON": operationsJSON,' in storage and 'operationsJSON: update.operationsJSON' in storage,'script_sha256':hashlib.sha256(script.encode()).hexdigest(),'swift_files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (a.source/'iOS/GlobalHoldings').glob('*.swift')}},indent=2)+'\n')
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
func makeJSON(_ rev:Int,_ epoch:Int=0,extra:String="",saveVersion:String="2.0.0") throws -> String {
    let obj:[String:Any]=["saveVersion":saveVersion,"saveRevision":rev,"resetEpoch":epoch,"simSeconds":Double(rev)*60,"label":"العساف / 海 🚢","extra":extra]
    return String(data:try JSONSerialization.data(withJSONObject:obj,options:[.sortedKeys]),encoding:.utf8)!
}
func hash(_ json:String)->String {SHA256.hash(data:Data(json.utf8)).map{String(format:"%02x",$0)}.joined()}
func envelope(_ json:String,action:String="commitSave") throws->[String:Any] {
    let root=try JSONSerialization.jsonObject(with:Data(json.utf8)) as! [String:Any]
    return ["action":action,"requestId":UUID().uuidString,"saveSchemaVersion":root["saveVersion"]!,"saveRevision":root["saveRevision"]!,"resetEpoch":root["resetEpoch"] ?? 0,"saveHash":hash(json),"saveJSON":json]
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
let currentSchema=try makeJSON(2,saveVersion:"3.0.0")
test("Save Schema 3 uses the current JSON vault path") {let gen:Int=try wait {commit(currentSchema,try! envelope(currentSchema),$0)};try check(gen==2 && vault.currentSave()==currentSchema,"Save Schema 3 native roundtrip mismatch")}
let next=try makeJSON(2)
var p=try envelope(next);p["saveHash"]=String(repeating:"0",count:64);reject("bad hash leaves disk unchanged",json:next,payload:p)
p=try envelope(next);p["saveRevision"]=999;reject("revision mismatch leaves disk unchanged",json:next,payload:p)
p=try envelope(next);p["resetEpoch"]=99;reject("epoch mismatch leaves disk unchanged",json:next,payload:p)
p=try envelope(next);p["requestId"]="";reject("empty request id",json:next,payload:p)
p=try envelope(next);p["requestId"]=String(repeating:"x",count:201);reject("oversized request id",json:next,payload:p)
p=try envelope(next);p["saveSchemaVersion"]="1.0.0";reject("wrong envelope schema",json:next,payload:p)
p=try envelope(next);p["saveSchemaVersion"]="3.0.0";reject("payload schema must match JSON root",json:next,payload:p)
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
let future=try makeJSON(3,saveVersion:"4.0.0");reject("unsupported future save schema",json:future,payload:try envelope(future))
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
// Fixture is emitted by the real AppliedUpdate type compiled above. Signing is NOT mocked as trusted.
let operationsJSON="[\\n {\\"type\\":\\"content-config\\",\\"label\\":\\"العساف / 海 🚢\\"}\\n]"
let operations=try JSONSerialization.jsonObject(with:Data(operationsJSON.utf8)) as! [[String:Any]]
let manifest:[String:Any]=["id":"native-n1-fixture","version":"3.0.0","build":335,"signaturePayloadVersion":3,"packageType":"full-web","installMode":"clean-snapshot-v1","operationsSha256":hash(operationsJSON)]
let applied=GlobalGameStorage.AppliedUpdate(version:"3.0.0",build:335,manifest:manifest,operations:operations,__RAWARG__replacedWebFiles:true)
try JSONSerialization.data(withJSONObject:applied.webPayload,options:[.sortedKeys]).write(to:URL(fileURLWithPath:"native-web-payload.json"))
test("AppliedUpdate preserves exact operationsJSON and no mirror"){
    try check(applied.webPayload["operationsJSON"] as? String==operationsJSON,"Signed text missing or changed")
    try check(applied.webPayload["operations"]==nil,"Forbidden operations mirror present")
}
// Build 358 (million-asset save): chunked fleet records in the native vault.
do {
vault.reset()
let chunkFolder=folder.appendingPathComponent("chunks",isDirectory:true)
func chunkFiles()->Set<String>{Set(((try? fm.contentsOfDirectory(atPath:chunkFolder.path)) ?? []).filter{$0.hasSuffix(".chunk")})}
func hex(_ d:Data)->String{SHA256.hash(data:d).map{String(format:"%02x",$0)}.joined()}
func chunkJSON(_ rev:Int,_ ids:[String]) throws -> String {
    let rows:[String:Any]=["$ghBinary":"chunks-v1","byteLength":ids.count*8,"chunkBytes":8,"chunks":ids]
    let obj:[String:Any]=["saveVersion":"3.0.0","saveRevision":rev,"resetEpoch":0,"simSeconds":Double(rev)*60,"fleet":["rows":rows]]
    return String(data:try JSONSerialization.data(withJSONObject:obj,options:[.sortedKeys]),encoding:.utf8)!
}
let chunkA=Data((0..<4_194_304).map{UInt8(truncatingIfNeeded:($0 &* 2654435761) >> 24)}),chunkB=Data(repeating:7,count:131_072)
test("chunk store round-trips bytes, compressed and SHA-256 checked") {
    let digest=try vault.storeChunk(id:"s1.a.1",data:chunkA)
    try check(digest==hex(chunkA),"Digest mismatch")
    try check(try vault.chunkData(id:"s1.a.1")==chunkA,"Chunk bytes differ")
    let size=((try fm.attributesOfItem(atPath:chunkFolder.appendingPathComponent("s1.a.1.chunk").path))[.size] as? NSNumber)?.intValue ?? Int.max
    try check(size<chunkA.count,"Chunk file is not compressed: \\(size)")
}
test("re-uploading the same bytes is accepted; other bytes under the id are refused") {
    _=try vault.storeChunk(id:"s1.a.1",data:chunkA)
    var refused=false;do{_=try vault.storeChunk(id:"s1.a.1",data:chunkB)}catch{refused=true}
    try check(refused,"Id reuse with other bytes accepted")
    try check(try vault.chunkData(id:"s1.a.1")==chunkA,"Stored chunk changed")
}
test("unsafe chunk ids are refused") {
    for id in ["","..",".","a/b","../x","a b",String(repeating:"x",count:200)] {
        var refused=false;do{_=try vault.storeChunk(id:id,data:chunkB)}catch{refused=true}
        try check(refused && !vault.isValidChunkId(id),"Unsafe id accepted: \\(id)")
    }
}
test("a corrupt chunk file is detected on read") {
    _=try vault.storeChunk(id:"s1.corrupt",data:chunkB)
    let url=chunkFolder.appendingPathComponent("s1.corrupt.chunk");var bytes=try Data(contentsOf:url);bytes[bytes.count-1]^=0xff;try bytes.write(to:url)
    var failed=false;do{_=try vault.chunkData(id:"s1.corrupt")}catch{failed=true}
    try check(failed,"Corrupt chunk accepted")
    try fm.removeItem(at:url)
}
test("a commit that lists a missing chunk is refused and leaves the disk unchanged") {
    let ok=try chunkJSON(1,["s1.a.1"]);let _:Int=try wait{commit(ok,try! envelope(ok),$0)}
    // The vault folder now holds the chunks/ directory, so compare the save files themselves.
    func saveFiles() throws -> [String:Data] {var out:[String:Data]=[:];for name in ["save-A.json","save-B.json"] {let url=folder.appendingPathComponent(name);if fm.fileExists(atPath:url.path) {out[name]=try Data(contentsOf:url)}};return out}
    let before=try saveFiles(),missing=try chunkJSON(2,["s1.a.1","s1.nothere"])
    var refused=false;do{let _:Int=try wait{commit(missing,try! envelope(missing),$0)}}catch{refused=true}
    try check(refused,"Commit with a missing chunk accepted")
    try check(try saveFiles()==before,"Refused commit changed the disk")
    try check(vault.currentSave()==ok,"Current save changed")
}
test("collection keeps chunks only because a vault file lists them, and removes stale ones") {
    _=try vault.storeChunk(id:"s1.b.2",data:chunkB)
    // Chunks from an earlier session: on disk but never uploaded by this process, so only a reference keeps them.
    let source=chunkFolder.appendingPathComponent("s1.b.2.chunk")
    for id in ["prev.ab.5","prev.slot.6","old.session.9"] {try fm.copyItem(at:source,to:chunkFolder.appendingPathComponent(id+".chunk"))}
    let slot=try chunkJSON(2,["prev.slot.6"]);let _:GlobalSaveVault.ManualSlotMetadata=try wait{manual(0,slot,try! envelope(slot,action:"saveManualSlot"),$0)}
    let next=try chunkJSON(3,["s1.a.1","prev.ab.5"]);let _:Int=try wait{commit(next,try! envelope(next),$0)}
    let files=chunkFiles()
    try check(files.contains("prev.ab.5.chunk"),"A/B-referenced chunk collected: \\(files.sorted())")
    try check(files.contains("prev.slot.6.chunk"),"Manual-slot chunk collected: \\(files.sorted())")
    try check(!files.contains("old.session.9.chunk"),"Stale chunk kept: \\(files.sorted())")
    try check(try vault.chunkData(id:"prev.ab.5")==chunkB,"Kept chunk unreadable")
}
// Build 358 (iPhone diagnostic: 3.4-5.3 s per commit): the vault keeps the header of the envelopes it verified and the
// chunk ids it found in unchanged files. These cases prove the shortcuts never hide a change on disk.
test("a chunk only a manual slot lists stays across commits and goes once the slot is cleared") {
    for rev in 4...5 {let j=try chunkJSON(rev,["s1.a.1"]);let _:Int=try wait{commit(j,try! envelope(j),$0)}}
    try check(chunkFiles().contains("prev.slot.6.chunk"),"Manual-slot chunk collected: \\(chunkFiles().sorted())")
    try check(!chunkFiles().contains("prev.ab.5.chunk"),"Chunk no file lists kept: \\(chunkFiles().sorted())")
    let _:Void=try wait{vault.clearManualSlotAsync(0,completion:$0)}
    let j=try chunkJSON(6,["s1.a.1"]);let _:Int=try wait{commit(j,try! envelope(j),$0)}
    try check(!chunkFiles().contains("prev.slot.6.chunk"),"Chunk of a cleared slot kept: \\(chunkFiles().sorted())")
    try check(chunkFiles().contains("s1.a.1.chunk"),"Referenced chunk collected: \\(chunkFiles().sorted())")
}
test("a commit reports its stage timings once") {
    let j=try chunkJSON(7,["s1.a.1"]);let gen:Int=try wait{commit(j,try! envelope(j),$0)}
    let stages=vault.takeCommitTimings(generation:gen) ?? [:]
    try check(["parseMs","currentSlotMs","encodeMs","writeMs","verifyMs","chunkGcMs","payloadBytes","envelopeBytes"].allSatisfy{stages[$0] != nil},"Stage timings missing: \\(stages)")
    try check(vault.takeCommitTimings(generation:gen)==nil,"Stage timings reported twice")
}
test("a slot file changed on disk is verified again before the next commit") {
    let gen=vault.currentGeneration()
    for name in ["save-A.json","save-B.json"] {
      let file=folder.appendingPathComponent(name)
      let obj=try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as! [String:Any]
      if (obj["generation"] as? Int)==gen {try Data("broken".utf8).write(to:file)}
    }
    // The newest slot is no longer valid: the commit follows the verified peer (generation gen-1) and writes over it.
    let j=try chunkJSON(8,["s1.a.1"]);let next:Int=try wait{commit(j,try! envelope(j),$0)}
    try check(next==gen,"Generation after a corrupt newest slot: \\(next), newest was \\(gen)")
    try check(vault.currentSave()==j && vault.currentGeneration()==gen,"Commit after corruption is not current")
    let stale=try chunkJSON(7,["s1.a.1"]);var refused=false
    do{let _:Int=try wait{commit(stale,try! envelope(stale),$0)}}catch{refused=true}
    try check(refused,"Stale revision accepted after a slot was rewritten")
}
// Build 358 (save size): text chunks of sealed collections listed in stateCodec.chunks are required and kept like fleet chunks.
func textJSON(_ rev:Int,fleet:[String],text:[String]) throws -> String {
    let rows:[String:Any]=["$ghBinary":"chunks-v1","byteLength":fleet.count*8,"chunkBytes":8,"chunks":fleet]
    let obj:[String:Any]=["saveVersion":"3.0.0","saveRevision":rev,"resetEpoch":0,"simSeconds":Double(rev)*60,"fleet":["rows":rows],"stateCodec":["version":"gh-shape-4","paths":[["documentProofs","recordsById"]],"chunks":text]]
    return String(data:try JSONSerialization.data(withJSONObject:obj,options:[.sortedKeys]),encoding:.utf8)!
}
test("a commit that lists a missing text chunk is refused; with it on disk it commits and the chunk is kept") {
    let rev=vault.currentSave().flatMap{try? JSONSerialization.jsonObject(with:Data($0.utf8)) as? [String:Any]}?["saveRevision"] as? Int ?? 8
    let missing=try textJSON(rev+1,fleet:["s1.a.1"],text:["s2.t.1"])
    var refused=false;do{let _:Int=try wait{commit(missing,try! envelope(missing),$0)}}catch{refused=true}
    try check(refused,"Commit with a missing text chunk accepted")
    _=try vault.storeChunk(id:"s2.t.1",data:Data(#"{"$gh":2,"k":[],"s":[],"p":[],"r":[]}"#.utf8))
    let ok=try textJSON(rev+1,fleet:["s1.a.1"],text:["s2.t.1"]);let _:Int=try wait{commit(ok,try! envelope(ok),$0)}
    try check(vault.currentSave()==ok,"Text-chunked save not current")
    let refs=try vault.referencedChunks(ok)
    try check(refs==["s1.a.1","s2.t.1"],"Manifest is not fleet then text: \\(refs)")
    let next=try textJSON(rev+2,fleet:["s1.a.1"],text:["s2.t.1"]);let _:Int=try wait{commit(next,try! envelope(next),$0)}
    try check(chunkFiles().contains("s2.t.1.chunk"),"Referenced text chunk collected: \\(chunkFiles().sorted())")
    let script=vault.bootstrapJavaScript(force:false)
    try check(script.contains("stateCodec") && script.contains("$ghText"),"Bootstrap does not fetch text chunks")
}
test("bootstrap of a chunked save installs the boot gate") {
    let script=vault.bootstrapJavaScript(force:false)
    try check(script.contains("__GH_BOOT_GATE__") && script.contains("gh://app/save-chunk/"),"Boot gate missing")
}
}
// Build 358: the vault reads a payload with its own one-pass scan (no longer JSONSerialization) and writes the A/B
// envelope without JSONEncoder escaping the payload. The scan must accept and refuse what JSONSerialization does and
// read the same fields; the envelope must give back every payload byte.
do {
func scanReference(_ data:Data)->[String:String]? {
    guard let root=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else {return nil}
    func text(_ value:Any?)->String {
        guard let value else {return "absent"}
        if value is NSNull {return "null"}
        if let s=value as? String {return "string:\\(s)"}
        if let n=value as? NSNumber {return CFGetTypeID(n)==CFBooleanGetTypeID() ? "bool:\\(n.boolValue)" : "number:\\(n.doubleValue)"}
        return "container"
    }
    var out=["saveVersion":text(root["saveVersion"]),"saveRevision":text(root["saveRevision"]),"resetEpoch":text(root["resetEpoch"]),"simSeconds":text(root["simSeconds"]),"binary":"absent","chunks":"absent","stateChunks":"absent","fleetRows":"no"]
    if let fleet=root["fleet"] as? [String:Any],let rows=fleet["rows"] as? [String:Any] {
        out["fleetRows"]="yes";out["binary"]=text(rows["$ghBinary"])
        if let chunks=rows["chunks"] {out["chunks"]=(chunks as? [String]).map{$0.joined(separator:",")} ?? "invalid"}
    }
    if let codec=root["stateCodec"] as? [String:Any],let chunks=codec["chunks"] {out["stateChunks"]=(chunks as? [String]).map{$0.joined(separator:",")} ?? "invalid"}
    return out
}
let scanCorpus:[String]=[
    #"{"saveVersion":"3.0.0","saveRevision":4,"resetEpoch":0,"simSeconds":120.25}"#,
    "{\\n\\t\\"saveVersion\\" :\\r\\n \\"3.0.0\\" , \\"simSeconds\\":\\"60\\" ,\\"saveRevision\\": 7 }\\n\\t ",
    #"{"save\\u0056ersion":"3.\\u0030.0","simSeconds":1e3,"saveRevision":2.5E-1,"resetEpoch":1E+2}"#,
    #"{"saveVersion":true,"saveRevision":null,"resetEpoch":false,"simSeconds":[1,{"a":[]}]}"#,
    #"{"label":"\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9\\ud83d\\udea2 العساف 海 🚢","x":[[[[{}]]]],"saveVersion":"3.0.0","simSeconds":{"a":"}"}}"#,
    #"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":["a.1","b-2","c_3"]}},"saveVersion":"3.0.0"}"#,
    #"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":[]}}}"#,
    #"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":["a",1]}}}"#,
    #"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":"a"}}}"#,
    #"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":[" a\\"b",null,["c"]]}}}"#,
    #"{"fleet":{"rows":[1,2]}}"#,
    #"{"fleet":[{"rows":{}}]}"#,
    #"{"fleet":"rows"}"#,
    #"{"fleet":{"other":{"rows":{"$ghBinary":"chunks-v1"}},"rows":{"$ghBinary":7,"chunks":["x"]}}}"#,
    #"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":["\\u0061b"],"nested":{"chunks":["no"]}}},"chunks":["root"]}"#,
    #"{"fleet":{"rows":{"$gh\\u0042inary":{"x":1},"chunks":["k"]}}}"#,
    // Build 358 (save size): stateCodec.chunks, the text chunks of sealed collections.
    #"{"saveVersion":"3.0.0","stateCodec":{"version":"gh-shape-4","paths":[["a"]],"chunks":["n.t.1","n.t.2"]}}"#,
    #"{"stateCodec":{"chunks":[]}}"#,
    #"{"stateCodec":{"chunks":["a",2]}}"#,
    #"{"stateCodec":{"chunks":"a"}}"#,
    #"{"stateCodec":["chunks"]}"#,
    #"{}"#, #" {} "#,
    #"{"a":{"b":{"c":{"d":[1,-2.5,3e2,"s",null,true,false,0,0.5,10]}}}}"#,
    // Refused by both.
    "", "   ", "[]", #"[{"saveVersion":"3.0.0"}]"#, #""x""#, "3", "null", "true",
    "{", "}", #"{"a"}"#, #"{"a":}"#, "{,}", #"{"a":1,,"b":2}"#,
    #"{"a" 1}"#, "{a:1}", "{'a':1}", #"{"a":1}x"#, #"{"a":1}{}"#, #"{"a":[1 2]}"#, #"{"a":{"b":1 "c":2}}"#,
    #"{"a":tru}"#, #"{"a":nul}"#, #"{"a":True}"#, #"{"a":falsey}"#,
    #"{"a":"\\x"}"#, #"{"a":"\\u12G4"}"#, #"{"a":"\\u12"}"#, #"{"a":"abc}"#, "{\\"a\\":\\"tab\\there\\"}", "{\\"a\\":\\"line\\nbreak\\"}", "{\\"a\\":\\"nul\\u{0}\\"}",
    #"{"a":[}"#, #"{"a":]}"#, #"{"a":{]}"#, #"{"a":[1}"#, #"{"a":{"b":[1,{"c":2]}}"#,
    #"{"fleet":{"rows":{"chunks":["a" "b"]}}}"#,
    #"{"saveVersion":"3.0.0"} "x""#, #"{"saveVersion":"3.0.0""#
]
test("payload scan reads what JSONSerialization reads (fixed corpus)") {
    var bad:[String]=[]
    for text in scanCorpus {
        let data=Data(text.utf8),got=GlobalSaveVault.inspectSaveJSONForTesting(data),want=scanReference(data)
        if got != want {bad.append("\\(text.prefix(80)) => \\(String(describing:got)) / \\(String(describing:want))")}
    }
    try check(bad.isEmpty,"Scan differs: \\(bad.prefix(4))")
}
// JSONSerialization on macOS accepts a trailing comma; JSON.parse in the game refuses it, and so does the scan.
test("payload scan refuses what RFC 8259 refuses") {
    let strict=[#"{"a":1,}"#,#"{"a":[1,]}"#,#"{"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":["a",]}}}"#,#"{"a":01}"#,#"{"a":-01}"#,#"{"a":1.}"#,#"{"a":.5}"#,#"{"a":+1}"#,#"{"a":0x10}"#,#"{"a":-}"#,#"{"a":NaN}"#,#"{"a":Infinity}"#,#"{"a":1e}"#,#"{"a":1e+}"#,#"{"a":1.e3}"#,"{\\"a\\":1}\\u{0}","\\u{FEFF}{}","{\\"a\\":1}\\u{0B}",#"{"a":"\\U0041"}"#]
    let accepted=strict.filter{GlobalSaveVault.inspectSaveJSONForTesting(Data($0.utf8)) != nil}
    try check(accepted.isEmpty,"Accepted: \\(accepted)")
}
test("payload scan: deep nesting, lone surrogates and repeated keys") {
    let deep="{\\"a\\":"+String(repeating:"[",count:20000)+String(repeating:"]",count:20000)+",\\"saveVersion\\":\\"3.0.0\\"}"
    try check(GlobalSaveVault.inspectSaveJSONForTesting(Data(deep.utf8))?["saveVersion"]=="string:3.0.0","Deep nesting refused")
    try check(GlobalSaveVault.inspectSaveJSONForTesting(Data(String(repeating:"[",count:20000).utf8))==nil,"Unclosed nesting accepted")
    // JSON.stringify writes a lone surrogate (a name cut inside an emoji) as \\udXXX: the save stays valid.
    let lone=GlobalSaveVault.inspectSaveJSONForTesting(Data(#"{"saveVersion":"\\ud800","n":"\\udc00x\\ud83d"}"#.utf8))
    try check(lone?["saveVersion"]=="string:\\u{FFFD}","Lone surrogate: \\(String(describing:lone))")
    let pair=GlobalSaveVault.inspectSaveJSONForTesting(Data(#"{"saveVersion":"\\ud83d\\n\\ud83d\\udea2"}"#.utf8))
    try check(pair?["saveVersion"]=="string:\\u{FFFD}\\n🚢","Surrogate then escape: \\(String(describing:pair))")
    let repeated=GlobalSaveVault.inspectSaveJSONForTesting(Data(#"{"saveRevision":1,"saveRevision":2,"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":["a"]}},"fleet":7}"#.utf8))
    try check(repeated?["saveRevision"]=="number:2.0" && repeated?["fleetRows"]=="no" && repeated?["chunks"]=="absent","Repeated keys: \\(String(describing:repeated))")
    // JSONSerialization keeps the first of repeated keys; JSON.parse in the game keeps the last, and so does the scan.
    let codecReplaced=GlobalSaveVault.inspectSaveJSONForTesting(Data(#"{"stateCodec":{"chunks":["x"]},"stateCodec":{"version":"v"}}"#.utf8))
    try check(codecReplaced?["stateChunks"]=="absent","Repeated stateCodec: \\(String(describing:codecReplaced))")
    let chunksReplaced=GlobalSaveVault.inspectSaveJSONForTesting(Data(#"{"stateCodec":{"chunks":["x"],"chunks":["y"],"nested":{"chunks":["no"]}},"fleet":{"rows":{"$ghBinary":"chunks-v1","chunks":["f"]}}}"#.utf8))
    try check(chunksReplaced?["stateChunks"]=="y" && chunksReplaced?["chunks"]=="f" && chunksReplaced?["fleetRows"]=="yes","Repeated stateCodec.chunks: \\(String(describing:chunksReplaced))")
}
test("payload scan reads what JSONSerialization reads (generated saves, cut short)") {
    var rng=SystemRandomNumberGenerator()
    let pool:[String]=(0..<32).map{String(Character(UnicodeScalar(UInt8($0))))}+["\\"","\\\\","/","a","Z"," ","é","العساف","海","🚢","\\u{2028}","\\u{7F}","$ghBinary","chunks-v1"]
    func word()->String {(0..<Int.random(in:0...6,using:&rng)).map{_ in pool.randomElement(using:&rng)!}.joined()}
    func scalar()->Any {
        switch Int.random(in:0...5,using:&rng) {
        case 0: return Int.random(in:-1_000_000...1_000_000,using:&rng)
        case 1: return Double(Int.random(in:0...1_000_000,using:&rng))/64
        case 2: return word()
        case 3: return Bool.random(using:&rng)
        case 4: return NSNull()
        default: return Int.random(in:0...9_007_199_254_740_991,using:&rng)
        }
    }
    func value(_ depth:Int)->Any {
        if depth>4 || Int.random(in:0...2,using:&rng)==0 {return scalar()}
        if Bool.random(using:&rng) {return (0..<Int.random(in:0...4,using:&rng)).map{_ in value(depth+1)}}
        var o:[String:Any]=[:];for _ in 0..<Int.random(in:0...4,using:&rng) {o[word()]=value(depth+1)};return o
    }
    var bad:[String]=[],count=0
    for round in 0..<400 {
        var root:[String:Any]=["saveVersion":Bool.random(using:&rng) ? ("3.0.0" as Any):scalar(),"payload":value(0)]
        for key in ["saveRevision","resetEpoch","simSeconds"] where Bool.random(using:&rng) {root[key]=Int.random(in:0...3,using:&rng)==0 ? value(1):scalar()}
        switch round%4 {
        case 0: root["fleet"]=["rows":["$ghBinary":"chunks-v1","chunks":(0..<Int.random(in:0...5,using:&rng)).map{"c.\\($0)"},"byteLength":8] as [String:Any]]
        case 1: root["fleet"]=["rows":["$ghBinary":scalar(),"chunks":value(2)]]
        case 2: root["fleet"]=value(1)
        default: break
        }
        let data=try JSONSerialization.data(withJSONObject:root,options:Bool.random(using:&rng) ? [.prettyPrinted]:[])
        for cut in [data.count,Int.random(in:0..<data.count,using:&rng)] {
            let piece=data.prefix(cut)
            guard String(data:piece,encoding:.utf8) != nil else {continue}
            count+=1
            let got=GlobalSaveVault.inspectSaveJSONForTesting(piece),want=scanReference(piece)
            if got != want {bad.append("\\(String(decoding:piece.prefix(120),as:UTF8.self)) => \\(String(describing:got)) / \\(String(describing:want))")}
        }
    }
    try check(count>=500 && bad.isEmpty,"Scan differs (\\(bad.count) of \\(count)): \\(bad.prefix(3))")
}
test("the A/B envelope keeps every payload byte") {
    vault.reset()
    var label="";for c in 0..<32 {label.unicodeScalars.append(UnicodeScalar(UInt8(c)))}
    label+="\\"\\\\/ \\u{7F} é العساف 海 🚢 \\u{2028}\\u{2029} \\\\u0041"
    let obj:[String:Any]=["saveVersion":"3.0.0","saveRevision":1,"resetEpoch":0,"simSeconds":60,"label":label,"nested":["a":[1,2,["b":label]] as [Any]]]
    let json=String(data:try JSONSerialization.data(withJSONObject:obj,options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!+"\\n\\t\\r "
    let gen:Int=try wait{commit(json,try! envelope(json),$0)}
    try check(vault.currentSave()==json,"Payload changed through the envelope")
    var found=false
    for name in ["save-A.json","save-B.json"] {
        let file=folder.appendingPathComponent(name)
        guard let data=try? Data(contentsOf:file),let env=try JSONSerialization.jsonObject(with:data) as? [String:Any],(env["generation"] as? Int)==gen else {continue}
        found=true
        try check(env["payload"] as? String==json && env["sha256"] as? String==hash(json),"Envelope payload or hash differs")
        try check(env["schemaVersion"] != nil && env["simSeconds"] as? Double==60 && env["saveRevision"] as? Int==1 && env["slot"] as? String==String(name.dropFirst(5).prefix(1)),"Envelope header differs: \\(env.filter{$0.key != "payload"})")
    }
    try check(found,"No slot holds generation \\(gen)")
    let next=try makeJSON(2,extra:label);let gen2:Int=try wait{commit(next,try! envelope(next),$0)}
    try check(gen2==gen+1 && vault.currentSave()==next,"Second commit through the envelope")
}
test("bridge check refuses an envelope whose save is not JSON") {
    let base=try makeJSON(9)
    var payload=try envelope(base)
    let broken=String(base.dropLast())
    payload["saveJSON"]=broken;payload["saveHash"]=hash(broken)
    let before=try diskDigest();var failed=false
    do {let _:Int=try wait {commit(broken,payload,$0)}}catch{failed=true}
    let after=try diskDigest()
    try check(failed && after==before,"Truncated save accepted or disk changed")
}
}
// Baseline validation runs in the main-thread probe; candidate enqueues it on the real vault queue.
vault.reset()
let perf=try makeJSON(1,extra:String(repeating:"x",count:14_000_000)),perfEnvelope=try envelope(perf)
let begin=DispatchTime.now().uptimeNanoseconds
var perfDone=false;var perfSuccess=false
commit(perf,perfEnvelope){r in perfSuccess=(try? r.get()) != nil;perfDone=true}
let dispatchMS=Double(DispatchTime.now().uptimeNanoseconds-begin)/1e6
let deadline=Date().addingTimeInterval(60)
while !perfDone && Date()<deadline {RunLoop.current.run(until:Date().addingTimeInterval(0.002))}
let totalMS=Double(DispatchTime.now().uptimeNanoseconds-begin)/1e6
// Build 358: the steady state of a session, a second large commit while the first is the current slot.
let perfNext=try makeJSON(2,extra:String(repeating:"y",count:14_000_000)),nextBegin=DispatchTime.now().uptimeNanoseconds
var nextGeneration=0
do {nextGeneration=try wait{commit(perfNext,try! envelope(perfNext),$0)}} catch {print("FAIL: second large commit: \\(error)")}
let nextMS=Double(DispatchTime.now().uptimeNanoseconds-nextBegin)/1e6
let nextStages=vault.takeCommitTimings(generation:nextGeneration) ?? [:]
test("a second large commit succeeds and reports its stages") {try check(nextGeneration>0 && vault.currentSave()==perfNext && nextStages["envelopeBytes"] != nil,"Second large commit failed")}
// Build 358: the envelope check compared the save text with String ==, which tests canonical equivalence for non-ASCII
// text; the vault now compares literally (NSString isEqual). Both timed on two separate 15 MB Arabic copies, then an
// Arabic commit through the real vault queue reports its check stage (bridgeMs).
let arabicText=String(repeating:"العساف للطيران · شحن ",count:400_000),copyA=NSString(string:arabicText),copyB=NSString(string:arabicText)
var equalBegin=DispatchTime.now().uptimeNanoseconds
let swiftEqual=(copyA as String)==(copyB as String)
let swiftEqualMS=Double(DispatchTime.now().uptimeNanoseconds-equalBegin)/1e6
equalBegin=DispatchTime.now().uptimeNanoseconds
let literalEqual=copyA.isEqual(to:copyB as String)
let literalEqualMS=Double(DispatchTime.now().uptimeNanoseconds-equalBegin)/1e6
let arabicSave=try makeJSON(3,extra:arabicText)
var arabicGeneration=0
do {arabicGeneration=try wait{commit(arabicSave,try! envelope(arabicSave),$0)}} catch {print("FAIL: Arabic commit: \\(error)")}
let arabicStages=vault.takeCommitTimings(generation:arabicGeneration) ?? [:]
test("a large Arabic save commits; text comparison is literal") {try check(swiftEqual && literalEqual && arabicGeneration>0 && vault.currentSave()==arabicSave && arabicStages["bridgeMs"] != nil,"Arabic commit or comparison failed")}
let performance:[String:Any]=["bytes":perf.utf8.count,"handler_validation_and_enqueue_ms":dispatchMS,"completed_ms":totalMS,"success":perfSuccess,"second_commit_ms":nextMS,"second_commit_stages":nextStages,"arabic_text_bytes":arabicText.utf8.count,"arabic_text_swift_equal_ms":swiftEqualMS,"arabic_text_literal_equal_ms":literalEqualMS,"arabic_commit_stages":arabicStages,"single_sample":true,"iphone_measurement":false,"includes_bootstrap_refresh":false]
try JSONSerialization.data(withJSONObject:performance,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"save-enqueue-measurement.json"))
print("SAVE_MEASUREMENT "+String(data:try JSONSerialization.data(withJSONObject:performance,options:[.sortedKeys]),encoding:.utf8)!)
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
