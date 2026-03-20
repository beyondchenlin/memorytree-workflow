# Daemon 命令精简与 Help 展示讨论

## 说明

本文档记录的是一轮“只讨论、不修改代码”的结论。

后续执行结果补充：

- 已落地 `memorytree daemon quick-start --root .`
- 已为 `daemon`、`daemon register`、`daemon install`、`daemon run-once` 补充场景型 `--help`
- 原有 `install` / `register` / `run-once` 底层命令仍然保留

讨论主题是下面这 3 条命令：

```bash
node dist/cli.js daemon register --root . --quick-start
node dist/cli.js daemon install --interval 5m --auto-push true
node dist/cli.js daemon run-once --root . --force
```

用户关心的是：

- 这 3 条命令能不能精简
- 是否适合写进 `--help`
- 如何让普通用户更容易理解

## 1. 这 3 条命令现在分别在做什么

### 1.1 `daemon register --root . --quick-start`

作用是：

- 把当前仓库接入 MemoryTree
- 用推荐默认值初始化当前项目
- 创建或复用这个项目对应的 worktree
- 默认 MemoryTree 分支为 `memorytree`
- 默认开启 heartbeat 和报告相关推荐配置

通俗讲：

这一步是在说：

“让这个仓库正式接入 MemoryTree 自动体系。”

### 1.2 `daemon install --interval 5m --auto-push true`

作用是：

- 把 heartbeat 注册到操作系统后台任务
- 设定周期，例如 `5m`
- 指定全局层面的 `auto_push` 行为

通俗讲：

这一步是在说：

“把自动运行机制装到这台电脑里。”

注意：

这一步更偏“本机安装”，不是“当前仓库接入”。

### 1.3 `daemon run-once --root . --force`

作用是：

- 立刻针对当前仓库手动执行一次 heartbeat
- 不等下一次定时任务
- `--force` 表示就算当前还没到执行时间，也先跑一次

通俗讲：

这一步是在说：

“现在马上先跑一遍，让我立刻看到结果。”

## 2. 为什么看起来长

这 3 条命令不是重复，而是在做 3 个层级的事情：

- 项目注册
- 系统安装
- 立即执行

所以它们看起来像一组启动命令，但本质上不是同一个动作拆成 3 份，而是 3 类不同动作连在一起使用。

也正因为这样，用户第一次看时很容易觉得：

- 为什么要写这么多
- 为什么不能一条命令完成
- 哪条是第一次用，哪条是平时用

## 3. 能不能精简

结论：

可以。

但要分成两种不同的“精简”。

### 3.1 说明层面的精简

这是最安全、最适合先做的。

也就是说，不急着改命令本身，而是先把“使用场景”讲清楚。

例如可以改成下面这种说明方式：

- 本机只需要做一次：

```bash
memorytree daemon install --interval 5m --auto-push true
```

- 当前仓库只需要接入一次：

```bash
memorytree daemon register --root . --quick-start
```

- 如果想立刻看到结果，再执行：

```bash
memorytree daemon run-once --root . --force
```

这样做的好处是：

- 不改代码
- 不改命令结构
- 但用户的理解成本会明显下降

### 3.2 命令层面的精简

这个也可以，但需要以后改代码。

最自然的方向是增加一个“一键启动”命令，例如：

```bash
memorytree daemon quick-start --root .
```

这条命令内部自动做完：

- install
- register
- run-once

通俗讲：

用户只要记住一句：

“首次接入当前仓库，就执行 `daemon quick-start`。”

这会是更像产品级体验的方案。

## 4. 能不能写进 `--help`

结论：

非常适合。

而且我认为应该写。

原因不是当前 help 不够详细，而是当前 help 的类型不对。

### 4.1 当前 help 的特点

当前 help 主要是参数说明，比如：

- 这个选项叫什么
- 这个参数收什么值
- 默认值是什么

这类 help 对“已经知道要用哪个命令的人”有用。

### 4.2 当前 help 的不足

普通用户第一次真正想知道的往往不是：

- `--root` 是什么
- `--interval` 是什么

而是：

- 我第一次使用到底先敲哪条
- 当前仓库接入该用哪条
- 如果我想马上看到效果，再敲哪条

也就是说，用户需要的是“场景型 help”，不是只有“参数型 help”。

### 4.3 更适合补充的 help 内容

例如可以补这种内容：

#### 首次在本机启用

```bash
memorytree daemon install --interval 5m --auto-push true
```

#### 首次让当前仓库接入

```bash
memorytree daemon register --root . --quick-start
```

#### 立即执行一次

```bash
memorytree daemon run-once --root . --force
```

这种内容比单纯解释参数更符合真实使用场景。

## 5. 如果不改代码，最好的理解方式是什么

如果只讨论、不修改代码，那么最推荐的理解方式是：

- `install`
  是“本机安装”
- `register`
  是“项目接入”
- `run-once`
  是“立刻同步一次”

这样用户脑子里不要记 3 条散命令，而是记 3 个动作：

- 本机安装
- 仓库接入
- 立即同步

这比单纯背命令更容易长期记住。

## 6. 对产品形态的建议

如果未来允许修改代码，那么从产品体验角度看，最顺手的方向是：

### 6.1 增加一键命令

例如：

```bash
memorytree daemon quick-start --root .
```

让它自动完成首次常见流程。

### 6.2 保留现有 3 条底层命令

原因是：

- 现有 3 条命令的职责边界其实是清楚的
- 对高级用户和调试场景仍然有价值
- 一键命令应该是“上层包装”，不是取代底层命令

### 6.3 在 help 中加入“场景说明”

也就是说：

- 帮助文档不只写参数
- 还要写“首次使用怎么做”
- 还要写“平时只想立即同步怎么做”

## 7. 一句话结论

关于下面这 3 条：

```bash
node dist/cli.js daemon register --root . --quick-start
node dist/cli.js daemon install --interval 5m --auto-push true
node dist/cli.js daemon run-once --root . --force
```

最终讨论结论是：

- 可以精简
- 最容易先落地的是把“场景示例”写进 `--help`
- 真正最顺手的长期方案，是以后增加一条类似 `daemon quick-start --root .` 的一键命令
- 在不改代码的前提下，最适合用户理解的方式是：
  - `install = 本机安装`
  - `register = 仓库接入`
  - `run-once = 立即同步`
