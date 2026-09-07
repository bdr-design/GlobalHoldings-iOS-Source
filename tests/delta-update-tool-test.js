const fs=require('fs');
if(fs.existsSync('scripts/build_delta_update.py'))throw new Error('Legacy delta/overlay update builder must remain removed in 2.3.9.');
console.log('Delta/overlay update path removal guard: PASS');
