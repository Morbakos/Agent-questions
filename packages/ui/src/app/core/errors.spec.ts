import { HttpErrorResponse } from "@angular/common/http";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
	it("returns the API's text", () => {
		expect(errorMessage(new HttpErrorResponse({ status: 409, error: { error: "Déjà pris" } }))).toBe("Déjà pris");
	});

	it("adds the detail of the fields at fault", () => {
		const error = new HttpErrorResponse({ status: 400, error: { error: "Requête invalide", details: ["a", "b"] } });
		expect(errorMessage(error)).toBe("Requête invalide (a ; b)");
	});

	it("reports an unreachable server", () => {
		expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toBe("Serveur injoignable.");
	});

	it("uses the fallback for an error without a body or that is not HTTP", () => {
		expect(errorMessage(new HttpErrorResponse({ status: 500 }), "Échec.")).toBe("Échec.");
		expect(errorMessage(new Error("x"), "Échec.")).toBe("Échec.");
		expect(errorMessage("texte")).toBe("Une erreur est survenue.");
	});
});
