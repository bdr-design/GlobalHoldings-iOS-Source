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
    origin_gate=('message.webView === webView' in controller and 'message.frameInfo.isMainFrame' in controller and 'isTrustedGameDocument(message.frameInfo.request.url)' in controller)
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
let coldFolder=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("GlobalHoldingsColdArchive")
// On an ephemeral CI runner only. Never delete a pre-existing save directory.
guard ProcessInfo.processInfo.environment["GH_NATIVE_AUDIT_EPHEMERAL"] == "1", !fm.fileExists(atPath:folder.path), !fm.fileExists(atPath:coldFolder.path) else { fatalError("Fresh disposable test directory required") }
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
func hashData(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
func hash(_ json:String)->String {hashData(Data(json.utf8))}
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
func materializedPayload(_ header:[String:Any]) throws -> String {
    guard let name=header["manifestFile"] as? String,
          let data=try? Data(contentsOf:folder.appendingPathComponent(name)),
          let manifest=try JSONSerialization.jsonObject(with:data) as? [String:Any],
          manifest["format"] as? String=="gh-state-manifest-v2",
          manifest["storageVersion"] as? Int==2,
          let sections=manifest["sections"] as? [[String:Any]] else {throw TestFailure(message:"Chunked manifest missing or invalid")}
    func components(_ key:String)->[String] {
      key.components(separatedBy:".").map { part in
        let bytes=Array(part.utf8);var decoded:[UInt8]=[],index=0
        while index<bytes.count {if bytes[index]==37 && index+2<bytes.count,let byte=UInt8(String(bytes:bytes[(index+1)...(index+2)],encoding:.utf8)!,radix:16){decoded.append(byte);index+=3}else{decoded.append(bytes[index]);index+=1}}
        return String(bytes:decoded,encoding:.utf8)!
      }
    }
    func assign(_ value:Any,_ path:[String],_ root:inout [String:Any]) {
      guard let key=path.first else{return};if path.count==1{root[key]=value;return}
      var child=root[key] as? [String:Any] ?? [:];assign(value,Array(path.dropFirst()),&child);root[key]=child
    }
    var root:[String:Any]=[:],nested:[([String],Any)]=[]
    for section in sections {
      guard let key=section["key"] as? String,let kind=section["kind"] as? String,let itemCount=section["itemCount"] as? Int,itemCount>=0,let chunks=section["chunks"] as? [[String:Any]] else {throw TestFailure(message:"Manifest section invalid")}
      var values:[Any]=[]
      for chunk in chunks {
        guard let file=chunk["file"] as? String,let expected=chunk["sha256"] as? String,let byteCount=chunk["byteCount"] as? Int,let bytes=try? Data(contentsOf:folder.appendingPathComponent(file)) else {throw TestFailure(message:"Manifest chunk missing")}
        try check(bytes.count==byteCount && hashData(bytes)==expected,"Chunk byte count or digest mismatch")
        values.append(try JSONSerialization.jsonObject(with:bytes,options:[.fragmentsAllowed]))
      }
      let path=components(key)
      if kind=="array" {var rows:[Any]=[];for value in values {guard let part=value as? [Any] else {throw TestFailure(message:"Array section chunk invalid")};rows.append(contentsOf:part)};try check(rows.count==itemCount,"Section item count mismatch");nested.append((path,rows))}
      else {guard values.count==1 && path.count==1 && itemCount==1 else {throw TestFailure(message:"Value section chunk count invalid")};root[path[0]]=values[0]}
    }
    for (path,value) in nested.sorted(by:{$0.0.count<$1.0.count}){assign(value,path,&root)}
    return String(data:try JSONSerialization.data(withJSONObject:root,options:[.sortedKeys]),encoding:.utf8)!
}
func reject(_ name:String, json:String, payload:[String:Any]) {
    test(name){let before=try diskDigest();var failed=false
      do {let _:Int=try wait {commit(json,payload,$0)}}catch{failed=true}
      try check(failed,"Invalid input was accepted");try check(try diskDigest()==before,"Invalid request changed persistent bytes")
    }
}
let first=try makeJSON(1)
test("native cold archive uses validated names, atomic writes, readback and remove") {
    let key="gh-cold-mobility-trip-receipts-e9-A.json",value=#"{"generation":1,"items":[]}"#
    let _:Void=try wait { vault.writeColdArchiveAsync(key,value:value,completion:$0) }
    let loaded:String?=try wait { vault.readColdArchiveAsync(key,completion:$0) }
    try check(loaded==value,"Cold archive readback mismatch")
    let keys:[String]=try wait { vault.coldArchiveKeysAsync(completion:$0) }
    try check(keys.contains(key),"Cold archive key missing from native inventory")
    let longBucket=String(repeating:"b",count:80),longKey="gh-cold-\\(longBucket)-item-"+String(repeating:"a",count:64)+".json"
    let _:Void=try wait { vault.writeColdArchiveAsync(longKey,value:value,completion:$0) }
    let longLoaded:String?=try wait { vault.readColdArchiveAsync(longKey,completion:$0) }
    try check(longLoaded==value,"Maximum-length content-addressed cold archive name was rejected")
    var rejected=false
    do { let _:Void=try wait { vault.writeColdArchiveAsync("../../escape.json",value:value,completion:$0) } } catch { rejected=true }
    try check(rejected,"Invalid archive path was accepted")
    let _:Void=try wait { vault.removeColdArchiveAsync(key,completion:$0) }
    let _:Void=try wait { vault.removeColdArchiveAsync(longKey,completion:$0) }
    let removed:String?=try wait { vault.readColdArchiveAsync(key,completion:$0) }
    try check(removed==nil,"Cold archive remove did not remove the verified file")
}
test("real UTF8 save, content-addressed sections and compact atomic manifest pointer") {let gen:Int=try wait {commit(first,try! envelope(first),$0)};try check(gen==1 && vault.currentSave()==first,"Native roundtrip mismatch");let header=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-A.json"))) as! [String:Any];try check(header["payload"]==nil && header["payloadFile"]==nil,"New header still embeds the full payload");try check(header["storageVersion"] as? Int==2,"Physical storage version is not independent V2");guard let manifestName=header["manifestFile"] as? String,let manifestData=try? Data(contentsOf:folder.appendingPathComponent(manifestName)),let manifest=try JSONSerialization.jsonObject(with:manifestData) as? [String:Any],let sections=manifest["sections"] as? [[String:Any]] else {throw TestFailure(message:"Chunked manifest missing")};try check(manifest["schemaVersion"] as? String=="2.0.0" && manifest["storageVersion"] as? Int==2,"Manifest changed logical schema or storage version");try check(manifest["saveRevision"] as? Int==1 && manifest["resetEpoch"] as? Double==0,"Manifest omitted save revision/reset epoch");try check(try materializedPayload(header)==first,"Manifest sections did not reconstruct the logical Save Schema")}
test("uncommitted higher A/B header cannot overtake atomic save-head") {let staged=try makeJSON(99);let stagedHash=hash(staged),stagedName="save-payload-B-g99-"+stagedHash+".bin",stagedData=Data(staged.utf8);try stagedData.write(to:folder.appendingPathComponent(stagedName),options:.atomic);let stagedHeader:[String:Any] = ["generation":99,"slot":"B","schemaVersion":"2.0.0","runtimeVersion":"3.0.0","simSeconds":5940,"saveRevision":99,"resetEpoch":0,"savedAt":99,"sha256":stagedHash,"payloadFile":stagedName];try JSONSerialization.data(withJSONObject:stagedHeader).write(to:folder.appendingPathComponent("save-B.json"),options:.atomic);try check(vault.currentSave()==first && vault.currentGeneration()==1,"Staged slot displaced the committed head");let committed=try makeJSON(2);let gen:Int=try wait{commit(committed,try! envelope(committed),$0)};try check(gen==2 && vault.currentSave()==committed,"Next commit did not replace staged slot at the next generation")}
test("root and nested append-only arrays split into 1000-row content-addressed sections") {var root=try JSONSerialization.jsonObject(with:Data(try makeJSON(3).utf8)) as! [String:Any];root["eventLog"]=(0..<2501).map{["id":"E-"+String($0),"at":$0] as [String:Any]};var finance=root["finance"] as? [String:Any] ?? [:];finance["ledger"]=(0..<2201).map{["id":"L-"+String($0),"debit":1,"credit":1] as [String:Any]};root["finance"]=finance;root["مفتاح.بمسافة "]=["ر" as Any];let json=String(data:try JSONSerialization.data(withJSONObject:root,options:[.sortedKeys]),encoding:.utf8)!;let gen:Int=try wait{commit(json,try! envelope(json),$0)};try check(gen==3,"Chunked save generation mismatch");let header=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-A.json"))) as! [String:Any],manifestData=try Data(contentsOf:folder.appendingPathComponent(header["manifestFile"] as! String)),manifest=try JSONSerialization.jsonObject(with:manifestData) as! [String:Any],sections=manifest["sections"] as! [[String:Any]],log=sections.first{$0["key"] as? String=="eventLog"}!,chunks=log["chunks"] as! [[String:Any]],ledger=sections.first{$0["key"] as? String=="finance.ledger"}!,ledgerChunks=ledger["chunks"] as! [[String:Any]];try check(chunks.count==3 && log["itemCount"] as? Int==2501,"Root append-only array was not chunked");try check(ledgerChunks.count==3 && ledger["itemCount"] as? Int==2201,"Nested finance ledger was not chunked");try check(sections.contains{$0["key"] as? String=="%D9%85%D9%81%D8%AA%D8%A7%D8%AD%2E%D8%A8%D9%85%D8%B3%D8%A7%D9%81%D8%A9%20"},"UTF-8 or dotted section key was not encoded safely");try check(try materializedPayload(header)==json,"Chunked append-only sections changed logical JSON")}
test("unchanged chunks are reused and a corrupt newest section falls back atomically") {let previous=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-A.json"))) as! [String:Any],previousManifest=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent(previous["manifestFile"] as! String))) as! [String:Any],previousSections=previousManifest["sections"] as! [[String:Any]],previousLog=previousSections.first{$0["key"] as? String=="eventLog"}!,previousFiles=(previousLog["chunks"] as! [[String:Any]]).compactMap{$0["file"] as? String},previousPayload=try materializedPayload(previous);var root=try JSONSerialization.jsonObject(with:Data(previousPayload.utf8)) as! [String:Any];root["saveRevision"]=4;root["simSeconds"]=240;let json=String(data:try JSONSerialization.data(withJSONObject:root,options:[.sortedKeys]),encoding:.utf8)!;let gen:Int=try wait{commit(json,try! envelope(json),$0)};try check(gen==4,"Incremental generation mismatch");let current=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-B.json"))) as! [String:Any],currentManifest=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent(current["manifestFile"] as! String))) as! [String:Any],currentSections=currentManifest["sections"] as! [[String:Any]],currentLog=currentSections.first{$0["key"] as? String=="eventLog"}!,currentFiles=(currentLog["chunks"] as! [[String:Any]]).compactMap{$0["file"] as? String};try check(currentFiles==previousFiles,"Unchanged append-only chunks were rewritten instead of shared");try check(try materializedPayload(current)==json,"Incremental manifest changed logical state");let revision=currentSections.first{$0["key"] as? String=="saveRevision"}!,revisionChunk=(revision["chunks"] as! [[String:Any]])[0],revisionURL=folder.appendingPathComponent(revisionChunk["file"] as! String);try Data("damaged".utf8).write(to:revisionURL,options:.atomic);try check(vault.currentSave()==previousPayload && vault.currentGeneration()==3,"Corrupt newest section did not recover the prior committed A/B generation")}
test("legacy inline A/B payload loads and migrates without changing logical schema") {vault.reset();try fm.createDirectory(at:folder,withIntermediateDirectories:true);let legacy=try makeJSON(20);let object:[String:Any]=["generation":50,"slot":"A","schemaVersion":"2.0.0","runtimeVersion":"3.0.0","simSeconds":1200,"saveRevision":20,"resetEpoch":0,"savedAt":1,"sha256":hash(legacy),"payload":legacy];try JSONSerialization.data(withJSONObject:object).write(to:folder.appendingPathComponent("save-A.json"));try check(vault.currentSave()==legacy && vault.currentGeneration()==50,"Legacy inline payload failed to load");let next=try makeJSON(21);let gen:Int=try wait{commit(next,try! envelope(next),$0)};try check(gen==51 && vault.currentSave()==next,"Legacy save was not promoted to the new generation");let header=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-B.json"))) as! [String:Any];try check(header["payload"]==nil && header["payloadFile"]==nil && header["manifestFile"] is String && header["storageVersion"] as? Int==2,"Legacy save was not migrated to a storage V2 manifest");try check(try materializedPayload(header)==next,"Migrated manifest changed Save Schema 2.0.0")}
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
      try check(obj["payload"]==nil && obj["payloadFile"]==nil && obj["storageVersion"] as? Int==2,"Reset slot still embeds a legacy payload");try check(try materializedPayload(obj)==clean,"Reset manifest did not retain the exact logical Save Schema")
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
    let recovered=vault.currentSave(),recoveredGeneration=vault.currentGeneration()
    try check(recovered != nil && recoveredGeneration > 0,"Verified peer was not available for pointer recovery")
    try Data("broken".utf8).write(to:folder.appendingPathComponent("save-head.json"),options:.atomic)
    try check(vault.currentSave()==recovered && vault.currentGeneration()==recoveredGeneration,"Corrupt save-head did not recover the highest complete A/B generation")
    let repairedHead=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-head.json"))) as! [String:Any]
    try check(repairedHead["generation"] as? Int==recoveredGeneration && ["A","B"].contains(repairedHead["slot"] as? String ?? ""),"Recovered save-head pointer was not repaired")
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
test("chunked envelope verifies payload digest metadata before A/B selection") {
    guard let baseline=vault.currentSave(),let baselineObject=try JSONSerialization.jsonObject(with:Data(baseline.utf8)) as? [String:Any] else {throw TestFailure(message:"Verified baseline save missing")}
    let next=try makeJSON((baselineObject["saveRevision"] as? Int ?? 0)+1)
    let generation:Int=try wait { commit(next,try! envelope(next),$0) }
    let head=try JSONSerialization.jsonObject(with:Data(contentsOf:folder.appendingPathComponent("save-head.json"))) as! [String:Any]
    guard head["generation"] as? Int==generation,let slot=head["slot"] as? String,["A","B"].contains(slot) else {throw TestFailure(message:"Current A/B pointer missing")}
    let peerSlot=slot=="A" ? "B" : "A",currentSlotURL=folder.appendingPathComponent("save-\\(slot).json"),peerURL=folder.appendingPathComponent("save-\\(peerSlot).json")
    guard let peerHeader=try JSONSerialization.jsonObject(with:Data(contentsOf:peerURL)) as? [String:Any],
          let peerGeneration=peerHeader["generation"] as? Int,let peerPayload=vault.snapshot(generation:peerGeneration)?.payload else {throw TestFailure(message:"Verified A/B peer missing")}
    let latest=try JSONSerialization.jsonObject(with:Data(contentsOf:currentSlotURL)) as! [String:Any]
    var damaged=latest;damaged["payloadSHA256"]=String(repeating:"0",count:64)
    try JSONSerialization.data(withJSONObject:damaged).write(to:currentSlotURL,options:.atomic)
    try check(vault.currentSave()==peerPayload && vault.currentGeneration()==peerGeneration,"Mismatched compact payload digest was accepted instead of recovering the verified A/B peer")
}
// Baseline validation runs in the main-thread probe; candidate enqueues it on the real vault queue.
vault.reset()
let perf=try makeJSON(1,extra:String(repeating:"x",count:28*1024*1024)),perfEnvelope=try envelope(perf)
let begin=DispatchTime.now().uptimeNanoseconds
var perfDone=false;var perfSuccess=false
commit(perf,perfEnvelope){r in perfSuccess=(try? r.get()) != nil;perfDone=true}
let dispatchMS=Double(DispatchTime.now().uptimeNanoseconds-begin)/1e6
let deadline=Date().addingTimeInterval(60)
while !perfDone && Date()<deadline {RunLoop.current.run(until:Date().addingTimeInterval(0.002))}
let totalMS=Double(DispatchTime.now().uptimeNanoseconds-begin)/1e6
let performance:[String:Any]=["bytes":perf.utf8.count,"handler_validation_and_enqueue_ms":dispatchMS,"completed_ms":totalMS,"nativeVaultCommitMs":totalMS,"success":perfSuccess,"single_sample":true,"iphone_measurement":false,"includes_bootstrap_refresh":false]
try JSONSerialization.data(withJSONObject:performance,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"save-enqueue-measurement.json"))
print("NATIVE_COMMIT_MS \\(totalMS)")
test("28 MiB native vault commit meets the 2s macOS acceptance limit") {try check(perfSuccess,"Native vault commit failed");try check(totalMS<2000,"nativeVaultCommitMs must be below 2000 ms, got "+String(totalMS)+" ms")}
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
