from pathlib import Path
import argparse, hashlib, json, shutil, difflib
ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
expected={'GameViewController.swift':'091872028d355a565cbe558710e90d86270d1e0f8c09d7db8758d62c2b9edecc','GlobalSaveVault.swift':'d4755cf780a614b39482adf6377b485d7b7f0e392974375ac3f35b33739279b0','GlobalGameStorage.swift':'facdc70c3086f2bafb486b17a77db3e2472557cda3aef961b07555e4bb0792e5'}
for name,h in expected.items():
 p=a.source/'iOS/GlobalHoldings'/name
 assert hashlib.sha256(p.read_bytes()).hexdigest()==h,name
if a.output.exists():raise SystemExit('Output must be new')
shutil.copytree(a.source,a.output)
p=a.output/'iOS/GlobalHoldings/GlobalSaveVault.swift';s=p.read_text();start=s.index('    func bootstrapJavaScript(force:');end=s.index('    private func envelopes()',start);part=s[start:end]
part=part.replace('    func bootstrapJavaScript(force: Bool, pause: Bool = false) -> String {','    private func bootstrapJavaScriptLocked(force: Bool, pause: Bool) -> String {\n        dispatchPrecondition(condition: .onQueue(queue))')
part=part.replace('let envelope = queue.sync(execute: { bestEnvelope() })','let envelope = bestEnvelope()').replace('let slotMetadata = manualSlotMetadata()','let slotMetadata = (0...2).compactMap { readManualSlot($0)?.metadata }')
methods='''    // All bootstrap material belongs to the same serial owner as commits and
    // resets. No A/B reads, validation or base64 work is performed on the UI
    // callback; navigation waits for the exact queued recovery snapshot.
    func bootstrapJavaScriptAsync(force: Bool, pause: Bool = false, completion: @escaping (String) -> Void) {
        queue.async {
            let script = self.bootstrapJavaScriptLocked(force: force, pause: pause)
            DispatchQueue.main.async { completion(script) }
        }
    }

    func bootstrapJavaScript(force: Bool, pause: Bool = false) -> String {
        queue.sync { bootstrapJavaScriptLocked(force: force, pause: pause) }
    }

'''
s=s[:start]+methods+part+s[end:];p.write_text(s)
p=a.output/'iOS/GlobalHoldings/GameViewController.swift';s=p.read_text();needle='    private var backgroundSaveToken: UInt = 0';assert needle in s
s=s.replace(needle,needle+'''
    private var nativeNavigationToken: UInt = 0
    private var nativeBootstrapIntent: UInt = 0
    private var bootstrapForceOnNavigation = false
    private var bootstrapPauseOnNavigation = false''')
s=s.replace('        let bootstrap = GlobalSaveVault.shared.bootstrapJavaScript(force: false)\n        if !bootstrap.isEmpty { configuration.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }\n','')
s=''.join(line for line in s.splitlines(keepends=True) if not ('.refreshNativeBootstrapScript()' in line or line.strip()=='refreshNativeBootstrapScript()'))
s=s.replace('refreshNativeBootstrapScript(force: true, pause: true)','prepareNextNativeBootstrap(force: true, pause: true)').replace('refreshNativeBootstrapScript(force: true)','prepareNextNativeBootstrap(force: true)')
start=s.index('    private func refreshNativeBootstrapScript(');end=s.index('    private func manualSlotMetadataDictionary',start)
new='''    private func prepareNextNativeBootstrap(force: Bool, pause: Bool = false) {
        // Recovery flags survive ordinary save completions until consumed by the
        // next successful top-level navigation. They do not hold a stale payload.
        bootstrapForceOnNavigation = bootstrapForceOnNavigation || force
        bootstrapPauseOnNavigation = bootstrapPauseOnNavigation || pause
        nativeBootstrapIntent &+= 1
    }

    private func installBootstrapBeforeNavigation(_ target: WKWebView, token: UInt, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let intent = nativeBootstrapIntent
        let force = bootstrapForceOnNavigation
        let pause = bootstrapPauseOnNavigation
        GlobalSaveVault.shared.bootstrapJavaScriptAsync(force: force, pause: pause) { [weak self, weak target] script in
            guard let self, let target, target === self.webView, token == self.nativeNavigationToken else {
                decisionHandler(.cancel)
                return
            }
            // A reset/recovery intent arriving while the snapshot was queued
            // must not be consumed by an earlier unpaused bootstrap.
            guard intent == self.nativeBootstrapIntent else {
                self.installBootstrapBeforeNavigation(target, token: token, decisionHandler: decisionHandler)
                return
            }
            target.configuration.userContentController.removeAllUserScripts()
            if !script.isEmpty {
                target.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            }
            self.bootstrapForceOnNavigation = false
            self.bootstrapPauseOnNavigation = false
            decisionHandler(.allow)
        }
    }

'''
s=s[:start]+new+s[end:]
old='''            webView.configuration.userContentController.removeAllUserScripts()
            let bootstrap = GlobalSaveVault.shared.bootstrapJavaScript(force: false)
            if !bootstrap.isEmpty { webView.configuration.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
'''
assert old in s;s=s.replace(old,'')
needle='''        decisionHandler(.allow)
    }

    private func showMessage'''
replacement='''        if let url = navigationAction.request.url,
           navigationAction.targetFrame?.isMainFrame != false,
           url.scheme?.lowercased() == "gh", url.host?.lowercased() == "app",
           url.user == nil, url.password == nil, url.port == nil {
            nativeNavigationToken &+= 1
            installBootstrapBeforeNavigation(webView, token: nativeNavigationToken, decisionHandler: decisionHandler)
            return
        }
        decisionHandler(.allow)
    }

    private func showMessage'''
assert needle in s;s=s.replace(needle,replacement)
assert 'bootstrapJavaScript(' not in s and 'refreshNativeBootstrapScript' not in s
p.write_text(s)
rows={p.relative_to(a.output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in a.output.rglob('*') if p.is_file()}
(a.output.parent/'n2-source-hashes.json').write_text(json.dumps(rows,indent=2)+'\n')
