#!/usr/bin/env python3
import argparse,json,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
v=(a.source/'iOS/GlobalHoldings/GlobalSaveVault.swift').read_text();c=(a.source/'iOS/GlobalHoldings/GameViewController.swift').read_text();modern='private func commitEnvelopeLocked(' in v
wrapper='vault.commitAsync(json,runtimeVersion:"3.0.0",envelope:env,bootstrap:bootstrap,completion:completion)' if modern else 'vault.commitAsync(json,runtimeVersion:"3.0.0",envelope:env){result in if case .success = result { bootstrap(vault.bootstrapJavaScript(force:false)) };completion(result)}'
if 'private func acceptsNativeCallback(' in c:
 start=c.index('    private func acceptsNativeCallback(');end=c.index('\n    }',start)+6;policy=c[start:end].replace('private func','func',1)
else:policy='func acceptsNativeCallback(pageEpoch:UInt,bootstrapEpoch:UInt?=nil)->Bool { true }'
code=r'''import Foundation
import CryptoKit
struct Failure:Error {let message:String}
let fm=FileManager.default
let folder=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("GlobalHoldingsSaveVault")
guard ProcessInfo.processInfo.environment["GH_NATIVE_AUDIT_EPHEMERAL"]=="1", !fm.fileExists(atPath:folder.path) else {fatalError("Fresh disposable runner required")}
let vault=GlobalSaveVault.shared
var rows:[[String:Any]]=[]
func check(_ condition:Bool,_ message:String) throws {if !condition {throw Failure(message:message)}}
func test(_ name:String,_ body:() throws->Void){do {try body();rows.append(["name":name,"ok":true]);print("PASS "+name)}catch{rows.append(["name":name,"ok":false,"error":String(describing:error)]);print("FAIL \(name): \(error)")}}
func json(_ rev:Int,_ epoch:Int=0,_ extra:String="") throws->String {String(data:try JSONSerialization.data(withJSONObject:["saveVersion":"2.0.0","saveRevision":rev,"resetEpoch":epoch,"simSeconds":Double(rev)*60,"label":"العساف / 海 🚢","extra":extra],options:[.sortedKeys]),encoding:.utf8)!}
func hash(_ s:String)->String {SHA256.hash(data:Data(s.utf8)).map{String(format:"%02x",$0)}.joined()}
func envelope(_ raw:String,_ action:String="commitSave") throws->[String:Any] {let o=try JSONSerialization.jsonObject(with:Data(raw.utf8)) as! [String:Any];return ["action":action,"requestId":"r4-\(UUID().uuidString)","saveSchemaVersion":"2.0.0","saveJSON":raw,"saveRevision":o["saveRevision"]!,"resetEpoch":o["resetEpoch"]!,"saveHash":hash(raw)]}
func submit(_ json:String,_ env:[String:Any],bootstrap:@escaping(String)->Void,completion:@escaping(Result<Int,Error>)->Void) { __WRAPPER__ }
func wait<T>(_ body:(@escaping(Result<T,Error>)->Void)->Void)throws->T {var r:Result<T,Error>?;body{r=$0};let end=Date().addingTimeInterval(60);while r==nil && Date()<end {RunLoop.current.run(until:Date().addingTimeInterval(0.002))};guard let r else{throw Failure(message:"timeout")};return try r.get()}
func pump(_ done:()->Bool)throws {let end=Date().addingTimeInterval(60);while !done() && Date()<end{RunLoop.current.run(until:Date().addingTimeInterval(0.002))};try check(done(),"callback timeout")}
func payload(_ script:String)throws->String {guard let range=script.range(of:"atob('") else{throw Failure(message:"payload absent")};let b64=script[range.upperBound...].prefix{ $0 != "'" };guard let d=Data(base64Encoded:String(b64)),let raw=String(data:d,encoding:.utf8)else{throw Failure(message:"payload malformed")};return raw}
func slots(_ script:String)throws->[[String:Any]] {guard let head=script.range(of:"window.__GH_NATIVE_SLOT_META__="),let begin=script[head.upperBound...].range(of:"atob('") else{throw Failure(message:"slots absent")};let b64=script[begin.upperBound...].prefix{$0 != "'"};return try JSONSerialization.jsonObject(with:Data(base64Encoded:String(b64))!) as! [[String:Any]]}
func disk()throws->[String:String] {if !fm.fileExists(atPath:folder.path){return [:]};var r:[String:String]=[:];for f in try fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil){r[f.lastPathComponent]=SHA256.hash(data:try Data(contentsOf:f)).map{String(format:"%02x",$0)}.joined()};return r}
final class Policy {var nativePageEpoch:UInt=3;var nativeBootstrapEpoch:UInt=7; __POLICY__ }
test("FIFO exact verified generation, script before ack, callbacks main even with backlog") {
 var events:[String]=[],errors:[String]=[];var scripts:[Int:String]=[:];var generations:[Int:Int]=[:]
 for i in 1...6 {let raw=try json(i);submit(raw,try envelope(raw),bootstrap:{s in if !Thread.isMainThread{errors.append("not main")};scripts[i]=s;events.append("S\(i)")},completion:{r in if !Thread.isMainThread{errors.append("not main ack")};switch r{case .success(let g):generations[i]=g;case .failure(let e):errors.append(String(describing:e))};events.append("A\(i)")})}
 _=vault.currentGeneration() // Intentionally hold the UI until all writes have drained.
 try pump{events.count==12};try check(errors.isEmpty,"callback failure \(errors)")
 try check(events==(1...6).flatMap{["S\($0)","A\($0)"]},"ordering")
 for i in 1...6 {try check(try payload(scripts[i]!)==json(i),"script for revision \(i) was replaced by another generation");try check(scripts[i]!.contains("generation:\(generations[i]!),saveRevision:\(i),"),"metadata wrong")}
}
test("synchronous recovery sees newest verified generation without deadlock") {let s=vault.bootstrapJavaScript(force:true,pause:true);try check(try payload(s)==json(6),"latest raw mismatch");try check(s.contains("forced:true,paused:true"),"recovery flags lost")}
test("invalid save never emits bootstrap and never changes disk") {let raw=try json(7);var env=try envelope(raw);env["saveHash"]=String(repeating:"0",count:64);let before=try disk();var called=false,failed=false;do {let _:Int=try wait{done in submit(raw,env,bootstrap:{_ in called=true},completion:done)}}catch{failed=true};try check(failed && !called,"invalid save accepted or published");try check(try disk()==before,"invalid save mutated storage")}
test("manual slot metadata is captured with each write rather than a later slot mutation") {
 let old=try json(4);let _:GlobalSaveVault.ManualSlotMetadata=try wait{vault.saveManualSlotAsync(0,json:old,label:"old",runtimeVersion:"3.0.0",completion:$0)}
 let raw=try json(7),future=try json(8);var captured:String?,done=false,slotDone=false
 submit(raw,try envelope(raw),bootstrap:{captured=$0},completion:{_ in done=true})
 vault.saveManualSlotAsync(0,json:future,label:"new",runtimeVersion:"3.0.0"){_ in slotDone=true}
 _=vault.currentGeneration();try pump{done && slotDone};try check(captured != nil,"no snapshot")
 try check(try slots(captured!)[0]["saveRevision"] as? Int==4,"snapshot used later slot data")
 try check(try slots(vault.bootstrapJavaScript(force:false))[0]["saveRevision"] as? Int==8,"new slot not visible later")
}
test("reset and following write retain FIFO epochs and correct recovery bytes") {
 let clean=try json(1,100),after=try json(2,100);var events:[String]=[],snapshot:String?,failure=false
 vault.resetToAsync(clean,runtimeVersion:"3.0.0",clearManualSlots:true,envelope:try envelope(clean,"resetGameSave")){r in if case .failure=r{failure=true};events.append("reset")}
 submit(after,try envelope(after),bootstrap:{snapshot=$0;events.append("script")},completion:{r in if case .failure=r{failure=true};events.append("ack")})
 _=vault.currentGeneration();try pump{events.count==3};try check(!failure && events==["reset","script","ack"],"reset/write order")
 try check(try payload(snapshot!)==after && slots(snapshot!).isEmpty,"wrong reset snapshot/slots");try check(snapshot!.contains("resetEpoch:Number(100)"),"old epoch returned")
}
test("corrupt newest generation falls back to verified peer; no unverified bootstrap") {
 let current=vault.currentGeneration();for f in try fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil) where ["save-A.json","save-B.json"].contains(f.lastPathComponent){let o=try JSONSerialization.jsonObject(with:Data(contentsOf:f)) as! [String:Any];if (o["generation"] as? Int)==current{try Data("corrupt".utf8).write(to:f)}}
 let s=vault.bootstrapJavaScript(force:true);try check(try payload(s)==json(1,100),"corrupt save promoted")
}
for (name,page,boot,expected) in [("current callback",UInt(3),Optional(UInt(7)),true),("old page",UInt(2),Optional(UInt(7)),false),("old bootstrap",UInt(3),Optional(UInt(6)),false),("current ack",UInt(3),nil,true),("old-page ack",UInt(2),nil,false)] {test(name){try check(Policy().acceptsNativeCallback(pageEpoch:page,bootstrapEpoch:boot)==expected,"stale callback policy")}}
// UI callback workload only; this does not include WKUserScript installation or an iPhone.
vault.reset();var samples:[[String:Any]]=[]
for i in 1...4 {
 let raw=try json(i,0,String(repeating:"x",count:14_000_000)),env=try envelope(raw)
 var callbackStart:UInt64=0,callbackEnd:UInt64=0;let t=DispatchTime.now().uptimeNanoseconds
 var completed=false,success=false
 __MEASURE__
 let enqueued=DispatchTime.now().uptimeNanoseconds;try pump{completed}
 samples.append(["bytes":raw.utf8.count,"enqueue_ms":Double(enqueued-t)/1e6,"ui_callback_preparation_ms":Double(callbackEnd-callbackStart)/1e6,"whole_save_ms":Double(DispatchTime.now().uptimeNanoseconds-t)/1e6,"success":success,"warmup":i==1])
}
try JSONSerialization.data(withJSONObject:["samples":samples,"iphone":false,"includes_webkit_install":false],options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"bootstrap-performance.json"))
vault.reset();let failed=rows.filter{($0["ok"] as? Bool) != true}.count
try JSONSerialization.data(withJSONObject:["total":rows.count,"passed":rows.count-failed,"failed":failed,"cases":rows,"real_macos_files":true,"iphone":false,"controller_policy_extracted_from_source":true],options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"native-bootstrap-tests.json"))
print("BOOTSTRAP_TESTS \(rows.count-failed)/\(rows.count)");exit(failed==0 ? 0:1)
'''
measure='''vault.commitAsync(raw,runtimeVersion:"3.0.0",envelope:env,bootstrap:{script in callbackStart=DispatchTime.now().uptimeNanoseconds;_ = script.utf8.count;callbackEnd=DispatchTime.now().uptimeNanoseconds}){r in success=(try? r.get()) != nil;completed=true}''' if modern else '''vault.commitAsync(raw,runtimeVersion:"3.0.0",envelope:env){r in callbackStart=DispatchTime.now().uptimeNanoseconds;_ = vault.bootstrapJavaScript(force:false);callbackEnd=DispatchTime.now().uptimeNanoseconds;success=(try? r.get()) != nil;completed=true}'''
code=code.replace('__WRAPPER__',wrapper).replace('__POLICY__',policy).replace('__MEASURE__',measure)
(a.output/'main.swift').write_text(code)
(a.output/'source-checks.json').write_text(json.dumps({'modern':modern,'sha256':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in (a.source/'iOS/GlobalHoldings').glob('*.swift')},'controller_uses_policy':c.count('self.acceptsNativeCallback('),'navigation_hook':'didStartProvisionalNavigation' in c},indent=2))
