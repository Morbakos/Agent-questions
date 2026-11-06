import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { Answer, Question } from "@agent-questions/shared";
import { MarkdownPipe } from "../../shared/markdown.pipe";
import { QuestionComponent } from "./question";
import { SessionState } from "./session-state";

/** Page `/s/:id`: the form (or the read-only view of a closed session). All the logic lives in `SessionState`. */
@Component({
	selector: "app-session",
	imports: [QuestionComponent, RouterLink, DatePipe, MarkdownPipe],
	providers: [SessionState],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: "./session.html",
	styleUrl: "./session.scss",
})
export class SessionComponent implements OnInit {
	private readonly route = inject(ActivatedRoute);
	protected readonly s = inject(SessionState);

	protected readonly declining = signal(false);
	protected readonly reason = signal("");

	ngOnInit(): void {
		void this.s.init(this.route.snapshot.paramMap.get("id") ?? "");
	}

	/** Selected options with their note (the id if the option has disappeared since a modification of the questions). */
	protected chosenOptions(q: Question, a: Answer | undefined): { id: string; label: string; note: string }[] {
		return (a?.selected ?? []).map((id) => ({
			id,
			label: q.options?.find((o) => o.id === id)?.label ?? id,
			note: a?.notes?.[id] ?? "",
		}));
	}

	protected onReason(event: Event): void {
		this.reason.set((event.target as HTMLTextAreaElement).value);
	}

	protected scrollTo(questionId: string): void {
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		document
			.getElementById("q-" + questionId)
			?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
	}
}
