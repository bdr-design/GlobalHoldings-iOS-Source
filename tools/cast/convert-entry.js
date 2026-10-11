// Conference cast, step 2: esbuild entry for convert-lib.js, the three.js bundle convert.html loads as the CONVERT global.
// Run: npx esbuild tools/cast/convert-entry.js --bundle --format=iife --global-name=CONVERT --outfile=tools/cast/convert-lib.js
export * from 'three';
export {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
export {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
export {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
