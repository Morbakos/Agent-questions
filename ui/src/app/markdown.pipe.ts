import { Pipe, PipeTransform } from "@angular/core";
import { marked } from "marked";

/**
 * Convertit le markdown en HTML. Le résultat est lié via [innerHTML] : Angular le
 * nettoie lui-même (scripts, handlers inline…), ce qui compte car le contenu vient d'un agent.
 */
@Pipe({ name: "markdown" })
export class MarkdownPipe implements PipeTransform {
	transform(value: string | undefined | null): string {
		if (!value) return "";
		return marked.parse(value, { async: false, gfm: true }) as string;
	}
}
