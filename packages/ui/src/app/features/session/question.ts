import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import type { Answer, Question } from "@agent-questions/shared";
import { MarkdownPipe } from "../../shared/markdown.pipe";

const textOf = (event: Event): string => (event.target as HTMLTextAreaElement).value;

@Component({
	selector: "app-question",
	imports: [MarkdownPipe],
	changeDetection: ChangeDetectionStrategy.OnPush,
	styleUrl: "./question.scss",
	template: `
		<section
			class="q"
			[id]="'q-' + question().id">
			@if (question().header) {
				<h2 class="q-head">{{ question().header }}</h2>
			}
			<div
				class="md q-prompt"
				[innerHTML]="question().prompt | markdown"></div>

			@if (question().context_markdown) {
				<details
					class="q-context"
					open>
					<summary>Contexte</summary>
					<div
						class="md"
						[innerHTML]="question().context_markdown | markdown"></div>
				</details>
			}

			@if (question().type === "text") {
				<textarea
					class="field"
					rows="4"
					[attr.aria-label]="question().header || question().id"
					[placeholder]="question().placeholder || ''"
					[value]="answer().text"
					(input)="setText($event)"></textarea>
			} @else {
				<div
					class="opts"
					role="group"
					[attr.aria-label]="question().header || question().id">
					@for (o of question().options ?? []; track o.id) {
						<label
							class="opt"
							[class.on]="isOn(o.id)">
							<input
								[type]="question().type === 'multi' ? 'checkbox' : 'radio'"
								[name]="question().id"
								[checked]="isOn(o.id)"
								(change)="toggle(o.id)" />
							<span class="opt-body">
								<span class="opt-label">
									{{ o.label }}
									@if (o.recommended) {
										<span class="badge">Recommandé</span>
									}
								</span>
								@if (o.description) {
									<span class="opt-desc">{{ o.description }}</span>
								}
							</span>
						</label>
					}
					@if (question().allow_other) {
						<label class="other">
							<span class="other-label">Autre</span>
							<textarea
								class="field"
								placeholder="Précisez…"
								[value]="answer().text"
								(input)="setOther($event)"></textarea>
						</label>
					}
				</div>
			}
		</section>
	`,
})
export class QuestionComponent {
	readonly question = input.required<Question>();
	readonly answer = input.required<Answer>();
	readonly changed = output<Answer>();

	isOn(id: string): boolean {
		return this.answer().selected.includes(id);
	}

	toggle(id: string) {
		const a = this.answer();
		if (this.question().type === "single") {
			this.changed.emit({ selected: [id], text: "" });
		} else {
			const selected = a.selected.includes(id) ? a.selected.filter((x) => x !== id) : [...a.selected, id];
			this.changed.emit({ ...a, selected });
		}
	}

	setText(event: Event) {
		this.changed.emit({ ...this.answer(), text: textOf(event) });
	}

	/** En choix unique, saisir « Autre » désélectionne les options (les deux s'excluent). */
	setOther(event: Event) {
		const text = textOf(event);
		const a = this.answer();
		this.changed.emit(this.question().type === "single" && text.trim() ? { selected: [], text } : { ...a, text });
	}
}
