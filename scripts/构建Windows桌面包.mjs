if (process.platform !== "win32") throw new Error("请在 Windows 上构建桌面包。");
await import("./desktop-build.mjs");
