import { ComponentFixture, TestBed } from "@angular/core/testing";
import type { Answer, Question } from "@agent-questions/shared";
import { multiQuestion, singleQuestion, textQuestion } from "../../../testing/fixtures";
import { QuestionComponent } from "./question";

describe("QuestionComponent", () => {
	let fixture: ComponentFixture<QuestionComponent>;
	let emitted: Answer[];

	async function render(question: Question, answer: Answer = { selected: [], text: "" }) {
		fixture = TestBed.createComponent(QuestionComponent);
		emitted = [];
		fixture.componentInstance.changed.subscribe((a) => emitted.push(a));
		fixture.componentRef.setInput("question", question);
		fixture.componentRef.setInput("answer", answer);
		await fixture.whenStable();
	}

	const el = () => fixture.nativeElement as HTMLElement;
	const inputs = () => Array.from(el().querySelectorAll<HTMLInputElement>("input"));
	const click = async (node: HTMLElement) => {
		node.click();
		await fixture.whenStable();
	};

	it("affiche l'en-tête et l'énoncé rendu en markdown", async () => {
		await render(singleQuestion());
		expect(el().querySelector(".q-head")?.textContent).toContain("Choix");
		expect(el().querySelector(".q-prompt strong")?.textContent).toBe("choisir");
	});

	it("affiche le contexte dans un bloc repliable quand il est fourni", async () => {
		await render(singleQuestion({ context_markdown: "```\ncode\n```" }));
		expect(el().querySelector("details.q-context pre")).not.toBeNull();
		await render(singleQuestion());
		expect(el().querySelector("details")).toBeNull();
	});

	describe("choix recommandé", () => {
		it("affiche un badge « Recommandé » uniquement sur l'option recommandée", async () => {
			await render(singleQuestion());
			const labels = Array.from(el().querySelectorAll(".opt"));
			expect(labels).toHaveLength(2);
			expect(labels[0]?.querySelector(".badge")?.textContent).toBe("Recommandé");
			expect(labels[1]?.querySelector(".badge")).toBeNull();
		});

		it("n'affiche aucun badge sans option recommandée", async () => {
			await render(
				singleQuestion({
					options: [
						{ id: "a", label: "A" },
						{ id: "b", label: "B" },
					],
				}),
			);
			expect(el().querySelector(".badge")).toBeNull();
		});

		it("ne présélectionne pas l'option recommandée", async () => {
			await render(singleQuestion());
			expect(inputs().every((i) => !i.checked)).toBe(true);
		});
	});

	describe("choix unique", () => {
		it("rend des boutons radio et affiche la description des options", async () => {
			await render(singleQuestion());
			expect(inputs().map((i) => i.type)).toEqual(["radio", "radio"]);
			expect(el().querySelector(".opt-desc")?.textContent).toBe("La première");
		});

		it("émet l'option choisie et vide le texte « Autre »", async () => {
			await render(singleQuestion(), { selected: [], text: "ancien" });
			await click(inputs()[1]!);
			expect(emitted).toEqual([{ selected: ["b"], text: "" }]);
		});

		it("coche l'option de la réponse courante", async () => {
			await render(singleQuestion(), { selected: ["b"], text: "" });
			expect(inputs().map((i) => i.checked)).toEqual([false, true]);
			expect(el().querySelector(".opt.on")).not.toBeNull();
		});
	});

	describe("choix multiple", () => {
		it("rend des cases à cocher", async () => {
			await render(multiQuestion());
			expect(inputs().map((i) => i.type)).toEqual(["checkbox", "checkbox"]);
		});

		it("ajoute puis retire une option", async () => {
			await render(multiQuestion(), { selected: ["x"], text: "" });
			await click(inputs()[1]!);
			expect(emitted.at(-1)).toEqual({ selected: ["x", "y"], text: "" });
			await click(inputs()[0]!);
			expect(emitted.at(-1)).toEqual({ selected: [], text: "" });
		});
	});

	describe("champ « Autre »", () => {
		const typeOther = async (value: string) => {
			const area = el().querySelector<HTMLTextAreaElement>(".other textarea")!;
			area.value = value;
			area.dispatchEvent(new Event("input"));
			await fixture.whenStable();
		};

		it("n'apparaît que si allow_other est actif", async () => {
			await render(singleQuestion());
			expect(el().querySelector(".other")).toBeNull();
			await render(singleQuestion({ allow_other: true }));
			expect(el().querySelector(".other")).not.toBeNull();
		});

		it("en choix unique, saisir du texte désélectionne les options", async () => {
			await render(singleQuestion({ allow_other: true }), { selected: ["a"], text: "" });
			await typeOther("autre chose");
			expect(emitted).toEqual([{ selected: [], text: "autre chose" }]);
		});

		it("en choix unique, un texte vide garde la sélection", async () => {
			await render(singleQuestion({ allow_other: true }), { selected: ["a"], text: "x" });
			await typeOther("  ");
			expect(emitted).toEqual([{ selected: ["a"], text: "  " }]);
		});

		it("en choix multiple, le texte s'ajoute à la sélection", async () => {
			await render(multiQuestion({ allow_other: true }), { selected: ["x"], text: "" });
			await typeOther("plus");
			expect(emitted).toEqual([{ selected: ["x"], text: "plus" }]);
		});
	});

	describe("question libre", () => {
		it("rend un textarea avec son placeholder, sans options", async () => {
			await render(textQuestion({ placeholder: "Écrivez…" }), { selected: [], text: "déjà" });
			const area = el().querySelector<HTMLTextAreaElement>("textarea")!;
			expect(area.placeholder).toBe("Écrivez…");
			expect(area.value).toBe("déjà");
			expect(el().querySelector(".opts")).toBeNull();
		});

		it("émet le texte saisi", async () => {
			await render(textQuestion());
			const area = el().querySelector<HTMLTextAreaElement>("textarea")!;
			area.value = "réponse";
			area.dispatchEvent(new Event("input"));
			expect(emitted).toEqual([{ selected: [], text: "réponse" }]);
		});
	});

	it("expose un identifiant d'ancre pour le plan de la page", async () => {
		await render(singleQuestion());
		expect(el().querySelector("section")?.id).toBe("q-choix");
	});
});
