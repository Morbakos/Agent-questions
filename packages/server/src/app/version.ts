/**
 * Replaced at build time by `scripts/build-server.ts` (Bun.build `define`) with the root `package.json` version, so the
 * bundle holds that one string instead of the whole file. Not defined when running from sources (dev, tests).
 */
declare const __APP_VERSION__: string | undefined;

/** Version announced to MCP clients (`serverInfo.version`). `0.0.0-dev` outside a build. */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
