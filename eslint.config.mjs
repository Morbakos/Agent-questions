import eslint from "@eslint/js";
import angular from "angular-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["**/dist/**", "**/.angular/**", "node_modules/**"] },

	// Server and shared package: Node.
	{
		files: ["packages/server/**/*.ts", "packages/shared/**/*.ts"],
		extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...tseslint.configs.stylistic],
		languageOptions: { globals: globals.node },
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
		},
	},

	// Angular UI: components (TypeScript) and templates.
	{
		files: ["packages/ui/**/*.ts"],
		extends: [
			eslint.configs.recommended,
			...tseslint.configs.recommended,
			...tseslint.configs.stylistic,
			...angular.configs.tsRecommended,
		],
		languageOptions: { globals: globals.browser },
		processor: angular.processInlineTemplates,
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
			"@angular-eslint/directive-selector": ["error", { type: "attribute", prefix: "app", style: "camelCase" }],
			"@angular-eslint/component-selector": ["error", { type: "element", prefix: "app", style: "kebab-case" }],
			"@angular-eslint/prefer-on-push-component-change-detection": "error",
		},
	},
	{
		files: ["packages/ui/**/*.html"],
		extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
	},

	// Disables the style rules that conflict with Prettier (always last).
	prettier,

	// After `prettier`, which disables `curly`: only the "all" option is compatible with Prettier.
	{
		files: ["packages/**/*.ts"],
		rules: { curly: ["error", "all"] },
	},
);
