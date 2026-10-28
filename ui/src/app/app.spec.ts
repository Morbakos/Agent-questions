import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { App } from "./app";

describe("App", () => {
	it("affiche l'en-tête avec un lien vers la liste", async () => {
		TestBed.configureTestingModule({ providers: [provideRouter([])] });
		const fixture = TestBed.createComponent(App);
		await fixture.whenStable();
		const brand = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>("a.brand");
		expect(brand?.textContent).toBe("Questions de l'agent");
		expect(brand?.getAttribute("href")).toBe("/");
	});
});
