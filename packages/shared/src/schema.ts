import { z } from "zod";

/** One choice of a `single`/`multi` question. Its `id` is what comes back in `Answer.selected`. */
export const OptionSchema = z.object({
	id: z.string().min(1).max(64).describe("Stable option identifier"),
	label: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	recommended: z
		.boolean()
		.optional()
		.describe("Mark the option(s) you recommend: shown with a 'Recommandé' badge. Not preselected."),
});

/**
 * A question the agent asks the user. Cross-field rule (`superRefine`): `single`/`multi` need at least 2 options with
 * unique ids; `text` questions ignore `options`. This is the input schema of the MCP tools and of stored sessions.
 */
export const QuestionSchema = z
	.object({
		id: z
			.string()
			.regex(/^[a-z0-9_]{1,64}$/, "snake_case attendu")
			.describe("Stable identifier (snake_case), used to map answers"),
		header: z.string().max(60).optional().describe("Short label shown in the outline"),
		prompt: z.string().min(1).max(20_000).describe("The question itself (markdown)"),
		context_markdown: z
			.string()
			.max(200_000)
			.optional()
			.describe("Long context: code, diffs, trade-offs (markdown). Shown in a collapsible block."),
		type: z.enum(["single", "multi", "text"]),
		options: z.array(OptionSchema).max(20).optional().describe("Required for single/multi (min 2)"),
		allow_other: z
			.boolean()
			.optional()
			.describe(
				"Adds a free-text 'Autre' field to single/multi questions. Defaults to true: pass false to remove it.",
			),
		allow_notes: z
			.boolean()
			.optional()
			.describe(
				"Lets the user attach an optional note to each option they select (returned as selected[].note). Defaults to true: pass false to remove it.",
			),
		required: z.boolean().optional().describe("Defaults to true"),
		placeholder: z.string().max(200).optional(),
	})
	.superRefine((question, context) => {
		if (question.type === "text") {
			return;
		}
		const options = question.options ?? [];
		if (options.length < 2) {
			context.addIssue({
				code: "custom",
				path: ["options"],
				message: "single/multi questions need at least 2 options",
			});
		}
		if (new Set(options.map((option) => option.id)).size !== options.length) {
			context.addIssue({ code: "custom", path: ["options"], message: "duplicate option ids" });
		}
	});

export type Question = z.infer<typeof QuestionSchema>;

/**
 * The user's answer to one question. `selected` holds option ids (empty for `text`), `text` is the free text (the
 * `text` answer itself, or the "Autre" field). `notes` is keyed by selected option id.
 */
export const AnswerSchema = z.object({
	selected: z.array(z.string()).max(50).default([]),
	text: z.string().max(50_000).default(""),
	notes: z.record(z.string(), z.string().max(5_000)).optional().describe("Optional note per selected option id"),
});
export type Answer = z.infer<typeof AnswerSchema>;

/** All answers of a session, keyed by question id. Also the shape of a draft (which may be partial). */
export const AnswersSchema = z.record(z.string(), AnswerSchema);
export type Answers = z.infer<typeof AnswersSchema>;

export type Option = z.infer<typeof OptionSchema>;

/** Body of a refusal: the user declines to answer, with an optional reason relayed to the agent. */
export const DeclineSchema = z.object({ reason: z.string().max(2000).default("") });
export type QuestionType = Question["type"];
