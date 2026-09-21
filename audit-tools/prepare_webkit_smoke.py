from pathlib import Path
import sys,hashlib,json
src=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
text=(src/'iOS/GlobalHoldings/GameViewController.swift').read_text()
start=text.index('    private func isTrustedGameDocument(');end=text.index('\n    }',start)+6
helper=text[start:end]
gate='guard message.webView === webView, message.frameInfo.isMainFrame,\n              isTrustedGameDocument(message.frameInfo.request.url) else { return }'
assert gate in text
code=r'''import Foundation
import AppKit
import WebKit
let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
final class Scheme:NSObject,WKURLSchemeHandler {
 func webView(_ webView:WKWebView,start task:WKURLSchemeTask) {
  guard let u=task.request.url else {return}
  let tag = u.path=="/frame.html" ? "child" : "main"
  let frame = u.path=="/index.html" && u.host=="app" ? "<iframe src='gh://app/frame.html'></iframe>" : ""
  let html="<html><body>\(frame)<script>window.webkit.messageHandlers.saveBridge.postMessage({tag:'\(tag)'});</script></body></html>"
  task.didReceive(URLResponse(url:u,mimeType:"text/html",expectedContentLength:html.utf8.count,textEncodingName:"utf-8"))
  task.didReceive(Data(html.utf8));task.didFinish()
 }
 func webView(_ webView:WKWebView,stop task:WKURLSchemeTask) {}
}
final class Probe:NSObject,WKScriptMessageHandler {
 var webView:WKWebView!
 var rows:[[String:Any]]=[]
 var phase=""
__HELPER__
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage) {
  var accepted=false
  func applyGate() {
    __GATE__
    accepted=true
  }
  applyGate()
  rows.append(["phase":phase,"isMainFrame":message.frameInfo.isMainFrame,"sameWebView":message.webView === webView,"url":message.frameInfo.request.url?.absoluteString ?? "","accepted":accepted])
 }
}
let scheme=Scheme(),probe=Probe()
func view()->WKWebView {
 let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
 config.setURLSchemeHandler(scheme,forURLScheme:"gh")
 config.userContentController.add(probe,name:"saveBridge")
 return WKWebView(frame:NSRect(x:0,y:0,width:600,height:400),configuration:config)
}
let primary=view();probe.webView=primary
let win=NSWindow(contentRect:NSRect(x:0,y:0,width:600,height:400),styleMask:[.borderless],backing:.buffered,defer:false)
win.contentView=primary
func waitRows(_ count:Int) {
 let until=Date().addingTimeInterval(20)
 while probe.rows.count<count && Date()<until {RunLoop.current.run(until:Date().addingTimeInterval(0.01))}
}
probe.phase="local-main-and-subframe"
primary.load(URLRequest(url:URL(string:"gh://app/index.html")!));waitRows(2)
probe.phase="wrong-host"
primary.load(URLRequest(url:URL(string:"gh://other/index.html")!));waitRows(3)
probe.phase="blank-document"
primary.loadHTMLString("<script>window.webkit.messageHandlers.saveBridge.postMessage({tag:'blank'})</script>",baseURL:nil);waitRows(4)
probe.phase="other-webview"
let other=view();other.load(URLRequest(url:URL(string:"gh://app/other.html")!));waitRows(5)
let cases:[[String:Any]]=[
 ["name":"custom-scheme main document allowed","ok":probe.rows.contains{($0["phase"] as? String)=="local-main-and-subframe" && ($0["isMainFrame"] as? Bool)==true && ($0["accepted"] as? Bool)==true}],
 ["name":"same-origin subframe denied","ok":probe.rows.contains{($0["phase"] as? String)=="local-main-and-subframe" && ($0["isMainFrame"] as? Bool)==false && ($0["accepted"] as? Bool)==false}],
 ["name":"wrong local host denied","ok":probe.rows.contains{($0["phase"] as? String)=="wrong-host" && ($0["accepted"] as? Bool)==false}],
 ["name":"about blank denied","ok":probe.rows.contains{($0["phase"] as? String)=="blank-document" && ($0["accepted"] as? Bool)==false}],
 ["name":"different webview denied","ok":probe.rows.contains{($0["phase"] as? String)=="other-webview" && ($0["accepted"] as? Bool)==false}]
]
let failed=cases.filter{($0["ok"] as? Bool) != true}.count
let report:[String:Any]=["cases":cases,"messages":probe.rows,"passed":cases.count-failed,"total":cases.count,"failed":failed,"realWKWebView":true,"platform":"macOS","iphone_test":false,"full_game_test":false]
try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"webkit-smoke.json"))
print("WK_SMOKE \(cases.count-failed)/\(cases.count)")
exit(failed==0 ? 0:1)
'''
(out/'main.swift').write_text(code.replace('__HELPER__',helper).replace('__GATE__',gate))
(out/'probe-provenance.json').write_text(json.dumps({'controller_sha256':hashlib.sha256(text.encode()).hexdigest(),'gate_copied_verbatim':True,'helper_copied_verbatim':True},indent=2)+'\n')
