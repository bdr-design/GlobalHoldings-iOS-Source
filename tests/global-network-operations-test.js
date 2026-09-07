const fs=require('fs');

const app=fs.readFileSync('WebApp/app.js','utf8');
const css=fs.readFileSync('WebApp/styles.css','utf8');

const requiredApp=[
  'LOCAL_PLACE_AREAS',
  "area:'حي النسيم'",
  'logisticsCenterName',
  'bindHubPlacementGestures',
  "'touchstart'",
  "'contextmenu'",
  "'long-press'",
  'routeEndpoints:{}',
  'ensurePublicRouteEndpoint',
  'buildAirRouteWithTechnicalStops',
  'buildMaritimeRoute',
  'publicAccess:true',
  'createGlobalRoute',
  'globalRouteSearch',
  'refreshVehicleMarker',
  'vehicle-sprite'
];
const missing=requiredApp.filter(token=>!app.includes(token));
if(missing.length)throw new Error(`Global network runtime is incomplete: ${missing.join(', ')}`);

const requiredCss=[
  'grid-template-areas:"actions kpis brand"',
  '.game-frame:has(.drawer.open) .map-stage{margin-right:0!important}',
  '.vehicle-pin',
  '.vehicle-sprite',
  '@keyframes vehiclePulse',
  '.global-route-search{grid-template-columns:minmax(0,1fr)}'
];
const missingCss=requiredCss.filter(token=>!css.includes(token));
if(missingCss.length)throw new Error(`Global network visual contract is incomplete: ${missingCss.join(', ')}`);

if(!/handleMapPlacement\(event,'tap'\)/.test(app)||!/handleMapPlacement\(event,'long-press'\)/.test(app)){
  throw new Error('Map placement does not preserve both tap fallback and mobile long-press placement.');
}
if(!/فتح القاعدة اختياري/.test(app)||!/لا يلزم امتلاك قاعدة أو مركز فيه/.test(app)){
  throw new Error('Public airport/port route policy is not visible to the player.');
}

console.log('Global Holdings global network operations: PASS');
