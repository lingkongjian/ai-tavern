import path from "node:path";

export function resolvePortableRoot({ platform, packaged, executable, desktopDirectory, override }) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (override) return paths.resolve(override);
  if (!packaged) return paths.resolve(desktopDirectory, "..");
  const executableDirectory = paths.dirname(executable);
  return platform === "darwin"
    ? paths.resolve(executableDirectory, "../../..")
    : executableDirectory;
}
