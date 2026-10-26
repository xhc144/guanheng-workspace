// Offline source inventory. TS compiler AST + Python ast; no application execution.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '../../systems/project-ops/package.json'));
const ts = require('typescript');
export const repoRoot = resolve(here, '../..');
const outputPath = 'systems/project-ops/lib/capabilities/catalog.json';
const digest = text => createHash('sha256').update(text).digest('hex');
function walk(path) {
  return readdirSync(path, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e =>
    e.isDirectory() ? walk(join(path,e.name)) : e.isFile() ? [join(path,e.name)] : []);
}
function ast(root,path) {
  const text = readFileSync(join(root,path),'utf8');
  const source = ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,/jsx$/.test(path)?ts.ScriptKind.JSX:ts.ScriptKind.TSX);
  if(source.parseDiagnostics.length) throw Error(`语法无法解析：${path}`);
  return { source, text };
}
function visit(node, fn) { fn(node); ts.forEachChild(node,child=>visit(child,fn)); }
function exported(node) { return node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword); }
function line(source,node) { return source.getLineAndCharacterOfPosition(node.getStart(source)).line+1; }
export function scan(root) {
  const records=[];
  const add=(system,kind,method,route,path,source,text,node,symbol)=>records.push({system,kind,method,route,path,line:line(source,node),symbol,sha256:digest(text)});
  const app='systems/project-ops/app';
  for(const abs of walk(join(root,app))) {
    const path=relative(root,abs).replaceAll('\\','/');
    if(!/(?:page\.tsx|route\.ts|actions\.ts)$/.test(path))continue;
    const {source,text}=ast(root,path);
    const route='/'+relative(app,dirname(path)).replaceAll('\\','/');
    for(const node of source.statements) {
      if(!ts.isFunctionDeclaration(node)||!exported(node))continue;
      const symbol=node.name?.text??'default';
      if(path.endsWith('/page.tsx')&&node.modifiers.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword)) add('主线','page','PAGE',route,path,source,text,node,symbol);
      if(path.endsWith('/route.ts')&&/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(symbol)) add('主线','http',symbol,route,path,source,text,node,symbol);
      if(path.endsWith('/actions.ts'))add('主线','action','ACTION',route+'#'+symbol,path,source,text,node,symbol);
    }
  }
  records.push(...JSON.parse(execFileSync('python3',[join(here,'python_routes.py'),root],{encoding:'utf8',maxBuffer:4*1024*1024})));
  for(const system of ['DeepSeek版','Kimi版','基础版']) {
    const base=`systems/pms-suite/${system}/frontend/src`;
    const path=base+(system==='基础版'?'/App.jsx':'/App.tsx');
    const {source,text}=ast(root,path), imports=new Map();
    for(const n of source.statements)if(ts.isImportDeclaration(n)&&n.importClause?.name&&ts.isStringLiteral(n.moduleSpecifier))imports.set(n.importClause.name.text,n.moduleSpecifier.text);
    function addPage(route,symbol,node) {
      let pagePath=path,pageSource=source,pageText=text,pageNode=node;
      if(imports.has(symbol)) {
        const module=imports.get(symbol);
        pagePath=relative(root,resolve(root,base,module+'.tsx')).replaceAll('\\','/');
        const parsed=ast(root,pagePath);pageSource=parsed.source;pageText=parsed.text;
        pageNode=pageSource.statements.find(n=>ts.isFunctionDeclaration(n)&&exported(n))??pageSource.statements[0];
      }
      add(system,'page','PAGE',route,pagePath,pageSource,pageText,pageNode,symbol);
    }
    visit(source,node=>{
      if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==='Route') {
        const attrs=node.attributes.properties;
        const pathAttr=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(source)==='path');
        const element=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(source)==='element');
        if(!pathAttr?.initializer||!ts.isStringLiteral(pathAttr.initializer)||!element?.initializer)throw Error('无法解析前端路由');
        let symbol;
        visit(element.initializer,n=>{if(ts.isJsxSelfClosingElement(n)&&imports.has(n.tagName.getText(source)))symbol=n.tagName.getText(source);});
        if(symbol)addPage(pathAttr.initializer.text,symbol,node); // Navigate redirects and Shell wrappers are not independent pages.
      }
      // DeepSeek's login/portal are conditional branches outside <Routes>.
      if(ts.isIfStatement(node)&&ts.isReturnStatement(node.thenStatement)&&node.thenStatement.expression) {
        const condition=node.expression.getText(source);
        const match=condition.match(/location\.pathname\s*(?:===\s*['"]([^'"]+)['"]|\.startsWith\(['"]([^'"]+)['"]\))/);
        if(match)visit(node.thenStatement.expression,n=>{if(ts.isJsxSelfClosingElement(n)&&imports.has(n.tagName.getText(source)))addPage(match[1]??match[2]+'/*',n.tagName.getText(source),n);});
      }
      // Basic is state-based navigation; preserve view keys, never invent HTTP URLs.
      if(system==='基础版'&&ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsEqualsEqualsToken&&node.left.getText(source)==='view'&&ts.isStringLiteral(node.right))addPage('view:'+node.right.text,'App',node);
    });
    if(system==='基础版') {
      const appNode=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='App');
      addPage('state:login','App',appNode);addPage('state:project-detail','ProjectDetail',source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ProjectDetail'));
      // final org branch is the menu's explicit fallback, extracted from the menu array.
      const menu=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='menu'));
      visit(menu,n=>{if(ts.isArrayLiteralExpression(n)&&n.elements.length===2&&ts.isStringLiteral(n.elements[0])&&n.elements[0].text==='org')addPage('view:org','App',n);});
    }
  }
  const keys=new Set();
  for(const r of records) {
    const normalized=r.route.replace(/\{[^}]+\}|\[[^\]]+\]|(?<=\/):[A-Za-z_]+/g,'{}').replace(/\/$/,'')||'/';
    const key=[r.system,r.kind,r.method,normalized].join('|');
    if(keys.has(key))throw Error(`重复路由：${key}`);keys.add(key);
  }
  return records.sort((a,b)=>[a.system,a.kind,a.route,a.method].join('|').localeCompare([b.system,b.kind,b.route,b.method].join('|'),'en'));
}
export function classify(record,rules) {
  const route=record.route.replace(/^\/api\/v1/,'').replace(/^\/api/,'').replace(/^view:|^state:/,'/');
  const rule=rules.find(r=>new RegExp(r.pattern).test(route));
  if(!rule)throw Error(`未分类：${record.system} ${record.route}`);
  return rule;
}
export function build(root=repoRoot) {
  const rules=JSON.parse(readFileSync(join(here,'mapping.json'),'utf8'));
  const entries=scan(root).map(record=>{
    const rule=classify(record,rules);
    for(const path of [...rule.primarySources,...rule.relatedTests]) readFileSync(join(root,path),'utf8');
    return {...record,domain:rule.id,label:rule.label,decision:record.system==='主线'?'主线已有':rule.decision,
      rationale:rule.rationale,primarySources:rule.primarySources,relatedTests:rule.relatedTests,
      runtimeStatus:'未逐项运行',testStatus:rule.relatedTests.length?'存在相关测试，覆盖程度需复核':'未定位主线测试',
      owner:rule.owner};
  });
  return {schemaVersion:1,sourceBase:'1e36bfce8c13e33f671c95902d23ce2ddabe92ca',
    sourceDigest:digest(JSON.stringify(entries)),dataKind:'静态源码盘点，非实时经营数据',
    scope:'Next页面/显式HTTP方法/server actions；三版PMS挂载HTTP路由及前端页面/状态视图；不包含隐式HEAD/OPTIONS、CLI或每个业务字段',
    verification:'源码解析及覆盖检查不证明业务运行；旧文档114项完成未经本次逐项验证',entries};
}
function markdown(catalog) {
  const rows=catalog.entries.map(r=>`| ${r.system} | ${r.label} | ${r.kind} ${r.method} \`${r.route}\` | [${r.path}:${r.line}](../${r.path}#L${r.line}) · \`${r.symbol}\` | ${r.decision} | ${r.runtimeStatus} |`);
  return '# 功能对照与可验证能力目录\n\n'+
    `源码基线：\`${catalog.sourceBase}\`。本表由 \`node tools/capability-inventory/generate.mjs\` 生成；\`--check\` 校验所有路由、方法、来源摘要及映射是否变化。\n\n`+
    `${catalog.dataKind}。${catalog.scope}。${catalog.verification}。\n\n`+
    '“主线已有”仅指相同能力族存在源码，不能解读为旧版每个端点/字段已等价。每条的主线来源、相关测试（非通过证据）、迁移限制见 catalog.json 和下方迁移说明。未获用户确认的功能均保留，不设“舍弃”类别。\n\n'+
    '管理员入口：`/capabilities`；只读 JSON：`GET /api/capabilities`。导航接入申请交 WP24，当前用地址直接访问。\n\n'+
    '| 系统 | 能力族 | 页面/接口/动作 | 真实来源与方法 | 决定 | 运行证据 |\n|---|---|---|---|---|---|\n'+rows.join('\n')+'\n\n'+
    '## 能力边界与移植交接\n\n'+JSON.parse(readFileSync(join(here,'mapping.json'),'utf8')).map(r=>`- **${r.label}（${r.owner}，${r.decision}）**：${r.rationale} 主线来源：${r.primarySources.map(p=>'`'+p+'`').join('、')||'尚未实现'}。相关测试：${r.relatedTests.map(p=>'`'+p+'`').join('、')||'未定位'}。`).join('\n')+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if(args.some(a=>!['--check','--stdout'].includes(a)))throw Error('用法：node tools/capability-inventory/generate.mjs [--check|--stdout]');
    const catalog=build();
    const json=JSON.stringify(catalog,null,2)+'\n';
    if(args.includes('--stdout'))process.stdout.write(json);
    else if(args.includes('--check')) {
      if(readFileSync(join(repoRoot,outputPath),'utf8')!==json||readFileSync(join(repoRoot,'docs/功能对照.md'),'utf8')!==markdown(catalog))throw Error('能力目录与源码/映射不一致，请重新生成并审查差异');
      console.log(`覆盖检查通过：${catalog.entries.length} 条源码记录；不代表业务运行通过`);
    }else {
      writeFileSync(join(repoRoot,outputPath),json);writeFileSync(join(repoRoot,'docs/功能对照.md'),markdown(catalog));
      console.log(`已提取 ${catalog.entries.length} 条源码记录；不代表业务运行通过`);
    }
  }catch(error){console.error(error.message);process.exitCode=1;}
}
