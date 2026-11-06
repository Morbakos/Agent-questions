import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@agent-questions/shared";
import { AccountsApi } from "../../core/accounts-api";
import { AuthService } from "../../core/auth";
import { errorMessage } from "../../core/errors";
import { passwordsMatch } from "../../core/validators";

/** Page opened from the invitation link: the invitee chooses a password and ends up signed in. */
@Component({
	selector: "app-invite",
	imports: [ReactiveFormsModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main class="page narrow">
			<h1>Bienvenue</h1>
			@if (username(); as name) {
				<p>
					Votre compte <strong>{{ name }}</strong> est prêt. Choisissez votre mot de passe ({{ minLength }}
					caractères minimum).
				</p>
				<form
					class="stack"
					[formGroup]="form"
					(ngSubmit)="submit()">
					<label class="stack tight">
						Mot de passe
						<input
							class="field"
							type="password"
							formControlName="password"
							autocomplete="new-password" />
					</label>
					<label class="stack tight">
						Confirmation
						<input
							class="field"
							type="password"
							formControlName="confirm"
							autocomplete="new-password" />
					</label>
					@if (form.errors?.["mismatch"] && form.controls.confirm.dirty) {
						<p
							class="error"
							role="alert">
							Les deux mots de passe sont différents.
						</p>
					}
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
						Créer mon accès
					</button>
				</form>
			} @else if (invalid()) {
				<p
					class="error"
					role="alert">
					Cette invitation est invalide ou a expiré. Demandez un nouveau lien à un administrateur.
				</p>
			}
		</main>
	`,
})
export class InviteComponent implements OnInit {
	private readonly api = inject(AccountsApi);
	private readonly auth = inject(AuthService);
	private readonly router = inject(Router);
	private readonly token = inject(ActivatedRoute).snapshot.paramMap.get("token") ?? "";
	protected readonly minLength = PASSWORD_MIN_LENGTH;
	protected readonly form = inject(NonNullableFormBuilder).group(
		{
			password: [
				"",
				[
					Validators.required,
					Validators.minLength(PASSWORD_MIN_LENGTH),
					Validators.maxLength(PASSWORD_MAX_LENGTH),
				],
			],
			confirm: ["", Validators.required],
		},
		{ validators: passwordsMatch },
	);
	protected readonly username = signal<string | null>(null);
	protected readonly invalid = signal(false);
	protected readonly error = signal<string | null>(null);
	protected readonly busy = signal(false);

	async ngOnInit(): Promise<void> {
		try {
			this.username.set((await this.api.invitation(this.token)).username);
		} catch {
			this.invalid.set(true);
		}
	}

	protected async submit(): Promise<void> {
		if (this.form.invalid || this.busy()) {
			return;
		}
		this.busy.set(true);
		this.error.set(null);
		try {
			await this.auth.acceptInvitation(this.token, this.form.getRawValue().password);
			await this.router.navigateByUrl("/");
		} catch (error) {
			this.error.set(errorMessage(error, "Impossible d'activer le compte."));
		} finally {
			this.busy.set(false);
		}
	}
}
