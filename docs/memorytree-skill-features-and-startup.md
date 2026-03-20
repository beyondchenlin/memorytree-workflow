# MemoryTree Skill 功能与启动说明

## 1. 它是什么

`memorytree-workflow` 可以理解成一套给 AI 开发项目使用的“长期记忆系统”。

它不是单一功能，而是三层东西组合在一起：

- `skill`
  就是在 Claude Code、Codex 这类工具里直接调用的能力。
- `CLI`
  就是命令行工具，负责初始化、导入、查询、生成报告、启动后台任务。
- `heartbeat`
  就是后台定时自动运行的部分，负责持续同步和刷新 MemoryTree 数据。

一句话理解：

它的目标是让一个仓库拥有“可持续记录、可自动同步、可网页查看”的项目记忆能力。

## 2. 它能做什么

### 2.1 建立项目记忆目录

它可以在仓库里建立一套固定结构：

```text
AGENTS.md
Memory/
  01_goals/
  02_todos/
  03_chat_logs/
  04_knowledge/
  05_archive/
  06_transcripts/
  07_reports/
```

通俗讲：

- `01_goals` 记录项目目标
- `02_todos` 记录当前待办
- `03_chat_logs` 记录会话摘要
- `06_transcripts` 记录聊天转录
- `07_reports` 生成网页报告

### 2.2 自动发现聊天记录

它可以扫描本机的 AI 工具记录，当前支持：

- `Codex`
- `Claude Code`
- `Gemini CLI`

发现后会把和当前项目有关的 transcript 归档进 MemoryTree。

### 2.3 导入和整理 transcript

它会把 transcript 分成几类：

- `raw`
  原始记录，保留原样
- `clean`
  清洗后的可读版本
- `manifests`
  对应的索引信息

通俗讲：

- `raw` 是原件
- `clean` 是方便阅读和检索的版本
- `manifests` 是索引卡片

### 2.4 找回上次项目会话

它支持 `recall`。

作用是：

- 找出这个项目上一次聊到哪
- 帮你恢复上下文
- 支持跨客户端找回

也就是说：

你上次可能在 Claude Code 里聊的，这次也能在 Codex 里找回来。

### 2.5 生成网页报告

它可以把项目记忆和 transcript 生成一个静态网页站点，默认输出到：

```text
Memory/07_reports/
```

网页里通常会包含：

- dashboard
- transcript 列表和详情页
- goals / todos / knowledge / archive 页面
- 搜索
- graph 视图
- RSS

### 2.6 本地打开网页查看

长期本地访问的推荐方式是：

- 让 Caddy 常驻托管 `Memory/07_reports`
- 固定使用 `10010` 这类端口访问

`report serve` 仍然保留，但它更适合临时预览或兜底，不是长期常驻方案。

默认端口是：

```text
10010
```

### 2.7 后台自动运行 heartbeat

它可以注册操作系统的后台定时任务，让系统周期性执行：

- 发现 transcript
- 导入 transcript
- 更新 Memory
- 生成报告
- 按规则提交和推送

### 2.8 用独立 worktree 隔离自动同步

这是当前这套方案里很重要的一点。

通俗讲：

- 主开发目录给你正常开发用
- heartbeat 不直接在主开发目录里乱写
- heartbeat 在独立 worktree 里运行
- 生成后的结果再同步回主目录

这样可以减少自动同步对主开发分支的干扰。

## 3. 怎么启动

## 3.1 启动 skill

如果是在支持 skill 的环境里，可以直接调用。

例如在 Claude Code 里：

```text
/memorytree-workflow
```

作用是：

- 自动检查当前仓库是不是已接入 MemoryTree
- 如果没接入，就初始化或升级
- 如果已经接入，就读取当前 goal / todo / chat log

## 3.2 启动 CLI

先在仓库根目录执行：

```bash
npm install
npm run build
```

然后通过下面方式运行：

```bash
node dist/cli.js <命令>
```

如果执行过：

```bash
npm link
```

也可以直接写成：

```bash
memorytree <命令>
```

## 3.3 最短启动方式

如果你只是想用最短的一条命令，把当前仓库接入并立刻跑起来，直接执行：

```bash
node dist/cli.js daemon quick-start --root .
```

这条命令会自动串起来做 3 件事：

