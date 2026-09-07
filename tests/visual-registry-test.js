const fs = require('fs');
const path = require('path');

const web = path.join(process.cwd(), 'WebApp');
const sources = ['app.js','catalog.js','realism-core.js','advanced-core.js'].map(name=>fs.readFileSync(path.join(web,name),'utf8')).join('\n');
const refs = [...sources.matchAll(/assets\/images\/([A-Za-z0-9._-]+\.(?:webp|png|jpg|jpeg))/g)].map(match=>match[1]);
const unique = [...new Set(refs)];
const imageDir=path.join(web,'assets','images');
const inventory=fs.readdirSync(imageDir).filter(name=>/\.(?:webp|png|jpe?g)$/i.test(name));
if (inventory.length < 25) throw new Error(`Visual library is unexpectedly small: ${inventory.length}`);

const broken=[];
for (const name of inventory) {
  const file=path.join(web,'assets','images',name);
  if (!fs.existsSync(file)) broken.push(`${name}: missing`);
  else if (fs.statSync(file).size < 1024) broken.push(`${name}: empty or too small`);
  else if (name.endsWith('.webp')) {
    const head=fs.readFileSync(file).subarray(0,12).toString('ascii');
    if (!head.startsWith('RIFF') || !head.endsWith('WEBP')) broken.push(`${name}: invalid WebP header`);
  }
}
if (broken.length) throw new Error(`Broken visual assets:\n${broken.join('\n')}`);
for (const name of unique) if (!inventory.includes(name)) broken.push(`${name}: referenced but absent`);
if (broken.length) throw new Error(`Broken visual assets:\n${broken.join('\n')}`);
console.log(`Global Holdings visual registry: PASS (${inventory.length} images, ${unique.length} direct references)`);
