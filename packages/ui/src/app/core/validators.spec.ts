import { FormControl, FormGroup } from "@angular/forms";
import { passwordsMatch } from "./validators";

const group = (value: Record<string, string>) =>
	new FormGroup(Object.fromEntries(Object.entries(value).map(([key, v]) => [key, new FormControl(v)])));

describe("passwordsMatch", () => {
	it("accepts two identical passwords, named `next` or `password`", () => {
		expect(passwordsMatch(group({ next: "abc", confirm: "abc" }))).toBeNull();
		expect(passwordsMatch(group({ password: "abc", confirm: "abc" }))).toBeNull();
	});

	it("rejects two different passwords", () => {
		expect(passwordsMatch(group({ next: "abc", confirm: "abd" }))).toEqual({ mismatch: true });
		expect(passwordsMatch(group({ password: "abc", confirm: "" }))).toEqual({ mismatch: true });
	});
});