- 如果这台机器还没装 heartbeat，就先安装系统后台任务
- 用推荐默认值把当前仓库注册进 MemoryTree
- 立刻先跑一次 heartbeat

通俗讲：

这是当前“第一次接入当前仓库”最省心的方式。

## 3.4 手动拆开执行时怎么做

如果你不想用一键命令，也可以继续拆成 3 步手动执行。

### 第 1 步：给当前仓库接入 heartbeat

```bash
node dist/cli.js daemon register --root . --quick-start
```

这一步通常会做这些事情：

- 把当前项目注册进配置
- 创建或复用专用 worktree
- 默认 MemoryTree 分支设为 `memorytree`
- 默认 heartbeat 间隔设为 `5m`
- 默认开启报告生成

### 第 2 步：安装后台定时任务

让系统后台常驻定时执行：

```bash
node dist/cli.js daemon install --interval 5m --auto-push true
```

通俗讲：

这一步不是“立刻同步一次”，而是“把自动运行机制装到系统里”。

### 第 3 步：手动立刻跑一次

如果你不想等下一次定时执行，可以手动触发：

```bash
node dist/cli.js daemon run-once --root . --force
```

作用是：

- 立刻对当前项目执行一次 heartbeat
- 不等定时器

## 3.5 查看 heartbeat 当前状态

```bash
node dist/cli.js daemon status
```

它会告诉你：

- 有没有注册后台任务
- 当前锁状态
- 心跳间隔
- auto-push 是否开启
- 当前注册了多少个项目

## 3.6 手动生成网页报告

```bash
node dist/cli.js report build --root . --no-ai
```

生成位置通常是：

```text
Memory/07_reports/
```

## 3.7 临时打开本地网页服务

长期本地使用时，推荐让 Caddy 直接指向 `Memory/07_reports/`。

如果只是临时预览，或者当前机器没有走 Caddy，再使用下面这条备用命令：

```bash
node dist/cli.js report serve --dir ./Memory/07_reports --port 10010
```

打开后可以访问：

```text
http://127.0.0.1:10010/
```

## 4. 常用命令一览

### 初始化或升级

```bash
node dist/cli.js init --root .
node dist/cli.js upgrade --root .
```

### 发现 transcript

```bash
node dist/cli.js discover --root . --client all --scope current-project
```

### 导入单个 transcript

```bash
node dist/cli.js import --root . --source <文件路径>
```

### 找回上次会话

```bash
node dist/cli.js recall --root . --format text
```

### 查看后台状态

```bash
node dist/cli.js daemon status
```

### 一键快速接入当前仓库

```bash
node dist/cli.js daemon quick-start --root .
```

### 手动跑一次 heartbeat

```bash
node dist/cli.js daemon run-once --root . --force
```

### 手动生成报告

```bash
node dist/cli.js report build --root . --no-ai
```

### 临时启动报告网页

```bash
node dist/cli.js report serve --dir ./Memory/07_reports --port 10010
```

长期本地访问则推荐：

- 用 Caddy 常驻托管 `Memory/07_reports/`
- 继续固定访问 `http://127.0.0.1:10010/`、`http://localhost:10010/` 或局域网 IP 加端口

## 5. 日常使用时，最常见的理解方式

如果只从实际使用角度理解，可以记住下面这套：

1. `skill`
   负责在对话里理解和维护项目记忆
2. `heartbeat`
   负责后台定时同步
3. `report`
   负责把结果变成网页给人看

也可以再简单一点：

- 你平时开发在主目录
- heartbeat 在 worktree 后台跑
- report 给你一个网页入口看结果

## 6. 当前这个仓库的实际状态

截至当前，这个仓库已经具备下面这些状态：

- 当前项目已经接入 heartbeat
- heartbeat 已经注册到系统
- 当前项目已经有独立 worktree
- 当前本地网页主入口由 Caddy 常驻托管，查看地址是：

```text
http://127.0.0.1:10010/
```

## 7. 一句话总结

`memorytree-workflow` 不是单纯一个“聊天记录工具”，而是一整套“项目记忆 + transcript 归档 + 后台同步 + 网页查看”的系统。

如果只记最核心的三件事：

- 它负责记住项目上下文
- 它可以后台自动同步
- 它可以生成网页给人直接查看
