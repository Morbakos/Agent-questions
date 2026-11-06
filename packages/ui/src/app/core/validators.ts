import type { AbstractControl, ValidationErrors } from "@angular/forms";

/** The `next` (or `password`) and `confirm` fields of a group must be identical. */
export function passwordsMatch(group: AbstractControl): ValidationErrors | null {
	const value = group.value as { next?: string; password?: string; confirm?: string };
	return (value.next ?? value.password) === value.confirm ? null : { mismatch: true };
}
