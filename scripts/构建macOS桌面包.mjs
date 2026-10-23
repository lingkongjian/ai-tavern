if (process.platform !== "darwin") throw new Error("请在 macOS 上构建，Windows 请运行 npm run desktop:build:win。");
await import("./desktop-build.mjs");
