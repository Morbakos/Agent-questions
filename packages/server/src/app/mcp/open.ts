import { spawn } from "node:child_process";

/** Opens the URL in the default browser. Fails silently (headless server, SSH…). */
export function openInBrowser(url: string): void {
	try {
		let cmd: string;
		let args: string[];
		if (process.platform === "darwin") {
			cmd = "open";
			args = [url];
		} else if (process.platform === "win32") {
			cmd = "cmd";
			args = ["/c", "start", "", url];
		} else {
			cmd = "xdg-open";
			args = [url];
		}
		const child = spawn(cmd, args, { stdio: "ignore", detached: true });
		child.on("error", () => {
			/* browser not found: the address is still given to the agent */
		});
		child.unref();
	} catch {
		/* ignored: the URL is also returned to the agent */
	}
}
