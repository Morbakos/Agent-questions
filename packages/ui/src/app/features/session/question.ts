import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";
import { type Answer, type Question, allowsNotes, allowsOther, isRequired } from "@agent-questions/shared";
import { MarkdownPipe } from "../../shared/markdown.pipe";

const textOf = (event: Event): string => (event.target as HTMLTextAreaElement).value;

/** Renders one question and edits its answer. Stateless about the answer: it emits a new `Answer` through `changed`. */
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
			@if (!required()) {
				<p class="muted small">(facultatif)</p>
			}
			<div
				class="md q-prompt"
				[id]="'q-' + question().id + '-prompt'"
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
					[attr.aria-labelledby]="'q-' + question().id + '-prompt'"
					[attr.aria-required]="required()"
					[placeholder]="question().placeholder || ''"
					[value]="answer().text"
					(input)="setText($event)"></textarea>
			} @else {
				<div
					class="opts"
					role="group"
					[attr.aria-labelledby]="'q-' + question().id + '-prompt'"
					[attr.aria-required]="required()">
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
						@if (allowNotes() && isOn(o.id)) {
							<div class="opt-note">
								@if (noteOpen(o.id)) {
									<textarea
										class="field"
										rows="2"
										placeholder="Précision (facultatif)…"
										[attr.aria-label]="'Précision sur ' + o.label"
										[value]="noteOf(o.id)"
										(input)="setNote(o.id, $event)"></textarea>
								} @else {
									<button
										type="button"
										class="link"
										aria-expanded="false"
										(click)="openNote(o.id)">
										+ Ajouter une précision
									</button>
								}
							</div>
						}
					}
					@if (allowOther()) {
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
	/** Emits the complete new answer (never a patch) on every edit. */
	readonly changed = output<Answer>();
	protected readonly required = computed(() => isRequired(this.question()));
	protected readonly allowOther = computed(() => allowsOther(this.question()));
	protected readonly allowNotes = computed(() => allowsNotes(this.question()));
	private readonly opened = signal<ReadonlySet<string>>(new Set());

	isOn(id: string): boolean {
		return this.answer().selected.includes(id);
	}

	noteOf(id: string): string {
		return this.answer().notes?.[id] ?? "";
	}

	/** The note field is open as soon as it is requested or a note already exists. */
	noteOpen(id: string): boolean {
		return this.opened().has(id) || this.noteOf(id) !== "";
	}

	openNote(id: string) {
		this.opened.update((ids) => new Set(ids).add(id));
	}

	setNote(id: string, event: Event) {
		const a = this.answer();
		this.changed.emit({ ...a, notes: { ...a.notes, [id]: textOf(event) } });
	}

	/** An unchecked option loses its note: the server rejects a note without a selected option. */
	toggle(id: string) {
		const a = this.answer();
		if (this.question().type === "single") {
			this.opened.set(new Set());
			this.changed.emit({ selected: [id], text: "", notes: {} });
		} else if (a.selected.includes(id)) {
			const notes = Object.fromEntries(Object.entries(a.notes ?? {}).filter(([key]) => key !== id));
			this.opened.update((ids) => new Set([...ids].filter((x) => x !== id)));
			this.changed.emit({ ...a, selected: a.selected.filter((x) => x !== id), notes });
		} else {
			this.changed.emit({ ...a, selected: [...a.selected, id] });
		}
	}

	setText(event: Event) {
		this.changed.emit({ ...this.answer(), text: textOf(event) });
	}

	/** On a single-choice question, typing "Autre" deselects the options (the two are mutually exclusive). */
	setOther(event: Event) {
		const text = textOf(event);
		const a = this.answer();
		this.changed.emit(this.question().type === "single" && text.trim() ? { selected: [], text } : { ...a, text });
	}
}
