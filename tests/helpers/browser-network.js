const fs=require('fs'),path=require('path');
async function installMapFixture(page){
 const folder=path.dirname(require.resolve('leaflet/dist/leaflet.js'));
 await page.route('https://unpkg.com/leaflet@1.9.4/dist/**',route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  if(!['leaflet.js','leaflet.css'].includes(name))return route.abort();
  return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':name.endsWith('.js')?'text/javascript':'text/css'},body:fs.readFileSync(path.join(folder,name))});
 });
 // Deliberate offline tile coverage. Leaflet itself is the pinned official package.
 await page.route(/https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com)\//,route=>route.abort());
}
function expectedNetworkError(message){const url=message.location().url||'';return /tile\.openstreetmap\.org|server\.arcgisonline\.com|favicon\.ico/.test(url)&&/Failed to load resource/.test(message.text());}
module.exports={installMapFixture,expectedNetworkError};
