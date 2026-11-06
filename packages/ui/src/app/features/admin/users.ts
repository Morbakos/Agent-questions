import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import type { Role, UserInvitation, UserSummary } from "@agent-questions/shared";
import { AccountsApi } from "../../core/accounts-api";
import { AuthService } from "../../core/auth";
import { errorMessage } from "../../core/errors";

/** Account administration: create, invite, disable, change role. Finer permissions come later. */
@Component({
	selector: "app-users",
	imports: [ReactiveFormsModule, DatePipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main class="page stack">
			<h1>Utilisateurs</h1>

			<section
				class="stack"
				aria-labelledby="new-title">
				<h2 id="new-title">Inviter une personne</h2>
				<form
					class="row"
					[formGroup]="form"
					(ngSubmit)="create()">
					<label class="stack tight grow">
						Identifiant
						<input
							class="field"
							type="text"
							formControlName="username"
							autocomplete="off"
							autocapitalize="none"
							spellcheck="false"
							aria-describedby="username-rules" />
						<span
							id="username-rules"
							class="muted small">
							3 à 40 caractères : lettres, chiffres, point, tiret, tiret bas.
						</span>
					</label>
					<label class="stack tight">
						Rôle
						<select
							class="field"
							formControlName="role">
							<option value="member">Collaborateur</option>
							<option value="admin">Administrateur</option>
						</select>
					</label>
					<button
						type="submit"
						class="btn primary"
						[disabled]="form.invalid || busy()">
						Créer et inviter
					</button>
				</form>
				@if (invitation(); as invite) {
					<div
						class="panel stack tight"
						role="status">
						<p>
							Lien d'invitation pour <strong>{{ invite.user.username }}</strong> (valable jusqu'au
							{{ invite.expiresAt | date: "dd/MM/yyyy à HH:mm" }}). Transmettez-le-lui : il ne sera plus
							affiché.
						</p>
						<code class="secret">{{ invite.inviteUrl }}</code>
					</div>
				}
				@if (error(); as message) {
					<p
						class="error"
						role="alert">
						{{ message }}
					</p>
				}
			</section>

			<section
				class="stack"
				aria-labelledby="list-title">
				<h2 id="list-title">Comptes</h2>
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th scope="col">Identifiant</th>
								<th scope="col">Rôle</th>
								<th scope="col">État</th>
								<th scope="col">Créé le</th>
								<th scope="col"><span class="visually-hidden">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							@for (user of users(); track user.id) {
								<tr>
									<th scope="row">{{ user.username }}</th>
									<td>{{ user.role === "admin" ? "Administrateur" : "Collaborateur" }}</td>
									<td>{{ status(user) }}</td>
									<td>{{ user.createdAt | date: "dd/MM/yyyy" }}</td>
									<td>
										<div class="row actions">
											<button
												type="button"
												class="btn"
												[attr.aria-label]="'Nouveau lien pour ' + user.username"
												(click)="reinvite(user)">
												Nouveau lien
											</button>
											<button
												type="button"
												class="btn"
												[attr.aria-label]="
													(user.role === 'admin' ? 'Rétrograder ' : 'Promouvoir ') +
													user.username
												"
												[disabled]="user.id === auth.me()?.userId"
												(click)="setRole(user, user.role === 'admin' ? 'member' : 'admin')">
												{{ user.role === "admin" ? "Rétrograder" : "Promouvoir" }}
											</button>
											<button
												type="button"
												class="btn"
												[class.danger]="!user.disabled"
												[attr.aria-label]="
													(user.disabled ? 'Réactiver ' : 'Désactiver ') + user.username
												"
												[disabled]="user.id === auth.me()?.userId && !user.disabled"
												(click)="user.disabled ? setDisabled(user, false) : askDisable(user)">
												{{ user.disabled ? "Réactiver" : "Désactiver" }}
											</button>
										</div>
										@if (confirming() === user.id) {
											<div
												class="panel stack tight"
												role="group"
												[attr.aria-label]="'Confirmer la désactivation de ' + user.username">
												<label class="row">
													<input
														type="checkbox"
														[checked]="revokeTokens()"
														(change)="revokeTokens.set(isChecked($event))" />
													Supprimer aussi ses jetons d'API
												</label>
												<p class="muted small">
													Sans cette case, ses jetons sont refusés tant que le compte est
													désactivé, mais fonctionnent de nouveau à sa réactivation.
												</p>
												<div class="row">
													<button
														type="button"
														class="btn danger"
														[disabled]="busy()"
														(click)="confirmDisable(user)">
														Confirmer
													</button>
													<button
														type="button"
														class="btn"
														(click)="confirming.set(null)">
														Annuler
													</button>
												</div>
											</div>
										}
									</td>
								</tr>
							}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	`,
})
export class UsersComponent implements OnInit {
	private readonly api = inject(AccountsApi);
	protected readonly auth = inject(AuthService);
	protected readonly form = inject(NonNullableFormBuilder).group({
		username: [
			"",
			[
				Validators.required,
				Validators.minLength(3),
				Validators.maxLength(40),
				Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
			],
		],
		role: ["member" as Role],
	});
	protected readonly users = signal<UserSummary[]>([]);
	protected readonly invitation = signal<UserInvitation | null>(null);
	protected readonly error = signal<string | null>(null);
	protected readonly busy = signal(false);
	/** Account whose disabling awaits confirmation, or `null`. */
	protected readonly confirming = signal<string | null>(null);
	/** "Supprimer aussi ses jetons d'API" checkbox of the current confirmation. */
	protected readonly revokeTokens = signal(true);

	async ngOnInit(): Promise<void> {
		await this.refresh();
	}

	protected status(user: UserSummary): string {
		if (user.disabled) {
			return "Désactivé";
		}
		return user.pending ? "Invitation en attente" : "Actif";
	}

	private async refresh(): Promise<void> {
		try {
			this.users.set(await this.api.users());
		} catch (error) {
			this.error.set(errorMessage(error));
		}
	}

	/** Runs an admin action, then reloads the list; any error is displayed. */
	private async act(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
		this.busy.set(true);
		this.error.set(null);
		try {
			await action();
			await this.refresh();
			return true;
		} catch (error) {
			this.error.set(errorMessage(error, fallback));
			return false;
		} finally {
			this.busy.set(false);
		}
	}

	protected async create(): Promise<void> {
		if (this.form.invalid) {
			return;
		}
		const { username, role } = this.form.getRawValue();
		this.invitation.set(null);
		const done = await this.act(
			async () => this.invitation.set(await this.api.createUser(username, role)),
			"Création impossible.",
		);
		if (done) {
			this.form.reset({ username: "", role: "member" });
		}
	}

	protected async reinvite(user: UserSummary): Promise<void> {
		this.invitation.set(null);
		await this.act(async () => this.invitation.set(await this.api.reinvite(user.id)), "Invitation impossible.");
	}

	protected async setRole(user: UserSummary, role: Role): Promise<void> {
		await this.act(() => this.api.updateUser(user.id, { role }), "Changement de rôle impossible.");
	}

	protected async setDisabled(user: UserSummary, disabled: boolean): Promise<void> {
		await this.act(() => this.api.updateUser(user.id, { disabled }), "Modification impossible.");
	}

	/** Opens the disabling confirmation for this account (token deletion is checked by default). */
	protected askDisable(user: UserSummary): void {
		this.revokeTokens.set(true);
		this.confirming.set(user.id);
	}

	protected async confirmDisable({ id }: UserSummary): Promise<void> {
		const done = await this.act(
			() => this.api.updateUser(id, { disabled: true, revokeTokens: this.revokeTokens() }),
			"Modification impossible.",
		);
		if (done) {
			this.confirming.set(null);
		}
	}

	protected isChecked(event: Event): boolean {
		return (event.target as HTMLInputElement).checked;
	}
}
