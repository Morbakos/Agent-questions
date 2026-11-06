import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { AuthService, safeReturnUrl } from "../../core/auth";
import { errorMessage } from "../../core/errors";

@Component({
	selector: "app-login",
	imports: [ReactiveFormsModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main class="page narrow">
			<h1>Connexion</h1>
			<form
				class="stack"
				[formGroup]="form"
				(ngSubmit)="submit()">
				<label class="stack tight">
					Identifiant
					<input
						class="field"
						type="text"
						formControlName="username"
						autocomplete="username"
						autocapitalize="none"
						spellcheck="false" />
				</label>
				<label class="stack tight">
					Mot de passe
					<input
						class="field"
						type="password"
						formControlName="password"
						autocomplete="current-password" />
				</label>
				@if (error(); as message) {
					<p
						class="error"
						role="alert">
						{{ message }}
					</p>
				}
				<button
					type="submit"
					class="btn primary"
					[disabled]="form.invalid || busy()">
					Se connecter
				</button>
			</form>
		</main>
	`,
})
export class LoginComponent {
	private readonly auth = inject(AuthService);
	private readonly router = inject(Router);
	protected readonly form = inject(NonNullableFormBuilder).group({
		username: ["", Validators.required],
		password: ["", Validators.required],
	});
	protected readonly error = signal<string | null>(null);
	protected readonly busy = signal(false);

	protected async submit(): Promise<void> {
		if (this.form.invalid || this.busy()) {
			return;
		}
		this.busy.set(true);
		this.error.set(null);
		try {
			const { username, password } = this.form.getRawValue();
			await this.auth.login(username, password);
			await this.router.navigateByUrl(
				safeReturnUrl(this.router.parseUrl(this.router.url).queryParams["returnUrl"]),
			);
		} catch (error) {
			this.error.set(errorMessage(error, "Connexion impossible."));
		} finally {
			this.busy.set(false);
		}
	}
}
