import { Routes } from "@angular/router";

// Chaque page est chargée à la demande : une fonctionnalité de plus = une route de plus, sans alourdir le bundle initial.
export const routes: Routes = [
	{ path: "", loadComponent: () => import("./features/home/home").then((m) => m.HomeComponent) },
	{ path: "s/:id", loadComponent: () => import("./features/session/session").then((m) => m.SessionComponent) },
	{ path: "**", redirectTo: "" },
];
