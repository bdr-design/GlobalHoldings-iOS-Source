#!/usr/bin/env python3
"""Reconstruct a separate native candidate from an exact historical native source.
Does not modify WebApp, keys, project metadata, an installed app, or an existing destination.
"""
from pathlib import Path
import argparse, hashlib, json, shutil, tempfile, os
BASE_BLOBS = {
 'AppDelegate.swift':'b6b17d46ee812ae7c69e15837003a5e22bbf6d4b',
 'GameViewController.swift':'80fa0bc02ddb2bcd5463d33736f0f563a71a490a',
 'GlobalGameStorage.swift':'12230a3592e5428023d490afff944b4c0dcad4e7',
 'GlobalSaveVault.swift':'7b07299c0134c7f4182ceed8c618a949ba0d7dbc',
}
def replace(s, old, new, count=1):
    if s.count(old)!=count: raise ValueError(f'Expected {count} occurrences, found {s.count(old)}: {old[:160]!r}')
    return s.replace(old,new)
def patch_storage(s):
    s=replace(s,'        let operations: [[String: Any]]\n        let ', '        let operations: [[String: Any]]\n        // Preserve the signed UTF-8 text; never reserialize the parsed array.\n        let operationsJSON: String\n        let ',2)
    s=replace(s,'                "operations": operations,','                "operationsJSON": operationsJSON,')
    s=replace(s,'parse(manifest: manifest, operations: operations, rawFiles: files, rawDeletes:', 'parse(manifest: manifest, operations: operations, operationsJSON: operationsJSON, rawFiles: files, rawDeletes:',2)
    s=replace(s,'        operations: [[String: Any]],\n        rawFiles:', '        operations: [[String: Any]],\n        operationsJSON: String,\n        rawFiles:')
    s=replace(s,'manifest: update.manifest, operations: update.operations, replacedWebFiles: true)', 'manifest: update.manifest, operations: update.operations, operationsJSON: update.operationsJSON, replacedWebFiles: true)')
    s=replace(s,'            operations: operations,\n            files: files,','            operations: operations,\n            operationsJSON: operationsJSON,\n            files: files,')
    return s
VALIDATOR = '''    /// Browser envelopes are authenticated inside the same FIFO queue as the write.
    /// Large JSON/SHA work must not execute in WKScriptMessageHandler on the UI thread.
    private func validateBridgeEnvelope(_ payload: [String: Any], json: String, action: String) throws {
        dispatchPrecondition(condition: .onQueue(queue))
        func integer(_ value: Any?) -> Double? {
            guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
            let v = n.doubleValue
            return v.isFinite && v >= 0 && v <= 9_007_199_254_740_991 && v.rounded(.down) == v ? v : nil
        }
        guard let requestId = payload["requestId"] as? String, !requestId.isEmpty, requestId.count <= 200,
              payload["action"] as? String == action,
              payload["saveSchemaVersion"] as? String == schemaVersion,
              payload["saveJSON"] as? String == json,
              let hash = payload["saveHash"] as? String, hash.utf8.count == 64,
              hash.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              json.utf8.count <= 30 * 1024 * 1024,
              let data = json.data(using: .utf8),
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              root["saveVersion"] as? String == schemaVersion,
              let revision = integer(payload["saveRevision"]),
              let rootRevision = integer(root["saveRevision"]), revision == rootRevision,
              let epoch = integer(payload["resetEpoch"]),
              let rootEpoch = integer(root["resetEpoch"] ?? NSNumber(value: 0)), epoch == rootEpoch,
              sha256(data) == hash else { throw VaultError.message("Invalid save envelope.") }
    }

'''
def patch_vault(s):
    s=replace(s,'func commitAsync(_ json: String, runtimeVersion: String? = nil, completion:', 'func commitAsync(_ json: String, runtimeVersion: String? = nil, envelope: [String: Any]? = nil, completion:')
    s=replace(s,'            let result = Result { try self.commitLocked(json, runtimeVersion: runtimeVersion) }','''            let result = Result<Int, Error> {
                if let envelope { try self.validateBridgeEnvelope(envelope, json: json, action: "commitSave") }
                return try self.commitLocked(json, runtimeVersion: runtimeVersion)
            }''')
    s=replace(s,'func saveManualSlotAsync(_ index: Int, json: String, label: String, runtimeVersion: String? = nil, completion:', 'func saveManualSlotAsync(_ index: Int, json: String, label: String, runtimeVersion: String? = nil, envelope: [String: Any]? = nil, completion:')
    s=replace(s,'            let result = Result<ManualSlotMetadata, Error> {\n                let index', '            let result = Result<ManualSlotMetadata, Error> {\n                if let envelope { try self.validateBridgeEnvelope(envelope, json: json, action: "saveManualSlot") }\n                let index')
    s=replace(s,'clearManualSlots: Bool = false, completion: ((Result<Int, Error>) -> Void)? = nil) {','clearManualSlots: Bool = false, envelope: [String: Any]? = nil, completion: ((Result<Int, Error>) -> Void)? = nil) {')
    s=replace(s,'            let result = Result<Int, Error> {\n                _ = try self.validatePayload(json)','            let result = Result<Int, Error> {\n                if let envelope { try self.validateBridgeEnvelope(envelope, json: json, action: "resetGameSave") }\n                _ = try self.validatePayload(json)')
    s=replace(s,'    private func validatePayload(_ json: String)',VALIDATOR+'    private func validatePayload(_ json: String)')
    return s

