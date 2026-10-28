import { spawn } from "node:child_process";

/** Ouvre l'URL dans le navigateur par défaut. Échoue silencieusement (serveur sans écran, SSH…). */
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
			/* navigateur introuvable : l'adresse reste donnée à l'agent */
		});
		child.unref();
	} catch {
		/* ignoré : l'URL est aussi renvoyée à l'agent */
	}
}
