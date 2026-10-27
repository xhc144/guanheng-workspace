# 一次性归档清理分支

仅用于2026-10-27用户授权的冻结分支归档和清理。生产main/integration不引入本工作流。

先将每个冻结head存为 archive/2026-10-27/<branch> 原生Git标签，逐项读回后，使用精确SHA lease删除旧分支。默认/受保护/openPR关联分支或变头一律拒删。最后同样归档并删除此maintenance分支。
