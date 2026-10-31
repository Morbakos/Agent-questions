import { ActivatedRouteSnapshot, BaseRouteReuseStrategy } from "@angular/router";

/**
 * Recrée le composant quand seuls les paramètres de la route changent. Sans cela, passer d'une session à une autre
 * (`/s/a` vers `/s/b`) réutiliserait la page de la première, qui ne lit son identifiant qu'une fois.
 */
export class ParamsReuseStrategy extends BaseRouteReuseStrategy {
	override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
		return super.shouldReuseRoute(future, curr) && JSON.stringify(future.params) === JSON.stringify(curr.params);
	}
}
