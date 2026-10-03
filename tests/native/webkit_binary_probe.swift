// Build 358 (million-asset save, evidence only): which binary paths does WKWebView offer between the game page and
// native code? The chunked save vault needs to move 4 MiB record chunks both ways without a base64 string if it can.
// Probed on the CI macOS WebKit (the same engine as iOS):
//   upload    fetch('gh://app/upload',{method:'POST',body:ArrayBuffer})  -> does the scheme handler see the body bytes?
//   download  fetch('gh://app/blob') -> ArrayBuffer                         -> are the bytes intact, how long does it take?
//   message   saveBridge.postMessage({buffer:ArrayBuffer})                 -> what type arrives, if any?
// Writes webkit-binary-probe.json; never fails the build (a missing path is a result, not an error).
import Foundation
import AppKit
import WebKit
import CryptoKit

let app=NSApplication.shared
app.setActivationPolicy(.prohibited)
let size=4*1024*1024
func pattern(_ n:Int)->Data{var d=Data(count:n);d.withUnsafeMutableBytes{(p:UnsafeMutableRawBufferPointer) in for i in 0..<n{p[i]=UInt8(truncatingIfNeeded:(i&*2654435761)>>24)}};return d}
func hex(_ d:Data)->String{SHA256.hash(data:d).map{String(format:"%02x",$0)}.joined()}
let blob=pattern(size),blobHash=hex(blob)
var results:[String:Any]=["bytes":size,"expectedSha256":blobHash]

final class Scheme:NSObject,WKURLSchemeHandler {
 func webView(_ webView:WKWebView,start task:WKURLSchemeTask) {
  guard let u=task.request.url else {return}
  func reply(_ data:Data,_ mime:String) {
   let response=HTTPURLResponse(url:u,statusCode:200,httpVersion:"HTTP/1.1",headerFields:["Content-Type":mime,"Content-Length":String(data.count),"Access-Control-Allow-Origin":"*"])!
   task.didReceive(response);task.didReceive(data);task.didFinish()
  }
  switch u.path {
  case "/index.html":
   let html="""
   <html><body><script>
   (async()=>{
    const post=(kind,detail)=>window.webkit.messageHandlers.saveBridge.postMessage({kind,detail});
    const n=\(size),bytes=new Uint8Array(n);for(let i=0;i<n;i++)bytes[i]=Number((BigInt(i)*2654435761n)>>24n&255n);
    const hex=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const local=await hex(bytes);post('page-hash',{sha256:local});
    try{const t=performance.now();const r=await fetch('gh://app/upload',{method:'POST',body:bytes});const j=await r.json();post('upload',{ms:performance.now()-t,status:r.status,received:j});}catch(e){post('upload',{error:String(e)});}
    try{const t=performance.now();const r=await fetch('gh://app/blob');const b=await r.arrayBuffer();const ms=performance.now()-t;post('download',{ms,bytes:b.byteLength,sha256:await hex(b)});}catch(e){post('download',{error:String(e)});}
    try{const t=performance.now();window.webkit.messageHandlers.saveBridge.postMessage({kind:'message',buffer:bytes.buffer});post('message-sent',{ms:performance.now()-t});}catch(e){post('message-sent',{error:String(e)});}
    try{const t=performance.now();let s='';const step=1<<20;for(let i=0;i<n;i+=step)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+step));const b64=btoa(s);window.webkit.messageHandlers.saveBridge.postMessage({kind:'base64',text:b64});post('base64-sent',{ms:performance.now()-t,chars:b64.length});}catch(e){post('base64-sent',{error:String(e)});}
    post('done',{});
   })();
   </script></body></html>
   """
   reply(Data(html.utf8),"text/html")
  case "/upload":
   var body=task.request.httpBody
   if body==nil, let stream=task.request.httpBodyStream {
    var d=Data();stream.open();var buf=[UInt8](repeating:0,count:65536)
    while stream.hasBytesAvailable {let k=stream.read(&buf,maxLength:buf.count);if k<=0 {break};d.append(buf,count:k)}
    stream.close();body=d;results["uploadVia"]="httpBodyStream"
   } else if body != nil {results["uploadVia"]="httpBody"}
   let json=try! JSONSerialization.data(withJSONObject:["bytes":body?.count ?? -1,"sha256":body.map{hex($0)} ?? ""])
   reply(json,"application/json")
  case "/blob": reply(blob,"application/octet-stream")
  default: reply(Data(),"text/plain")
  }
 }
 func webView(_ webView:WKWebView,stop task:WKURLSchemeTask) {}
}
final class Probe:NSObject,WKScriptMessageHandler {
 var done=false
 func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage) {
  guard let body=message.body as? [String:Any],let kind=body["kind"] as? String else {results["unexpectedBody"]=String(describing:type(of:message.body));return}
  switch kind {
  case "message":
   let value=body["buffer"]
   results["messageBufferType"]=value.map{String(describing:type(of:$0))} ?? "absent"
   if let data=value as? Data {results["messageBufferBytes"]=data.count;results["messageBufferSha256Matches"]=hex(data)==blobHash}
  case "base64":
   if let text=body["text"] as? String, let data=Data(base64Encoded:text) {results["base64Bytes"]=data.count;results["base64Sha256Matches"]=hex(data)==blobHash}
  case "done": done=true
  default:
   results[kind]=body["detail"] ?? NSNull()
  }
 }
}
let scheme=Scheme(),probe=Probe()
let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
config.setURLSchemeHandler(scheme,forURLScheme:"gh")
config.userContentController.add(probe,name:"saveBridge")
let view=WKWebView(frame:NSRect(x:0,y:0,width:400,height:300),configuration:config)
let window=NSWindow(contentRect:NSRect(x:0,y:0,width:400,height:300),styleMask:[.borderless],backing:.buffered,defer:false)
window.contentView=view
view.load(URLRequest(url:URL(string:"gh://app/index.html")!))
let until=Date().addingTimeInterval(60)
while !probe.done && Date()<until {RunLoop.current.run(until:Date().addingTimeInterval(0.02))}
results["completed"]=probe.done
if let upload=results["upload"] as? [String:Any], let received=upload["received"] as? [String:Any] {results["uploadBodyIntact"]=(received["sha256"] as? String)==blobHash}
if let download=results["download"] as? [String:Any] {results["downloadIntact"]=(download["sha256"] as? String)==blobHash}
let data=try! JSONSerialization.data(withJSONObject:results,options:[.prettyPrinted,.sortedKeys])
try! data.write(to:URL(fileURLWithPath:"webkit-binary-probe.json"))
print(String(data:data,encoding:.utf8)!)
