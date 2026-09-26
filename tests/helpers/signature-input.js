'use strict';

async function drawSignaturePad(page,selector){
  const canvas=page.locator(selector).first();
  await canvas.waitFor({state:'visible'});
  await canvas.scrollIntoViewIfNeeded();
  const box=await canvas.boundingBox();
  if(!box||box.width<20||box.height<20)throw new Error(`signature canvas is not drawable: ${selector}`);
  const points=[[.10,.66],[.23,.32],[.36,.68],[.49,.28],[.63,.64],[.78,.34],[.90,.58]];
  await page.mouse.move(box.x+box.width*points[0][0],box.y+box.height*points[0][1]);
  await page.mouse.down();
  for(const [x,y] of points.slice(1))await page.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:3});
  await page.mouse.up();
  await page.waitForFunction(input=>{
    const node=document.querySelector(input);return node?.closest('.authorization-pad')?.querySelector('[role="status"]')?.textContent?.includes('جاهز');
  },selector);
}

const drawFounderSignature=page=>drawSignaturePad(page,'#founderSignatureMount .authorization-pad-canvas');
const drawUpgradeSignature=page=>drawSignaturePad(page,'#signatureDialogMount .authorization-pad-canvas');

module.exports={drawSignaturePad,drawFounderSignature,drawUpgradeSignature};
