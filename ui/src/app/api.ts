import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import { Answers, SessionSummary, SessionView } from "./models";

@Injectable({ providedIn: "root" })
export class ApiService {
	private http = inject(HttpClient);

	list() {
		return firstValueFrom(this.http.get<SessionSummary[]>("/api/sessions"));
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
