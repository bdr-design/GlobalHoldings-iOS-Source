'use strict';
const fs=require('fs'),path=require('path'),acorn=require('acorn');
const root=path.resolve(__dirname,'..'),errors=[],registrations=new Map();
function parts(n){if(!n)return [];if(n.type==='ChainExpression')return parts(n.expression);if(n.type==='Identifier')return [n.name];if(n.type==='MemberExpression')return [...parts(n.object),n.computed?n.property.value:n.property.name];return [];}
function walk(n,visit){if(!n||typeof n!=='object')return;if(n.type)visit(n);for(const [key,v] of Object.entries(n)){if(['start','end','loc'].includes(key))continue;if(Array.isArray(v))v.forEach(c=>walk(c,visit));else if(v&&typeof v==='object')walk(v,visit);}}
for(const file of fs.readdirSync(path.join(root,'WebApp')).filter(n=>n.endsWith('.js'))){
 const text=fs.readFileSync(path.join(root,'WebApp',file),'utf8'),tree=acorn.parse(text,{ecmaVersion:'latest',sourceType:'script',locations:true});
 const fail=(n,msg)=>errors.push(file+':'+n.loc.start.line+': '+msg);
 walk(tree,n=>{
  if(['CallExpression','NewExpression'].includes(n.type)){
   const call=parts(n.callee),method=call.at(-1);
   if(['eval','Function'].includes(method))fail(n,'Dynamic code execution is forbidden');
   if(method==='register'&&call.includes('GH_DOMAIN_COMMANDS')){const domain=n.arguments[0]?.value;if(!domain)fail(n,'Domain registration must be static');else if(registrations.has(domain))fail(n,'Duplicate owner '+domain);else registrations.set(domain,file);}
   if(['app.js','advanced-core.js'].includes(file)&&['executeHiring','recordExecution'].includes(method))fail(n,'Business mutation must use the command gateway');
   if(file==='market-core.js'&&['push','unshift','splice'].includes(method)&&['ownedCompanies','stakes','maDeals'].some(x=>call.includes(x)))fail(n,'Market ownership mutation bypasses Corporate');
  }
  const target=n.type==='AssignmentExpression'?n.left:n.type==='UpdateExpression'?n.argument:n.type==='UnaryExpression'&&n.operator==='delete'?n.argument:null;
  if(target){const p=parts(target),prop=p.at(-1),business=p.some(x=>['state','s'].includes(x));
   if(['app.js','advanced-core.js'].includes(file)&&business&&['cash','debt','groupValue','companyRegistry','openedCompanies','ownedCompanies','stakes','maDeals'].includes(p[p.indexOf(p.includes('state')?'state':'s')+1]))fail(n,'UI must delegate business ownership');
   if(['app.js','advanced-core.js'].includes(file)&&['prepaidUpfront','paymentClearedAt'].includes(prop))fail(n,'Only Request owns payment release');
   if(file==='market-core.js'&&['groupValue','ownedCompanies','stakes','maDeals'].some(x=>p.includes(x)))fail(n,'Only Corporate owns acquisitions');
   if(file==='finance-core.js'&&business&&p.includes('assets'))fail(n,'Finance cannot create fleet assets');
   if(file==='facility-core.js'&&prop==='staff'&&!(n.type==='AssignmentExpression'&&n.operator==='='&&text.slice(n.right.start,n.right.end)==='num(m.staff)'))fail(n,'Only HR may create facility staff');
  }
 });
}
for(const domain of ['finance','procurement','fleet','facilities','hr','corporate','market','ai'])if(!registrations.has(domain))errors.push('Missing owner '+domain);
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('AST OWNERSHIP / NO DYNAMIC CODE GUARD: PASS ('+registrations.size+' domain owners)');
