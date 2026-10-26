# 精确合后只读复验：严格浏览器门未通过

精确HEAD：`875fb80613e7626c774d4d7ec3a9eadafb7ae66f`。应用树：`a868b4354a951b0a89b3daa49bb5381f2a3162af`，与此前已验树一致；一致性没有代替本轮命令。下面均为合后重新执行产生的新日志，未复用合前输出。实际cwd：`/workspace/guanheng-wp24/systems/project-ops`。

| 完整命令 | UTC开始 | 退出码 | 新原始日志 |
| --- | --- | --- | --- |
| `pnpm test` | 2026-10-26T18:02:56.449284+00:00 | 0 | [01-test.log](01-test.log) |
| `pnpm typecheck` | 2026-10-26T18:02:56.466355+00:00 | 0 | [02-typecheck.log](02-typecheck.log) |
| `pnpm lint` | 2026-10-26T18:02:56.433449+00:00 | 0 | [03-lint.log](03-lint.log) |
| `pnpm build` | 2026-10-26T18:03:53.859012+00:00 | 0 | [04-build.log](04-build.log) |
| `node tests/favicon-browser.mjs` | 2026-10-26T18:04:44.940300+00:00 | 1 | [05-favicon-browser.log](05-favicon-browser.log) |
| `node tests/favicon-browser.mjs` | 2026-10-26T18:06:26.054636+00:00 | 1 | [06-favicon-browser-retry.log](06-favicon-browser-retry.log) |

测试105通过，fail/skipped/cancelled/todo均0；类型、lint、独立生产build均0。严格浏览器整体两次均1，**不能把不同轮次的通过结果拼成双前缀整体通过**：

- 首轮：默认build/browser均0；/pms build0，非管理员`/pms/api/integration-health`读取出现`ECONNRESET`，browser1（原脚本136行）。临时失败目录`/tmp/guanheng-wp24-browser-b8veIN`，server.log只有启动信息，未见应用异常堆栈。
- 完整重跑：默认build0，等待“运行版本检查通过”标题30000ms超时，browser1（原脚本125行）；/pms build/browser均0。默认失败目录`/tmp/guanheng-wp24-browser-HVjh3k`，server.log同样未见应用异常堆栈。

失败原因尚未定位，未判定为版本、权限或应用算法缺陷。之后在两个失败临时cwd及项目cwd只读查询`pnpm --pm-on-fail=error --offline --version`均返回11.19.0；这不证明超时原因，也不替代失败的浏览器验收。没有修改源码、依赖、超时或断言，没有忽略错误，未继续反复重试求绿。两次临时服务均由原工具停止。

本轮没有commit、push、改PR、部署、G1或自行放行WP23。最终全部tracked源码仍与精确合后SHA无差异，Next生成的next-env.d.ts已恢复原文；仅新增本目录证据。所有数据为原工具mkdtemp合成库，仓库data仍只有.gitkeep。

当前状态：**严格浏览器门未通过，WP23放行条件尚不满足，交根处理。** 未发生权限拒绝；两项是实际测试失败，原因未定。[result.json](result.json)保存每条新日志的SHA256、执行前后SHA/应用树、时间、cwd、退出码及每轮两种部署的独立结果。
