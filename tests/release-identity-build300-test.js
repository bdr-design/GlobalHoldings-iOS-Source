'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');

const root=path.resolve(__dirname,'..');
const version=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
const build=fs.readFileSync(path.join(root,'BUILD'),'utf8').trim();
const project=fs.readFileSync(path.join(root,'project.yml'),'utf8');
const app=fs.readFileSync(path.join(root,'WebApp','app.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const builder=fs.readFileSync(path.join(root,'scripts','build_update.py'),'utf8');

assert.strictEqual(version,'3.0.0');
assert.strictEqual(build,'313');
assert.strictEqual(pkg.version,`${version}-build${build}`);
assert(project.includes(`MARKETING_VERSION: "${version}"`));
assert(project.includes(`CURRENT_PROJECT_VERSION: "${build}"`));
assert(project.includes(`CFBundleShortVersionString: "${version}"`));
assert(project.includes(`CFBundleVersion: "${build}"`));
assert(app.includes(`const APP_VERSION = '${version}';`));
assert(app.includes(`const RUNTIME_BUILD = ${build};`));
assert(app.includes("const SAVE_SCHEMA_VERSION = '2.0.0';"));
assert(builder.includes("VERSION=(ROOT/'VERSION').read_text"));
assert(builder.includes("BUILD=int((ROOT/'BUILD').read_text"));

for(const name of fs.readdirSync(path.join(root,'WebApp')).filter(name=>name.endsWith('-core.js')||name==='save-schema.js')){
  const source=fs.readFileSync(path.join(root,'WebApp',name),'utf8');
  assert(source.includes(`VERSION='${version}'`)||source.includes(`VERSION = '${version}'`)||source.includes(`APP_VERSION='${version}'`),`${name} does not expose the canonical runtime version`);
}

console.log(`BUILD${build} release identity and Save Schema 2.0.0: PASS`);
