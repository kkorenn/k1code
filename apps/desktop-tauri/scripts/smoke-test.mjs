import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");

console.log("\nRunning Tauri desktop smoke check...");

const child = spawn("bunx", ["tauri", "build", "--bundles", "none"], {
  cwd: desktopDir,
  stdio: "inherit",
  env: {
    ...process.env,
    CI: process.env.CI ?? "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
