import { DatePipe } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { ApiService } from "./api";
import {
	type Answer,
	type Answers,
	type ApiError,
	type Question,
	type SessionView,
	emptyAnswer,
	isAnswered,
	isRequired,
} from "@agent-questions/shared";
import { QuestionComponent } from "./question";

type ViewState = "loading" | "missing" | "ready" | "answered" | "declined";

@Component({
	selector: "app-session",
	imports: [QuestionComponent, RouterLink, DatePipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@switch (state()) {
			@case ("loading") {
				<p class="page narrow muted">Chargement…</p>
			}
			@case ("missing") {
				<main class="page narrow">
					<h1>Session introuvable</h1>
					<p>Cette session n'existe pas ou a été supprimée. <a routerLink="/">Retour à la liste</a></p>
				</main>
			}
			@case ("answered") {
				<main class="page narrow">
					<h1>Réponses envoyées</h1>
					<p>L'agent a reçu vos réponses. Vous pouvez fermer cet onglet.</p>
				</main>
			}
			@case ("declined") {
				<main class="page narrow">
					<h1>Refus transmis</h1>
					<p>L'agent sait que vous ne souhaitez pas répondre. Vous pouvez fermer cet onglet.</p>
				</main>
			}
			@case ("ready") {
				@if (session(); as s) {
					<div class="layout">
						<nav
							class="outline"
							aria-label="Plan des questions">
							<h2 class="outline-title">Plan</h2>
							<ol>
								@for (q of s.questions; track q.id) {
									<li>
										<button
											type="button"
											class="outline-link"
											[class.done]="done(q)"
											(click)="scrollTo(q.id)">
											{{ q.header || q.id }}
										</button>
									</li>
								}
							</ol>
							<p class="muted small">{{ doneCount() }} sur {{ s.questions.length }} répondues</p>
						</nav>

						<main class="questions">
							<h1>{{ s.title }}</h1>
							@if (updated()) {
								<p
									class="notice"
									role="status">
									L'agent a modifié les questions. Vos réponses ont été conservées quand c'était
									possible.
								</p>
							}
							@for (q of s.questions; track q.id) {
								<app-question
									[question]="q"
									[answer]="answerFor(q)"
									(changed)="onAnswer(q.id, $event)" />
							}

							<div class="actions">
								<div class="actions-row">
									<button
										type="button"
										class="btn primary"
										[disabled]="!canSubmit() || sending()"
										(click)="submit()">
										{{ sending() ? "Envoi…" : "Envoyer à l'agent" }}
									</button>
									@if (missing() > 0) {
										<span class="muted small"
											>{{ missing() }} réponse(s) obligatoire(s) manquante(s)</span
										>
									}
									@if (savedAt(); as t) {
										<span class="muted small">Brouillon enregistré à {{ t | date: "HH:mm" }}</span>
									}
								</div>

								@if (declining()) {
									<div class="decline">
										<label for="reason">Pourquoi ne pas répondre ? (facultatif)</label>
										<textarea
											id="reason"
											class="field"
											rows="2"
											[value]="reason()"
											(input)="onReason($event)"></textarea>
										<div class="actions-row">
											<button
												type="button"
												class="btn danger"
												(click)="decline()">
												Confirmer le refus
											</button>
											<button
												type="button"
												class="btn"
												(click)="declining.set(false)">
												Annuler
											</button>
										</div>
									</div>
								} @else {
									<button
										type="button"
										class="btn quiet"
										(click)="declining.set(true)">
										Ne pas répondre
									</button>
								}

								@if (error(); as e) {
									<p
										class="error"
										role="alert">
										{{ e }}
									</p>
								}
							</div>
						</main>
					</div>
				}
			}
		}
	`,
})
export class SessionComponent implements OnInit {
	private api = inject(ApiService);
	private route = inject(ActivatedRoute);
	private destroyRef = inject(DestroyRef);

	private id = "";
	private saveTimer?: ReturnType<typeof setTimeout>;

	readonly state = signal<ViewState>("loading");
	readonly session = signal<SessionView | null>(null);
	readonly answers = signal<Answers>({});
	readonly savedAt = signal<Date | null>(null);
	readonly sending = signal(false);
	readonly error = signal<string | null>(null);
	readonly declining = signal(false);
	readonly reason = signal("");
	readonly updated = signal(false);

	readonly doneCount = computed(() => {
		const s = this.session();
		return s ? s.questions.filter((q) => this.done(q)).length : 0;
	});
	readonly missing = computed(() => {
		const s = this.session();
		return s ? s.questions.filter((q) => isRequired(q) && !this.done(q)).length : 0;
	});
	readonly canSubmit = computed(() => this.missing() === 0);

	async ngOnInit() {
		this.id = this.route.snapshot.paramMap.get("id") ?? "";
		try {
			const s = await this.api.get(this.id);
			if (s.status === "answered") return this.state.set("answered");
			if (s.status === "declined") return this.state.set("declined");
			this.session.set(s);
			this.answers.set(Object.fromEntries(s.questions.map((q) => [q.id, s.draft[q.id] ?? emptyAnswer()])));
			this.state.set("ready");
		} catch {
			this.state.set("missing");
			return;
		}
		const timer = setInterval(() => void this.refresh(), 5000);
		this.destroyRef.onDestroy(() => clearInterval(timer));
	}

	/** Détecte une modification des questions par l'agent (ou la clôture de la session) et met la vue à jour. */
	private async refresh() {
		const current = this.session();
		if (this.state() !== "ready" || !current || this.sending()) return;
		try {
			const s = await this.api.get(this.id);
			if (s.status === "answered") return this.state.set("answered");
			if (s.status === "declined") return this.state.set("declined");
			if (s.revision === current.revision) return;
			// Les réponses en cours de saisie priment sur le brouillon, mais seulement pour les options qui existent encore.
			const local = this.answers();
			this.answers.set(
				Object.fromEntries(
					s.questions.map((q) => {
						const a = local[q.id] ?? s.draft[q.id] ?? emptyAnswer();
						const known = new Set((q.options ?? []).map((o) => o.id));
						return [q.id, { ...a, selected: a.selected.filter((id) => known.has(id)) }];
					}),
				),
			);
			this.session.set(s);
			this.updated.set(true);
		} catch {
			/* non bloquant : prochaine tentative dans 5 s */
		}
	}

	onReason(event: Event) {
		this.reason.set((event.target as HTMLTextAreaElement).value);
	}

	answerFor(q: Question): Answer {
		return this.answers()[q.id] ?? emptyAnswer();
	}

	done(q: Question): boolean {
		return isAnswered(q, this.answers()[q.id]);
	}

	onAnswer(qid: string, a: Answer) {
		this.answers.update((cur) => ({ ...cur, [qid]: a }));
		clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.saveDraft(), 600);
	}

	private async saveDraft() {
		try {
			await this.api.saveDraft(this.id, this.answers());
			this.savedAt.set(new Date());
		} catch {
			/* non bloquant : l'envoi final reste possible */
		}
	}

	scrollTo(qid: string) {
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		document.getElementById("q-" + qid)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
	}

	async submit() {
		clearTimeout(this.saveTimer);
		this.sending.set(true);
		this.error.set(null);
		try {
			await this.api.submit(this.id, this.answers());
			this.state.set("answered");
		} catch (err) {
			this.error.set(this.message(err, "L'envoi a échoué."));
		} finally {
			this.sending.set(false);
		}
	}

	async decline() {
		clearTimeout(this.saveTimer);
		this.error.set(null);
		try {
			await this.api.decline(this.id, this.reason());
			this.state.set("declined");
		} catch (err) {
			this.error.set(this.message(err, "Le refus n'a pas pu être transmis."));
		}
	}

	private message(err: unknown, fallback: string): string {
		const body = err instanceof HttpErrorResponse ? (err.error as ApiError | null) : null;
		if (body?.details?.length) return `${body.error} : ${body.details.join(" ; ")}`;
		return body?.error ?? fallback;
	}
}
