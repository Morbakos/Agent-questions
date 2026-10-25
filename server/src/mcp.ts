import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { openInBrowser } from "./open.js";
import { QuestionSchema } from "./schema.js";
import type { Session, SessionStore } from "./sessions.js";

/** Sous-ensemble de l'objet `extra` fourni par le SDK à chaque appel d'outil. */
interface Extra {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendNotification: (notification: any) => Promise<void>;
}

const lastOpened = new Map<string, number>();

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

export function createMcpServer(store: SessionStore, cfg: AppConfig): McpServer {
  const server = new McpServer({ name: "agent-questions", version: "0.1.0" });

  const urlOf = (s: Session) => `${cfg.baseUrl}/s/${s.id}`;

  /** Ouvre le navigateur sauf si la page est déjà ouverte (vue récemment) ou vient d'être ouverte. */
  function maybeOpen(s: Session): void {
    if (cfg.noOpen || s.status !== "pending") return;
    const now = Date.now();
    const seenRecently = s.lastSeenAt !== null && now - s.lastSeenAt < 60_000;
    const openedRecently = now - (lastOpened.get(s.id) ?? 0) < 120_000;
    if (seenRecently || openedRecently) return;
    lastOpened.set(s.id, now);
    openInBrowser(urlOf(s));
  }

  function toResult(s: Session) {
    if (s.status === "answered" && s.answers) {
      store.markDelivered(s.id);
      const answers = s.questions.map((q) => {
        const a = s.answers![q.id] ?? { selected: [], text: "" };
        return {
          question_id: q.id,
          header: q.header,
          selected: a.selected.map((id) => ({
            id,
            label: q.options?.find((o) => o.id === id)?.label ?? id,
          })),
          text: a.text || undefined,
        };
      });
      return json({ status: "answered", session_id: s.id, answers });
    }
    if (s.status === "declined") {
      store.markDelivered(s.id);
      return json({
        status: "declined",
        session_id: s.id,
        reason: s.declineReason || "L'utilisateur a choisi de ne pas répondre.",
      });
    }
    return json({
      status: "pending",
      session_id: s.id,
      url: urlOf(s),
      message:
        "The user has not answered yet. Call get_answers with this session_id to keep waiting, " +
        "and tell the user they can open the url if the page did not open by itself. Do not re-ask the questions.",
    });
  }

  async function waitAndRespond(s: Session, waitSeconds: number | undefined, extra: Extra) {
    maybeOpen(s);
    const token = extra._meta?.progressToken;
    const notify = (progress: number, message: string) => {
      if (token === undefined) return;
      extra
        .sendNotification({
          method: "notifications/progress",
          params: { progressToken: token, progress, message },
        })
        .catch(() => {});
    };
    notify(0, `En attente de la réponse de l'utilisateur : ${urlOf(s)}`);
    let tick = 0;
    const keepalive = setInterval(() => notify(++tick, "En attente de la réponse de l'utilisateur"), 15_000);
    try {
      const ms = Math.min(waitSeconds ?? cfg.defaultWaitSeconds, 3600) * 1000;
      const final = await store.wait(s.id, ms, extra.signal);
      return toResult(final);
    } finally {
      clearInterval(keepalive);
    }
  }

  server.registerTool(
    "ask_user",
    {
      title: "Ask the user (rich form)",
      description:
        "Ask the user a set of questions in a dedicated web form. Prefer this over inline questions when you " +
        "have several questions, long context (code, diffs, trade-offs) or many options. The call waits for the " +
        "answers. If the user has not answered in time the result is status 'pending' with a session_id: then " +
        "call get_answers. Never re-ask the same questions: reuse the session_id.",
      inputSchema: {
        title: z.string().max(120).optional().describe("Short title of this question set"),
        questions: z.array(QuestionSchema).min(1).max(30),
        session_id: z
          .string()
          .uuid()
          .optional()
          .describe("Existing session to keep waiting on (returned by a previous 'pending' result)"),
        wait_seconds: z.number().int().min(0).max(3600).optional().describe("Max wait before returning 'pending'"),
      },
    },
    async ({ title, questions, session_id, wait_seconds }, extra) => {
      const ids = questions.map((q) => q.id);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate question ids");
      const { session } = store.findOrCreate({
        sessionId: session_id,
        title: title ?? "Questions de l'agent",
        questions,
      });
      return waitAndRespond(session, wait_seconds, extra as unknown as Extra);
    },
  );

  server.registerTool(
    "get_answers",
    {
      title: "Get the answers of a question session",
      description:
        "Wait for (or fetch) the answers of a session previously created with ask_user. " +
        "Returns status 'answered', 'declined' or 'pending'.",
      inputSchema: {
        session_id: z.string().uuid(),
        wait_seconds: z.number().int().min(0).max(3600).optional(),
      },
    },
    async ({ session_id, wait_seconds }, extra) => {
      const session = store.get(session_id);
      if (!session) throw new Error(`session_id inconnu : ${session_id}`);
      return waitAndRespond(session, wait_seconds, extra as unknown as Extra);
    },
  );

  return server;
}
