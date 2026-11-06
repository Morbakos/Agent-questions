import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { AdminSessionView, Answer, Question } from "@agent-questions/shared";
import { ApiService } from "../../core/api";
import { errorMessage } from "../../core/errors";
import { MarkdownPipe } from "../../shared/markdown.pipe";

/** A user's session as seen by an admin: questions and answers, with no way to act. */
@Component({
	selector: "app-admin-session-detail",
	imports: [MarkdownPipe, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<main class="page stack">
			<a routerLink="/admin/sessions">← Toutes les sessions</a>
			@if (error(); as message) {
				<p
					class="error"
					role="alert">
					{{ message }}
				</p>
			}
			@if (session(); as s) {
				<h1>{{ s.title }}</h1>
				<p
					class="panel"
					role="note">
					Lecture seule. Session de <strong>{{ s.ownerUsername }}</strong
					>{{ stateText(s) }}
				</p>
				@for (question of s.questions; track question.id) {
					<section class="stack panel">
						<h2>{{ question.header || question.id }}</h2>
						<div
							class="md"
							[innerHTML]="question.prompt | markdown"></div>
						@if (answerOf(s, question); as answer) {
							@if (chosen(question, answer).length) {
								<ul>
									@for (option of chosen(question, answer); track option.id) {
										<li>
											{{ option.label }}
											@if (option.note) {
												<blockquote>{{ option.note }}</blockquote>
											}
										</li>
									}
								</ul>
							}
							@if (answer.text) {
								<blockquote>{{ answer.text }}</blockquote>
							}
						} @else {
							<p class="muted">Pas de réponse.</p>
						}
					</section>
				}
			}
		</main>
	`,
})
export class AdminSessionDetailComponent implements OnInit {
	private readonly api = inject(ApiService);
	private readonly route = inject(ActivatedRoute);
	protected readonly session = signal<AdminSessionView | null>(null);
	protected readonly error = signal<string | null>(null);

	async ngOnInit(): Promise<void> {
		try {
			this.session.set(await this.api.adminSession(this.route.snapshot.paramMap.get("id") ?? ""));
		} catch (error) {
			this.error.set(errorMessage(error, "Session introuvable."));
		}
	}

	protected stateText(session: AdminSessionView): string {
		if (session.status === "declined") {
			return session.declineReason ? ` : refusée (« ${session.declineReason} »).` : " : refusée.";
		}
		return session.status === "answered" ? " : répondue." : " : en attente de réponse.";
	}

	/** Answer given, or failing that the draft the owner is currently typing. */
	protected answerOf(session: AdminSessionView, question: Question): Answer | undefined {
		return (session.answers ?? session.draft)[question.id];
	}

	protected chosen(question: Question, answer: Answer): { id: string; label: string; note: string }[] {
		return answer.selected.map((id) => ({
			id,
			label: question.options?.find((option) => option.id === id)?.label ?? id,
			note: answer.notes?.[id] ?? "",
		}));
	}
}
