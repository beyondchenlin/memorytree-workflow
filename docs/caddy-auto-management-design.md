# Caddy 自动管理设计文档

## 1. 文档目的

本文档用于定义 MemoryTree 下一阶段的本地报告托管方案：

- `Caddy` 继续作为本地长期访问的主入口
- `report serve` 保留为临时预览和兜底工具
- MemoryTree CLI 负责“管理 Caddy 配置”，而不是让用户手工改一堆文件

一句话概括：

**不是让 heartbeat 去反复启动网页服务，而是让项目一次性接入 Caddy，后面由 Caddy 长期常驻。**

## 2. 当前现状

当前仓库已经明确了这套使用逻辑：

- `MemoryTree` 负责生成 `Memory/07_reports`
- `Caddy` 负责长期托管 `Memory/07_reports`
- `report serve` 只作为备用入口

但现在还缺一块：

- 项目还不会自动把自己“登记到 Caddy”
- 用户仍然需要手工处理 Caddy 配置、reload、排查端口

这会导致：

- 初次接入不够顺手
- 多项目并行时容易手工改错
- 团队成员很难判断“这个项目到底有没有接上 Caddy”

另外，设计里还需要明确 3 个关键点，否则后续实现会不稳：

- MemoryTree 到底接管哪一份 Caddy 主配置
- 本地报告默认是“仅本机可见”还是“局域网可见”
- 多项目配置片段如何保证文件名唯一

## 3. 目标

第一阶段目标只做一件事：

**让 MemoryTree 能自动管理“当前项目对应的 Caddy 配置片段”。**

希望达到的用户体验：

1. 用户执行一条启用命令
2. 当前项目自动写入 Caddy 配置
3. Caddy 自动 reload
4. 用户马上就能通过 `127.0.0.1:端口`、`localhost:端口`、局域网 IP 加端口访问

## 4. 非目标

第一阶段明确不做下面这些事情：

- 不自动安装 Caddy 二进制
- 不自动注册 Caddy 系统服务
- 不自动配置系统防火墙
- 不让 heartbeat 负责启动或关闭 Caddy
- 不替代 `report serve`

原因很简单：

- 自动安装和自动注册服务跨平台差异大，复杂度高
- heartbeat 的职责是同步内容，不是管理常驻网页服务
- 先把“项目自动接入 Caddy”做好，收益最大、风险最小

## 5. 设计结论

推荐采用下面这套结构：

### 5.1 职责拆分

- `heartbeat` / `report build`
  负责生成和更新 `Memory/07_reports`
- `Caddy`
  负责长期托管本地网页
- `MemoryTree CLI`
  负责为每个项目生成、删除、检查对应的 Caddy 配置片段

### 5.2 配置模式

推荐采用：

- 一个全局 Caddy 主配置
- 多个项目级独立配置片段

也就是：

- Caddy 仍然是全局只有一份
- 但每个 MemoryTree 项目各自拥有自己的站点配置文件

这样做的好处：

- 多项目不会互相覆盖
- 启用/停用某个项目时，只改它自己的配置片段
- 后续更容易排查问题

### 5.3 主配置归属规则

第一阶段必须明确一条规则：

**MemoryTree 只管理自己这一套专用 Caddy 主配置，不尝试兼容用户任意已有的其他 Caddyfile。**

也就是说：

- 如果用户要使用 MemoryTree 的自动 Caddy 管理
- 那么当前机器上的 Caddy 就必须用 MemoryTree 这套主配置启动

这样做的目的很直接：

- 避免“MemoryTree 写的是一份配置，但正在运行的 Caddy 用的是另一份配置”
- 避免 enable / disable 看起来成功，实际服务没有变化

通俗讲：

- MemoryTree 以后只认自己这一份“总账”
- 不同时兼容一堆外部手工配置文件

## 6. 推荐目录结构

建议在用户级目录下维护 Caddy 管理目录，例如：

```text
~/.memorytree/caddy/
  Caddyfile
  sites/
    d-demo1-memorytree-workflow-d-demo1-memorytree-workflow.caddy
    c-users-ai-memorytree-worktrees-openmnemo-c-users-ai-memorytree-worktrees-openmnemo.caddy
```

