# 能力目录提取器

只读取仓库源码文本，使用已冻结安装中的 TypeScript 编译器 AST 和 Python 标准库 ast。不会 import/启动 PMS，不打开 DB、.env、附件或经营文件，不联网。需要 Node 24.19.0、pnpm 11.19.0、Python3，以及主线 `pnpm install --frozen-lockfile` 已成功。

从仓库根运行：

```sh
node tools/capability-inventory/generate.mjs
node tools/capability-inventory/generate.mjs --check
node tools/capability-inventory/generate.mjs --stdout
```

默认更新 `docs/功能对照.md` 和 `systems/project-ops/lib/capabilities/catalog.json`。`--check` 不写文件，逐字比较重新提取后的两个输出，不一致或无法分类/解析时退出1；参数错误也退出1。`--stdout` 输出完整 JSON，不写文件。不得在不审查 diff 的情况下用重新生成掩盖遗漏能力。

提取范围：

- Next `app/**/page.tsx` 的默认函数、`route.ts` 的显式导出函数HTTP方法、`actions.ts` 的导出函数。隐式 HEAD/OPTIONS 不重复计数；action 用 `ACTION /域#函数` 标识，不冒充可直接请求的 URL。
- 三版 PMS 的 backend/app 中 APIRouter 装饰函数，结合 main.py 的 include_router 挂载前缀；Kimi 的显式 router 元组支持 /api/v1 挂载。Python只做AST解析，不执行模块。
- DeepSeek/Kimi 的 App.tsx Route 节点及 DeepSeek 的 login/portal 条件分支。定位默认页面函数或默认导出的 const 组件真实行号。pages/ 中未被解析挂载的页面会报错。
- 基础版是状态视图：`view:*` 和 `state:*` 不是 HTTP 路径；从实际 view 条件、项目详情条件和登录分支提取。
- 每条来源包含文件 SHA-256、1起始行号、符号、最多32项静态调用线索。Python测试名及行号仅供参考，关联依据为 mapping.json 中明确的测试文件名/函数名模式，不能推导该接口已覆盖。

当前源码采用显式函数导出；新的变量形式HTTP handler（仅允许本地已解析导出函数的const别名，例如HEAD=GET）、转导出、无法解析的页面/路由、未挂载Python路由、重复系统/类型/方法/规范化路径、未分类项均失败，需要维护者明确扩展解析器。动态参数名称不同会被归一检测重复。这里不是任意框架版本的通用路由解析器；内联server action、CLI、middleware及业务字段不在范围，后续出现时应扩展范围与测试，不能声称全业务覆盖。

`mapping.json` 按优先级分类，具体缺口应放在能力族规则前。每条规则必须指定移植决定、owner、主线源文件和相关测试文件（没有则空数组并保留未知），未知不能兜底成“已完成”。不允许“舍弃”决定。`sourceBase` 表示本次已合入并复核的integration SHA（最初开工SHA另记报告），当前提取同时包含WP04自身页面/API；`sourceDigest`识别本次提取结果，不是已部署版本或CI标志。

验证入口为主线 `tests/capabilities.test.ts`，使用真实SQLite合成内存库、真实session和NextRequest调用本包服务/API；路由变更、重复和未挂载测试在 mkdtemp 临时源码中运行。浏览器脚本独立运行，见 `docs/work-packages/WP-04/browser-check.mjs`。测试结果和范围由 `reports/WP-04.md` 记录，生成目录自身所有业务运行状态始终为“未逐项运行”。
