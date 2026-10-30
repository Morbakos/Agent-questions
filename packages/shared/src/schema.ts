import { z } from "zod";

export const OptionSchema = z.object({
	id: z.string().min(1).max(64).describe("Stable option identifier"),
	label: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	recommended: z
		.boolean()
		.optional()
		.describe("Mark the option(s) you recommend: shown with a 'Recommandé' badge. Not preselected."),
});

export const QuestionSchema = z
	.object({
		id: z
			.string()
			.regex(/^[a-z0-9_]{1,64}$/, "snake_case attendu")
			.describe("Stable identifier (snake_case), used to map answers"),
		header: z.string().max(60).optional().describe("Short label shown in the outline"),
		prompt: z.string().min(1).describe("The question itself (markdown)"),
		context_markdown: z
			.string()
			.optional()
			.describe("Long context: code, diffs, trade-offs (markdown). Shown in a collapsible block."),
		type: z.enum(["single", "multi", "text"]),
		options: z.array(OptionSchema).max(20).optional().describe("Required for single/multi (min 2)"),
		allow_other: z.boolean().optional().describe("Adds a free-text 'Autre' field"),
		required: z.boolean().optional().describe("Defaults to true"),
		placeholder: z.string().max(200).optional(),
	})
	.superRefine((q, ctx) => {
		if (q.type === "text") {
			return;
		}
		const opts = q.options ?? [];
		if (opts.length < 2) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["options"],
				message: "single/multi questions need at least 2 options",
			});
		}
		if (new Set(opts.map((o) => o.id)).size !== opts.length) {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options"], message: "duplicate option ids" });
		}
	});

export type Question = z.infer<typeof QuestionSchema>;

export const AnswerSchema = z.object({
	selected: z.array(z.string()).max(50).default([]),
	text: z.string().max(50_000).default(""),
});
export type Answer = z.infer<typeof AnswerSchema>;

export const AnswersSchema = z.record(z.string(), AnswerSchema);
export type Answers = z.infer<typeof AnswersSchema>;

export type Option = z.infer<typeof OptionSchema>;
export type QuestionType = Question["type"];
