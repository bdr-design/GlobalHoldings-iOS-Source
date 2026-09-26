import json,pathlib,urllib.request,concurrent.futures
from PIL import Image
root=pathlib.Path(__file__).parent;revision='0943055db6ec570bcef9f2c8b41c9e5467c808f9';tree=json.loads(urllib.request.urlopen('https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/'+revision+'?recursive=1').read())['tree'];base='https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/'+revision+'/'
selected=['Business_Male_01','Business_Male_07','Business_Female_02']
paths=[x['path'] for x in tree if x['path'].startswith('Assets/') and any('/'+name+'/' in x['path'] for name in selected) and (x['path'].endswith('.png') or (x['path'].endswith('.fbx') and not x['path'].endswith('_facial.fbx')) or x['path'].endswith('_color.tga'))]+['LICENSE.md']
def fetch(p):
 try:
  f=root/pathlib.Path(p).name
  if not f.exists(): f.write_bytes(urllib.request.urlopen(base+p,timeout=90).read())
  if f.suffix=='.tga':
   im=Image.open(f);im.thumbnail((1024,1024));im.save(f.with_suffix('.png'))
  return (p,f.stat().st_size)
 except Exception as e:return(p,str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
 for r in ex.map(fetch,paths):print(r,flush=True)
