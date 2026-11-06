import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type {
	AdminSessionPage,
	AdminSessionView,
	Answers,
	SessionHistory,
	SessionSummary,
	SessionView,
} from "@agent-questions/shared";

/**
 * Client of the session API (`/api/sessions`), typed with the contract of `@agent-questions/shared/views`. Methods
 * return promises and reject with `HttpErrorResponse` (see `errorMessage`); the server only returns the signed-in
 * user's own sessions, except for the `admin*` calls (read-only supervision).
 */
@Injectable({ providedIn: "root" })
export class ApiService {
	private http = inject(HttpClient);

	/** Pending sessions of the user, most recent first. */
	list() {
		return firstValueFrom(this.http.get<SessionSummary[]>("/api/sessions"));
	}
	/** History page; `before` is the `nextBefore` cursor of the previous page. */
	history(before?: string) {
		let params = new HttpParams();
		if (before !== undefined) {
			params = params.set("before", before);
		}
		return firstValueFrom(this.http.get<SessionHistory>("/api/sessions/history", { params }));
	}
	/** Supervision (admin): all sessions, read-only. */
	adminSessions(before?: string) {
		let params = new HttpParams();
		if (before !== undefined) {
			params = params.set("before", before);
		}
		return firstValueFrom(this.http.get<AdminSessionPage>("/api/admin/sessions", { params }));
	}
	adminSession(id: string) {
		return firstValueFrom(this.http.get<AdminSessionView>(`/api/admin/sessions/${id}`));
	}
	get(id: string) {
		return firstValueFrom(this.http.get<SessionView>(`/api/sessions/${id}`));
	}
	/** Stores the unsent form state; rejected with 409 once the session is closed. */
	saveDraft(id: string, draft: Answers) {
		return firstValueFrom(this.http.put(`/api/sessions/${id}/draft`, draft));
	}
	/** Sends the final answers; rejected with 422 (error list in `details`) if they do not validate, 409 if closed. */
	submit(id: string, answers: Answers) {
		return firstValueFrom(this.http.post(`/api/sessions/${id}/answers`, answers));
	}
	decline(id: string, reason: string) {
		return firstValueFrom(this.http.post(`/api/sessions/${id}/decline`, { reason }));
	}
}
