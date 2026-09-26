from pathlib import Path
import urllib.request,zipfile,json
import numpy as np
from PIL import Image
W=Path('WebApp');out=W/'assets/maps/ne2';out.mkdir(parents=True,exist_ok=True)
archive=Path('/tmp/gh329-ne2.zip')
if not archive.exists():
 with urllib.request.urlopen('https://naturalearth.s3.amazonaws.com/50m_raster/NE2_50M_SR_W.zip',timeout=60) as r,archive.open('wb') as f:
  while data:=r.read(1024*1024):f.write(data)
with zipfile.ZipFile(archive) as z:
 name=next(n for n in z.namelist() if n.endswith('.tif'));z.extract(name,'/tmp/gh329-ne2')
source=np.asarray(Image.open('/tmp/gh329-ne2/'+name).convert('RGB').resize((4096,2048),Image.Resampling.LANCZOS))
y=(np.arange(4096)+.5)/4096;latitude=np.arctan(np.sinh(np.pi*(1-2*y)))*180/np.pi;sy=np.clip((90-latitude)/180*2048-.5,0,2047);y0=np.floor(sy).astype(int);y1=np.minimum(y0+1,2047);weight=(sy-y0)[:,None,None]
projected=Image.fromarray(np.clip(source[y0]*(1-weight)+source[y1]*weight,0,255).astype('uint8'))
for z in range(5):
 n=2**z;level=projected.resize((256*n,256*n),Image.Resampling.LANCZOS)
 for x in range(n):
  folder=out/str(z)/str(x);folder.mkdir(parents=True,exist_ok=True)
  for y in range(n):level.crop((x*256,y*256,(x+1)*256,(y+1)*256)).save(folder/(str(y)+'.webp'),quality=86,method=6)
data=json.load(urllib.request.urlopen('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',timeout=45))
rows=[{'name':f['properties'].get('NAME_AR') or f['properties']['NAME'],'coords':[f['properties']['LABEL_Y'],f['properties']['LABEL_X']],'population':f['properties']['POP_EST']} for f in data['features']]
(W/'map-labels.js').write_text('/* Natural Earth public-domain country labels; WGS84 label points. */\nwindow.GH_MAP_LABELS='+json.dumps(rows,ensure_ascii=False,separators=(',',':'))+';\n')
(out/'SOURCE.txt').write_text('Made with Natural Earth.\nNatural Earth II, 1:50m, Shaded Relief and Water, version 3.2.0.\nhttps://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-2/\nhttps://naturalearth.s3.amazonaws.com/50m_raster/NE2_50M_SR_W.zip\nPublic domain: https://www.naturalearthdata.com/about/terms-of-use/\nCountry labels: Natural Earth ne_110m_admin_0_countries.\nRaster reprojected from geographic WGS84 to Web Mercator, z0-z4.\n')
p=W/'runtime-required.json';m=json.loads(p.read_text());m['files']=sorted(set(m['files']+['interface-core.js','map-labels.js']+[str(f.relative_to(W)) for f in out.rglob('*') if f.is_file()]));p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'tiles':len(list(out.rglob('*.webp'))),'labels':len(rows),'requiredFiles':len(m['files'])}))
