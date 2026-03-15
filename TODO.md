# memorytree-workflow Skill 开发待办

## 背景

本仓库是 MemoryTree 记忆系统的 Skill 实现，从 `beyondchenlin/memorytree` 独立拆出。
消费端项目（普通项目）通过安装此 Skill 获得记忆管理能力。

## 当前核心问题

大模型不可靠 — 会忘记执行 chat_log 记录、transcript 导入等机械性流程。
需要把这些确定性工作交给后台进程，大模型只做轻量的摘要和状态更新。

## 架构决策

### 定时心跳（单次执行 + OS 调度，零 token 消耗）
- 全局单实例: 1 台电脑 = 1 个定时任务，扫描所有项目
- 定时扫描客户端 transcript 目录（~/.claude/projects/、~/.codex/sessions/、~/.gemini/）
- 每次执行: 扫描 → 增量导入 → 清洗 → git commit + push → 退出
- 心跳间隔可配置（默认 5 分钟）
- 运行方式: OS 原生定时任务（cron / launchd / Task Scheduler），tmux 仅用于开发调试
- Git 策略: **默认 auto_push = true**（记忆数据安全优先，防止本地丢失）

### 大模型（对话时才介入，省 token）
- 只写当轮 chat_log 摘要（几行文字）
- 只更新 goal/todo 状态
- 不负责 transcript 导入、清洗、提交

---

## 待办任务（按优先级排序）

### P0: 定时心跳 — 核心阻塞项

> 验收标准: 全局单实例 heartbeat，OS 定时任务驱动，自动发现新 transcript 并完成导入 + commit + push，无需人工介入。

- [ ] **运行架构**: 单次执行 + OS 原生调度
  - 核心脚本 `heartbeat.py`: 跑一次扫描就退出（无状态、幂等）
  - OS 定时任务每 5 分钟调用一次
  - `memorytree-daemon install`: 自动检测 OS，注册定时任务
  - `memorytree-daemon run-once`: 手动执行一次（调试用）
  - `memorytree-daemon watch`: tmux 循环模式（开发调试用）
  - `memorytree-daemon uninstall`: 移除定时任务
- [ ] **首次安装触发**: Skill 激活时若 daemon 未注册，交互式询问用户配置偏好（间隔、auto_push、范围），确认后执行 install。询问方式必须兼容所有支持 Skill 的大模型（Claude Code、Codex、Gemini CLI），不依赖特定客户端的 UI 组件
- [ ] **实现 heartbeat 主逻辑**: 调用 `discover-transcripts.py` 扫描三个客户端目录
- [ ] **增量导入**: 发现新 transcript 时调用 `import-transcripts.py`
- [ ] **敏感信息预检**: 清洗阶段扫描常见敏感模式（API key、password、token），发现时标记警告写入日志（不自动删除，避免误伤）
- [ ] **自动 git 提交 + 推送**:
  - `git status --porcelain Memory/` → 无变动则跳过
  - 有变动 → `git add Memory/` → `git commit` → `git push`
  - **默认 auto_push = true**（记忆是用户资产，本地丢失不可恢复）
  - 首次安装时提示用户确认 push 行为，之后静默执行
  - 提交到当前分支（遵循项目已有的分支策略，不自动创建新分支）
- [ ] **git remote 前置检查**:
  - push 前检测 remote 是否存在
  - 无 remote → 跳过 push，记录到日志，下次 Skill 激活时提醒用户配置
- [ ] **配置文件** (`~/.memorytree/config.toml`，全局唯一):
  - 心跳间隔（默认 300s）
  - 监听目录列表（默认三个客户端目录）
  - 已注册项目列表（自动发现或手动添加）
  - auto_push 开关（默认 true）
  - log_level（默认 info）
- [ ] **运维能力**:
  - 日志输出到 `~/.memorytree/logs/heartbeat.log`（按日轮转）
  - 锁文件互斥（防止上一次还没跑完，下一次又启动）
  - push 失败时记录到日志，下次重试（网络中断不丢数据）
  - **错误通知**: 连续失败 3 次后，写入 `~/.memorytree/alerts.json`，下次 Skill 激活时展示给用户
  - **锁机制**: PID-based lock file，stale lock 通过检测进程存活自动回收
- [ ] **测试用例**:
  - [x] 单元测试: 配置加载、增量检测逻辑、锁文件互斥（27 tests in `test_heartbeat_modules.py`）
  - [x] 集成测试: 模拟新 transcript 出现 → 验证自动导入 + commit（`test_integration.py` Scenario 4）

