const fs=require('fs');
const path=require('path');

const read=file=>fs.readFileSync(file,'utf8');
const storage=read('iOS/GlobalHoldings/GlobalGameStorage.swift');
const controller=read('iOS/GlobalHoldings/GameViewController.swift');
const appDelegate=read('iOS/GlobalHoldings/AppDelegate.swift');
const project=read('project.yml');
const advanced=read('WebApp/advanced-core.js');
const app=read('WebApp/app.js');

const files=['AppDelegate.swift','GameViewController.swift','GlobalGameStorage.swift','GlobalSaveVault.swift','LaunchScreen.storyboard'];
const missingFiles=files.filter(file=>!fs.existsSync(path.join('iOS/GlobalHoldings',file)));
if(missingFiles.length)throw new Error(`Missing native runtime files: ${missingFiles.join(', ')}`);
if(fs.existsSync('iOS/GlobalHoldings/ContentView.swift')||fs.existsSync('iOS/GlobalHoldings/GlobalHoldingsApp.swift'))throw new Error('Legacy SwiftUI shell must not coexist with the native runtime');

const storageTokens=['ensureInitialized','Curve25519.Signing.PublicKey','isValidSignature','signatureKeyId','operationsJSON','prepareRuntimeForUpdate','WebApp.staging','WebApp.previous','IncomingUpdates','copyIncomingUpdate','applyUpdatePackage','applyWebBridgeUpdate','restorePreviousVersion','filesIndexSha256','validateStagedWebApp','normalizedJSONData','SHA256.hash','GlobalHoldingsContentVersion','installBundledBaseline','isVersion(bundledVersion, newerThan: recorded)'];
const missingStorage=storageTokens.filter(token=>!storage.includes(token));
if(missingStorage.length)throw new Error(`Native storage is incomplete: ${missingStorage.join(', ')}`);

const controllerTokens=['WKWebView(frame: .zero','saveBridge','webViewWebContentProcessDidTerminate','bootstrapJavaScript(force: true, pause: true)','WKURLSchemeHandler','UIDocumentPickerViewController','updateBridge','openNativeUpdatePicker','supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape','prefersStatusBarHidden','applyPendingNativeOperationsIfNeeded','retryRuntimeInitialization','GlobalGameSchemeHandler','diagnosticBridge','exportDiagnosticBundle','UIActivityViewController'];
const missingController=controllerTokens.filter(token=>!controller.includes(token));
if(missingController.length)throw new Error(`Native controller is incomplete: ${missingController.join(', ')}`);
if(!appDelegate.includes('application(\n        _ app: UIApplication,\n        open url: URL'))throw new Error('AppDelegate does not receive update files from Files');

const projectTokens=['CFBundleDocumentTypes','UTExportedTypeDeclarations','saneiupdate','ghupdate','UIStatusBarHidden: true','UILaunchStoryboardName: LaunchScreen','Copy WebApp Files'];
const missingProject=projectTokens.filter(token=>!project.includes(token));
if(missingProject.length)throw new Error(`iOS project configuration is incomplete: ${missingProject.join(', ')}`);
if(project.includes('UIInterfaceOrientationPortrait'))throw new Error('Global Holdings must remain landscape-only');

const bridgeTokens=['validateUpdatePack','applyUpdateOperations','applyNativeUpdate:async'];
const missingBridge=bridgeTokens.filter(token=>!advanced.includes(token));
if(missingBridge.length||!app.includes('window.GH_RUNTIME'))throw new Error(`Web/native update bridge is incomplete: ${missingBridge.join(', ')}`);
if(fs.existsSync('scripts/build_delta_update.py'))throw new Error('Legacy delta/overlay update builder must not exist under Clean Atomic Update Installer');

console.log('Global Holdings iOS native runtime: PASS');
