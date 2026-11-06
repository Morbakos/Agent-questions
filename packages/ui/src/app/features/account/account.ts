import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import {
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
	type ApiTokenSummary,
	type CreatedApiToken,
} from "@agent-questions/shared";
import { AccountsApi } from "../../core/accounts-api";
import { AuthService } from "../../core/auth";
import { errorMessage } from "../../core/errors";
import { passwordsMatch } from "../../core/validators";

/** Account of the signed-in user: password, and personal tokens to connect an MCP client. */
@Component({
	selector: "app-account",
	imports: [ReactiveFormsModule, DatePipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main class="page narrow stack">
			<h1>Mon compte</h1>
			<p class="muted">
				Connecté en tant que <strong>{{ auth.me()?.username }}</strong> ({{
					auth.isAdmin() ? "administrateur" : "collaborateur"
				}}).
			</p>

			<section
				class="stack"
				aria-labelledby="pwd-title">
				<h2 id="pwd-title">Mot de passe</h2>
				<form
					class="stack"
					[formGroup]="passwordForm"
					(ngSubmit)="changePassword()">
					<label class="stack tight">
						Mot de passe actuel
						<input
							class="field"
							type="password"
							formControlName="current"
							autocomplete="current-password" />
					</label>
					<label class="stack tight">
						Nouveau mot de passe ({{ minLength }} caractères minimum)
						<input
							class="field"
							type="password"
							formControlName="next"
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
					@if (passwordMessage(); as message) {
						<p
							[class.error]="passwordFailed()"
							[class.muted]="!passwordFailed()"
							role="status">
							{{ message }}
						</p>
					}
					<button
						type="submit"
						class="btn primary"
						[disabled]="passwordForm.invalid || busy()">
						Changer le mot de passe
					</button>
				</form>
				<p class="muted small">Vos autres sessions ouvertes seront fermées.</p>
			</section>

			<section
				class="stack"
				aria-labelledby="tok-title">
				<h2 id="tok-title">Jetons personnels</h2>
				<p class="muted">
					Un jeton permet à un client MCP (Claude Code, Codex…) d'agir en votre nom. Il n'est affiché qu'une
					seule fois : copiez-le tout de suite.
				</p>
				<form
					class="row"
					[formGroup]="tokenForm"
					(ngSubmit)="createToken()">
					<label class="stack tight grow">
						Nom du jeton
						<input
							class="field"
							type="text"
							formControlName="name"
							placeholder="Claude Code sur mon portable" />
					</label>
					<button
						type="submit"
						class="btn primary"
						[disabled]="tokenForm.invalid || busy()">
						Créer un jeton
					</button>
				</form>
				@if (created(); as token) {
					<div
						class="panel stack tight"
						role="status">
						<p>Jeton « {{ token.name }} » créé. Il ne sera plus jamais affiché :</p>
						<code class="secret">{{ token.token }}</code>
						<p class="muted small">Brancher Claude Code :</p>
						<code class="secret">{{ command(token.token) }}</code>
					</div>
				}
				@if (tokenError(); as message) {
					<p
						class="error"
						role="alert">
						{{ message }}
					</p>
				}
				@if (tokens().length === 0) {
					<p class="muted">Aucun jeton.</p>
				} @else {
					<ul class="plain-list">
						@for (token of tokens(); track token.id) {
							<li class="row between">
								<span>
									{{ token.name }}
									<span class="muted small"
										>— créé le {{ token.createdAt | date: "dd/MM/yyyy" }}</span
									>
								</span>
								<button
									type="button"
									class="btn danger"
									[attr.aria-label]="'Révoquer le jeton ' + token.name"
									(click)="revoke(token)">
									Révoquer
								</button>
							</li>
						}
					</ul>
				}
			</section>
		</main>
	`,
})
export class AccountComponent implements OnInit {
	private readonly api = inject(AccountsApi);
	protected readonly auth = inject(AuthService);
	private readonly fb = inject(NonNullableFormBuilder);
	protected readonly minLength = PASSWORD_MIN_LENGTH;
	protected readonly passwordForm = this.fb.group(
		{
			current: ["", Validators.required],
			next: [
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
	protected readonly tokenForm = this.fb.group({ name: ["", [Validators.required, Validators.maxLength(60)]] });
	protected readonly tokens = signal<ApiTokenSummary[]>([]);
	protected readonly created = signal<CreatedApiToken | null>(null);
	protected readonly passwordMessage = signal<string | null>(null);
	protected readonly passwordFailed = signal(false);
	protected readonly tokenError = signal<string | null>(null);
	protected readonly busy = signal(false);

	async ngOnInit(): Promise<void> {
		await this.refresh();
	}

	private async refresh(): Promise<void> {
		try {
			this.tokens.set(await this.api.tokens());
		} catch (error) {
			this.tokenError.set(errorMessage(error));
		}
	}

	/** Ready-to-paste command; the token is never stored in the browser. */
	protected command(token: string): string {
		return `claude mcp add --transport http agent-questions ${location.origin}/mcp --header "Authorization: Bearer ${token}"`;
	}

	protected async changePassword(): Promise<void> {
		if (this.passwordForm.invalid || this.busy()) {
			return;
		}
		this.busy.set(true);
		this.passwordMessage.set(null);
		try {
			const { current, next } = this.passwordForm.getRawValue();
			await this.api.changePassword(current, next);
			this.passwordForm.reset();
			this.passwordFailed.set(false);
			this.passwordMessage.set("Mot de passe modifié.");
		} catch (error) {
			this.passwordFailed.set(true);
			this.passwordMessage.set(errorMessage(error, "Modification impossible."));
		} finally {
			this.busy.set(false);
		}
	}

	protected async createToken(): Promise<void> {
		if (this.tokenForm.invalid || this.busy()) {
			return;
		}
		this.busy.set(true);
		this.tokenError.set(null);
		try {
			this.created.set(await this.api.createToken(this.tokenForm.getRawValue().name));
			this.tokenForm.reset();
			await this.refresh();
		} catch (error) {
			this.tokenError.set(errorMessage(error, "Création impossible."));
		} finally {
			this.busy.set(false);
		}
	}

	protected async revoke(token: ApiTokenSummary): Promise<void> {
		this.tokenError.set(null);
		try {
			await this.api.revokeToken(token.id);
			if (this.created()?.id === token.id) {
				this.created.set(null);
			}
			await this.refresh();
		} catch (error) {
			this.tokenError.set(errorMessage(error, "Révocation impossible."));
		}
	}
}
