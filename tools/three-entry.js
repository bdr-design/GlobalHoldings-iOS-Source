// esbuild entry for the bundled three.js: the classes and addons the WebApp uses, exposed as the GH_THREE global.
// Run: npm run build:three   (writes WebApp/vendor/three/three-0.180.0.min.js; then tools/refresh_fingerprints.py)
export { Scene, PerspectiveCamera, WebGLRenderer, Color, Fog, Group, Mesh, InstancedMesh, Object3D, BoxGeometry, PlaneGeometry, CylinderGeometry, SphereGeometry, CapsuleGeometry, TorusGeometry, LatheGeometry, Vector2, Vector3, MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, HemisphereLight, DirectionalLight, PointLight, SpotLight, SRGBColorSpace, ACESFilmicToneMapping, PCFSoftShadowMap, DoubleSide, MathUtils, Box3, BufferGeometry, Float32BufferAttribute, Quaternion, Matrix4 } from 'three';

export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
