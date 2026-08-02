# 安全与隐私

## 报告安全问题

请不要在公开 Issue 中粘贴 API Key、完整存档、数据库、日志或含有私人剧情的截图。GitHub 仓库建立后，优先使用仓库的 Private vulnerability reporting；若该功能尚未启用，请通过维护者 GitHub 主页提供的私密联系方式报告，只提供复现所需的最小信息。

## 密钥泄露时的处理

如果真实 API Key 曾进入提交、Issue、Pull Request、Actions 日志或发布附件：

1. 立即前往对应模型供应商撤销并重新生成密钥；
2. 不要只删除最新文件——普通删除仍会把密钥留在 Git 历史中；
3. 清理历史后再次运行 `npm run public:check:history`；
4. 检查 GitHub 缓存、Fork、Release 和 Actions 日志是否仍保留副本。

## 本项目的数据边界

- 开发配置保存在被忽略的 `.env.local`；桌面版配置保存在软件同级 `用户数据/配置/模型.env`。
- SQLite、备份、完整存档、日志、测试资料和桌面构建产物不属于公开源码。
- API Key 不写入浏览器状态、剧本或完整存档，但会作为鉴权信息发送到玩家明确配置的模型接口。
- 生成剧情时，实际选入上下文的角色、世界书、剧情和原文片段会发送给当前模型供应商；完整数据库不会整体上传。

公开发布前请运行：

```bash
npm run public:check
npm run public:check:history
```
