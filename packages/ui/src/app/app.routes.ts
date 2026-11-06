import { Routes } from "@angular/router";
import { adminGuard, serverGuard } from "./core/auth";

// Each page is loaded on demand: one more feature = one more route, without growing the initial bundle.
export const routes: Routes = [
	{
		path: "",
		title: "Questions de l'agent",
		loadComponent: () => import("./features/home/home").then((m) => m.HomeComponent),
	},
	{
		path: "s/:id",
		title: "Questions",
		loadComponent: () => import("./features/session/session").then((m) => m.SessionComponent),
	},
	{
		path: "login",
		title: "Connexion",
		loadComponent: () => import("./features/auth/login").then((m) => m.LoginComponent),
	},
	{
		path: "invite/:token",
		title: "Invitation",
		loadComponent: () => import("./features/auth/invite").then((m) => m.InviteComponent),
	},
	{
		path: "account",
		title: "Mon compte",
		canActivate: [serverGuard],
		loadComponent: () => import("./features/account/account").then((m) => m.AccountComponent),
	},
	{
		path: "admin/users",
		title: "Utilisateurs",
		canActivate: [adminGuard],
		loadComponent: () => import("./features/admin/users").then((m) => m.UsersComponent),
	},
	{
		path: "admin/sessions",
		title: "Sessions des utilisateurs",
		canActivate: [adminGuard],
		loadComponent: () => import("./features/admin/sessions").then((m) => m.AdminSessionsComponent),
	},
	{
		path: "admin/sessions/:id",
		title: "Session d'un utilisateur",
		canActivate: [adminGuard],
		loadComponent: () => import("./features/admin/session-detail").then((m) => m.AdminSessionDetailComponent),
	},
	{ path: "**", redirectTo: "" },
];
