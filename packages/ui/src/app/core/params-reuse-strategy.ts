import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from "@angular/router";

/**
 * Recreates the component when only the route parameters change. Without this, going from one session to another
 * (`/s/a` to `/s/b`) would reuse the first one's page, which reads its id only once.
 */
export class ParamsReuseStrategy extends BaseRouteReuseStrategy {
	override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
		return super.shouldReuseRoute(future, curr) && JSON.stringify(future.params) === JSON.stringify(curr.params);
	}
}
