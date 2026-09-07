const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('WebApp/index.html', 'utf8');
const source = fs.readFileSync('WebApp/app.js', 'utf8');
const localScripts = [
  'world-data.js','catalog.js','realism-core.js','persistence-core.js','workflow-core.js',
  'department-core.js','interaction-core.js','ui-quality-core.js','hr-core.js','economics-core.js','advanced-core.js',
  'event-ledger-core.js','dependency-core.js','policy-core.js','lifecycle-core.js',
  'demand-closure-core.js','integrity-core.js','request-core.js','save-schema.js',
  'determinism-core.js','diagnostics-core.js','transaction-core.js','migration-core.js','game-lifecycle-core.js','domain-command-core.js',
  'finance-core.js','procurement-core.js','banking-core.js','market-core.js','strategy-core.js',
  'facility-core.js','fleet-core.js','route-core.js','governance-core.js','corporate-core.js',
  'ai-executive-core.js','operations-core.js','contracts-core.js','control-plane-core.js','simulation-core.js'
];
const scriptSources = Object.fromEntries(localScripts.map(name => [name, fs.readFileSync(`WebApp/${name}`, 'utf8')]));

const referencedIds = [...source.matchAll(/\$\('([^']+)'\)/g)].map(match => match[1]);
const dynamicIds = new Set(['drawerGodBtn', 'moreGodBtn', 'worldSearch', 'worldKind', 'roadFrom', 'roadTo', 'assetSearch', 'assetSegment', 'globalRouteSearch','financeDocsCompany','chequeCompany','chequeAmount','chequeBeneficiary','chequeNote','invoiceCompany','invoiceKind','invoiceAmount','invoiceNote','invoiceCounterparty','companyTransferFrom','companyTransferTo','companyTransferAmount','bulkTransferTotal','bulkTransferPool']);
const missingIds = [...new Set(referencedIds)].filter(id => !dynamicIds.has(id) && !new RegExp(`id=["']${id}["']`).test(html));
if (missingIds.length) throw new Error(`Missing DOM ids: ${missingIds.join(', ')}`);

const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const duplicateIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
if (duplicateIds.length) throw new Error(`Duplicate DOM ids: ${[...new Set(duplicateIds)].join(', ')}`);

class ClassList {
  constructor() { this.values = new Set(['hidden']); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : force;
    enabled ? this.values.add(value) : this.values.delete(value);
    return enabled;
  }
  contains(value) { return this.values.has(value); }
}

class ElementMock {
  constructor(id) {
    this.id = id; this.classList = new ClassList(); this.dataset = {}; this.style = {removeProperty(name){ delete this[name]; }};
    this.value = ''; this.checked = false; this.textContent = ''; this.innerHTML = ''; this.events = {};
  }
  addEventListener(name, handler) { (this.events[name] ||= []).push(handler); }
  fire(name, event = {preventDefault() {}, stopPropagation() {}, target: this}) { (this.events[name] || []).forEach(handler => handler(event)); }
  setAttribute() {}
  removeAttribute() {}
  hasAttribute() { return false; }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, new ElementMock(id));
  return elements.get(id);
};

Object.entries({
  founderMode: 'investor', founderSector: 'sea', founderName: 'مجموعة الاختبار', founderShort: 'TGH',
  founderOwner: 'المؤسس', founderCountry: 'السعودية', founderCity: 'الرياض',
  addMoneyInput: '100000000', setMoneyInput: '1000000000'
}).forEach(([id, value]) => { getElement(id).value = value; });

const localStorage = {
  value: null,
  getItem() { return this.value; },
  setItem(key, value) { this.value = value; },
  removeItem() { this.value = null; }
};

const context = {
  console,
  document: {getElementById: getElement, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, createElement: () => new ElementMock('created')},
  localStorage,
  window: {L: null, matchMedia: () => ({matches: false}), addEventListener() {}, removeEventListener() {}},
  location: {reload() {}}, performance: {now: () => 0}, requestAnimationFrame() {}, setTimeout() {},
  confirm: () => true, alert() {}, Intl, Date, Math, JSON
};

vm.createContext(context);
for (const name of localScripts) {
  vm.runInContext(scriptSources[name], context, {filename: `WebApp/${name}`});
}
vm.runInContext(source, context, {filename: 'WebApp/app.js'});
getElement('founderForm').fire('submit');
getElement('alertsBtn').fire('click');
getElement('drawerClose').fire('click');
getElement('settingsBtn').fire('click');

const save = JSON.parse(localStorage.value);
if (save.saveVersion !== '2.0.0') throw new Error('Incorrect save version');
if (!save.advanced || save.advanced.schema !== 2) throw new Error('Advanced institutional state was not migrated');
if (!save.onboardingComplete) throw new Error('Founder flow was not completed');
if (save.profile.name !== 'مجموعة الاختبار') throw new Error('Founder profile was not saved');
if (save.profile.firstSector !== 'sea' || save.assets.length !== 0 || save.openedCompanies.length !== 0) throw new Error('Founder should begin without automatic companies or assets');
if (context.window.GH_WORLD_DATA.meta.airportCount < 28000 || context.window.GH_WORLD_DATA.meta.portCount < 3900) throw new Error('World registry is incomplete');
if (context.window.GH_ASSET_CATALOG.air.new.length < 15 || context.window.GH_ASSET_CATALOG.sea.new.length < 18 || context.window.GH_ASSET_CATALOG.road.new.length < 16) throw new Error('Expanded asset catalog is incomplete');
if (/basemaps\.cartocdn\.com|API KEY REQUIRED/.test(source)) throw new Error('Keyed map layer remains in source');

console.log('Global Holdings smoke test: PASS');
