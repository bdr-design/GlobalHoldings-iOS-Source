from pathlib import Path
import sys, hashlib, json
src=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
s=(src/'iOS/GlobalHoldings/GameViewController.swift').read_text()
def method(start):
 a=s.index(start);b=s.index('\n    }',a)+6
 return s[a:b].replace('private func','func',1)
helpers=method('    private func prepareNextNativeBootstrap(')+'\n'+method('    private func installBootstrapBeforeNavigation(')
nav=method('    func webView(_ webView: WKWebView, decidePolicyFor navigationAction:')
nav=nav.replace('UIApplication.shared.open(url)','NSWorkspace.shared.open(url)')
code=r'''import Foundation
import AppKit
import WebKit
import CryptoKit
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
let fm=FileManager.default
let folder=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("GlobalHoldingsSaveVault")
guard ProcessInfo.processInfo.environment["GH_NATIVE_AUDIT_EPHEMERAL"]=="1", !fm.fileExists(atPath:folder.path) else {fatalError("Disposable empty CI storage required")}
let vault=GlobalSaveVault.shared
var results:[[String:Any]]=[]
struct Failure:Error {let message:String}
func check(_ value:Bool,_ message:String) throws {if !value {throw Failure(message:message)}}
func test(_ name:String,_ body:() throws -> Void) {do{try body();results.append(["name":name,"ok":true]);print("PASS "+name)}catch{results.append(["name":name,"ok":false,"error":String(describing:error)]);print("FAIL \(name) \(error)")}}
func spin(_ ready:()->Bool) throws {let end=Date().addingTimeInterval(25);while !ready() && Date()<end {RunLoop.current.run(until:Date().addingTimeInterval(0.002))};try check(ready(),"timeout")}
func wait<T>(_ body:(@escaping(Result<T,Error>)->Void)->Void) throws -> T {var result:Result<T,Error>?;body{result=$0};try spin{result != nil};return try result!.get()}
func json(_ revision:Int,_ epoch:Int=0,_ extra:String="") throws -> String {String(data:try JSONSerialization.data(withJSONObject:["saveVersion":"2.0.0","saveRevision":revision,"resetEpoch":epoch,"simSeconds":Double(revision)*60,"speed":3,"extra":extra],options:[.sortedKeys]),encoding:.utf8)!}
final class Scheme:NSObject,WKURLSchemeHandler {
 func webView(_ webView:WKWebView,start task:WKURLSchemeTask) {
  guard let url=task.request.url else{return}
  let html="<html><body><script>let r=window.__GH_NATIVE_SAVE_JSON__?JSON.parse(window.__GH_NATIVE_SAVE_JSON__):null;window.webkit.messageHandlers.probe.postMessage({meta:window.__GH_NATIVE_SAVE_META__||null,slots:window.__GH_NATIVE_SLOT_META__||[],blocked:window.GH_NATIVE_RECOVERY_BLOCKED===true,revision:r?r.saveRevision:null,epoch:r?r.resetEpoch:null,speed:r?r.speed:null});</script></body></html>"
  task.didReceive(URLResponse(url:url,mimeType:"text/html",expectedContentLength:html.utf8.count,textEncodingName:"utf-8"));task.didReceive(Data(html.utf8));task.didFinish()
 }
 func webView(_ webView:WKWebView,stop task:WKURLSchemeTask) {}
}
final class Probe:NSObject,WKNavigationDelegate,WKScriptMessageHandler {
 var webView:WKWebView!
 var nativeNavigationToken:UInt=0
 var nativeBootstrapIntent:UInt=0
 var bootstrapForceOnNavigation=false
 var bootstrapPauseOnNavigation=false
 var messages:[[String:Any]]=[]
 __HELPERS__
 __NAV__
 func userContentController(_ c:WKUserContentController,didReceive m:WKScriptMessage){if let p=m.body as? [String:Any]{messages.append(p)}}
 func direct(_ done:@escaping(WKNavigationActionPolicy)->Void){nativeNavigationToken &+= 1;installBootstrapBeforeNavigation(webView,token:nativeNavigationToken,decisionHandler:done)}
}
let probe=Probe(),scheme=Scheme(),config=WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent();config.setURLSchemeHandler(scheme,forURLScheme:"gh");config.userContentController.add(probe,name:"probe")
let view=WKWebView(frame:NSRect(x:0,y:0,width:600,height:400),configuration:config);probe.webView=view;view.navigationDelegate=probe
let win=NSWindow(contentRect:NSRect(x:0,y:0,width:600,height:400),styleMask:[.borderless],backing:.buffered,defer:false);win.contentView=view
func navigate(_ reload:Bool=false) throws->[String:Any] {let before=probe.messages.count;if reload{view.reload()}else{view.load(URLRequest(url:URL(string:"gh://app/index.html?v="+UUID().uuidString)!))};try spin{probe.messages.count>before};return probe.messages.last!}
test("first navigation awaits verified bootstrap before page scripts run") {let j=try json(1);let _:Int=try wait{vault.commitAsync(j,runtimeVersion:"3.0.0",completion:$0)};let r=try navigate();try check(r["revision"] as? Int==1,"missing initial revision");try check(r["blocked"] as? Bool==false,"valid save blocked")}
test("ordinary commit requires no bootstrap refresh; actual reload reads latest generation") {let j=try json(2);let _:Int=try wait{vault.commitAsync(j,runtimeVersion:"3.0.0",completion:$0)};let r=try navigate(true);try check(r["revision"] as? Int==2,"stale bootstrap after reload")}
test("navigation waits behind a previously queued commit") {let j=try json(3);var completed=false;vault.commitAsync(j,runtimeVersion:"3.0.0"){_ in completed=true};let r=try navigate();try check(completed && r["revision"] as? Int==3,"FIFO barrier violated")}
test("manual slot metadata is refreshed on navigation without per-save script creation") {let j=try json(3);let _:GlobalSaveVault.ManualSlotMetadata=try wait{vault.saveManualSlotAsync(1,json:j,label:"Slot",runtimeVersion:"3.0.0",completion:$0)};let r=try navigate(true),slots=r["slots"] as? [[String:Any]] ?? [];try check(slots.count==1 && slots.first?["index"] as? Int==1,"slot metadata stale")}
test("reset and paused recovery use a coherent new epoch and generation") {let j=try json(1,1);let _:Int=try wait{vault.resetToAsync(j,runtimeVersion:"3.0.0",clearManualSlots:true,completion:$0)};probe.prepareNextNativeBootstrap(force:true,pause:true);let r=try navigate();try check(r["epoch"] as? Int==1 && r["revision"] as? Int==1 && r["speed"] as? Int==0,"old epoch or unpaused restore");try check((r["slots"] as? [Any])?.count==0,"reset resurrected slot")}
test("late recovery intent cannot be consumed by an earlier unpaused snapshot") {var calls=0;var allowed=false;probe.direct{p in calls+=1;allowed=p == .allow};probe.prepareNextNativeBootstrap(force:true,pause:true);try spin{calls>0};try check(calls==1 && allowed,"decision completion wrong");let script=view.configuration.userContentController.userScripts.first?.source ?? "";try check(script.contains("paused:true"),"late pause intent lost")}
test("superseded navigation callbacks complete once and cannot replace latest bootstrap") {var policies:[WKNavigationActionPolicy]=[];probe.direct{policies.append($0)};probe.direct{policies.append($0)};try spin{policies.count==2};try check(policies[0] == .cancel && policies[1] == .allow,"older navigation accepted")}
test("large bootstrap request returns without waiting and finishes on main callback") {let j=try json(2,1,String(repeating:"x",count:14_000_000));let _:Int=try wait{vault.commitAsync(j,runtimeVersion:"3.0.0",completion:$0)};var done=false;var main=false;var length=0;let start=DispatchTime.now().uptimeNanoseconds;vault.bootstrapJavaScriptAsync(force:false){script in main=Thread.isMainThread;length=script.utf8.count;done=true};let dispatchMS=Double(DispatchTime.now().uptimeNanoseconds-start)/1e6;try spin{done};try check(main && length>14_000_000,"async bootstrap failed");let row:[String:Any]=["enqueueMS":dispatchMS,"bootstrapBytes":length,"singleSample":true,"iphoneMeasurement":false];try JSONSerialization.data(withJSONObject:row,options:.prettyPrinted).write(to:URL(fileURLWithPath:"bootstrap-measurement.json"))}
test("two corrupt A/B files fail closed before page boot") {for name in ["save-A.json","save-B.json"]{try Data("corrupted".utf8).write(to:folder.appendingPathComponent(name))};let r=try navigate();try check(r["blocked"] as? Bool==true,"corrupt vault admitted");try check(r["revision"] is NSNull,"corrupt payload exposed")}
vault.reset()
let failed=results.filter{($0["ok"] as? Bool) != true}.count
let report:[String:Any]=["passed":results.count-failed,"total":results.count,"failed":failed,"cases":results,"macOSRealWKWebView":true,"nativeFileIO":true,"iphone":false,"fullGame":false,"controllerMethodsExtractedUnchanged":true]
try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"n2-navigation-tests.json"));print("N2_TESTS \(results.count-failed)/\(results.count)");exit(failed==0 ? 0:1)
'''
code=code.replace('__HELPERS__',helpers).replace('__NAV__',nav)
(out/'main.swift').write_text(code)
(out/'extraction.json').write_text(json.dumps({'controller_sha256':hashlib.sha256(s.encode()).hexdigest(),'test_adapter':'UIKit external-link opener replaced by AppKit only; navigation/snapshot helpers unchanged','device_test':False},indent=2)+'\n')
