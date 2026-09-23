# 参与贡献

感谢你改进 AI 酒馆。项目仍处于开发预览阶段，提交前请先阅读 [`README.md`](README.md)、[`docs/PROJECT_SCOPE.md`](docs/PROJECT_SCOPE.md) 和 [`docs/FILE_LIFECYCLE.md`](docs/FILE_LIFECYCLE.md)。

## 开发环境

- Node.js `>=22.13.0`
- `npm install`
- 从 `.env.example` 复制本地 `.env.local`，不要提交真实密钥
- 使用 `npm run dev` 启动开发服务

## 提交前检查

```bash
npm run public:check
npm run lint
npm test
```

涉及桌面端时，还应在 Windows 上运行 `npm run desktop:build:win`，在 Apple Silicon Mac 上运行 `npm run desktop:build:mac`。公共构建与验证逻辑须保持两端兼容；Windows 验证包含中文/空格路径、退出备份和后台服务清理。涉及文件格式、数据库或模型输出时，需要同步修改对应 Schema、兼容测试和规范文档。

## 数据与内容要求

- 不得提交真实 API Key、Cookie、访问令牌或供应商账户信息。
- 不得提交个人存档、SQLite、备份、日志、原文全文或未经授权的角色/世界书资料。
- 测试应使用原创、合成且足够短的固定资料。
- 不要让测试访问真实模型接口；模型调用应使用可控的本地替身。
- 修改生成规则时，应保留玩家角色控制权和单回合原子提交边界。

## 文档同步

新功能需要同步更新 GitHub 首页、玩家操作手册及对应技术规范。文件流、导入格式或内部存储发生变化时，按 [`docs/FILE_LIFECYCLE.md`](docs/FILE_LIFECYCLE.md) 的文档责任表检查全部受影响文件。

提交贡献即表示你同意以项目当前的 [MIT License](LICENSE) 发布该贡献。
