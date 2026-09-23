import path from "node:path";
import { pathToFileURL } from "node:url";

// Windows termination bypasses Node's exit hooks. Ask the utility process to
// exit itself so SQLite's synchronous shutdown backup runs before it closes.
process.parentPort?.on("message", ({ data }) => {
  if (data === "ai-tavern:shutdown") process.exit(0);
});
await import(pathToFileURL(path.join(process.cwd(), "server.js")).href);
