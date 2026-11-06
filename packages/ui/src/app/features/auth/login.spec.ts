import { HttpErrorResponse } from "@angular/common/http";
import { TestBed } from "@angular/core/testing";
import { Router, provideRouter } from "@angular/router";
import { AuthService } from "../../core/auth";
import { button, typeInto } from "../../../testing/dom";
import { LoginComponent } from "./login";

describe("LoginComponent", () => {
	const auth = { login: vi.fn() };
	let navigate: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		auth.login.mockReset();
		TestBed.configureTestingModule({
			providers: [provideRouter([]), { provide: AuthService, useValue: auth }],
		});
		navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
	});

	async function render() {
		const fixture = TestBed.createComponent(LoginComponent);
		await fixture.whenStable();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it.each([
		["/s/abc", "/s/abc"],
		["//autre.example", "/"],
		["https://autre.example", "/"],
		[undefined, "/"],
	])(
		"après connexion, revient à la page demandée (%s) sans suivre une URL extérieure",
		async (returnUrl, expected) => {
			const router = TestBed.inject(Router);
			vi.spyOn(router, "url", "get").mockReturnValue(
				returnUrl === undefined ? "/login" : `/login?returnUrl=${encodeURIComponent(returnUrl)}`,
			);
			auth.login.mockResolvedValue(undefined);
			const { fixture, el } = await render();
			typeInto(el, 'input[formControlName="username"]', "alice");
			typeInto(el, 'input[formControlName="password"]', "mot-de-passe-long");
			fixture.detectChanges();
			button(el, "Se connecter").click();
			await fixture.whenStable();
			expect(navigate).toHaveBeenCalledWith(expected);
		},
	);

	it("does not allow submitting an empty form", async () => {
		const { el } = await render();
		expect(button(el, "Se connecter").disabled).toBe(true);
	});

	it("signs in then opens the home page", async () => {
		auth.login.mockResolvedValue(undefined);
		const { fixture, el } = await render();
		typeInto(el, 'input[formControlName="username"]', "alice");
		typeInto(el, 'input[formControlName="password"]', "mot-de-passe-long");
		fixture.detectChanges();
		button(el, "Se connecter").click();
		await fixture.whenStable();
		expect(auth.login).toHaveBeenCalledWith("alice", "mot-de-passe-long");
		expect(navigate).toHaveBeenCalledWith("/");
	});

	it("shows the server error and stays on the page", async () => {
		auth.login.mockRejectedValue(
			new HttpErrorResponse({ status: 401, error: { error: "Identifiant ou mot de passe incorrect" } }),
		);
		const { fixture, el } = await render();
		typeInto(el, 'input[formControlName="username"]', "alice");
		typeInto(el, 'input[formControlName="password"]', "faux");
		fixture.detectChanges();
		button(el, "Se connecter").click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(el.querySelector('[role="alert"]')?.textContent).toContain("Identifiant ou mot de passe incorrect");
		expect(navigate).not.toHaveBeenCalled();
	});
});
