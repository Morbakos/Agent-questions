import { registerLocaleData } from "@angular/common";
import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import localeFr from "@angular/common/locales/fr";
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from "@angular/core";
import { RouteReuseStrategy, provideRouter } from "@angular/router";
import { routes } from "../app.routes";
import { authInterceptor } from "./auth";
import { ParamsReuseStrategy } from "./params-reuse-strategy";

registerLocaleData(localeFr);

/** Root providers: lazy routes, per-params route reuse, `fetch`-based HTTP with the 401 interceptor, French locale. */
export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideRouter(routes),
		{ provide: RouteReuseStrategy, useClass: ParamsReuseStrategy },
		provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
		{ provide: LOCALE_ID, useValue: "fr" },
	],
};
