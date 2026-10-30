import eslint from "@eslint/js";
import angular from "angular-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["**/dist/**", "**/.angular/**", "node_modules/**"] },

	// Serveur et paquet partagé : Node.
	{
		files: ["packages/server/**/*.ts", "packages/shared/**/*.ts"],
		extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...tseslint.configs.stylistic],
		languageOptions: { globals: globals.node },
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
		},
	},

	// UI Angular : composants (TypeScript) et templates.
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

	// Désactive les règles de style en conflit avec Prettier (toujours en dernier).
	prettier,

	// Après `prettier`, qui désactive `curly` : seule l'option "all" est compatible avec Prettier.
	{
		files: ["packages/**/*.ts"],
		rules: { curly: ["error", "all"] },
	},
);