含义：

- `Caddyfile`
  全局主配置
- `sites/*.caddy`
  每个项目一个独立配置片段

主配置只负责一件事：

- 引入 `sites/` 目录下的所有项目配置片段

项目配置片段只负责一件事：

- 描述“当前项目的报告目录对应哪个端口”

片段文件名规则：

- 使用项目配置里的 `project.id`
- 不直接使用项目名

原因：

- 项目名可能重复
- `project.id` 在当前配置模型里已经是稳定唯一标识
- 这样才能真正做到多项目不互相覆盖

## 7. 项目配置片段的核心信息

每个项目的 Caddy 配置片段，至少要表达下面几项：

- 项目标识
- 绑定端口
- 报告目录
- 暴露范围

通俗说，就是告诉 Caddy：

“请把这个项目的 `Memory/07_reports` 挂到这个端口上。”

这里的“暴露范围”必须是明确配置，而不是隐式推断。

建议新增一个项目级配置项，例如：

```toml
report_exposure = "local"
```

可选值建议只有两个：

- `local`
  只允许本机访问
- `lan`
  允许局域网访问

推荐默认值：

- **`local`**

原因：

- 更安全
- 更符合“默认只给自己看”的直觉
- 避免用户一接入就无感暴露到整个局域网

## 8. 推荐 CLI 命令

第一阶段建议增加这 3 个命令：

### 8.1 `memorytree caddy enable --root .`

作用：

- 为当前项目生成或更新 Caddy 配置片段
- 自动读取当前项目的 `report_port`
- 自动读取当前项目的 `report_exposure`
- 自动指向当前项目的 `Memory/07_reports`
- 自动 reload Caddy

通俗理解：

**把当前项目接入 Caddy。**

### 8.2 `memorytree caddy disable --root .`

作用：

- 删除当前项目对应的 Caddy 配置片段
- 自动 reload Caddy

通俗理解：

**把当前项目从 Caddy 下线。**

### 8.3 `memorytree caddy status --root .`

作用：

- 告诉用户当前项目有没有接入 Caddy
- 当前绑定的端口是多少
- 当前报告目录是什么
- Caddy 是否正在运行
- 当前可访问地址是什么

通俗理解：

**查看当前项目的 Caddy 状态。**

## 9. `enable` 命令的推荐流程

建议 `memorytree caddy enable --root .` 按下面顺序执行：

1. 解析当前项目根目录
2. 读取当前项目的 `report_port`
3. 读取当前项目的 `report_exposure`
4. 计算当前项目的报告目录：
   `Memory/07_reports`
5. 检查当前运行中的 Caddy 是否使用 MemoryTree 这套主配置
6. 检查 `sites/` 目录是否存在，不存在就创建
7. 用 `project.id` 生成当前项目的配置片段文件名
8. 为当前项目生成配置片段
9. 调用 `caddy reload`
10. 输出访问地址

建议输出类似：

```text
Caddy enabled for project: memorytree-workflow
Report directory: D:/demo1/memorytree-workflow/Memory/07_reports
Port: 10010
Local URL: http://127.0.0.1:10010/
```

如果 `report_exposure = "lan"`，再额外输出：

```text
LAN URL: http://192.168.1.99:10010/
```

## 10. `disable` 命令的推荐流程

建议按下面顺序执行：

1. 定位当前项目对应的配置片段
   文件名来源于 `project.id`
2. 删除该片段
3. 调用 `caddy reload`
4. 输出停用结果

注意：

- 只删除当前项目自己的片段
- 不影响其他项目
- 不删除全局主配置

## 11. `status` 命令的推荐输出

建议输出这些信息：

- Caddy 是否安装
- Caddy 是否在运行
- 当前运行中的 Caddy 是否使用 MemoryTree 主配置
- 当前项目是否已接入
- 当前项目使用的端口
- 当前项目的暴露范围
- 当前项目指向的目录
- 当前建议访问地址

例如：

