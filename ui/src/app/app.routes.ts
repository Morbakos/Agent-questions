import { Routes } from "@angular/router";
import { HomeComponent } from "./home";
import { SessionComponent } from "./session";

export const routes: Routes = [
	{ path: "", component: HomeComponent },
	{ path: "s/:id", component: SessionComponent },
	{ path: "**", redirectTo: "" },
];
