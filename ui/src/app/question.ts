import { Component, input, output } from '@angular/core';
import { Answer, Question } from './models';
import { MarkdownPipe } from './markdown.pipe';

@Component({
  selector: 'app-question',
  imports: [MarkdownPipe],
  template: `
    <section class="q" [id]="'q-' + question().id">
      @if (question().header) {
        <h2 class="q-head">{{ question().header }}</h2>
      }
      <div class="md q-prompt" [innerHTML]="question().prompt | markdown"></div>

      @if (question().context_markdown) {
        <details class="q-context" open>
          <summary>Contexte</summary>
          <div class="md" [innerHTML]="question().context_markdown | markdown"></div>
        </details>
      }

      @if (question().type === 'text') {
        <textarea
          class="field"
          rows="4"
          [attr.aria-label]="question().header || question().id"
          [placeholder]="question().placeholder || ''"
          [value]="answer().text"
          (input)="setText($any($event.target).value)"
        ></textarea>
      } @else {
        <div class="opts" role="group" [attr.aria-label]="question().header || question().id">
          @for (o of question().options ?? []; track o.id) {
            <label class="opt" [class.on]="isOn(o.id)">
              <input
                [type]="question().type === 'multi' ? 'checkbox' : 'radio'"
                [name]="question().id"
                [checked]="isOn(o.id)"
                (change)="toggle(o.id)"
              />
              <span class="opt-body">
                <span class="opt-label">{{ o.label }}</span>
                @if (o.description) {
                  <span class="opt-desc">{{ o.description }}</span>
                }
              </span>
            </label>
          }
          @if (question().allow_other) {
            <label class="other">
              <span class="other-label">Autre</span>
              <input
                class="field"
                type="text"
                placeholder="Précisez…"
                [value]="answer().text"
                (input)="setOther($any($event.target).value)"
              />
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
    if (this.question().type === 'single') {
      this.changed.emit({ selected: [id], text: '' });
    } else {
      const selected = a.selected.includes(id) ? a.selected.filter((x) => x !== id) : [...a.selected, id];
      this.changed.emit({ ...a, selected });
    }
  }

  setText(text: string) {
    this.changed.emit({ ...this.answer(), text });
  }

  /** En choix unique, saisir « Autre » désélectionne les options (les deux s'excluent). */
  setOther(text: string) {
    const a = this.answer();
    this.changed.emit(this.question().type === 'single' && text.trim() ? { selected: [], text } : { ...a, text });
  }
}
