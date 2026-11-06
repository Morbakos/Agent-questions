import type { ActivatedRouteSnapshot, Route } from "@angular/router";
import { ParamsReuseStrategy } from "./params-reuse-strategy";

const snapshot = (routeConfig: Route | null, params: Record<string, string> = {}) =>
	({ routeConfig, params }) as unknown as ActivatedRouteSnapshot;

describe("ParamsReuseStrategy", () => {
	const strategy = new ParamsReuseStrategy();
	const session: Route = { path: "s/:id" };

	it("reuses the route when nothing changes", () => {
		expect(strategy.shouldReuseRoute(snapshot(session, { id: "a" }), snapshot(session, { id: "a" }))).toBe(true);
	});

	it("recreates the page when only the id changes (from one session to another)", () => {
		expect(strategy.shouldReuseRoute(snapshot(session, { id: "b" }), snapshot(session, { id: "a" }))).toBe(false);
	});

	it("does not reuse a different route", () => {
		expect(strategy.shouldReuseRoute(snapshot({ path: "" }), snapshot(session, { id: "a" }))).toBe(false);
	});
});
