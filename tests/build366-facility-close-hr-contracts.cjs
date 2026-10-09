'use strict';
const assert=require('node:assert/strict');
const previous=globalThis.GH_COMPANY_PLATFORM;
globalThis.GH_COMPANY_PLATFORM={requireCompany(_state,id){if(id!=='air')throw new Error('unexpected-company');return {id};}};
const Facilities=require('../WebApp/facility-core.js');
const state={simSeconds:37*86400,globalBases:[],customHubs:[{id:'AIR-RUH-QA',kind:'airport-base',name:'مطار الاختبار',ownerCompanyId:'air',owned:true}],advanced:{facilities:{'AIR-RUH-QA':{staff:4}},labor:{employmentContracts:[
 {id:'FAC-1',facilityId:'AIR-RUH-QA',ownerCompanyId:'air',status:'ساري',role:'تشغيل منشأة'},
 {id:'FAC-2',facilityId:'AIR-RUH-QA',ownerCompanyId:'air',status:'ساري',role:'تشغيل منشأة'},
 {id:'OTHER',facilityId:'AIR-JED-QA',ownerCompanyId:'air',status:'ساري',role:'تشغيل منشأة'},
 {id:'ASSET',facilityId:'AIR-RUH-QA',ownerCompanyId:'air',status:'ساري',role:'طاقم أصل',automaticAssetStaffing:true}
]}}};
try{
 assert.equal(Facilities.execute({state},'close',{id:'AIR-RUH-QA',company:'air',settlement:0}),true);
 const contracts=state.advanced.labor.employmentContracts;
 for(const id of ['FAC-1','FAC-2']){const row=contracts.find(contract=>contract.id===id);assert.equal(row.status,'منتهي');assert.equal(row.endedDay,37);assert.match(row.endReason,/إغلاق/);}
 assert.equal(contracts.find(row=>row.id==='OTHER').status,'ساري','closing one facility must not terminate another site’s contract');
 assert.equal(contracts.find(row=>row.id==='ASSET').status,'ساري','automatic asset staffing is outside facility HR closure');
 assert.equal(state.customHubs.length,0);assert.equal(state.advanced.facilities['AIR-RUH-QA'],undefined);
 console.log(JSON.stringify({suite:'build366-facility-close-hr-contracts',passed:7,total:7}));
}finally{if(previous===undefined)delete globalThis.GH_COMPANY_PLATFORM;else globalThis.GH_COMPANY_PLATFORM=previous;}
