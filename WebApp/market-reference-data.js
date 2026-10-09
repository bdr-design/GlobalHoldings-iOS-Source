(()=>{
  'use strict';
  // Offline snapshot of official monetary-policy reference rates. Values are facts from the cited
  // primary sources; they are not retail lending/deposit quotes and carry no issuer endorsement.
  const snapshot={
    version:'gh-market-reference-v1',
    retrievedAt:'2026-10-09',
    unit:'decimal annual rate',
    entries:{
      euroArea:{
        id:'ecb-main-refinancing-2026-09-16',region:'euro-area',countries:['AT','BE','BG','CY','DE','EE','ES','FI','FR','GR','HR','IE','IT','LT','LU','LV','MT','NL','PT','SI','SK'],
        benchmark:'ECB main refinancing operations fixed rate',value:0.0265,sourceValue:2.65,sourceUnit:'percent per annum',referenceDate:'2026-09-16',
        sourceUrl:'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?lastNObservations=5&format=csvdata',
        sourcePage:'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html',
        attribution:'Source: European Central Bank (ECB), Main refinancing operations - fixed rate tenders (fixed rate) (date of changes) - Level; snapshot retrieved 2026-10-09. Rate expressed as a decimal annual rate for the game.',
        reuse:'ECB website information may be reused accurately with ECB attribution; transformations must be identified. No ECB logo or endorsement is implied.',
        coverage:'Euro area; policy benchmark only; not an individual country lending rate.'
      },
      unitedStates:{
        id:'fed-funds-target-midpoint-2026-09-17',region:'united-states',countries:['US'],
        benchmark:'Federal Reserve federal funds target range midpoint',value:0.03875,sourceValue:{lower:3.75,upper:4.00,midpoint:3.875},sourceUnit:'percent per annum',referenceDate:'2026-09-17',
        sourceUrl:'https://www.federalreserve.gov/monetarypolicy/openmarket.htm',
        attribution:'Source: Board of Governors of the Federal Reserve System, Federal Open Market Committee target range history; midpoint calculated from the published 3.75%-4.00% range. Snapshot retrieved 2026-10-09.',
        reuse:'Factual policy-rate reference transcribed from the cited official Federal Reserve page; midpoint is a derived value. No Federal Reserve logo or endorsement is implied.',
        coverage:'United States; FOMC target-range midpoint only; not an individual borrower quote.'
      },
      saudiArabia:{
        id:'sama-repo-rate-2026-09-16',region:'saudi-arabia',countries:['SA'],
        benchmark:'Saudi Central Bank (SAMA) repo rate',value:0.045,sourceValue:{repo:4.50,reverseRepo:4.00},sourceUnit:'percent per annum',referenceDate:'2026-09-16',
        sourceUrl:'https://www.sama.gov.sa/en-US/MediaCenter/News/Pages/news-1169.aspx',
        attribution:'Source: Saudi Central Bank (SAMA), monetary policy rate announcement published 2026-09-16; repo rate 4.50%, reverse repo rate 4.00%. Snapshot retrieved 2026-10-09.',
        reuse:'Official factual policy-rate values transcribed with attribution. SAMA redistribution terms for this specific announcement have not been independently confirmed; see release note before external redistribution.',
        coverage:'Saudi Arabia; repo policy rate only, not a retail financing quote. The game applies its internal product and credit-risk spreads.'
      }
    }
  };
  Object.freeze(snapshot.entries.euroArea.countries);Object.freeze(snapshot.entries.unitedStates.countries);Object.freeze(snapshot.entries.saudiArabia.countries);
  for(const entry of Object.values(snapshot.entries))if(entry.sourceValue&&typeof entry.sourceValue==='object')Object.freeze(entry.sourceValue);
  Object.freeze(snapshot.entries.euroArea);Object.freeze(snapshot.entries.unitedStates);Object.freeze(snapshot.entries.saudiArabia);Object.freeze(snapshot.entries);Object.freeze(snapshot);
  globalThis.GH_MARKET_REFERENCE_DATA=snapshot;
  if(globalThis.window&&window!==globalThis)window.GH_MARKET_REFERENCE_DATA=snapshot;
  if(typeof module!=='undefined'&&module.exports)module.exports=snapshot;
})();
