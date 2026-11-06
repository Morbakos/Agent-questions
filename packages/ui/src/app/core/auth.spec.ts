import { HttpClient, provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Injector, runInInjectionContext } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import type { AuthMe } from "@agent-questions/shared";
import { AuthService, adminGuard, authInterceptor, serverGuard } from "./auth";

const server = (role: AuthMe["role"]): AuthMe => ({ mode: "server", userId: "u1", username: "alice", role });
const local: AuthMe = { mode: "local", userId: "local", username: "local", role: "admin" };

describe("UI authentication", () => {
	let http: HttpTestingController;
	let router: Router;

	beforeEach(() => {
		TestBed.configureTestingModule({
			providers: [
				provideRouter([]),
				provideHttpClient(withInterceptors([authInterceptor])),
				provideHttpClientTesting(),
			],
		});
		http = TestBed.inject(HttpTestingController);
		router = TestBed.inject(Router);
		vi.spyOn(router, "navigateByUrl").mockResolvedValue(true);
		vi.spyOn(router, "navigate").mockResolvedValue(true);
	});
	afterEach(() => http.verify());

	describe("interceptor", () => {
		it("adds no header to calls: CSRF relies on Sec-Fetch-Site, set by the browser", () => {
			const client = TestBed.inject(HttpClient);
			client.post("/api/sessions/x/decline", {}).subscribe();
			expect(http.expectOne("/api/sessions/x/decline").request.headers.has("x-aq-csrf")).toBe(false);
		});

		it("redirects to /login on a 401, except for the sign-in itself", () => {
			const client = TestBed.inject(HttpClient);
			client.get("/api/sessions").subscribe({ error: () => undefined });
			http.expectOne("/api/sessions").flush({}, { status: 401, statusText: "Unauthorized" });
			expect(router.navigate).toHaveBeenCalledWith(["/login"], {});

			vi.mocked(router.navigate).mockClear();
			client.post("/auth/login", {}).subscribe({ error: () => undefined });
			http.expectOne("/auth/login").flush({}, { status: 401, statusText: "Unauthorized" });
			client.get("/auth/invitations/abc").subscribe({ error: () => undefined });
			http.expectOne("/auth/invitations/abc").flush({}, { status: 401, statusText: "Unauthorized" });
			// /auth/me answers 401 without a session: a normal response at startup, not an expiry.
			client.get("/auth/me").subscribe({ error: () => undefined });
			http.expectOne("/auth/me").flush({}, { status: 401, statusText: "Unauthorized" });
			expect(router.navigate).not.toHaveBeenCalled();
		});

		it("remembers the requested page to return to it after sign-in", () => {
			vi.spyOn(router, "url", "get").mockReturnValue("/s/abc");
			TestBed.inject(HttpClient)
				.get("/api/sessions")
				.subscribe({ error: () => undefined });
			http.expectOne("/api/sessions").flush({}, { status: 401, statusText: "Unauthorized" });
			expect(router.navigate).toHaveBeenCalledWith(["/login"], { queryParams: { returnUrl: "/s/abc" } });
		});

		it("does not redirect to sign-in on a 401 from a protocol-relative URL", () => {
			TestBed.inject(HttpClient)
				.get("//autre.example/api")
				.subscribe({ error: () => undefined });
			http.expectOne("//autre.example/api").flush({}, { status: 401, statusText: "Unauthorized" });
			expect(router.navigate).not.toHaveBeenCalled();
		});

		it("does not redirect to sign-in for another error", () => {
			TestBed.inject(HttpClient)
				.get("/api/sessions")
				.subscribe({ error: () => undefined });
			http.expectOne("/api/sessions").flush({}, { status: 500, statusText: "Server Error" });
			expect(router.navigate).not.toHaveBeenCalled();
		});
	});

	describe("service", () => {
		it("loads the identity, and tells the local profile, member and admin apart", async () => {
			const auth = TestBed.inject(AuthService);
			const load = auth.load();
			http.expectOne("/auth/me").flush(local);
			await load;
			expect(auth.isServer()).toBe(false);
			expect(auth.isAdmin()).toBe(false);

			const member = auth.load();
			http.expectOne("/auth/me").flush(server("member"));
			await member;
			expect(auth.isServer()).toBe(true);
			expect(auth.isAdmin()).toBe(false);

			const admin = auth.load();
			http.expectOne("/auth/me").flush(server("admin"));
			await admin;
			expect(auth.isAdmin()).toBe(true);
		});

		it("signs in then loads the identity", async () => {
			const auth = TestBed.inject(AuthService);
			const done = auth.login("alice", "mot-de-passe-long");
			const request = http.expectOne("/auth/login");
			expect(request.request.body).toEqual({ username: "alice", password: "mot-de-passe-long" });
			request.flush({ ok: true });
			await Promise.resolve();
			http.expectOne("/auth/me").flush(server("member"));
			await done;
			expect(auth.me()?.username).toBe("alice");
		});

		it("opens the session by accepting an invitation", async () => {
			const auth = TestBed.inject(AuthService);
			const done = auth.acceptInvitation("jeton/spécial", "mot-de-passe-long");
			http.expectOne("/auth/invitations/jeton%2Fsp%C3%A9cial").flush({ ok: true });
			await Promise.resolve();
			http.expectOne("/auth/me").flush(server("member"));
			await done;
			expect(auth.isServer()).toBe(true);
		});

		it("signs out, forgets the identity and goes back to sign-in", async () => {
			const auth = TestBed.inject(AuthService);
			auth.me.set(server("member"));
			const done = auth.logout();
			http.expectOne("/auth/logout").flush({ ok: true });
			await done;
			expect(auth.me()).toBeNull();
			expect(router.navigateByUrl).toHaveBeenCalledWith("/login");
		});
	});

	describe("route guards", () => {
		const run = (guard: typeof serverGuard) =>
			runInInjectionContext(TestBed.inject(Injector), () => guard({} as never, {} as never)) as Promise<unknown>;

		it("reserves administration for admins and sends the others to the home page", async () => {
			const auth = TestBed.inject(AuthService);
			auth.me.set(server("admin"));
			expect(await run(adminGuard)).toBe(true);
			auth.me.set(server("member"));
			expect(String(await run(adminGuard))).toBe("/");
			auth.me.set(local);
			expect(String(await run(adminGuard))).toBe("/");
		});

		it("offers the account and tokens only in the server profile, loading the identity if needed", async () => {
			const auth = TestBed.inject(AuthService);
			const pending = run(serverGuard);
			await Promise.resolve();
			http.expectOne("/auth/me").flush(local);
			expect(String(await pending)).toBe("/");
			auth.me.set(server("member"));
			expect(await run(serverGuard)).toBe(true);
		});
	});
});
