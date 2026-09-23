from pathlib import Path
import sys
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
(out/'main.swift').write_text(r'''import Foundation
import CryptoKit
let fm=FileManager.default
let root=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("GlobalHoldingsRuntime")
let vaultFolder=fm.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("GlobalHoldingsSaveVault")
guard ProcessInfo.processInfo.environment["GH_NATIVE_AUDIT_EPHEMERAL"]=="1", !fm.fileExists(atPath:root.path),!fm.fileExists(atPath:vaultFolder.path) else{fatalError("Disposable empty test directories required")}
let store=GlobalGameStorage.shared,vault=GlobalSaveVault.shared,defaults=UserDefaults.standard
let keys=["GlobalHoldingsContentVersion","GlobalHoldingsInstalledBundledBuild","GlobalHoldingsAttemptedBundleSnapshot","GlobalHoldingsPendingContentBootVersion","GlobalHoldingsPendingContentPreviousVersion","GlobalHoldingsPreviousContentVersion","GlobalHoldingsPreviousContentBuild"]
for k in keys{defaults.removeObject(forKey:k)}
var rows:[[String:Any]]=[]
struct Failure:Error{let text:String}
func check(_ b:Bool,_ text:String)throws{if !b{throw Failure(text:text)}}
func test(_ name:String,_ f:()throws->Void){do{try f();rows.append(["name":name,"ok":true]);print("PASS "+name)}catch{rows.append(["name":name,"ok":false,"error":String(describing:error)]);print("FAIL \(name) \(error)")}}
func read(_ name:String)throws->Data{try Data(contentsOf:store.webURL.appendingPathComponent(name))}
func save(_ n:Int)throws {let obj:[String:Any]=["saveVersion":"2.0.0","saveRevision":n,"resetEpoch":0,"simSeconds":n*60];let text=String(data:try JSONSerialization.data(withJSONObject:obj),encoding:.utf8)!;_ = try vault.commit(text,runtimeVersion:"3.0.0")}
let bundled=Bundle.main.resourceURL!.appendingPathComponent("WebApp"),snapshot=(Bundle.main.object(forInfoDictionaryKey:"GHSourceSnapshotSHA256") as? String) ?? ""
let manifest=try JSONSerialization.data(withJSONObject:["format":"gh-runtime-required-v1","saveSchemaVersion":"2.0.0","minimumNativeBuild":251,"files":["runtime-required.json","index.html","marker.txt"]])
try fm.createDirectory(at:bundled,withIntermediateDirectories:true);try manifest.write(to:bundled.appendingPathComponent("runtime-required.json"));try Data("<html><body>native installation test only</body></html>".utf8).write(to:bundled.appendingPathComponent("index.html"));try Data("fresh334".utf8).write(to:bundled.appendingPathComponent("marker.txt"))
test("first install creates only a validated complete source copy"){try store.ensureInitialized();try check(try read("marker.txt")==Data("fresh334".utf8),"wrong source");try check(store.installedBuild==334,"wrong Build");try check(defaults.string(forKey:"GlobalHoldingsAttemptedBundleSnapshot")==snapshot,"snapshot not recorded")}
test("same Build334 repaired snapshot is promoted once and preserves pinned save"){try save(1);defaults.removeObject(forKey:"GlobalHoldingsAttemptedBundleSnapshot");try Data("old334".utf8).write(to:store.webURL.appendingPathComponent("marker.txt"));try store.ensureInitialized();try check(try read("marker.txt")==Data("fresh334".utf8),"same-number repair was skipped");try check(vault.hasRollbackCheckpoint(for:"3.0.0"),"save not pinned");try check(defaults.string(forKey:"GlobalHoldingsAttemptedBundleSnapshot")==snapshot,"snapshot admission missing");let j=root.appendingPathComponent("update-journal.json");try check(fm.fileExists(atPath:j.path),"no durable journal");let _:Bool=try store.confirmCurrentUpdateBoot(version:"3.0.0",build:334)}
test("same snapshot does not overwrite runtime repeatedly on launch"){try Data("already-admitted".utf8).write(to:store.webURL.appendingPathComponent("marker.txt"));try store.ensureInitialized();try check(try read("marker.txt")==Data("already-admitted".utf8),"repeated unwanted replacement")}
test("newer runtime version is never replaced by repaired old semantic version"){defaults.set("3.1.0",forKey:"GlobalHoldingsContentVersion");defaults.removeObject(forKey:"GlobalHoldingsAttemptedBundleSnapshot");try store.ensureInitialized();try check(try read("marker.txt")==Data("already-admitted".utf8),"newer content downgraded");defaults.set("3.0.0",forKey:"GlobalHoldingsContentVersion")}
test("failed staging leaves old active runtime and files untouched"){try fm.removeItem(at:bundled.appendingPathComponent("marker.txt"));var failed=false;do{try store.ensureInitialized()}catch{failed=true};try check(failed,"missing bundled required file was accepted");try check(try read("marker.txt")==Data("already-admitted".utf8),"failed copy published partial runtime");try Data("fresh334".utf8).write(to:bundled.appendingPathComponent("marker.txt"))}
let failures=rows.filter{($0["ok"] as? Bool) != true}.count
try JSONSerialization.data(withJSONObject:["cases":rows,"passed":rows.count-failures,"total":rows.count,"failed":failures,"realNativeStorage":true,"iPhone":false],options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:"bundle-tests.json"))
try? fm.removeItem(at:root);vault.reset();for k in keys{defaults.removeObject(forKey:k)}
exit(failures==0 ? 0:1)
''')
