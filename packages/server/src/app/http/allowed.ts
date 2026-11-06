import type { AppConfig } from "@app/config/config.js";

/** Accepted `Host` names (`host:port`): the local machine, `AQ_ALLOWED_HOSTS` and the public URL. */
export function hostsOf({ baseUrl, allowedHosts, port }: AppConfig): Set<string> {
	const hosts = new Set(
		["127.0.0.1", "localhost", ...allowedHosts].map((host) => (host.includes(":") ? host : `${host}:${port}`)),
	);
	// The public URL (in server profile: HTTPS behind a reverse proxy) is always accepted as is.
	hosts.add(new URL(baseUrl).host);
	return hosts;
}

/** Accepted origins (DNS-rebinding guard and CORS): the hosts', the public URL, the dev server and `AQ_ALLOWED_ORIGINS`. */
export function originsOf(config: AppConfig): Set<string> {
	const { baseUrl, dev, allowedOrigins, port, allowedHosts } = config;
	const origins = new Set(
		["127.0.0.1", "localhost", ...allowedHosts].map(
			(host) => `http://${host.includes(":") ? host : `${host}:${port}`}`,
		),
	);
	origins.add(new URL(baseUrl).origin);
	if (dev) {
		origins.add("http://localhost:4200");
		origins.add("http://127.0.0.1:4200");
	}
	for (const origin of allowedOrigins) {
		origins.add(origin);
	}
	return origins;
}
