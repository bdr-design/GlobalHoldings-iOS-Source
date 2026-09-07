const assert=require('assert');
global.GH_DEPENDENCY_CORE=require('../WebApp/dependency-core.js');
global.GH_LIFECYCLE_CORE=require('../WebApp/lifecycle-core.js');
global.GH_INTEGRITY_CORE=require('../WebApp/integrity-core.js');
const state={simSeconds:0,advanced:{procurement:{assetRequests:[],assetRequestArchive:[]},ai:{requests:[],requestArchive:[]}},realism:{procurement:{deliveries:[]}},assets:[]};
GH_DEPENDENCY_CORE.link(state,'A','B','depends_on');GH_DEPENDENCY_CORE.link(state,'B','A','depends_on');
const report=GH_INTEGRITY_CORE.check(state);assert(report.issues.some(x=>x.id==='DEPENDENCY_GRAPH_CYCLE'),'dependency cycle not detected');
console.log('Dependency Integrity 2.3.9: PASS');
