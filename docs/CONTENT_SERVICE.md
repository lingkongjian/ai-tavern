# 统一剧本内容服务规范

本文档定义运行中剧本的统一读取与编辑协议。人物、地点、剧情任务、伏笔、触发器、世界书、原文和记忆都必须通过同一个服务边界进入剧本工作台；“修改记录”从统一读取接口汇总资料与状态审计，跨领域状态补偿回滚与字段锁仍使用专用接口。

协议版本固定为 `1.0.0`，与导入文件、模型输出和完整存档的版本相互独立。

## 1. 接口

- `GET /api/adventures/{sessionId}/content`：读取内容快照和两类审计记录。
- `GET /api/adventures/{sessionId}/content?audit=false`：只读取内容快照。
- `POST /api/adventures/{sessionId}/content`：校验并执行一项内容命令。

旧的 `characters`、`locations`、`story-modules`、`world-book`、`sources` 和 `memories` 路由暂时保留，供旧页面或本地脚本兼容；当前剧本工作台只使用统一接口。

## 2. 命令信封

```json
{
  "schemaVersion": "1.0.0",
  "actionId": "客户端为本次操作生成的 UUID",
  "domain": "characters",
  "command": {
    "operation": "set_presence",
    "characterId": "角色 ID",
    "present": true
  }
}
```

`actionId` 用于网络失败后的安全重试。调用方只能为完全相同的领域和命令复用同一 ID；命令内容改变时必须生成新 ID。重复提交返回 `reused=true`，原文与记忆服务还会核对请求哈希并拒绝用同一 ID 改换内容。

## 3. 领域与操作

| `domain` | 支持的 `operation` | 主要内容 |
| --- | --- | --- |
| `characters` | `create`、`update`、`set_presence`、`set_active` | 人物卡、角色当前状态与在场状态 |
| `locations` | `create`、`update`、`set_current`、`set_active` | 地点资料、当前位置与默认登场人物 |
| `story_modules` | `create`、`update`、`set_active` | 任务目标、完成条件、前置关系与启停 |
| `foreshadowing` | `create`、`update`、`delete` | 伏笔（关键词、出现/回收条件、回收概要） |
| `triggers` | `create`、`update`、`delete` | 偏离触发器（条件、后果、状态影响与期限） |
| `world_book` | `create`、`update`、`set_enabled`、`remove`、`restore_base` | 世界书玩家层、覆盖层与基础恢复 |
| `sources` | `import`、`update`、`remove`、`rollback` | 原文全文、章节进度、防剧透、贴合度与安全恢复 |
| `memories` | `update_entry`、`update_settings`、`rebuild`、`rollback` | 记忆修正、预算设置、自动索引重建与安全恢复 |

各领域继续使用自己的字段级解析器。统一服务只负责版本、领域、动作 ID、命令路由、错误格式和刷新结果，不放宽任何既有校验。

## 4. 成功响应

每次命令返回统一结果和完整轻量快照，页面不得根据旧值自行猜测局部变化。

```json
{
  "schemaVersion": "1.0.0",
  "result": {
    "actionId": "...",
    "domain": "sources",
    "operation": "update",
    "targetId": "...",
    "reused": false
  },
  "content": {
    "adventure": {},
    "sourceDocuments": [],
    "memory": {}
  }
}
```

查询接口还可返回 `audit.state` 和 `audit.assets`。`state` 汇总剧情回合及人物、地点、任务、世界书和补偿式状态变化；`assets` 保存原文与记忆的内容动作摘要、同对象修订序号、修改前后快照、撤销状态和阻止原因。原文快照只记录文件名、长度和设置，不复制正文；记忆快照保存必要的旧值，以便恢复玩家修正。

撤销命令仍使用相同信封，`domain` 必须与原记录一致：

```json
{
  "schemaVersion": "1.0.0",
  "actionId": "新的 UUID",
  "domain": "sources",
  "command": {
    "operation": "rollback",
    "changeId": "audit.assets 中的记录 ID",
    "reason": "误删了仍需参考的原文"
  }
}
```

## 5. 错误响应

所有统一接口错误都使用同一结构：

```json
{
  "schemaVersion": "1.0.0",
  "error": {
    "code": "invalid_content_command",
    "message": "可直接展示给玩家的首要错误",
    "domain": "memories",
    "issues": ["全部字段问题"]
  }
}
```

常用状态码为：输入或业务拒绝 `400`、剧本或目标不存在 `404`、未预期的本地错误 `500`。出现失败时不得返回伪造的成功快照。

## 6. 事务与审计

- 人物、地点、剧情任务、伏笔、触发器和世界书继续由各自的 `manage*` 方法在 `BEGIN IMMEDIATE` 事务内更新物化状态并写入领域审计表。
- 原文和记忆由 `manageContentAsset()` 在同一事务内完成正文或索引修改、`content_asset_management_changes` 动作写入和会话修改时间更新。
- 任何解析、唯一性、目标引用或数据库写入错误都会回滚整个动作。
- 原文与记忆动作关联当前分支头回合。最新 AI 回合后出现任一内容管理动作时，系统会阻止直接重生成，避免覆盖玩家确认过的修改。
- 自动撤销只允许当前活动分支、仍处于原参考回合、同一对象的最新修订，且记录含完整恢复快照。剧情已经继续、对象有更新修订、动作已经撤销或来自旧版只读记录时必须拒绝。
- 原文删除使用软删除标记；撤销删除恢复原设置和检索资格。原文导入本身也可在安全窗口内撤销。
- `rebuild` 不能自动撤销；撤销动作本身只进入审计，不提供“撤销撤销”。
- 完整存档 `1.8.0` 保存恢复快照、软删除标记，并新增伏笔、偏离触发器与属性判定的管理审计表；`1.7.0` 内容动作按无恢复快照的只读历史导入，更早缺失该表的存档按空历史导入。

## 7. 数据边界

统一内容服务是浏览器与本地 SQLite 之间的接口，不是发给模型供应商的文件格式。模型只能收到上下文构建器按预算选出的角色、地点、任务、世界书、记忆和原文片段，不能收到内容命令、动作审计、完整原文目录或 API Key。

新增剧本内容编辑能力时必须同步修改：服务领域与解析器、工作台栏目、事务/审计实现、完整存档、[`FILE_LIFECYCLE.md`](FILE_LIFECYCLE.md)、[`STORAGE.md`](STORAGE.md) 和用户操作手册。
