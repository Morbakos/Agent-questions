# CLAUDE.md

Agent Questions : un serveur MCP + une UI web pour poser à l'utilisateur des questions longues ou complexes
(markdown, code, nombreuses options). L'agent appelle `ask_user`, l'utilisateur répond dans un formulaire, la réponse
revient dans l'appel d'outil. Le README décrit l'usage ; ce fichier décrit comment travailler sur le code.

## Stack et structure

Monorepo npm (workspaces `packages/shared`, `packages/server` et `packages/ui`), Node ≥ 22.13, TypeScript strict. Ordre de build :
`shared` → `ui` → `server`.

- `packages/shared/` (`@agent-questions/shared`) : **source unique des types** entre serveur et UI. `src/schema.ts` (schémas zod
  et types `z.infer`), `src/answers.ts` (logique pure sans zod : `isAnswered`, `validateAnswers`…), `src/views.ts`
  (contrat de l'API de l'UI : `SessionView`, `SessionSummary`, `ApiError`). Compilé par `tsc` vers `dist`. L'UI
  l'importe en `import type` et n'utilise à l'exécution que `answers.ts` (`sideEffects: false` : zod n'entre pas dans
  le bundle).
- `packages/server/` : Fastify 5, SDK MCP (`@modelcontextprotocol/sdk`), zod 3, SQLite via `node:sqlite` (intégré, pas de
  dépendance native). ESM `NodeNext` : les imports relatifs portent l'extension `.js`.
  - `src/index.ts` : point d'entrée. Sans option, démarre le serveur HTTP. Avec `--stdio`, lance le relais.
  - `src/http.ts` : assemble Fastify (garde, gestion d'erreurs, routes). `src/routes/` : `guard.ts` (Host/Origin,
    CORS), `sessions.ts` (API de l'UI), `mcp.ts` (endpoint `POST /mcp`), `static.ts` (UI), `views.ts`.
  - `src/mcp.ts` : assemble le serveur MCP. `src/tools/` : **un fichier par outil** (`ask-user.ts`,
    `update-questions.ts`, `get-answers.ts`) qui exporte `registerXxx(server, ctx)` ; `respond.ts` regroupe les helpers
    communs (attente, réponse, ouverture du navigateur), `context.ts` le contexte injecté.
  - `src/sessions.ts` : `SessionStore` (requêtes SQLite + attente des réponses). `src/db/migrations.ts` : migrations
    ordonnées, version dans `PRAGMA user_version`.
  - `src/stdio.ts` : mode stdio (relais, voir plus bas).
  - `src/config.ts` : variables d'environnement `AQ_*`. `src/open.ts` : ouverture du navigateur.
- `packages/ui/` : Angular 21.1, composants standalone, signals, `OnPush`, styles en SCSS, rendu markdown avec `marked`.
  - `src/app/core/` (`api.ts`, `app.config.ts`), `src/app/shared/` (`markdown.pipe.ts`), `src/app/features/home/`
    (liste des questions en attente, rafraîchie toutes les 5 s), `src/app/features/session/` (formulaire :
    `session.ts` + `session.html`, `question.ts`, `session-state.ts` qui porte l'état, le brouillon et le sondage).
    Les routes (`app.routes.ts`) sont chargées à la demande (`loadComponent`).
  - Styles : `src/styles.scss` ne fait que `@use` les partiels de `src/styles/` (jetons de thème clair/sombre en
    variables CSS, base, formulaires, markdown). Le reste vit dans le `.scss` du composant. Le markdown injecté par
    `[innerHTML]` n'est pas atteint par les styles encapsulés : ses règles (`.md`) restent globales.

### Ajouter un outil MCP

1. Créer `packages/server/src/tools/<nom>.ts` qui exporte `registerXxx(server, ctx)` (voir `get-answers.ts`, le plus court).
2. L'appeler dans `createMcpServer` (`packages/server/src/mcp.ts`).
3. Si l'outil expose de nouveaux champs ou types, les ajouter dans `packages/shared/src/`.
4. Écrire ses tests dans `packages/server/src/mcp.test.ts` (client MCP en mémoire) et mettre le README à jour.

### Ajouter une page à l'UI

Créer `packages/ui/src/app/features/<nom>/`, puis une entrée `loadComponent` dans `app.routes.ts`. Les appels HTTP passent par
`core/api.ts`.

## Commandes

```bash
npm install --legacy-peer-deps   # sans le flag, npm 10.9 plante (« edgesOut ») sur les peers d'Angular 21
npm run build              # shared, UI puis serveur (l'UI est lente à compiler)
npm run build -w @agent-questions/server    # serveur seul : sert aussi de vérification de types (shared doit être construit)
npm start                  # serveur sur http://127.0.0.1:4317 (UI incluse si construite)
npm run dev:ui             # construit shared puis ng serve sur :4200, proxy /api vers :4317
npm run dev:shared         # tsc --watch sur shared (si vous le modifiez pendant un dev:ui / dev:server)
npm test                   # tests du serveur et de shared (Vitest), puis de l'UI (ng test)
npm run test:server        # tests serveur et shared seulement (rapide, sans compiler shared)
npm run lint               # ESLint (typescript-eslint pour packages/server et packages/shared, angular-eslint pour packages/ui)
npm run format             # Prettier (format:check pour vérifier sans écrire)
```

`npm run dev:server` utilise la syntaxe `AQ_DEV=1 …` de bash : sous PowerShell, faire
`npm run build -w @agent-questions/shared; $env:AQ_DEV="1"; npm run dev -w @agent-questions/server`.

## Tests

- Serveur et `shared` : Vitest (`vitest.config.ts` à la racine, qui lit les sources de `shared` sans le compiler).
  `schema.test.ts`, `sessions.test.ts` (base en mémoire, dont la migration d'une ancienne base), `db/migrations.test.ts`,
  `http.test.ts` (`fastify.inject`, sans port), `mcp.test.ts` (client MCP relié en mémoire au serveur, sans réseau).
  `src/test-helpers.ts` : `testConfig()` force `noOpen: true`, **ne jamais le désactiver dans un test** (le navigateur
  s'ouvrirait).
- UI : `ng test` (builder `unit-test`, Vitest + jsdom). Les doubles et fixtures sont dans `packages/ui/src/testing/` (exclu du
  build de l'application). Avec des faux timers (`vi.useFakeTimers`), `fixture.whenStable()` peut ne jamais se
  résoudre : utiliser `fixture.detectChanges()` après `vi.advanceTimersByTimeAsync`.
- Après une modification : `npm run lint`, `npm run format:check`, `npm run build`, `npm test`, puis un essai réel
  (voir « Vérifier »). Ces tests ne couvrent pas le navigateur ni le mode `--stdio`.

## Architecture : le point à ne pas casser

Tout vit dans **un seul processus HTTP** (UI, API, base, endpoint `/mcp`). `SessionStore.wait()` repose sur un
`EventEmitter` **en mémoire** : quand l'utilisateur envoie ses réponses via l'API de l'UI, l'événement réveille l'appel
`ask_user` qui attendait. Si l'API de l'UI et le handler MCP étaient dans deux processus, l'attente ne serait jamais
réveillée. Ne séparez pas ces deux parties sans remplacer l'émetteur (polling SQLite, par exemple).

- **Serveur MCP sans état** : pas de `Mcp-Session-Id`, un `McpServer` et un transport par requête. Les sessions de
  questions ont leur propre identifiant en base.
- **Mode `--stdio`** : pour Claude Code, Codex, etc. Le processus lancé par le client ne contient aucune logique ni
  SQLite : il vérifie qu'un serveur HTTP répond sur `AQ_PORT` (`/health`), le démarre sinon (processus détaché,
  journal dans `<AQ_DATA_DIR>/daemon.log`), puis relaie chaque message JSON-RPC vers `POST /mcp` (réponses JSON ou SSE).
  Il gère l'annulation (`notifications/cancelled` abandonne la requête HTTP) et relance le serveur s'il est tombé.
- **En stdio, stdout ne doit contenir que du JSON-RPC.** Aucun `console.log` dans `stdio.ts` ni dans la branche
  `--stdio` de `index.ts` : les journaux vont sur stderr.
- **Reprise idempotente** : `findOrCreate` retrouve une session par hash du **titre et des questions** (pas du titre
  seul), tant qu'elle est en attente ou que ses réponses n'ont pas été livrées (`delivered_at`). Changer le titre ou
  reformuler une question crée une nouvelle session.
- **Édition par l'agent** : `update_questions` remplace les questions d'une session en attente (`SessionStore.updateQuestions`),
  recalcule le hash et incrémente `revision`. L'UI sonde la session toutes les 5 s et se met à jour si `revision` change.
- **Attente** : `ask_user` et `get_answers` attendent jusqu'à `wait_seconds` (défaut `AQ_WAIT_SECONDS`, 480 s), puis
  répondent `pending` avec le `session_id`. L'agent n'est pas prévenu d'une réponse tardive : c'est à l'utilisateur de
  lui dire de rappeler `get_answers` (documenté dans le README).
- **Le SDK envoie déjà un `: keepalive` SSE** toutes les 15 s sur les connexions `/mcp` : inutile d'en ajouter.

## Les descriptions d'outils sont des prompts

Les descriptions de `ask_user` / `get_answers`, celle du paramètre `wait_seconds` et le message `pending` sont lus par
les modèles : les modifier change le comportement des agents. Deux leçons déjà apprises :

- Un modèle qui passe `wait_seconds: 0` reçoit `pending` aussitôt et rend la main : la description du paramètre dit
  de ne pas le renseigner. Si le problème revient, envisager un plancher côté serveur (`AQ_MIN_WAIT_SECONDS`).
- Quand `AQ_NO_OPEN=1` (Docker), `relayHint` dans `mcp.ts` demande à l'agent de donner l'adresse de l'UI **avant** un
  appel unique à `ask_user`. Ne pas y remettre l'enchaînement `wait_seconds: 0` puis `get_answers`, qui poussait les
  modèles à faire deux appels.

## Sécurité

Pas d'authentification : le serveur écoute sur `127.0.0.1` et ne doit pas être exposé tel quel.

- Le hook `onRequest` de `http.ts` vérifie `Host` et `Origin` (DNS rebinding). Les origines supplémentaires se déclarent
  par `AQ_ALLOWED_ORIGINS`, **jamais `*`**.
- La route `/mcp` fait `reply.hijack()` : les en-têtes CORS sont donc posés sur `reply.raw`, pas avec `reply.header()`.
- Le contenu markdown vient d'un agent : l'UI le passe par `marked` puis par le nettoyage d'Angular (`[innerHTML]`).
  Ne pas contourner avec `bypassSecurityTrust…`.

## Règles et conventions

- Textes de l'UI, commentaires et README en **français** ; identifiants et descriptions d'outils MCP en anglais
  (ils sont lus par les modèles). Les messages de commit existants sont en anglais.
- Style imposé par Prettier (`.prettierrc` à la racine) : tabulations, guillemets doubles, virgules finales, 120
  colonnes, un attribut par ligne dans les templates. YAML en 2 espaces (override). Ne pas formater à la main.
- `any` interdit (`@typescript-eslint/no-explicit-any`) ; composants Angular en `OnPush`.
- Les types partagés vivent dans `packages/shared/` : ne pas les redéclarer côté UI ou serveur. Après un changement dans
  `packages/shared/`, `npm run build -w @agent-questions/shared` (les tests serveur lisent ses sources, mais `tsc`, `ng` et `node` lisent `dist`).
- Après un changement de comportement visible (variable `AQ_*`, outil, flux), mettre le README à jour.

### Règles de travail

Détail dans `.claude/rules/git-workflow.md`.

- **Avant chaque commit** : rejouer `npm run lint`, `npm run format:check`, `npm run build` et `npm test`, et donner le
  résultat. Pas de commit si l'un échoue.
- **Jamais de `git push` sans accord explicite**, demandé dans une question distincte après le commit.
- Ne jamais commiter `.mcp.json` (modification locale de l'utilisateur).
- Modifier les fichiers avec l'outil Edit, pas avec `sed`.

## Vérifier

Serveur HTTP lancé (`npm start`), initialisation MCP puis appel d'outil :

```bash
curl -s -X POST http://127.0.0.1:4317/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Pour répondre sans navigateur : `POST /api/sessions/<id>/answers` avec `{"<question_id>":{"selected":["<option_id>"],"text":""}}`.
Un appel `ask_user` avec `wait_seconds` positif doit se terminer dès que cette requête est envoyée.

Le mode stdio se teste en lançant `node packages/server/dist/index.js --stdio` avec un client qui envoie du JSON-RPC ligne par
ligne : vérifier le démarrage automatique du serveur, le réveil de l'attente par l'API de l'UI, l'annulation, et que
stdout ne contient que du JSON-RPC. Jusqu'ici ce mode n'a été validé que sous Linux, avec un client simulé.

## Docker

`Dockerfile` : build de l'UI et du serveur, image d'exécution avec `AQ_BIND_HOST=0.0.0.0`, `AQ_NO_OPEN=1`,
`AQ_DATA_DIR=/data`. `docker-compose.yml` contient `agent-questions` et un service `llama` (llama.cpp, essai avec un
modèle local) qui n'est **pas nécessaire** pour Claude Code. Pour le serveur seul :
`docker compose up -d --build agent-questions`.

Piège d'environnement : le port est publié sur le `127.0.0.1` de la machine qui fait tourner Docker. Un client sur une
autre machine (Windows vers une VM Linux, par exemple) ne le voit pas sans tunnel SSH.

## État et pistes

Fait : serveur HTTP, UI, mode stdio, flux à appel unique, journal des attentes (`[mcp] session … : answered après Ns`,
avec « appel interrompu par le client » si la connexion a été coupée), CORS pour l'interface de llama-server.

À valider ou à décider :

- Tester le mode stdio avec un vrai Claude Code, sous Windows (démarrage du processus détaché) et sous Linux.
- Délai d'attente des outils côté clients (Claude Code, Codex : `tool_timeout_sec`, à vérifier dans leur doc) face à
  `AQ_WAIT_SECONDS` = 480 s.
- `get_answers` est redondant avec `ask_user` + `session_id`. Le supprimer simplifierait l'interface mais casserait les
  consignes déjà écrites pour les agents.
- Pas de nettoyage automatique des anciennes sessions ; pas de test de bout en bout dans un navigateur, ni du mode
  `--stdio`.
