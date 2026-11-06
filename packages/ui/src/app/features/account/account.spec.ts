import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { ApiTokenSummary } from "@agent-questions/shared";
import { AccountsApi } from "../../core/accounts-api";
import { AuthService } from "../../core/auth";
import { button, typeInto } from "../../../testing/dom";
import { AccountComponent } from "./account";

describe("AccountComponent", () => {
	const existing: ApiTokenSummary = { id: "t1", name: "Portable", createdAt: 1_700_000_000_000 };
	const api = {
		tokens: vi.fn(),
		createToken: vi.fn(),
		revokeToken: vi.fn(),
		changePassword: vi.fn(),
	};
	const auth = { me: signal({ username: "alice" }), isAdmin: signal(false) };

	beforeEach(() => {
		for (const fn of Object.values(api)) {
			fn.mockReset();
		}
		api.tokens.mockResolvedValue([existing]);
		TestBed.configureTestingModule({
			providers: [
				{ provide: AccountsApi, useValue: api },
				{ provide: AuthService, useValue: auth },
			],
		});
	});

	async function render() {
		const fixture = TestBed.createComponent(AccountComponent);
		await fixture.whenStable();
		fixture.detectChanges();
		return { fixture, el: fixture.nativeElement as HTMLElement };
	}

	it("shows the user and their tokens", async () => {
		const { el } = await render();
		expect(el.textContent).toContain("alice");
		expect(el.textContent).toContain("Portable");
	});

	it("changes the password when the current one is given and the confirmation matches", async () => {
		api.changePassword.mockResolvedValue(undefined);
		const { fixture, el } = await render();
		expect(button(el, "Changer le mot de passe").disabled).toBe(true);
		typeInto(el, 'input[formControlName="current"]', "ancien-mot-de-passe");
		typeInto(el, 'input[formControlName="next"]', "nouveau-mot-de-passe");
		typeInto(el, 'input[formControlName="confirm"]', "nouveau-mot-de-passe");
		fixture.detectChanges();
		button(el, "Changer le mot de passe").click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(api.changePassword).toHaveBeenCalledWith("ancien-mot-de-passe", "nouveau-mot-de-passe");
		expect(el.textContent).toContain("Mot de passe modifié");
	});

	it("creates a token and shows it only once, with the connection command", async () => {
		api.createToken.mockResolvedValue({ id: "t2", name: "Codex", createdAt: 1, token: "aq_secret-value" });
		const { fixture, el } = await render();
		typeInto(el, 'input[formControlName="name"]', "Codex");
		fixture.detectChanges();
		button(el, "Créer un jeton").click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(api.createToken).toHaveBeenCalledWith("Codex");
		const secrets = Array.from(el.querySelectorAll(".secret")).map((node) => node.textContent);
		expect(secrets[0]).toBe("aq_secret-value");
		expect(secrets[1]).toContain("claude mcp add --transport http agent-questions");
		expect(secrets[1]).toContain("Authorization: Bearer aq_secret-value");
	});

	it("revokes a token then reloads the list", async () => {
		api.revokeToken.mockResolvedValue(undefined);
		const { fixture, el } = await render();
		api.tokens.mockResolvedValue([]);
		el.querySelector<HTMLButtonElement>('button[aria-label="Révoquer le jeton Portable"]')?.click();
		await fixture.whenStable();
		fixture.detectChanges();
		expect(api.revokeToken).toHaveBeenCalledWith("t1");
		expect(el.textContent).toContain("Aucun jeton");
	});
});
