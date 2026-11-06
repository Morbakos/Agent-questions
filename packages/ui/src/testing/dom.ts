/** Types a value into a field, as the user would (fires the `input` event). */
export function typeInto(root: HTMLElement, selector: string, value: string): void {
	const input = root.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
	if (!input) {
		throw new Error(`Champ introuvable : ${selector}`);
	}
	input.value = value;
	input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

export const button = (root: HTMLElement, text: string): HTMLButtonElement => {
	const found = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
		b.textContent?.includes(text),
	);
	if (!found) {
		throw new Error(`Bouton introuvable : ${text}`);
	}
	return found;
};
