#!/usr/bin/env python3
"""Busy stretches over 50 ms in a .cpuprofile (Build 372 tool, not an acceptance gate).

What it does: in a CPU profile written by tools/measure_fullgame_trace.cjs --profile (the first two dispatch commands,
and <profile>-advance.cpuprofile for the calendar), finds every run of consecutive non-idle samples (gaps under 4 ms)
longer than 50 ms, prints their count and total, the inclusive frames over all of them, and for the N longest the top
self and inclusive frames (function:line@script).

Run: python3 tools/cpuprofile_blocks.py dispatch.cpuprofile [N]
"""
import json,sys,collections
p=json.load(open(sys.argv[1]));N=int(sys.argv[2]) if len(sys.argv)>2 else 10
nodes={n['id']:n for n in p['nodes']};parent={}
for n in p['nodes']:
  for c in n.get('children',[]):parent[c]=n['id']
def name(i):cf=nodes[i]['callFrame'];return f"{cf['functionName'] or '(anon)'}:{cf['lineNumber']+1}@{cf['url'].split('/')[-1][:20]}"
idle={i for i,n in nodes.items() if n['callFrame']['functionName'] in('(idle)','(program)','(garbage collector)')}
gc={i for i,n in nodes.items() if n['callFrame']['functionName']=='(garbage collector)'}
t=p['startTime'];times=[]
for d in p['timeDeltas']:t+=d;times.append(t)
blocks=[];cur=None
for ts,sid in zip(times,p['samples']):
  busy=sid not in idle or sid in gc
  if busy:
    if cur and ts-cur['end']<4000:cur['end']=ts;cur['s'].append(sid)
    else:
      if cur:blocks.append(cur)
      cur={'start':ts,'end':ts,'s':[sid]}
if cur:blocks.append(cur)
blocks=[b for b in blocks if b['end']-b['start']>50000];blocks.sort(key=lambda b:-(b['end']-b['start']))
print('blocks>50ms',len(blocks),'total ms',round(sum(b['end']-b['start'] for b in blocks)/1000))
agg=collections.Counter()
for b in blocks:
  for sid in b['s']:
    x=sid;seen=set()
    while x in nodes:
      k=name(x)
      if k not in seen:seen.add(k);agg[k]+=1
      x=parent.get(x)
print('inclusive over all blocks:',[f"{k} {v}" for k,v in agg.most_common(40)])
for b in blocks[:N]:
  self_=collections.Counter(name(s) for s in b['s']);incl=collections.Counter()
  for sid in b['s']:
    x=sid;seen=set()
    while x in nodes:
      k=name(x)
      if k not in seen:seen.add(k);incl[k]+=1
      x=parent.get(x)
  print(f"\n== {round((b['end']-b['start'])/1000)} ms samples={len(b['s'])}")
  print(' self',[f"{k} {v}" for k,v in self_.most_common(6)])
  print(' incl',[f"{k} {v}" for k,v in incl.most_common(22)])
