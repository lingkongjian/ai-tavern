if (process.platform !== "darwin") throw new Error("请在 macOS 上验证，Windows 请运行 npm run desktop:verify:win。");
await import("./desktop-verify.mjs");