### P0.5: 跨会话上下文恢复 — 核心用户价值

> 验收标准: 用户在新会话中说"看看最近的聊天"，Skill 即时同步最新 transcript，定位本项目最近一次会话，输出延续摘要，用户可无缝继续上次未完成的工作。

**场景**: 用户在会话 A 中讨论了很长时间但问题未解决，关闭后开新会话 B，不想重新描述所有背景。

**覆盖范围**: 三个客户端（Claude Code、Codex、Gemini CLI），支持跨客户端上下文恢复。例如 Codex 会话 → Claude Code 新会话。

- [ ] **即时同步路径**（不依赖心跳定时）:
  - 用户请求时立即扫描三个客户端的 transcript 目录
  - 增量导入到全局归档（`~/.memorytree/transcripts/`）和项目镜像（`Memory/06_transcripts/`）
  - 轻量级单项目同步，不需要全量扫描所有已注册项目
- [ ] **定位最近会话**:
  - 查询全局索引（`sessions.jsonl` / `search.sqlite`）
  - 过滤条件: `project = 当前目录` + `client IN (claude, codex, gemini)`
  - 按 timestamp 降序排列
  - 排除当前会话自身（基于 Skill 激活时间戳：`started_at` >= 激活时间的 transcript 视为当前会话，跨客户端通用）
- [ ] **延续摘要生成**（消耗 model token，但价值远大于用户手动重述）:
  - 读取定位到的 transcript（优先 clean，精确确认查 raw）
  - 结合 `Memory/03_chat_logs/` 已有的会话日志补充上下文
  - 提取:
    - 在讨论什么问题？
    - 尝试了哪些方案？
    - 走到了哪一步？
    - 什么没有解决？最后卡在哪里？
  - 输出来源标注（客户端、时间、时长）
- [ ] **On Activation 主动检测**（可选增强）:
  - Skill 激活时自动检测是否有未同步的新 transcript 属于当前项目
  - 有则主动提示: "发现你上次在这个项目有一个未完成的会话（Codex, 2h ago），要查看摘要吗？"
  - 不等用户主动询问，降低使用门槛
- [ ] **扩展查询能力**（后续迭代）:
  - "最近几次的聊天"（不限于一次）
  - "上次讨论部署的那次"（按主题查找）
  - 跨项目查找: "我在其他项目里讨论过这个问题吗？"

### 跨客户端兼容性原则

> 此原则适用于所有 P0–P3 任务中涉及交互提示的部分。

MemoryTree Skill 可被 Claude Code、Codex、Gemini CLI 等多个 AI 助手加载。所有交互行为必须:

1. **不依赖特定客户端的 UI 组件**: 不使用 Claude Code 独有的 AskUserQuestion 多选框等控件，只使用纯文本对话
2. **提示语言跟随用户/repo locale**: 不硬编码中英文
3. **用自然语言提问 + 等待用户回复**: 所有确认步骤都是"提问 → 等待回答 → 行动"，不依赖 button/checkbox
4. **AGENTS.md 模板中的规则必须是客户端无关的**: 不引用 Claude Code 专有概念（如 MCP、Skill tool 等）
5. **scripts 的 CLI 接口保持统一**: 无论被哪个客户端调用，参数和输出格式一致

### P1: 代码质量 — 降低维护成本

> 验收标准: `_transcript_utils.py` 拆分为 ≤400 行的模块；CI 流水线自动运行测试。

- [x] **拆分 `_transcript_utils.py`**（已完成，2aea9da）:
  - `_transcript_common.py`(257L) — 常量、通用工具函数、文本提取
  - `_transcript_parse.py`(352L) — 数据类 + 三客户端解析（Codex/Claude/Gemini）
  - `_transcript_import.py`(213L) — 导入、清洗、manifest 生成
  - `_transcript_index.py`(100L) — SQLite 索引操作
  - `_transcript_discover.py`(100L) — 文件发现、项目匹配
  - `_transcript_utils.py`(123L) — 向后兼容 re-export 层
  - 消费方脚本已更新为直接导入具体模块，59 个测试全部通过
