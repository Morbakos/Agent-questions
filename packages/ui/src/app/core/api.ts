import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type { Answers, SessionHistory, SessionSummary, SessionView } from "@agent-questions/shared";

@Injectable({ providedIn: "root" })
export class ApiService {
	private http = inject(HttpClient);

	list() {
		return firstValueFrom(this.http.get<SessionSummary[]>("/api/sessions"));
	}
	/** Page de l'historique ; `before` est le curseur `nextBefore` de la page précédente. */
	history(before?: number) {
		let params = new HttpParams();
		if (before !== undefined) {
			params = params.set("before", before);
		}
		return firstValueFrom(this.http.get<SessionHistory>("/api/sessions/history", { params }));
	}
	get(id: string) {
		return firstValueFrom(this.http.get<SessionView>(`/api/sessions/${id}`));
	}
	saveDraft(id: string, draft: Answers) {
		return firstValueFrom(this.http.put(`/api/sessions/${id}/draft`, draft));
	}
	submit(id: string, answers: Answers) {
		return firstValueFrom(this.http.post(`/api/sessions/${id}/answers`, answers));
	}
	decline(id: string, reason: string) {
		return firstValueFrom(this.http.post(`/api/sessions/${id}/decline`, { reason }));
	}
}
