# AGENTS.md

## 读取顺序
- 先读本文件。
- 读取 `Memory/01_goals/` 中最新的目标文件。
- 读取与该目标绑定的 `Memory/02_todos/` 最新待办文件。
- 仅在需要时读取 `Memory/04_knowledge/`。
- 仅在需要时读取 `Memory/06_transcripts/clean/` 和 transcript manifest。
- 仅在需要时读取 `Memory/03_chat_logs/` 和 `Memory/05_archive/`。

## 记忆规则
- 只有在用户明确确认需求或范围变化后，才修改当前目标。
- 当前待办必须与当前目标保持同步。
- 对话日志只追加，禁止重写或删除既有内容。
- 活跃文件保持精简，过期内容移入知识库或归档。
- 清洗后的 transcript 仅用于检索和定位；当精确表述重要时，必须回看原始 transcript。

## Transcript 规则
- 如启用 transcript 归档，按 client、project、session 分层保存。
- 原始 transcript 同时保存在当前仓库的 `Memory/06_transcripts/raw/` 镜像和用户级 MemoryTree 全局归档中。
- 当前仓库的 transcript 镜像只保存属于本项目的记录；其他项目的记录只进入全局 MemoryTree 归档。
- 清洗后的 transcript 索引必须通过确定性代码生成，不能依赖模型重写。
- 当前仓库的原始 transcript 上传权限：未设置。首次提交或推送原始 transcript 前必须先询问用户，并在此处记录答案。
- 若用户未批准原始 transcript 上传，则 `Memory/06_transcripts/raw/**` 保留在仓库中但不参与自动暂存；当前仓库只提交清洗后的 transcript 索引或 manifest。

## Git 规则
- 遵守当前仓库的分支、PR、CI、评审和发布规则。
- 仅自动提交和推送 MemoryTree 自有变更（`Memory/**` 以及由 MemoryTree 管理的本文件），但在当前仓库未获批前，不得包含 `Memory/06_transcripts/raw/**`。
- 提交标题使用 MemoryTree 专用标识。优先使用 `memorytree(<scope>): <subject>`；若仓库强制其他提交规范，则使用兼容格式，例如 `docs(memorytree): <subject>`。
- 对 MemoryTree 专用变更使用专用分支和 PR；仅在仓库规则允许时才开启自动合并。
- 如果 diff 混入产品代码、共享策略文件、跨项目 transcript 文件或文件归属不清，暂存或推送前先询问用户。
- 当 `auto_push` 启用时，心跳进程在提交后自动推送。若未配置 remote 或推送失败，会将告警写入 `~/.memorytree/alerts.json`。

## 心跳规则
- Transcript 的发现、导入、清洗和推送由后台心跳进程负责，大模型不执行这些操作。
- 大模型在交互会话中只负责写对话日志摘要、更新目标和待办。
- 如果 `~/.memorytree/alerts.json` 中有待处理的通知，在会话开始时展示给用户。
- 如果 `memorytree-daemon` 可用但当前机器未注册，建议用户运行 `memorytree-daemon install`。
