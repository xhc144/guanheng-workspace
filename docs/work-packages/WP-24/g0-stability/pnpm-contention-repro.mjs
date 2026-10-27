// Fixed, bounded load comparison. The launcher argument must be a real installed pnpm entry.
// Both groups inherit the SAME actual launcher path; no install/cache/policy changes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const launcher=realpathSync(process.argv[2]);
const metadata=JSON.parse(readFileSync(join(dirname(launcher),'../package.json'),'utf8'));
assert.equal(metadata.name,'pnpm');
assert.equal(realpathSync(join(dirname(launcher),'..',metadata.bin.pnpm)),launcher);
const runtime=new URL('../../../../systems/project-ops/lib/runtime-health.ts',import.meta.url);
const count=32, deadline=5000, env={...process.env,npm_execpath:launcher};
async function group(improved){
 return Promise.all(Array.from({length:count},(_,index)=>new Promise(resolve=>{
  const began=performance.now();
  const child=improved
   ?spawn(process.execPath,['--experimental-strip-types','--input-type=module','-e',`import {inspectRuntime} from ${JSON.stringify(runtime.href)};const t=performance.now();const h=inspectRuntime();console.log(JSON.stringify({probeMs:performance.now()-t,status:h.status,version:h.checks.find(c=>c.component==='pnpm').actual}));`],{env,timeout:deadline,stdio:['ignore','pipe','pipe']})
   :spawn('pnpm',['--pm-on-fail=error','--offline','--version'],{env,timeout:deadline,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',error;
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',e=>error=e.code);
  child.on('close',(code,signal)=>{
   let output;
   try{output=improved?JSON.parse(stdout):{version:stdout.trim()};}catch{output={invalid:true};}
   resolve({index,code,signal,error,ms:Math.round(performance.now()-began),...output,stderrBytes:stderr.length});
  });
 })));
}
const before=await group(false), after=await group(true);
assert.ok(after.every(r=>r.code===0&&r.status==='ok'&&r.version===metadata.version),'fresh real launcher inspection failed');
const summarize=items=>({count:items.length,failed:items.filter(r=>r.code!==0||r.signal).length,minMs:Math.min(...items.map(r=>r.ms)),maxMs:Math.max(...items.map(r=>r.ms))});
console.log(JSON.stringify({fixture:'32 concurrent queries, same installed launcher, original 5000ms deadline, one run per group',launcher,version:metadata.version,cpuQuota:readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),runtimeSha256:createHash('sha256').update(readFileSync(runtime)).digest('hex'),summary:{before:summarize(before),after:summarize(after)},before,after},null,2));
