import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type {
	ApiTokenSummary,
	CreatedApiToken,
	InvitationInfo,
	Role,
	UserInvitation,
	UserSummary,
} from "@agent-questions/shared";

/** Account management calls (server profile). */
@Injectable({ providedIn: "root" })
export class AccountsApi {
	private http = inject(HttpClient);

	invitation(token: string) {
		return firstValueFrom(this.http.get<InvitationInfo>(`/auth/invitations/${encodeURIComponent(token)}`));
	}
	users() {
		return firstValueFrom(this.http.get<UserSummary[]>("/api/admin/users"));
	}
	createUser(username: string, role: Role) {
		return firstValueFrom(this.http.post<UserInvitation>("/api/admin/users", { username, role }));
	}
	reinvite(id: string) {
		return firstValueFrom(this.http.post<UserInvitation>(`/api/admin/users/${id}/invitation`, {}));
	}
	updateUser(id: string, patch: { role?: Role; disabled?: boolean; revokeTokens?: boolean }) {
		return firstValueFrom(this.http.patch<UserSummary>(`/api/admin/users/${id}`, patch));
	}
	changePassword(current: string, next: string) {
		return firstValueFrom(this.http.post("/api/account/password", { current, next }));
	}
	tokens() {
		return firstValueFrom(this.http.get<ApiTokenSummary[]>("/api/account/tokens"));
	}
	createToken(name: string) {
		return firstValueFrom(this.http.post<CreatedApiToken>("/api/account/tokens", { name }));
	}
	revokeToken(id: string) {
		return firstValueFrom(this.http.delete(`/api/account/tokens/${id}`));
	}
}
