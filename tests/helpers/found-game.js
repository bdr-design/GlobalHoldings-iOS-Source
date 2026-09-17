'use strict';
const assert=require('assert');
async function foundGame(window){
  const document=window.document;
  document.getElementById('founderReview').click();
  assert.strictEqual(document.getElementById('founderReviewPane').hidden,false,document.getElementById('founderError').textContent);
  document.getElementById('founderForm').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
  for(let attempt=0;attempt<100&&!window.__GH_STATE__.onboardingComplete;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.strictEqual(window.__GH_STATE__.onboardingComplete,true,document.getElementById('founderError').textContent||'founding did not commit');
}
module.exports={foundGame};