def patch_controller(s):
    s=replace(s,'import UIKit\n','import UIKit\nimport CoreFoundation\n')
    s=replace(s,'''    private func payloadInteger(_ value: Any?) -> Int? {
        if let number = value as? NSNumber { return number.intValue }
        if let value = value as? Int { return value }
        if let value = value as? String { return Int(value) }
        return nil
    }''','''    private func payloadInteger(_ value: Any?) -> Int? {
        if let number = value as? NSNumber {
            guard CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
            let v = number.doubleValue
            guard v.isFinite, v >= 0, v <= 9_007_199_254_740_991, v.rounded(.down) == v else { return nil }
            return Int(v)
        }
        if let text = value as? String, let v = Int(text), v >= 0, v <= 9_007_199_254_740_991 { return v }
        return nil
    }

    private func isTrustedGameDocument(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme?.lowercased() == "gh" && url.host?.lowercased() == "app"
            && url.user == nil && url.password == nil && url.port == nil
    }''')
    s=replace(s,'''        guard let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        if message.name''','''        // Privileged bridges are owned by this WebView's main local document only.
        guard message.webView === webView, message.frameInfo.isMainFrame,
              isTrustedGameDocument(message.frameInfo.request.url) else { return }
        guard let payload = message.body as? [String: Any], let action = payload["action"] as? String else { return }
        if message.name''')
    s=replace(s,'''                guard let json = payload["saveJSON"] as? String else { return }
                guard validSaveEnvelope(payload, json: json) else {''','''                guard let json = payload["saveJSON"] as? String else {''')
    s=replace(s,'GlobalSaveVault.shared.commitAsync(json, runtimeVersion: GlobalGameStorage.shared.currentVersion) {','GlobalSaveVault.shared.commitAsync(json, runtimeVersion: GlobalGameStorage.shared.currentVersion, envelope: payload) {')
    s=replace(s,'                      let json = payload["saveJSON"] as? String,\n                      validSaveEnvelope(payload, json: json) else {','                      let json = payload["saveJSON"] as? String else {')
    s=replace(s,'saveManualSlotAsync(index, json: json, label: label, runtimeVersion: GlobalGameStorage.shared.currentVersion) {','saveManualSlotAsync(index, json: json, label: label, runtimeVersion: GlobalGameStorage.shared.currentVersion, envelope: payload) {')
    s=replace(s,'guard let cleanSave = payload["saveJSON"] as? String, validSaveEnvelope(payload, json: cleanSave) else {','guard let cleanSave = payload["saveJSON"] as? String else {')
    s=replace(s,'resetToAsync(cleanSave, runtimeVersion: version, clearManualSlots: clearManualSlots) {','resetToAsync(cleanSave, runtimeVersion: version, clearManualSlots: clearManualSlots, envelope: payload) {')
    start=s.index('    private func validSaveEnvelope(')
    end=s.index('    private func reportBridgeEvent(',start)
    s=s[:start]+s[end:]
    s=replace(s,'''          Promise.resolve(window.GH_RUNTIME?.applyNativeUpdate?.(p)).then(()=>{
            const integrity=window.GH_RUNTIME?.businessIntegrity?.();
            if(integrity&&integrity.status==='critical') throw new Error('Critical integrity failure after update operations: '+JSON.stringify(integrity.counts||{}));''','''          Promise.resolve().then(()=>{
            const runtime=window.GH_RUNTIME;
            if(!runtime||typeof runtime.applyNativeUpdate!=='function'||typeof runtime.businessIntegrity!=='function') throw new Error('Required update runtime owners are unavailable');
            return runtime.applyNativeUpdate(p);
          }).then(applied=>{
            // false can mean a duplicate or unavailable owner: neither proves this signed update was applied.
            if(applied!==true) throw new Error('Update owner did not confirm application; duplicate or ambiguous result rejected');
            const integrity=window.GH_RUNTIME.businessIntegrity();
            if(!integrity||!['healthy','warning'].includes(integrity.status)||!integrity.counts||integrity.counts.critical!==0) throw new Error('Integrity confirmation is missing or critical after update operations');''')
    return s

def main():
    p=argparse.ArgumentParser();p.add_argument('--reference',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():raise SystemExit('Destination must not exist')
    src=a.reference/'iOS/GlobalHoldings'
    for name,expected in BASE_BLOBS.items():
        data=(src/name).read_bytes()
        actual=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if expected!=actual:raise SystemExit('Reference mismatch: '+name)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    stage=Path(tempfile.mkdtemp(prefix='.native-n1-',dir=a.output.parent))
    try:
        shutil.copytree(a.reference,stage/'source')
        for name,fn in [('GlobalGameStorage.swift',patch_storage),('GlobalSaveVault.swift',patch_vault),('GameViewController.swift',patch_controller)]:
            target=stage/'source/iOS/GlobalHoldings'/name
            target.write_text(fn(target.read_text()),encoding='utf-8')
        records={str(p.relative_to(stage/'source')):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((stage/'source').rglob('*')) if p.is_file()}
        (stage/'NATIVE_N1_MANIFEST.json').write_text(json.dumps({'native_reference_commit':'5f9d195e4a23ccfa669eeb0e9f7e92acfb3ac01f','native_candidate_only':True,'matched_installed334':False,'ipa_built':False,'files':records},indent=2)+'\n')
        os.rename(stage,a.output)
    except BaseException:
        shutil.rmtree(stage,ignore_errors=True);raise
    print(json.dumps({'output':str(a.output),'files':len(records),'native_candidate_only':True}))
if __name__=='__main__':main()
