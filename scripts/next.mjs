// Set the environment in Node rather than using POSIX-only shell assignments.
process.env.NEXT_TELEMETRY_DISABLED = "1";
await import("next/dist/bin/next");
