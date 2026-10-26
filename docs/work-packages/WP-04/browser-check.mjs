// Real Chromium + built standalone app. Synthetic database and screenshots stay in /tmp.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDatabase } from '../../../systems/project-ops/lib/db.ts';
import { hashPassword } from '../../../systems/project-ops/lib/auth.ts';
assert.equal(process.argv.length,4,'用法：node docs/work-packages/WP-04/browser-check.mjs <playwright/index.mjs> <chromium>');
const {chromium}=await import(pathToFileURL(process.argv[2]).href);
const project=fileURLToPath(new URL('../../../systems/project-ops/',import.meta.url));
const runtime=mkdtempSync(join(tmpdir(),'guanheng-wp04-browser-'));
cpSync(join(project,'.next/standalone'),runtime,{recursive:true,verbatimSymlinks:true});
cpSync(join(project,'.next/static'),join(runtime,'.next/static'),{recursive:true});
if(existsSync(join(project,'public')))cpSync(join(project,'public'),join(runtime,'public'),{recursive:true});
mkdirSync(join(runtime,'screenshots'));
const password='Wp04-Synthetic-Only-2026!';
const database=openDatabase(join(runtime,'data/wp04-synthetic.db'));
for(const role of ['ADMIN','FINANCE','DEPARTMENT_MANAGER','PROJECT_MEMBER']) database.prepare('INSERT INTO users (id,username,name,password_hash,role) VALUES (?,?,?,?,?)').run(role,`wp04_${role.toLowerCase()}`,'WP04合成验收人员',hashPassword(password),role);
database.close();
const reservation=createServer();
await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,[join(runtime,'server.js')],{cwd:runtime,env:{PATH:process.env.PATH,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1',DATABASE_FILENAME:'wp04-synthetic.db',SESSION_SECRET:'WP04_SYNTHETIC_ONLY_32_CHARACTERS_LONG'},stdio:['ignore','pipe','pipe']});
let output='',browser;
server.stdout.on('data',c=>{output+=c});server.stderr.on('data',c=>{output+=c});
const results=[];
try {
 let ready=false;
 for(let i=0;i<80;i++){try{ready=(await fetch(`${base}/login`)).ok}catch{}if(ready)break;if(server.exitCode!==null)throw Error('临时服务启动失败');await new Promise(r=>setTimeout(r,250));}
 assert.ok(ready,'临时服务未就绪');
 browser=await chromium.launch({executablePath:process.argv[3],headless:true});
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push({message:m.text(),location:m.location().url})});
 page.on('response',response=>{if(response.status()>=400)console.log(JSON.stringify({resourceStatus:response.status(),path:new URL(response.url()).pathname}));});
 assert.equal((await context.request.get(`${base}/api/capabilities`)).status(),401);
 assert.equal((await context.request.head(`${base}/api/capabilities`)).status(),401);
 await page.goto(`${base}/capabilities`);assert.equal(new URL(page.url()).pathname,'/login');
 results.push({check:'匿名GET/HEAD拒绝、页面跳转登录',status:'通过'});
 async function login(role){await context.clearCookies();await page.goto(`${base}/login`);await page.getByLabel('用户名或邮箱').fill(`wp04_${role.toLowerCase()}`);await page.getByLabel('密码',{exact:true}).fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(url=>url.pathname==='/');await page.locator('.app-shell').waitFor();}
 async function headers(){const cookie=(await context.cookies()).find(c=>c.name==='pms_session');assert.ok(cookie?.httpOnly&&cookie.secure);return {cookie:`${cookie.name}=${cookie.value}`};}
 await login('ADMIN');
 const adminHeaders=await headers();
 const ok=await context.request.get(`${base}/api/capabilities`,{headers:adminHeaders});assert.equal(ok.status(),200);
 assert.equal(ok.headers()['cache-control'],'private, no-store');assert.ok(ok.headers()['vary'].split(',').map(v=>v.trim().toLowerCase()).includes('cookie'));
 const data=await ok.json();assert.equal(data.entries.length,25);assert.ok(data.total>25);assert.ok(data.entries.every(e=>e.runtimeStatus==='未逐项运行'));
 assert.equal(data.sourceDigest,JSON.parse(readFileSync(join(project,'lib/capabilities/catalog.json'),'utf8')).sourceDigest,'构建目录摘要须与当前源码提取一致');
 assert.equal((await context.request.head(`${base}/api/capabilities`,{headers:adminHeaders})).status(),200);
 assert.equal((await context.request.post(`${base}/api/capabilities`,{headers:adminHeaders,data:{}})).status(),405);
 const invalid=await context.request.get(`${base}/api/capabilities?page=-1`,{headers:adminHeaders});assert.equal(invalid.status(),400);assert.match((await invalid.json()).error,/页码/);
 results.push({check:'管理员真实登录、GET/HEAD只读、POST405与非法页码400',status:'通过',sourceDigest:data.sourceDigest});
 for(const width of [375,768,1440]){
  await page.setViewportSize({width,height:1000});
  const response=await page.goto(`${base}/capabilities`);assert.equal(response.status(),200);
  await page.getByRole('heading',{name:'盘点不等于运行通过',exact:true}).waitFor();
  assert.match(await page.locator('main').innerText(),/114项完成/);
  assert.equal(await page.locator('ul[aria-label="能力来源记录"] > li').count(),25);
  await page.getByLabel('来源系统',{exact:true}).selectOption('DeepSeek版');
  await page.getByLabel('搜索来源或能力',{exact:true}).fill('预算');
  const apply=page.getByRole('button',{name:'应用筛选',exact:true});
  const box=await apply.boundingBox();assert.ok(box.width>=44&&box.height>=44);
  await apply.focus();assert.equal(await apply.evaluate(e=>document.activeElement===e),true);
  await apply.click();await page.waitForURL(url=>url.searchParams.get('q')==='预算');
  await page.getByRole('heading',{name:'预算版本与执行',exact:true}).first().waitFor();
  const text=await page.locator('ul[aria-label="能力来源记录"]').innerText();assert.match(text,/DeepSeek版 · 移植/);assert.match(text,/未逐项运行/);assert.doesNotMatch(text,/基础版 ·/);
  const first=page.locator('ul[aria-label="能力来源记录"] > li').first();await first.getByText('查看主线对应、测试与来源摘要',{exact:true}).click();assert.match(await first.innerText(),/源码 SHA-256/);
  const dimensions=await page.evaluate(()=>({viewport:innerWidth,body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
  assert.ok(dimensions.body<=width&&dimensions.document<=width,`${width}px横向溢出`);
  await page.screenshot({path:join(runtime,`screenshots/capabilities-${width}.png`),fullPage:true});
  if(width===375)await page.screenshot({path:join(runtime,'screenshots/capabilities-375-viewport.png')});
  results.push({check:`${width}px真实中文筛选、证据展开、键盘焦点、44px触控及布局`,status:'通过',dimensions});
 }
 await page.goto(`${base}/capabilities`);await page.getByRole('link',{name:'下一页',exact:true}).click();await page.waitForURL(url=>url.searchParams.get('page')==='2');assert.match(await page.getByRole('status').innerText(),/第 2/);
 await page.goto(`${base}/capabilities?q=WP04_不存在的合成能力`);await page.getByRole('heading',{name:'没有符合条件的来源记录',exact:true}).waitFor();
 await page.goto(`${base}/capabilities?page=-1`);await page.getByRole('heading',{name:'无法应用筛选',exact:true}).waitFor();assert.match(await page.locator('section[role="alert"]').innerText(),/页码/);await page.getByRole('link',{name:'重置筛选',exact:true}).click();await page.waitForURL(url=>url.pathname==='/capabilities'&&!url.search);
 results.push({check:'翻页、中文空状态、错误边界与重置恢复',status:'通过'});
 for(const role of ['FINANCE','DEPARTMENT_MANAGER','PROJECT_MEMBER']){
  await login(role);const denied=await context.request.get(`${base}/api/capabilities`,{headers:await headers()});assert.equal(denied.status(),403);assert.deepEqual(await denied.json(),{error:'仅管理员可查看能力目录'});
  await page.goto(`${base}/capabilities`);await page.getByRole('heading',{name:'仅管理员可查看能力目录',exact:true}).waitFor();assert.equal(await page.locator('ul[aria-label="能力来源记录"]').count(),0);
 }
 results.push({check:'三个非管理员角色中文拒绝、无目录数据展示',status:'通过'});
 const normalFlowErrors=errors.slice();
 await login('ADMIN');
 await page.setViewportSize({width:375,height:900});
 const brokenHeaders=await headers();
 const broken=openDatabase(join(runtime,'data/wp04-synthetic.db'));broken.exec('DROP TABLE sessions');broken.close();
 const unavailable=await context.request.get(`${base}/api/capabilities`,{headers:brokenHeaders});assert.equal(unavailable.status(),500);assert.deepEqual(await unavailable.json(),{error:'能力目录暂时无法读取，请稍后重试或联系管理员'});
 await page.goto(`${base}/capabilities`);
 await page.getByRole('heading',{name:'能力目录暂时无法读取',exact:true}).waitFor();
 assert.equal(await page.locator('ul[aria-label="能力来源记录"]').count(),0);
 assert.doesNotMatch(await page.locator('main').innerText(),/no such table|sessions|\/tmp|\/workspace/);
 const errorDimensions=await page.evaluate(()=>({body:document.body.scrollWidth,document:document.documentElement.scrollWidth}));
 assert.ok(errorDimensions.body<=375&&errorDimensions.document<=375);
 await page.screenshot({path:join(runtime,'screenshots/capabilities-error-375.png')});
 const repaired=openDatabase(join(runtime,'data/wp04-synthetic.db'));repaired.close();
 await page.getByRole('button',{name:'重试读取',exact:true}).click();
 await page.waitForURL(url=>url.pathname==='/login');
 results.push({check:'合成库移除会话表触发真实500及中文错误边界；恢复表后重试回登录',status:'通过',faultPhaseConsoleErrors:errors.slice(normalFlowErrors.length)});
 const check=openDatabase(join(runtime,'data/wp04-synthetic.db'));
 assert.equal(check.prepare('SELECT COUNT(*) count FROM customers').get().count,0);
 assert.equal(check.prepare('SELECT COUNT(*) count FROM projects').get().count,0);
 check.close();
 console.log(JSON.stringify({runtime,port,results,normalFlowConsoleErrors:normalFlowErrors,scope:'仅本包目录交互，不证明被盘点业务或Windows通过'},null,2));
 // Preserve any existing shared-asset failures; never turn them green by interception or filtering.
 assert.deepEqual(normalFlowErrors,[],'正常流程存在控制台错误，业务断言结果已完整记录');
}catch(error){console.error(error);console.error(output.slice(-4000));process.exitCode=1}
finally{await browser?.close();server.kill('SIGTERM');}
