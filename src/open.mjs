// Opening the setup page in the default browser, when there is one to open.
import { spawn } from "node:child_process";

/** False over SSH (unless X is forwarded on Linux) and on a Linux box with no display. */
export function canOpenBrowser(env = process.env, platform = process.platform) {
  if (env.CLAUDE_TOOLKIT_NO_BROWSER) return false;
  if (env.SSH_CONNECTION || env.SSH_TTY) return platform === "linux" && !!(env.DISPLAY || env.WAYLAND_DISPLAY);
  if (platform === "win32" || platform === "darwin") return true;
  return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
}

export function openUrl(url, platform = process.platform) {
  // rundll32 hands the URL to the default browser without cmd.exe parsing it.
  const [cmd, args] = platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
