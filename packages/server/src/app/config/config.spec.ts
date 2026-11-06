import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

const server = {
	AQ_DEPLOYMENT_MODE: "server",
	AQ_PUBLIC_URL: "https://questions.example.com",
	AQ_DATA_DIR: "/data",
	AQ_BIND_HOST: "0.0.0.0",
};

describe("local profile", () => {
	it("starts with no variable at all, on loopback and without an IdP", () => {
		const config = loadConfig({});
		expect(config.deploymentMode).toBe("local");
		expect(config.host).toBe("127.0.0.1");
		expect(config.admin).toBeNull();
	});

	it.each(["127.0.0.1", "::1", "localhost"])("accepts the host %s", (host) => {
		expect(loadConfig({ AQ_BIND_HOST: host }).host).toBe(host);
	});

	it.each(["0.0.0.0", "192.168.1.20", "::"])("rejects the host %s outside a container", (host) => {
		expect(() => loadConfig({ AQ_BIND_HOST: host })).toThrow(ConfigError);
		expect(() => loadConfig({ AQ_BIND_HOST: host })).toThrow(/AQ_BIND_HOST/);
	});

	it("allows 0.0.0.0 in a container, but not a LAN address", () => {
		expect(loadConfig({ AQ_BIND_HOST: "0.0.0.0", AQ_IN_CONTAINER: "1" }).host).toBe("0.0.0.0");
		expect(() => loadConfig({ AQ_BIND_HOST: "192.168.1.20", AQ_IN_CONTAINER: "1" })).toThrow(ConfigError);
	});

	it("rejects an unknown mode", () => {
		expect(() => loadConfig({ AQ_DEPLOYMENT_MODE: "prod" })).toThrow(/AQ_DEPLOYMENT_MODE/);
	});

	it("rejects an invalid port", () => {
		expect(() => loadConfig({ AQ_PORT: "99999" })).toThrow(/AQ_PORT/);
	});
});

describe("allowed origins", () => {
	it("rejects any wildcard", () => {
		expect(() => loadConfig({ AQ_ALLOWED_ORIGINS: "*" })).toThrow(/wildcard/);
		expect(() => loadConfig({ AQ_ALLOWED_ORIGINS: "https://*.example.com" })).toThrow(/wildcard/);
	});

	it("requires exact origins", () => {
		expect(() => loadConfig({ AQ_ALLOWED_ORIGINS: "https://a.example.com/chemin" })).toThrow(/must be an origin/);
		expect(
			loadConfig({ AQ_ALLOWED_ORIGINS: "http://localhost:8080, http://127.0.0.1:8080" }).allowedOrigins,
		).toEqual(["http://localhost:8080", "http://127.0.0.1:8080"]);
	});
});

describe("server profile", () => {
	it("starts once configured, with a default admin named admin", () => {
		const config = loadConfig(server);
		expect(config.deploymentMode).toBe("server");
		expect(config.host).toBe("0.0.0.0");
		expect(config.admin).toEqual({ username: "admin", password: null });
	});

	it("reads the initial admin username and password", () => {
		const config = loadConfig({
			...server,
			AQ_ADMIN_USERNAME: "alexis",
			AQ_ADMIN_PASSWORD: "un-long-mot-de-passe",
		});
		expect(config.admin).toEqual({ username: "alexis", password: "un-long-mot-de-passe" });
	});

	it.each(["AQ_PUBLIC_URL", "AQ_DATA_DIR"])("refuses to start without %s, naming the variable", (name) => {
		const env: Record<string, string | undefined> = { ...server, [name]: undefined };
		expect(() => loadConfig(env)).toThrow(new RegExp(name));
	});

	it("requires HTTPS for the public URL, except on loopback", () => {
		expect(() => loadConfig({ ...server, AQ_PUBLIC_URL: "http://questions.example.com" })).toThrow(/HTTPS/);
		expect(loadConfig({ ...server, AQ_PUBLIC_URL: "http://127.0.0.1:4317" }).baseUrl).toBe("http://127.0.0.1:4317");
	});

	it("rejects an invalid admin username", () => {
		expect(() => loadConfig({ ...server, AQ_ADMIN_USERNAME: "a b" })).toThrow(/AQ_ADMIN_USERNAME/);
	});

	it("does not check the admin password length at load time (see AuthService.bootstrapAdmin)", () => {
		expect(loadConfig({ ...server, AQ_ADMIN_PASSWORD: "court" }).admin?.password).toBe("court");
	});

	it("replaces a leading ~ in AQ_DATA_DIR with the home directory", () => {
		expect(loadConfig({ AQ_DATA_DIR: "~/.aq" }).dbFile).toBe(join(homedir(), ".aq", "agent-questions.sqlite"));
		expect(loadConfig({ AQ_DATA_DIR: "/data" }).dbFile).toBe(join("/data", "agent-questions.sqlite"));
		expect(loadConfig({ AQ_DATA_DIR: "~autre" }).dbFile).toBe(join("~autre", "agent-questions.sqlite"));
	});
});

describe("hardening settings", () => {
	it("does not block by default: AQ_WAIT_SECONDS is 0", () => {
		expect(loadConfig({}).defaultWaitSeconds).toBe(0);
	});

	it("validates AQ_WAIT_SECONDS (integer from 0 to 3600)", () => {
		expect(loadConfig({ AQ_WAIT_SECONDS: "30" }).defaultWaitSeconds).toBe(30);
		for (const value of ["abc", "-1", "3601", "1.5"]) {
			expect(() => loadConfig({ AQ_WAIT_SECONDS: value }), value).toThrow(/AQ_WAIT_SECONDS/);
		}
	});

	it("validates AQ_TRUST_PROXY (number of proxies, 0 by default)", () => {
		expect(loadConfig({}).trustProxy).toBe(0);
		expect(loadConfig({ AQ_TRUST_PROXY: "1" }).trustProxy).toBe(1);
		expect(() => loadConfig({ AQ_TRUST_PROXY: "oui" })).toThrow(/AQ_TRUST_PROXY/);
	});

	it("validates AQ_LOG", () => {
		expect(loadConfig({ AQ_LOG: "warn" }).logLevel).toBe("warn");
		expect(() => loadConfig({ AQ_LOG: "bavard" })).toThrow(/AQ_LOG/);
	});

	it("never opens the server browser in the server profile, even with AQ_NO_OPEN=0", () => {
		const env = { ...server, AQ_ADMIN_PASSWORD: "mot-de-passe-solide", AQ_NO_OPEN: "0" };
		expect(loadConfig(env).noOpen).toBe(true);
		expect(loadConfig({ AQ_NO_OPEN: "0" }).noOpen).toBe(false);
	});
});
