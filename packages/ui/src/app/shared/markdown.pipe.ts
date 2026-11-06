import { Pipe, PipeTransform } from "@angular/core";
import { Renderer, marked } from "marked";

/**
 * The content comes from an agent, so it is untrusted. Angular sanitizes the produced HTML (scripts, handlers); we also remove
 * remote images, which would make a request to a third party as soon as the form is displayed (IP address leak),
 * and we open links in another tab so as not to leave the input in progress.
 */
const renderer = new Renderer();
renderer.image = ({ text }) => text;
renderer.html = ({ text }) => text.replace(/<img\b[^>]*>/gi, "");
renderer.link = function ({ href, title, tokens }) {
	const label = this.parser.parseInline(tokens);
	const escapedTitle = title ? ` title="${title.replace(/"/g, "&quot;")}"` : "";
	return `<a href="${href}"${escapedTitle} target="_blank" rel="noopener noreferrer">${label}</a>`;
};

/**
 * Converts markdown to HTML. The result is bound via [innerHTML]: Angular
 * sanitizes it itself (scripts, inline handlers…).
 */
@Pipe({ name: "markdown" })
export class MarkdownPipe implements PipeTransform {
	transform(value: string | undefined | null): string {
		if (!value) {
			return "";
		}
		return marked.parse(value, { async: false, gfm: true, renderer }) as string;
	}
}
