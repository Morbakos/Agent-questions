import { registerLocaleData } from "@angular/common";
import { provideHttpClient, withFetch } from "@angular/common/http";
import localeFr from "@angular/common/locales/fr";
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from "@angular/core";
import { RouteReuseStrategy, provideRouter } from "@angular/router";
import { routes } from "../app.routes";
import { ParamsReuseStrategy } from "./params-reuse-strategy";

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideRouter(routes),
		{ provide: RouteReuseStrategy, useClass: ParamsReuseStrategy },
		provideHttpClient(withFetch()),
		{ provide: LOCALE_ID, useValue: "fr" },
	],
};