- [x] **transcript 去重修复**（已完成）:
  - `_transcript_common.py` 新增 `deduplicate_messages()` / `deduplicate_tool_events()`（sha256 前缀签名）
  - 三个解析器统一在构建 `ParsedTranscript` 前调用去重；Gemini 移除内联 `message_signatures`
  - 17 个回归测试（单元 + 三客户端集成），全量 76 测试通过
- [x] **CI 流水线** (GitHub Actions):
  - Python 3.11/3.12/3.13 矩阵测试（Linux/macOS/Windows，9 组合）
  - 测试覆盖率报告（≥ 80%，当前 90%）
- [x] **集成测试补充**（`test_integration.py`，27 tests）:
  - init → parse → import 端到端流程
  - discover 批量扫描流程
  - heartbeat 敏感信息扫描
  - heartbeat 函数级测试（main, _run_heartbeat, _process_project, _git_commit_and_push, _try_push, _git）

### P2: 大模型职责最小化 — 依赖 P0 完成

> 验收标准: SKILL.md 明确标注哪些工作由 heartbeat 负责；transcript 处理段落标记为"大模型不执行"。

- [ ] **更新 SKILL.md On Activation 段**:
  - 明确大模型只负责: chat_log 摘要 + goal/todo 更新
  - 明确 heartbeat 负责: transcript 发现/导入/清洗/提交
- [ ] **添加定时任务状态检测**:
  - On Activation 时检测定时任务是否已注册（检查 crontab / launchd plist / schtasks）
  - 未注册则提示用户运行 `memorytree-daemon install`
  - 读取 `~/.memorytree/alerts.json`，展示累积的错误通知

### P3: 分发与兼容 — 降低使用门槛

> 验收标准: 用户可通过 `pip install` 或 `uv add` 安装；跨平台路径正确。

- [ ] **项目包化**:
  - 添加 `pyproject.toml`（含版本号、入口点、依赖声明）
  - CLI 入口: `memorytree-daemon install|uninstall|run-once|watch|status`
- [ ] **跨平台路径兼容**:
  - Windows: `%APPDATA%` / `%LOCALAPPDATA%` 路径适配
  - 测试矩阵覆盖 Windows/macOS/Linux
- [ ] **安装文档更新**:
  - pip install 方式
  - Claude Code skill 安装方式
  - 各平台定时任务注册说明（自动 install 失败时的手动方案）

---

## 任务依赖关系

```
P0 (heartbeat) ──→ P2 (职责最小化，需要 heartbeat 就绪)
P0 (heartbeat) ──→ P3 (打包需包含 heartbeat)
P0.5 (上下文恢复) 可与 P0 并行（复用现有 discover + import + SQLite，不需要 daemon）
P1 (代码拆分) 可与 P0 并行（代码质量优化，非硬依赖）
跨客户端兼容性原则 ─贯穿→ 所有交互设计
```

建议执行顺序: **P0 heartbeat + P0.5 上下文恢复（并行） → P1 拆分 → P2 职责更新 → P3 分发**

## 环境要求

- **Python 3.11+**（`tomllib` 为 3.11+ stdlib，无需第三方 TOML 包）
- Python 3.9 已于 2025 年 10 月 EOL，3.10 将于 2026 年 10 月 EOL

---

## 相关仓库

- 消费端项目: `beyondchenlin/memorytree`（目标 v002 已创建）
- 本仓库: `beyondchenlin/memorytree-workflow`

## 现有脚本（可复用）

| 脚本 | 用途 |
|------|------|
| init-memorytree.py | 新项目初始化记忆目录结构 |
| upgrade-memorytree.py | 安全升级已有项目 |
| import-transcripts.py | 单文件 transcript 导入（raw → clean → manifest → SQLite） |
| discover-transcripts.py | 批量扫描三个客户端的 transcript |
| detect-memorytree-locale.py | 检测项目语言环境 |

## 远期愿景: OpenMnemo

以 Gitea 为底座的 SaaS 记忆平台，跨平台 AI 对话聚合 + 语义检索 + Git 版本管理。
项目名 OpenMnemo（来自希腊记忆女神 Mnemosyne），域名和 GitHub org 全线可用。

预研课题（待独立为单独文档）:
- [ ] Gitea API 批量写入验证（POST /api/v1/repos/{owner}/{repo}/contents）
- [ ] 多租户仓库结构设计（每用户一个 Git 仓库）
- [ ] 语义检索方案: BM25 (SQLite FTS5) + 向量搜索
- [ ] 浏览器插件可行性: 从 ChatGPT/Claude/Gemini 网页版采集对话
