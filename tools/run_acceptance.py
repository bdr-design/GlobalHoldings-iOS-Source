#!/usr/bin/env python3
"""Run the current source's declared tests; always retain failures and source digests.
No IPA, historical base application, signing key, or state modification is involved.
"""
from __future__ import annotations
import argparse,json,os,shlex,shutil,subprocess,time
from pathlib import Path
from verify_current_source import verify

def expand(command:str,scripts:dict,stack:tuple=())->list[list[str]]:
    rows=[]
    for part in command.split('&&'):
        argv=shlex.split(part.strip())
        if argv[:2]==['npm','run'] and len(argv)==3:
            if argv[2] in stack:raise ValueError('Recursive package script')
            rows+=expand(scripts[argv[2]],scripts,stack+(argv[2],))
        elif argv and argv[0] in ('node','python3','python'):
            if argv not in rows:rows.append(argv)
        else:raise ValueError(f'Unsupported acceptance command: {argv!r}')
    # A test referenced by several convenience scripts needs one recorded run.
    unique=[]
    for argv in rows:
        if argv not in unique:unique.append(argv)
    return unique

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);p.add_argument('--node',default='node');p.add_argument('--timeout',type=int,default=240);a=p.parse_args()
    root=Path(__file__).resolve().parents[1];out=a.output.absolute()
    if out.exists() or out.is_symlink() or root==out or root in out.parents:raise ValueError('Evidence output must be a new directory outside source')
    before=verify(root);version=subprocess.check_output([a.node,'--version'],text=True).strip()
    if int(version.lstrip('v').split('.')[0])<24:raise ValueError('Node 24 or later is required')
    out.mkdir(parents=True);pkg=json.loads((root/'package.json').read_text());commands=expand(pkg['scripts']['test'],pkg['scripts']);rows=[]
    node=shutil.which(a.node) or a.node;env={**os.environ,'GH_TEST_SOURCE_DIR':str(root),'PATH':str(Path(node).resolve().parent)+os.pathsep+os.environ.get('PATH','')}
    for i,args in enumerate(commands,1):
        argv=[node if args[0]=='node' else args[0],*args[1:]];start=time.monotonic();log=f'{i:03d}-{Path(args[1]).stem}.log'
        with (out/log).open('w') as stream:
            try:code=subprocess.run(argv,cwd=root,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=a.timeout,check=False).returncode
            except subprocess.TimeoutExpired:code='timeout'
            except OSError as e:stream.write(str(e));code='launch-failed'
        rows.append({'argv':args,'exit_code':code,'elapsed_seconds':round(time.monotonic()-start,3),'log':log});print(i,len(commands),code,args[1],flush=True)
        (out/'results.json').write_text(json.dumps({'completed':False,'node':version,'runtime_source':before,'tests':rows},ensure_ascii=False,indent=2)+'\n')
    try:after=verify(root);unchanged=after['source_tree_sha256']==before['source_tree_sha256'];verification_error=None
    except Exception as e:after=None;unchanged=False;verification_error=str(e)
    passed=all(row['exit_code']==0 for row in rows) and unchanged
    result={'completed':True,'all_tests_passed':passed,'node':version,'runtime_unchanged':unchanged,'verification_error':verification_error,'runtime_source':before,'tests':rows,'total':len(rows),'passed':sum(row['exit_code']==0 for row in rows),'ipa_built':False,'device_tested':False}
    (out/'results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return 0 if passed else 1
if __name__=='__main__':raise SystemExit(main())
