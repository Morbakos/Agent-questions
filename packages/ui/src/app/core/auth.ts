import { HttpClient, type HttpInterceptorFn } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { type CanActivateFn, Router } from "@angular/router";
import { catchError, firstValueFrom, throwError } from "rxjs";
import type { AuthMe } from "@agent-questions/shared";

/** Page to return to after sign-in: a path of the application, never an external URL. */
export function safeReturnUrl(value: unknown): string {
	return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}

/** Routes and calls that must remain reachable without a session (sign-in, invitation). */
const PUBLIC_ROUTES = ["/login", "/invite/"];
const PUBLIC_CALLS = ["/auth/login", "/auth/invitations/", "/auth/me"];

/**
 * Current identity. The browser never handles a token: the session is an `HttpOnly` cookie set by the
 * server. In the local profile there is neither account nor sign-in (`mode: "local"`).
 */
@Injectable({ providedIn: "root" })
export class AuthService {
	private http = inject(HttpClient);
	private router = inject(Router);
	readonly me = signal<AuthMe | null>(null);
	readonly isServer = computed(() => this.me()?.mode === "server");
	readonly isAdmin = computed(() => this.isServer() && this.me()?.role === "admin");

	private loading: Promise<void> | null = null;

	/** Loads the identity; concurrent calls share a single request. */
	load(): Promise<void> {
		this.loading ??= (async () => {
			try {
				this.me.set(await firstValueFrom(this.http.get<AuthMe>("/auth/me")));
			} catch {
				// No session (401) or server unreachable: "unknown" identity. The guards and the following calls
				// decide on the redirect to /login.
				this.me.set(null);
			} finally {
				this.loading = null;
			}
		})();
		return this.loading;
	}

	/** Signs in (the server sets the session cookie) then loads the identity. Rejects with the HTTP error on failure. */
	async login(username: string, password: string): Promise<void> {
		await firstValueFrom(this.http.post("/auth/login", { username, password }));
		await this.load();
	}

	/** The server opens the session at the same time as it stores the password chosen by the invitee. */
	async acceptInvitation(token: string, password: string): Promise<void> {
		await firstValueFrom(this.http.post(`/auth/invitations/${encodeURIComponent(token)}`, { password }));
		await this.load();
	}

	/** Always ends locally (clears the identity, goes to `/login`) even if the server call fails. */
	async logout(): Promise<void> {
		try {
			await firstValueFrom(this.http.post("/auth/logout", {}));
		} catch {
			/* session already expired or server unreachable: we leave the interface anyway */
		}
		this.me.set(null);
		await this.router.navigateByUrl("/login");
	}
}

/**
 * Redirects to sign-in when the session has expired (401). No anti-CSRF header: the server relies on
 * `Sec-Fetch-Site` / `Origin`, which the browser adds itself.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
	const router = inject(Router);
	// A URL relative to the origin, not a "protocol-relative" URL (//host).
	const sameOrigin = request.url.startsWith("/") && !request.url.startsWith("//");
	return next(request).pipe(
		catchError((error: unknown) => {
			const onPublicRoute = PUBLIC_ROUTES.some((route) => router.url.startsWith(route));
			const publicCall = PUBLIC_CALLS.some((call) => request.url.startsWith(call));
			if (sameOrigin && (error as { status?: number }).status === 401 && !onPublicRoute && !publicCall) {
				const returnUrl = router.url;
				void router.navigate(["/login"], returnUrl && returnUrl !== "/" ? { queryParams: { returnUrl } } : {});
			}
			return throwError(() => error);
		}),
	);
};

async function ensureLoaded(auth: AuthService): Promise<void> {
	if (auth.me() === null) {
		await auth.load();
	}
}

/** Pages reserved for the server profile (account, tokens): in the local profile, back to the home page. */
export const serverGuard: CanActivateFn = async () => {
	// `inject` is only valid before the first `await`.
	const auth = inject(AuthService);
	const router = inject(Router);
	await ensureLoaded(auth);
	return auth.isServer() || router.parseUrl("/");
};

/** Pages reserved for admins. */
export const adminGuard: CanActivateFn = async () => {
	const auth = inject(AuthService);
	const router = inject(Router);
	await ensureLoaded(auth);
	return auth.isAdmin() || router.parseUrl("/");
};
