# 关衡工作区 · Guanheng Workspace

关衡内部管理系统与 AI 研发编排工具的统一仓库。

| 目录 | 内容 | 状态 |
|------|------|------|
| [`systems/project-ops`](systems/project-ops) | **项目经营管理系统**（Next.js + SQLite）：客户、合同、项目、应收/发票/回款、服务费、提成、研发、报表 | 主线，已上线 |
| [`systems/pms-suite`](systems/pms-suite) | **综合项目管理系统系列**（FastAPI + React）：基础版 / DeepSeek版 / Kimi版 | 待修复后归档，功能移植进主线 |
| [`company`](company) | 关衡公司资料：解决方案介绍、官网、品牌宣传片、投标方案生成服务 | 资料 |
| [`orchestrator`](orchestrator) | 总管 AI 派发器：一个工作包一个 git worktree + 一个子 AI，并发可调 | 可用 |
| [`docs/总管AI架构.md`](docs/总管AI架构.md) | 总管 AI / 子 AI 多分支并行架构设计 | — |
| [`docs/系统修复提示词.md`](docs/系统修复提示词.md) | 交给 GPT 总管 AI 的系统修复提示词 | — |

## 快速开始

```bash
# 主线系统
cd systems/project-ops
pnpm install
pnpm db:seed      # 创建演示数据库（data/app.db，不入库）
pnpm dev
```

综合项目管理系统系列的启动方式见 [`systems/pms-suite/使用说明.md`](systems/pms-suite/使用说明.md)。
注意：各版本需要先在本机重新创建 Python 虚拟环境（`python -m venv .venv` 后安装 `requirements.txt`）。

## 用总管 AI 并行修复系统

1. 打开 [`docs/系统修复提示词.md`](docs/系统修复提示词.md)，复制“提示词开始”与“提示词结束”之间的内容发给 Codex / GPT。
2. 总管 AI 会生成 `tasks/queue.json`，然后运行：

```bash
python orchestrator/run.py --repo systems/project-ops --queue tasks/queue.json --max-workers 24
```

## 仓库不包含

真实数据库、上传附件、`.env` 等密钥文件、部署包，以及含客户信息的标书和方案（清单见 [`company/README.md`](company/README.md)）。这些只保存在本地或服务器，
已在 [`.gitignore`](.gitignore) 中排除。提交前请确认没有把它们加回来。

## 许可证

[MIT](LICENSE)
