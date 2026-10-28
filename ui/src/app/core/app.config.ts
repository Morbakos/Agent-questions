import { registerLocaleData } from "@angular/common";
import { provideHttpClient, withFetch } from "@angular/common/http";
import localeFr from "@angular/common/locales/fr";
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideRouter } from "@angular/router";
import { routes } from "../app.routes";

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideRouter(routes),
		provideHttpClient(withFetch()),
		{ provide: LOCALE_ID, useValue: "fr" },
	],
};
