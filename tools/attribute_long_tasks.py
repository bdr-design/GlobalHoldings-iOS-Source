#!/usr/bin/env python3
"""Name what ran in every main-thread long task (>50 ms) of a Chrome trace (Build 371 tool, not an acceptance gate).

What it does: reads a trace written by tools/measure_fullgame_trace.cjs --trace, keeps only the renderer main thread's
CPU profile (worker samples share the process and must not be mixed in), and prints the long-task count and total,
then, for the N longest tasks (default 8), the GC time inside each and its top self and inclusive frames
(function:line@script; scripts injected by the local harness have no URL).

Run: python3 tools/attribute_long_tasks.py play.trace.json [N]
"""
import json,sys,collections
d=json.load(open(sys.argv[1]));ev=d['traceEvents'] if isinstance(d,dict) else d
names={(e['pid'],e['tid']):e['args']['name'] for e in ev if e.get('ph')=='M' and e.get('name')=='thread_name'}
main=[k for k,v in names.items() if v=='CrRendererMain']
mp,mt=main[0]
tasks=sorted([e for e in ev if e.get('pid')==mp and e.get('tid')==mt and e.get('ph')=='X' and e.get('name')=='RunTask' and e.get('dur',0)>50000],key=lambda e:-e['dur'])
# cpu profile from ProfileChunk events
nodes={};samples=[];t=None
mainProfiles={e['id'] for e in ev if e.get('name')=='Profile' and e.get('pid')==mp and e.get('tid')==mt}
for e in ev:
    if e.get('name')=='Profile' and e.get('id') in mainProfiles:
        t=e['args']['data'].get('startTime')
    if e.get('name')=='ProfileChunk' and e.get('id') in mainProfiles:
        c=e['args']['data'].get('cpuProfile',{})
        for n in c.get('nodes',[]):nodes[n['id']]=n
        td=e['args']['data'].get('timeDeltas',[])
        for sid,dt in zip(c.get('samples',[]),td):
            t=(t or 0)+dt;samples.append((t,sid))
parent={}
for n in nodes.values():
    if 'parent' in n:parent[n['id']]=n['parent']
def stack(sid):
    out=[];x=sid
    while x in nodes:
        cf=nodes[x]['callFrame'];out.append(f"{cf.get('functionName') or '(anon)'}:{cf.get('lineNumber',0)+1}@{cf.get('url','').split('/')[-1][:18]}");x=parent.get(x)
    return out
gc=[e for e in ev if e.get('pid')==mp and e.get('tid')==mt and e.get('ph')=='X' and ('GC' in e.get('name','') or e.get('name') in('MajorGC','MinorGC'))]
print('long tasks >50ms:',len(tasks),'total ms',round(sum(t['dur'] for t in tasks)/1000))
for task in tasks[:int(sys.argv[2]) if len(sys.argv)>2 else 8]:
    t0,t1=task['ts'],task['ts']+task['dur']
    inside=[sid for ts,sid in samples if t0<=ts<=t1]
    self_=collections.Counter();incl=collections.Counter()
    for sid in inside:
        st=stack(sid);self_[st[0]]+=1
        for f in set(st):incl[f]+=1
    g=sum(e['dur'] for e in gc if t0<=e['ts']<t1)
    print(f"\n=== task {task['dur']/1000:.0f}ms samples={len(inside)} gc={g/1000:.0f}ms")
    print(' self:',[f"{k} {v}" for k,v in self_.most_common(6)])
    print(' incl:',[f"{k} {v}" for k,v in incl.most_common(16)])
