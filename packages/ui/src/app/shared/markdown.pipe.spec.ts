import { ChangeDetectionStrategy, Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MarkdownPipe } from "./markdown.pipe";

describe("MarkdownPipe", () => {
	const pipe = new MarkdownPipe();

	it("converts markdown to HTML", () => {
		expect(pipe.transform("**gras**")).toContain("<strong>gras</strong>");
	});

	it("handles code blocks and tables (GFM)", () => {
		expect(pipe.transform("```ts\nconst a = 1;\n```")).toContain("<pre>");
		expect(pipe.transform("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table>");
	});

	it("returns an empty string for an empty or missing value", () => {
		expect(pipe.transform("")).toBe("");
		expect(pipe.transform(undefined)).toBe("");
		expect(pipe.transform(null)).toBe("");
	});

	describe("content coming from an agent", () => {
		it("emits no remote image (IP address leak), neither in markdown nor in raw HTML", () => {
			expect(pipe.transform("![logo](https://tracker.example/p.png)")).not.toContain("<img");
			expect(pipe.transform('avant <img src="https://tracker.example/p.png"> après')).not.toContain("<img");
		});

		it("opens links in another tab, without opener", () => {
			const html = pipe.transform("[doc](https://example.com/a)");
			expect(html).toContain('href="https://example.com/a"');
			expect(html).toContain('target="_blank"');
			expect(html).toContain('rel="noopener noreferrer"');
		});

		it("is sanitized by Angular once bound via innerHTML (scripts, handlers, javascript:)", () => {
			@Component({ template: `<div [innerHTML]="html"></div>`, changeDetection: ChangeDetectionStrategy.OnPush })
			class Host {
				html = pipe.transform(
					'<script>window.pwned = 1</script><b onclick="window.pwned = 2">gras</b> [x](javascript:window.pwned=3) <a href="javascript:window.pwned=4">y</a>',
				);
			}
			const fixture = TestBed.createComponent(Host);
			fixture.detectChanges();
			const root = fixture.nativeElement as HTMLElement;
			expect(root.querySelector("script")).toBeNull();
			expect(root.querySelector("b")?.getAttribute("onclick")).toBeNull();
			for (const link of Array.from(root.querySelectorAll("a"))) {
				expect(link.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
			}
		});
	});
});
