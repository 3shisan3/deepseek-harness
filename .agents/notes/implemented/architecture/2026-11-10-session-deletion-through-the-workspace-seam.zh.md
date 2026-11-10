# Agent Note: 通过 Workspace 接缝销毁会话

Status: implemented

[English](2026-11-10-session-deletion-through-the-workspace-seam.md) | 中文

## 问题

会话可以归档与恢复，但没有任何途径能移除它。归档是一次展示集合写入：日志仍留在磁盘上，账户槽位被保留，取消归档即可恢复该行。移除需要相反的保证——存储日志必须消失、注册表中指向该 id 的引用必须全部停止、实时 Agent 必须结束以关闭其持久写句柄。

写句柄是难点。`SessionPersistence` 有意不提供按 id 寻址的修改：每次读写都流经 `SessionHandle`，句柄的属主持有单写所有权。因此后端无法在活跃写入方之下删除日志，而任何注册表层调用也无法触达关闭它的拆除流程——`AgentHandle.dispose()` 仅由创建该 Agent 的属主持有，对普通 API 会话而言就是 `ApiSessionAgentController`。

## 决策

永久删除，由 Workspace 接缝拥有：

| 项 | 契约 |
|---|---|
| 存储 | `SessionPersistence.delete(id)` 整体销毁一个已存储会话——产物、相邻格式代，以及任何未实体化条目。对没有已存储会话占用的 id 解析为 `false`；在有写句柄持有该 id 时以 `SessionAlreadyOwnedError` 拒绝。 |
| 编排 | `WorkspaceRegistry.deleteSession(sessionId)` 确认会话存在、停止其工作、结束其实时 Agent、删除日志，只有到此后才移除每个工作区的账户槽位、归档集合与置顶集合。 |
| 停止 | `workspace/session-stop`（parallel）——沿用既有的归档准入提供方，未作改动。 |
| 拆除 | `workspace/session-dispose`（parallel，等待完成）——每个持有实时 Agent 句柄的属主拆除它并等待该拆除完成，使日志删除找不到写入方。 |
| 通知 | `workspace/session-deleted`（emit）——注册表写入后的信号。`session-controller` 把它转发为 `api-session/removed`，使已销毁的冷会话也会离开客户端列表；对于从未实时存在的会话，`session/disposed` 无法做到这一点。 |
| 远程 | 既有 `workspace` namespace 上的 `workspace/deleteSession`，与 `archiveSession`、`unarchiveSession` 并列；行菜单、悬停操作区与 Session 标题行都唤起同一次确认。 |
| 未知 id | 以 `WorkspaceUnknownSessionError` 拒绝，映射为 `session/not-found`。重复删除是 not-found，因为第一次调用已经移除了该会话。 |

注册表最后才写自己的引用。若在日志删除与该次写入之间崩溃，注册表会留下指向缺失日志的条目，而成员投影本就会把它们过滤掉；反过来则会留下注册表从不命名的孤儿日志。

## 备选方案

| 备选 | 被拒原因 |
|---|---|
| Session namespace 上的 `session/delete` | Session namespace 拥有的是寻址实时 Agent 的命令（prompt、rename、fork、cancel）。删除是唯一必须触及存储、每个工作区账户、归档集合与置顶集合的操作——这些全是注册表状态。把它放在 `session` 会让 API 层依赖注册表的完整状态，或复制注册表已为归档准入拥有的编排。 |
| 软删除（墓碑集合，保留日志） | 用户要求的是永久移除。墓碑仍会让日志暴露给 `session-query`，并且需要在每条读取路径上再加一条隐藏规则。 |
| 回收站／隔离区并可恢复 | 会引入保留策略、过期机制与恢复界面。产品并没有要求可恢复性；确认对话框就是安全网。 |
| 幂等删除（对未知 id 解析，像 `unarchiveSession`） | `unarchiveSession` 幂等，是因为从集合移除 id 不可能引入未知 id，且两次恢复之间丢失竞态无害。删除一个已不存在的 id 是另一种答案：调用方点名的东西不在了，而界面需要 `session/not-found` 来撤掉它们仍在显示的行。 |
| 注册表内删除日志而不引入 dispose 事件 | 注册表需要知道如何结束实时 Agent，而那只能通过 `AgentHandle` 触达的 `dsh-agent-loop` 内部。parallel 事件把该知识留给持有句柄的属主，与既有的 `session-activity`/`session-stop` 接缝一致。 |
| 在 `ClientWorkspaceModel.deleteSession` 中乐观重写客户端投影 | follow 流已经携带删除所写入的账户、归档与置顶变更。再写一次本地状态只会与流竞逐，没有收益。 |

## 后果

- 会话删除不可逆，也不留墓碑。附件 blob 将不可达，附件存储本已把这一点记为等待保留策略。
- 实时 Agent 由其他属主发布（subagent routing、ACP）的会话没有 `workspace/session-dispose` 监听器，其写句柄保持打开，日志删除会拒绝。这是显式失败，而非静默。
- 注册表的 `WorkspaceUnknownSessionError` 增加了 `delete` 动词。
- 已删除冷会话的客户端列表行经 `api-session/removed` 消失；实时会话则同时经该转发与 `session/disposed` 消失，二者幂等。
- 派生索引不消费 `workspace/session-deleted`：`session-query-sqlite` 在下一次稳定观察时才用 `sessionPersistence.list()` 对账持久行，因此已删除会话在此之前会留下不可达的索引行。
