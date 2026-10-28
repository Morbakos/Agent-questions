import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { QuestionComponent } from "./question";
import { SessionState } from "./session-state";

@Component({
	selector: "app-session",
	imports: [QuestionComponent, RouterLink, DatePipe],
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
