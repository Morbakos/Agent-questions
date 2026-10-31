import type { ActivatedRouteSnapshot, Route } from "@angular/router";
import { ParamsReuseStrategy } from "./params-reuse-strategy";

const snapshot = (routeConfig: Route | null, params: Record<string, string> = {}) =>
	({ routeConfig, params }) as unknown as ActivatedRouteSnapshot;

describe("ParamsReuseStrategy", () => {
	const strategy = new ParamsReuseStrategy();
	const session: Route = { path: "s/:id" };

	it("réutilise la route quand rien ne change", () => {
		expect(strategy.shouldReuseRoute(snapshot(session, { id: "a" }), snapshot(session, { id: "a" }))).toBe(true);
	});

	it("recrée la page quand seul l'identifiant change (d'une session à une autre)", () => {
		expect(strategy.shouldReuseRoute(snapshot(session, { id: "b" }), snapshot(session, { id: "a" }))).toBe(false);
	});

	it("ne réutilise pas une route différente", () => {
		expect(strategy.shouldReuseRoute(snapshot({ path: "" }), snapshot(session, { id: "a" }))).toBe(false);
	});
});
