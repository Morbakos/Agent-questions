import {
	BadRequestException,
	ConflictException,
	HttpException,
	Inject,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { type McpContext, Tool } from "@nestjs/mcp";
import { z } from "zod";
import { type Question, QuestionSchema, emptyAnswer } from "@agent-questions/shared";
import { LOCAL_USER_ID, type Principal } from "@app/auth/domain/principal.js";
import { appConfig } from "@app/config/app.config.js";
import type { AppConfig } from "@app/config/config.js";
import { getRuntimeConfig } from "@app/config/runtime-config.js";
import { UiHub } from "@app/events/ui-hub.js";
import { openInBrowser } from "@app/mcp/open.js";
import { relayHintOf } from "@app/mcp/relay-hint.js";
import type { Session } from "@app/sessions/domain/session.js";
import { SessionsService } from "@app/sessions/sessions.service.js";

/** The HTTP request of `/mcp`, on which `@nestjs/authentication` set the user. */
interface AuthenticatedRequest {
	user?: Principal;
}

/** Tool result carrying `value` as a single JSON text block (what the agent parses). */
const json = (value: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/** Shared `wait_seconds` input field, in seconds (0 to 3600); its description embeds the configured default. */
const waitSecondsField = ({ defaultWaitSeconds }: AppConfig, extraAdvice: string) =>
	z
		.number()
		.int()
		.min(0)
		.max(3600)
		.optional()
		.describe(
			`Seconds to wait for the user's answers before returning 'pending' (max 3600; default ${defaultWaitSeconds}` +
				`${defaultWaitSeconds === 0 ? ", which returns immediately" : ""}). ${extraAdvice}`.trim(),
		);

/** What `ask_user` says about waiting: by default (0 s) the call does not block, and the agent chooses to wait. */
const waitingAdvice = ({ defaultWaitSeconds }: AppConfig): string =>
	defaultWaitSeconds === 0
		? "By default the call does not wait: it creates the form and returns status 'pending' with a session_id and " +
			"the form url, and the user answers in their own time. Then tell the user the form is waiting, keep working " +
			"on whatever does not depend on the answers, and call get_answers with the session_id when you need them " +
			"(or when the user tells you they have answered). Only if you cannot continue without the answers and have " +
			"nothing else to do, set wait_seconds so that the call waits for them: it then blocks you until the user " +
			"answers or the delay ends (if your client can, run it as a background task). "
		: "The call waits for the answers, and the user may take a long time to give them: if your client can, run " +
			"this call as a background task (or in a background subagent) instead of blocking the main thread, keep " +
			"working on whatever does not depend on the answers, and handle the result when the call completes. " +
			"If the user has not answered in time the result is status 'pending' with a session_id: then call " +
			"get_answers. ";

/** @throws BadRequestException when two questions share an id (answers are keyed by question id). */
function assertUniqueIds(questions: Question[]): void {
	const ids = questions.map((question) => question.id);
	if (new Set(ids).size !== ids.length) {
		throw new BadRequestException("Duplicate question ids");
	}
}

/**
 * Configuration read **when the `@Tool` decorators are evaluated** (descriptions: default `wait_seconds`, relay
 * instruction). This file is therefore never imported statically: `QuestionsMcpModule.register` sets the configuration
 * (`setRuntimeConfig`) then imports it dynamically. Descriptions are read by models: changing them changes agent
 * behavior (see CLAUDE.md).
 */
const cfg = getRuntimeConfig();
const relayHint = relayHintOf(cfg);

/**
 * The three MCP tools (`ask_user`, `get_answers`, `update_questions`). The session owner is the user that
 * authentication established on the `/mcp` HTTP request (API token or local profile): never a tool argument.
 */
@Injectable()
export class QuestionTools {
	private readonly logger = new Logger("mcp");

	// `cfg` (module) is only for descriptions; the logic uses the injected configuration, like everywhere else.
	constructor(
		@Inject(appConfig.KEY) private readonly cfg: ConfigType<typeof appConfig>,
		@Inject(SessionsService) private readonly sessions: SessionsService,
		@Inject(UiHub) private readonly hub: UiHub,
	) {}

	/**
	 * Owner of the call: the HTTP request's user (set by authentication); in local profile without a request (in-memory
	 * client), the local user.
	 */
	private owner(context: McpContext<AuthenticatedRequest>): string {
		const principal = context.request?.user;
		if (principal) {
			return principal.userId;
		}
		if (this.cfg.deploymentMode === "local") {
			return LOCAL_USER_ID;
		}
		throw new HttpException("Appel MCP sans utilisateur authentifié.", 401);
	}

	@Tool({
		name: "ask_user",
		title: "Ask the user (rich form)",
		description:
			"Ask the user a set of questions in a dedicated web form. Prefer this over inline questions when you " +
			"have several questions, long context (code, diffs, trade-offs) or many options. It is for open " +
			"questions and decisions you cannot make alone (choices, missing requirements, preferences), NOT for " +
			"asking the user to approve or validate your plan, your design or a change you are about to make: give " +
			"the plan in your normal reply or through your client's own approval step, and ask here only what would " +
			"change it. For choice questions the user may attach a note to each option they pick: it comes back in " +
			"selected[].note. " +
			waitingAdvice(cfg) +
			"Never re-ask the same questions: reuse the session_id." +
			(relayHint ? ` ${relayHint}` : ""),
		// Helps clients: replaying the same call creates no duplicate, and nothing is destroyed or sent outside the server.
		annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
		inputSchema: z.object({
			title: z.string().max(120).optional().describe("Short title of this question set"),
			questions: z.array(QuestionSchema).min(1).max(30),
			session_id: z
				.uuid()
				.optional()
				.describe("Existing session to keep waiting on (returned by a previous 'pending' result)"),
			wait_seconds: waitSecondsField(
				cfg,
				"Waiting blocks you until the user answers: set it only when you cannot continue without the answers " +
					"and have nothing else to do.",
			),
		}),
	})
	async askUser(
		{
			title,
			questions,
			session_id,
			wait_seconds,
		}: { title?: string; questions: Question[]; session_id?: string; wait_seconds?: number },
		context: McpContext<AuthenticatedRequest>,
	) {
		assertUniqueIds(questions);
		const owner = this.owner(context);
		const { session, created } = await this.sessions.findOrCreate(owner, {
			sessionId: session_id,
			title: title ?? "Questions de l'agent",
			questions,
		});
		if (created) {
			this.hub.announce(owner, session);
		}
		return this.waitAndRespond(owner, session, wait_seconds, context);
	}

	@Tool({
		name: "get_answers",
		title: "Get the answers of a question session",
		description:
			"Fetch the answers of a session previously created with ask_user, optionally waiting for them (wait_seconds). " +
			"Returns status 'answered', 'declined' or 'pending'. Call it when you need the answers, or when the user " +
			"tells you they have answered.",
		annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
		inputSchema: z.object({
			session_id: z.uuid(),
			wait_seconds: waitSecondsField(
				cfg,
				"0 only checks the current state; use a positive value to wait for the answers when you have nothing else to do.",
			),
		}),
	})
	async getAnswers(
		{ session_id, wait_seconds }: { session_id: string; wait_seconds?: number },
		context: McpContext<AuthenticatedRequest>,
	) {
		const owner = this.owner(context);
		const session = await this.sessions.get(owner, session_id);
		if (!session) {
			throw new NotFoundException(`session_id inconnu : ${session_id}`);
		}
		return this.waitAndRespond(owner, session, wait_seconds, context);
	}

	@Tool({
		name: "update_questions",
		title: "Edit the questions of a pending session",
		description:
			"Replace the questions (and optionally the title) of a session the user has not answered yet, e.g. to " +
			"fix a mistake or refine an option. Send the COMPLETE new list of questions, not a diff. The open form " +
			"refreshes by itself and the user's draft is kept for the questions whose id is unchanged. Keep the ids " +
			"of questions you only reword. Fails if the session is already answered or declined: call get_answers. " +
			"Like ask_user, it waits for the answers only if wait_seconds says so.",
		annotations: { idempotentHint: true, openWorldHint: false },
		inputSchema: z.object({
			session_id: z.uuid().describe("Session returned by ask_user"),
			questions: z.array(QuestionSchema).min(1).max(30),
			title: z.string().max(120).optional().describe("New title; unchanged if omitted"),
			wait_seconds: waitSecondsField(
				cfg,
				"Waiting blocks you until the user answers: set it only when you have nothing else to do.",
			),
		}),
	})
	async updateQuestions(
		{
			session_id,
			questions,
			title,
			wait_seconds,
		}: { session_id: string; questions: Question[]; title?: string; wait_seconds?: number },
		context: McpContext<AuthenticatedRequest>,
	) {
		assertUniqueIds(questions);
		const owner = this.owner(context);
		const current = await this.sessions.get(owner, session_id);
		if (!current) {
			throw new NotFoundException(`session_id inconnu : ${session_id}`);
		}
		if (current.status !== "pending") {
			throw new ConflictException(
				`Session already ${current.status}: it cannot be edited. Call get_answers with this session_id.`,
			);
		}
		const session = await this.sessions.updateQuestions(owner, session_id, title, questions);
		this.logger.log(`session ${session.id} : questions modifiées (révision ${session.revision})`);
		return this.waitAndRespond(owner, session, wait_seconds, context);
	}

	/** Address of the session's form in the UI, given to the agent (and opened in the browser). */
	private urlOf({ id }: Session): string {
		const { baseUrl } = this.cfg;
		return `${baseUrl}/s/${id}`;
	}

	/**
	 * Opens the form in the server's browser, only when it is not disabled (`noOpen`), the session is pending and
	 * the owner has no UI tab connected or just opened (otherwise the tab itself reacts to the `new-session` event).
	 */
	private maybeOpen(owner: string, session: Session): void {
		const { noOpen } = this.cfg;
		if (noOpen || session.status !== "pending" || this.hub.hasUi(owner)) {
			return;
		}
		this.hub.markOpened(owner);
		openInBrowser(this.urlOf(session));
	}

	/**
	 * Builds the tool result for the session state. Side effect: an `answered` or `declined` outcome is marked as
	 * delivered, so the session stops being resumable by `ask_user` with the same questions.
	 */
	private async toResult(owner: string, session: Session) {
		if (session.status === "answered" && session.answers) {
			const given = session.answers;
			await this.sessions.markDelivered(owner, session.id);
			const answers = session.questions.map((question) => {
				const answer = given[question.id] ?? emptyAnswer();
				return {
					question_id: question.id,
					header: question.header,
					selected: answer.selected.map((id) => ({
						id,
						label: question.options?.find((option) => option.id === id)?.label ?? id,
						note: answer.notes?.[id] || undefined,
					})),
					text: answer.text || undefined,
				};
			});
			return json({ status: "answered", session_id: session.id, answers });
		}
		if (session.status === "declined") {
			await this.sessions.markDelivered(owner, session.id);
			return json({
				status: "declined",
				session_id: session.id,
				reason: session.declineReason || "L'utilisateur a choisi de ne pas répondre.",
			});
		}
		return json({
			status: "pending",
			session_id: session.id,
			url: this.urlOf(session),
			message:
				"The user has not answered yet. Tell the user the form is waiting at the url (they can open it if the " +
				"page did not open by itself), and keep working on whatever does not depend on the answers. When you " +
				"need the answers, or when the user tells you they have answered, call get_answers with this " +
				"session_id (set wait_seconds to wait for them). Do not re-ask the questions.",
		});
	}

	/** Waits for the session to close, with MCP progress notifications (if the client asks for them). */
	private async waitAndRespond(
		owner: string,
		session: Session,
		waitSeconds: number | undefined,
		context: McpContext<AuthenticatedRequest>,
	) {
		this.maybeOpen(owner, session);
		// A progress notification must never interrupt the tool call.
		const notify = (progress: number, message: string) =>
			void context.reportProgress(progress, undefined, message).catch(() => undefined);
		notify(1, `En attente de la réponse de l'utilisateur : ${this.urlOf(session)}`);
		let tick = 1;
		const keepalive = setInterval(() => notify(++tick, "En attente de la réponse de l'utilisateur"), 15_000);
		const ms = Math.min(waitSeconds ?? this.cfg.defaultWaitSeconds, 3600) * 1000;
		const startedAt = Date.now();
		this.logger.log(`session ${session.id} : attente de ${ms / 1000}s`);
		try {
			const final = await this.sessions.wait(owner, session.id, ms, context.signal);
			const elapsed = Math.round((Date.now() - startedAt) / 1000);
			this.logger.log(
				`session ${session.id} : ${final.status} après ${elapsed}s` +
					(context.signal.aborted ? " (appel interrompu par le client)" : ""),
			);
			return await this.toResult(owner, final);
		} finally {
			clearInterval(keepalive);
		}
	}
}
