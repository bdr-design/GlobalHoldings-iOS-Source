const fs=require('fs'),assert=require('assert');
const app=fs.readFileSync('WebApp/app.js','utf8'),advanced=fs.readFileSync('WebApp/advanced-core.js','utf8');
for(const forbidden of ["entity.icao||entity.code||Date.now()","entity.code||Date.now()","PUBLIC-${now.toString(36)}","updated:new Date().toISOString()","commercialRegistration:`CR-${new Date().getFullYear()}","commercialRegistration:`CR-GH-${new Date().getFullYear()}"])assert(!app.includes(forbidden),`wall-clock state path remains: ${forbidden}`);
for(const forbidden of ["localStorage.setItem(`global-holdings-save-slot-","localStorage.getItem(`global-holdings-save-slot-","GlobalHoldings_Save_${Date.now()}"])assert(!advanced.includes(forbidden),`legacy persistence bypass remains: ${forbidden}`);
assert(app.includes("window.GH_PERSISTENCE?.migrateMetadata?.(state)"),'Persistence metadata migration missing');
assert(app.includes("'routes','cache-geometry'")&&fs.readFileSync("WebApp/route-core.js","utf8").includes("cachedAtSim:Number(s.simSeconds)||0"),'route cache must use simulation timestamp');
console.log('Deterministic state + persistence guard 2.3.9: PASS');