```text
Caddy installed: yes
Caddy running: yes
Using MemoryTree Caddyfile: yes
Project registered: yes
Port: 10010
Exposure: local
Report directory: D:/demo1/memorytree-workflow/Memory/07_reports
Local URL: http://127.0.0.1:10010/
```

## 12. 端口冲突策略

这是必须提前定义清楚的部分。

推荐策略：

### 12.1 优先使用项目自己的 `report_port`

也就是说：

- 端口来源仍然是当前已经存在的项目配置
- Caddy 只是复用这个端口，不重新发明一套端口配置
- 暴露范围来源于当前项目配置里的 `report_exposure`

### 12.2 如果端口已被别的 MemoryTree 项目占用

建议直接报错，不自动改端口。

原因：

- 自动改端口会让用户失去预期
- 多项目同时跑时，用户更需要“明确报错”，而不是“偷偷换端口”

推荐提示方式：

```text
Port 10010 is already used by another managed Caddy site.
Change this project's report_port first, then rerun `memorytree caddy enable --root .`.
```

### 12.3 如果端口被非 MemoryTree 进程占用

同样直接报错，不自动抢占。

## 13. 与 heartbeat 的关系

这是最容易被混淆的一点。

正确逻辑应该是：

- heartbeat 更新内容
- Caddy 托管内容

而不是：

- heartbeat 启动 Caddy
- heartbeat 每次重启 Caddy

所以建议：

- `daemon quick-start` 不直接控制 Caddy
- `heartbeat run-once` 不去拉起 Caddy
- Caddy 接入是单独一步

后续如果真的要做“一键接入”，也应该是：

- `daemon quick-start`
- 再加一个可选的 `caddy enable`

而不是把两者强行绑成同一个后台周期任务

## 14. 与 `report serve` 的关系

建议保持下面的产品定位：

- `Caddy`
  长期本地使用主路径
- `report serve`
  临时预览和备用路径

也就是说：

- 不删除 `report serve`
- 不再把 `report serve` 当成推荐的长期方案

这样既保留灵活性，也不会让长期使用路径混乱。

## 15. 跨平台考虑

第一阶段建议先把命令设计成跨平台兼容，但实现时接受“外部环境不同”这一事实。

最小兼容目标：

- Windows
- macOS
- Linux / Ubuntu

建议命令层只做这些事情：

- 查找 Caddy 可执行文件
- 调用 `caddy reload`
- 读写 MemoryTree 自己维护的配置目录

不建议第一阶段就做：

- 自动注册 Windows 服务
- 自动注册 launchd
- 自动注册 systemd

这些可以留到第二阶段。

## 16. 失败处理

推荐区分 3 类失败：

### 16.1 没安装 Caddy

输出明确提示：

- 当前机器还没有可用的 Caddy
- 请先手工安装

### 16.2 配置片段写入失败

直接报错并停止，不 reload

### 16.3 `caddy reload` 失败

要明确告诉用户：

- 配置文件已经写入
- 但 Caddy 没有成功重载
- 当前访问可能还没生效

### 16.4 当前运行中的 Caddy 没有使用 MemoryTree 主配置

要明确告诉用户：

- 当前机器上虽然有 Caddy
- 但它现在不是按 MemoryTree 这套主配置启动的
- 因此自动 enable / disable 不保证生效

这是第一阶段必须显式检查的失败场景。

## 17. 推荐落地顺序

建议按下面顺序推进：

### 第一步

先做设计确认：

- 命令名是否接受
- 配置目录是否接受
- 端口冲突策略是否接受

### 第二步

实现第一阶段：

- `caddy enable`
- `caddy disable`
- `caddy status`

### 第三步

补测试：

- 单测
- CLI e2e
- Windows 路径场景

### 第四步

再考虑第二阶段：

- 自动安装 Caddy
- 自动注册系统服务
- 可能的一键接入

## 18. 最终结论

下一步最合理的方向不是“让 heartbeat 管 Caddy 进程”，而是：

**让 MemoryTree CLI 管理每个项目的 Caddy 配置片段。**

这样可以同时满足：

- 本地长期访问稳定
- 多项目不冲突
- 端口规则清晰
- 用户基本无感接入

如果团队认可这份设计，下一步就可以开始进入实现阶段。
