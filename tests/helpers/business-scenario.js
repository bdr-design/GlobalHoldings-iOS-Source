const {harness,minimal}=require('./core-harness');
function scenario(){
 const h=harness(['transaction-core','domain-command-core','save-schema','determinism-core','event-ledger-core','dependency-core','policy-core','lifecycle-core','demand-closure-core','catalog','realism-core','finance-core','hr-core','corporate-core','procurement-core','facility-core','fleet-core','request-core','ai-executive-core','operations-core','route-core','game-lifecycle-core','market-core']);
 const {s}=h,d={...minimal(),profile:{name:'Test Group'},bank:{},operations:{},crew:['pilots','cabin','aeng','captains','sailors','seng','drivers','mech'].map(id=>({id,count:0,name:id,salaryMin:10,salaryMax:20})),branches:[],hired:[],unlockedSectors:[],ownedCompanies:[]};
 const state=s.GH_GAME_LIFECYCLE.pristine(d,1);
 s.GH_GAME_LIFECYCLE.foundGroup(state,{mode:'sandbox',name:'Contract Group',country:'SA',city:'Riyadh'},d,{nextId:()=> 'FOUND-1',simYear:()=>2026});
 s.GH_REALISM.migrate(state);s.GH_AI_EXECUTIVE_CORE.ensure(state);
 const ctx={state,assetCatalog:s.GH_ASSET_CATALOG,companyOperatingBalance:t=>s.GH_FINANCE_CORE.operating(state,t),supplierFor:()=>({id:'S1',name:'Supplier'}),getDynamicFacilities:()=>[...state.globalBases,...state.customHubs],candidates:[]};
 const command=(domain,name,p={})=>s.GH_DOMAIN_COMMANDS.dispatch(ctx,domain,name,p).result;
 command('corporate','open-company',{type:'air',capital:500000000,legalName:'Test Air'});
 command('facilities','create',{facility:{id:'B1',name:'Test airport',kind:'airport-base',company:'air',owned:true,coords:[24.7,46.6]},groupValueAdd:0});
 state.advanced.facilities.B1.capacity=10;
 const item=[...s.GH_ASSET_CATALOG.air.new].sort((a,b)=>a.price-b.price)[0];
 ctx.buyAsset=(type,tab,id,mode,qty,baseId,prepaid,_silent,requestRef)=>{const selected=s.GH_ASSET_CATALOG[type][tab].find(x=>x.id===id),total=selected.price*qty,upfront=mode==='finance'?total*(selected.downPayment||.2):mode==='lease'?(selected.leaseMonthly||0)*3*qty:total;return command('procurement','purchase-assets',{type,tab,item:selected,base:state.globalBases.find(x=>x.id===baseId),supplier:ctx.supplierFor(),mode,qty,prepaid,upfront,totalPrice:total,leadSeconds:60,requestRef}).orderId;};
 ctx.transferBetweenCompanies=(from,to,amount,note)=>command('finance','transfer',{from,to,amount,note})?.transferred===true;
 return {...h,state,ctx,command,item,defaults:d,request:(qty=3)=>s.GH_REQUEST_CORE.create(ctx,{company:'air',tab:'new',catalogId:item.id,mode:'cash',qty,baseId:'B1'})};
}
module.exports={scenario};
