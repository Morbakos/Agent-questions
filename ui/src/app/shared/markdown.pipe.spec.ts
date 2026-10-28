import { MarkdownPipe } from "./markdown.pipe";

describe("MarkdownPipe", () => {
	const pipe = new MarkdownPipe();

	it("convertit le markdown en HTML", () => {
		expect(pipe.transform("**gras**")).toContain("<strong>gras</strong>");
	});

	it("gère les blocs de code et les tableaux (GFM)", () => {
		expect(pipe.transform("```ts\nconst a = 1;\n```")).toContain("<pre>");
		expect(pipe.transform("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>");
	});

	it("renvoie une chaîne vide pour une valeur vide ou absente", () => {
		expect(pipe.transform("")).toBe("");
		expect(pipe.transform(undefined)).toBe("");
		expect(pipe.transform(null)).toBe("");
	});
});
