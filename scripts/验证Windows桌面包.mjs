if (process.platform !== "win32") throw new Error("请在 Windows 上验证桌面包。");
await import("./desktop-verify.mjs");
