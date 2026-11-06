# CLAUDE.md

Agent Questions : un serveur MCP + une UI web pour poser à l'utilisateur des questions longues ou complexes
(markdown, code, nombreuses options). L'agent appelle `ask_user`, l'utilisateur répond dans un formulaire, la réponse
revient dans l'appel d'outil. Le README décrit l'usage ; ce fichier décrit comment travailler sur le code.

## Stack et structure

Monorepo **Bun** (workspaces `packages/shared`, `packages/server`, `packages/ui` ; les scripts de la racine appellent
directement `ng`, `tsc`, `vitest` et `bun`), TypeScript strict. Le serveur s'exécute sur Node ≥ 22.13 **ou** Bun ≥ 1.4
(tous deux fournissent `node:sqlite` : ne pas utiliser `bun:sqlite`, qui casserait Node, `npx` et Vitest). L'image Docker
tourne sur Bun. Ordre de build : `ui` → `server`.

- `packages/shared/` : **source unique des types** entre serveur et UI (`schema.ts` : schémas zod 4 ; `answers.ts` : logique
  pure sans zod ; `views.ts` : contrat de l'API de l'UI). **Livré en TypeScript, sans étape de build** (`exports` pointe sur
  `src/index.ts`). L'UI n'y importe à l'exécution que `answers.ts` (`sideEffects: false` : zod n'entre pas dans le bundle).
- `packages/server/` (privé) : NestJS 12 sur Fastify, MCP via `@nestjs/mcp` (SDK `@modelcontextprotocol/server` v2),
  **MikroORM 7** sur SQLite via `node:sqlite` (`NodeSqliteDialect` : aucune dépendance native, ne pas passer à un driver
  natif). Entités à **décorateurs legacy** avec **types déclarés explicitement** (`@Property({ type: "string" })`) : Bun et
  esbuild n'émettent pas `emitDecoratorMetadata`, donc toutes les injections sont aussi **explicites** (`@Inject(Classe)`).
    - **Imports** : ESM `NodeNext`, extension `.js`, et alias `@app/…` (`src/app/…`) et `@server/…` (`src/…`) plutôt que des
      chemins relatifs (seul le même dossier reste relatif). Alias déclarés à **trois endroits à garder alignés** : `paths` de
      `packages/server/tsconfig.json`, `alias` de `packages/server/vitest.alias.ts`, garde de `scripts/build-server.ts`.
    - **Persistance** : uniquement par des repositories asynchrones (classe abstraite = jeton d'injection, implémentation
      `Mikro…Repository` avec un `EntityManager` forké par opération), branchés dans `CoreModule.register()`. Les services
      portent les règles métier et ne touchent jamais l'ORM. Chaque méthode d'un repository de sessions prend le
      **propriétaire** en premier argument et filtre dessus (la session d'un autre est introuvable) ; seules exceptions, en
      lecture seule : `findAnyById` et `listAll` (supervision admin). `findOrCreate` est atomique.
    - **Couches** par domaine dans `src/app/` : `domain/` (types purs), `persistence/` (contrat + implémentation Mikro,
      `entities/` une entité par fichier), `api/` (contrôleurs, gardes, décorateurs). Une couche n'importe que des couches plus
      pures ; services et `api` n'importent que le **contrat** de `persistence`, jamais `mikro-*` ni les entités (sauf
      `core.module.ts`, `storage/orm.ts` et les tests).
    - `core/` : `core.module.ts` (config, base, repositories, `UiHub`, globalement).
    - `config/` : `config.ts` (`loadConfig`, variables `AQ_*` validées au démarrage), `app.config.ts` (espace de noms
      `@nestjs/config` par lequel la config est injectée).
    - `http/` : `http-setup.ts` (garde Host/Origin, `no-store`, journal des requêtes), `security-headers.ts`, `allowed.ts`,
      `http-error*.ts`, `cursor.ts`, `log-levels.ts` (`AQ_LOG` → niveaux du `Logger` Nest). **L'UI est servie par
      `@nestjs/serve-static`** (`fallthrough: true`, `index.html` pour les routes d'Angular). Son chargeur Fastify **ignore
      `exclude`** : `unknown-route.controller.ts` répond donc 404 JSON sous `/api`, `/auth`, `/mcp/*` et `/.well-known`
      (`@Public()`) : sans cela un client MCP qui sonde la découverte OAuth recevrait la page de l'UI ou un 401 et échouerait.
      Jokers `*` simples, pas `*path` (Fastify). **Un seul journal** : le `Logger` de Nest ; Fastify a `logger: false`.
      Requêtes journalisées en `debug`, sans `/health`.
    - `storage/` : `orm.ts` (`ormOptions`, `prepareDatabase` : PRAGMA WAL puis migrations, `createOrm` pour les tests),
      `storage-bootstrap.ts` (`prepareDatabase` dans `onModuleInit` ; **tout accès à la base au démarrage va dans
      `onApplicationBootstrap`**), `migrations/` (listées explicitement dans `orm.ts` : le bundle n'a pas de découverte de
      fichiers ; **une évolution du schéma = une nouvelle migration**, jamais une migration publiée modifiée). Le dialecte n'a
      qu'**une** connexion : `wal_checkpoint(TRUNCATE)` est fait avant l'ouverture (`flushWal`).
    - `sessions/` : `sessions.controller.ts` (API de l'UI), `admin-sessions.controller.ts` (un admin **voit** toutes les
      sessions en lecture seule, chaque lecture est journalisée), `sessions.service.ts` (règles métier + attente des réponses).
    - `events/` : flux SSE `GET /api/events` (`@Sse()`), `ui-hub.ts` (diffusion aux onglets, maintien toutes les 15 s,
      fermeture sur `sign-out` / désactivation / expiration, rejeu de l'annonce récente).
    - `mcp/` : `McpModule.forRoot` de `@nestjs/mcp` (la route `/mcp` est un contrôleur comme un autre : le garde global
      l'authentifie ; `decorators` n'y accepte que les jetons d'API et le profil local). `api/question-tools.ts` : méthodes
      `@Tool` de `QuestionTools`, dont les descriptions dépendent de la config lue à l'évaluation des décorateurs
      (`getRuntimeConfig()`). **`question-tools.ts` ne s'importe jamais statiquement** : `QuestionsMcpModule.register(config)`
      pose la config puis fait `await import(...)`. Les descriptions sont donc figées par processus (et par fichier de test).
      Aussi `relay-hint.ts`, `open.ts` (ouverture du navigateur), `mcp-error-result.ts`.
    - `auth/` : fondé sur **`@nestjs/authentication`** (**épinglé en 0.1.4** comme `@nestjs/mcp` : 0.x, l'API peut casser ;
      relire le changelog avant de monter). Son garde global protège toute route sauf `@Public()` ; l'utilisateur
      (`Principal`) est sur `request.user` (`@CurrentUser()` / `@CurrentPrincipal()`), jamais lu du corps ni d'un en-tête.
      Trois fournisseurs (`providers/`, selon le profil) : `SessionAuth` (cookie, server), `ApiKeyAuth` (jeton
      `aq_<id>_<secret>`, server), `LocalAuth` (utilisateur fixe, local). **Un jeton d'API n'ouvre que `/mcp`** (`decorators`
      du module MCP) ; tout contrôleur de l'UI porte `@SessionOnly()` : **un nouveau contrôleur doit le porter** (une liste
      écrite à la main dans `auth.e2e-spec.ts` énumère les routes : l'y ajouter). `@Roles("admin")` réserve une route aux admins (isolation assurée par le filtrage des
      repositories, pas de `@nestjs/authorization`). Sessions : `SignInService`, cookie `__Host-sid` (`sid` en HTTP hors
      localhost), `mikro-auth-session.store.ts` (vérifié par `authenticationStoreContract()`). **CSRF** :
      `app.enableCsrfProtection({ trustedOrigins })` (`Sec-Fetch-Site` / `Origin`, un client sans navigateur passe).
      Mots de passe : `PasswordHasher` du paquet. `auth-events.bridge.ts` ferme les flux SSE sur `sign-out`. Reste à nous :
      comptes, invitations (liens à usage unique hachés SHA-256, `tokens.ts`), `login-throttle.ts`, `accounts.service.ts`
      (jetons valables un an). Le propriétaire d'un appel d'outil est `context.request.user`. Les refus 401/403 sont
      journalisés par `http-setup.ts` (méthode et chemin, jamais de secret).
    - `health/` : `/health` (`@nestjs/terminus` : 200, ou 503 si la base ne répond pas ou pendant l'arrêt).
    - `stdio/` : lanceur `agent-questions --stdio` (sous-commande de `main.ts`, branchée **avant** `loadConfig()`).
      `probe.ts` (`/health`, cible `AQ_MCP_URL` ou `AQ_PORT`), `launcher-lock.ts` (`<dataDir>/launcher.lock`, `wx`,
      périmé après 30 s), `spawn-server.ts` (démarre ce même bundle sans `--stdio`, détaché, journal
      `<dataDir>/server.log` ; ne le tue jamais), `bridge.ts` (relais JSON-RPC `StdioServerTransport` ↔
      `StreamableHTTPClientTransport`, `AQ_TOKEN` en `Bearer`), `run-stdio.ts` (renvoie le code de sortie).
      **Stdout est réservé au protocole** : rien d'autre ne doit y écrire dans ce chemin. Le serveur lancé reste le
      serveur unique partagé.
    - `src/main.ts` : point d'entrée.
    - **Build** : `scripts/build-server.ts` (Bun.build) bundle `main.ts` en `dist/index.js` (`shared` inliné, `dependencies`
      de la racine externes) et copie l'UI dans `dist/ui` (échoue si l'UI n'est pas construite). Bundle **minifié sans mangling des identifiants**
      (Nest et MikroORM tirent des noms des classes) et **sans sourcemap** ; la version vient du `package.json` racine,
      injectée par `define` (`__APP_VERSION__`, lue par `src/app/version.ts`, `0.0.0-dev` hors build). **Le paquet publié est le
      paquet racine** `@morbakos/agent-questions` (GitHub Packages) : **chaque dépendance d'exécution de `packages/server` doit
      figurer à la racine avec la même plage** (`scripts/check-deps.ts`, lancé par `build:server`). Publier : voir le README.
- `packages/ui/` : Angular 21.1, composants standalone, signals, `OnPush`, SCSS, markdown avec `marked`.
    - `src/app/core/` (`api.ts`, `app.config.ts`, `live.ts`), `src/app/shared/` (`markdown.pipe.ts`),
      `src/app/features/home/` (liste en attente rafraîchie toutes les 5 s, historique paginé par curseur `before`, 50 par
      page), `src/app/features/session/` (`session.ts`, `question.ts`, `session-state.ts` : état, brouillon, sondage ; une
      session clôturée s'ouvre en lecture seule). Routes chargées à la demande (`loadComponent`).
    - Styles : `src/styles.scss` ne fait que `@use` les partiels de `src/styles/` ; le reste vit dans le `.scss` du
      composant. Le markdown injecté par `[innerHTML]` échappe aux styles encapsulés : ses règles (`.md`) restent globales.

### Ajouter un outil MCP

1. Ajouter une méthode `@Tool({ name, description, inputSchema })` à `QuestionTools` (voir `getAnswers`, la plus courte).
   Une erreur n'atteint l'agent que si c'est une `HttpException` (`NotFoundException`…, ou une `HttpError` / `AuthError` des
   services, convertie par `HttpErrorFilter` / `AuthErrorFilter`) ; toute autre devient « Internal server error ».
2. Rien à enregistrer : `@nestjs/mcp` découvre les méthodes `@Tool`.
3. Nouveaux champs ou types : dans `packages/shared/src/`.
4. Tests dans `packages/server/test/mcp.e2e-spec.ts` (client MCP en mémoire) ; mettre le README à jour.

### Ajouter une page à l'UI

Créer `packages/ui/src/app/features/<nom>/`, puis une entrée `loadComponent` dans `app.routes.ts`. Les appels HTTP passent par
`core/api.ts`.

## Commandes

```bash
bun install
bun run build              # UI (ng build) puis bundle serveur : dist/index.js + dist/ui
bun run build:server       # typecheck + contrôle des dépendances + bundle (l'UI doit déjà être construite)
bun run start              # dist/index.js sur http://127.0.0.1:4317, UI incluse
bun run dev:server         # nest start --watch --exec bun, AQ_DEV=1 (origine localhost:4200 autorisée)
bun run dev:ui             # ng serve sur :4200, proxy /api vers :4317
bun run typecheck          # tsc --noEmit sur shared et server
bun run test               # serveur et shared (Vitest), puis UI (ng test)
bun run test:server        # serveur et shared seulement (rapide)
bun run test:e2e           # Playwright ; exige `bun run build` et Chromium
bun run verify:built       # après `build` : empaquette et démarre le paquet sur Node et Bun (comme la CI)
bun run lint               # ESLint
bun run format             # Prettier (format:check pour vérifier sans écrire)
```

Bun est le seul gestionnaire de paquets ; Node reste le runtime des tests Vitest et d'Angular.
`scripts/verify-package.ts <tarball> [node|bun]` vérifie le paquet publié sur les deux runtimes.

## Tests

- Serveur : Vitest, conventions Nest. `bun run test:server` lance les deux familles ; `shared` : `vitest.config.ts` racine.
    - **Unitaires** : `src/**/*.spec.ts` à côté du code, sujet obtenu par `Test.createTestingModule(...).compile()`,
      `overrideProvider` pour remplacer une dépendance. Repositories et services sur base en mémoire.
    - **E2E** : `packages/server/test/*.e2e-spec.ts` (`bun run --cwd packages/server test:e2e` ; à ne pas confondre avec
      `bun run test:e2e` de la racine, qui est Playwright). Application complète par `createTestApplication({ config })`
      (`src/test-helpers.ts`, mêmes réglages que `main.ts`). Elle n'est pas initialisée : `await app.init()`, puis
      `await app.getHttpAdapter().getInstance().ready()` avant `app.inject(...)`, et `await app.close()` après. Fichiers :
      `auth`, `http`, `hardening` (en-têtes, CORS, 404 JSON, journaux), `mcp` (client en mémoire, sans réseau).
    - `test-helpers.ts` : `testConfig()` force `noOpen: true`, **ne jamais le désactiver** (le navigateur s'ouvrirait) ;
      base `:memory:` par défaut, un fichier temporaire pour ce qui touche aux PRAGMA (pas de WAL en mémoire) ;
      `memoryOrm()` pour un test hors application.
- UI : `ng test` (Vitest + jsdom). Doubles et fixtures dans `packages/ui/src/testing/`. Avec des faux timers,
  `fixture.whenStable()` peut ne jamais se résoudre : utiliser `fixture.detectChanges()` après `vi.advanceTimersByTimeAsync`.
- **E2E navigateur** (`e2e/`, Playwright + Chromium) : lance le serveur **construit** sur un port libre avec une base
  temporaire. `harness.ts` (`startServer`, `callTool`), `local.spec.ts` (profil local), `server.spec.ts` (profil server :
  connexion, invitation, isolation, supervision, jetons limités à `/mcp`), `inspector.spec.ts` (CLI de
  `@modelcontextprotocol/inspector` : un client MCP tiers contre `/mcp`). Premier lancement : `bunx playwright install chromium`.
- Après une modification : `bun run lint`, `bun run format:check`, `bun run build`, `bun run test`, puis un essai réel
  (voir « Vérifier »). Après un changement de dépendance ou d'import, ajouter `bun run verify:built` : le bundle se
  compile même quand le démarrage échoue (export introuvable, par exemple).

## Architecture : le point à ne pas casser

Tout vit dans **un seul processus HTTP** (UI, API, base, `/mcp`), toujours lancé : tous les agents s'y connectent (Docker
avec `restart: unless-stopped`, ou `npx`) ; un jeton d'API passe par l'en-tête `Authorization` de l'entrée HTTP du client.
`SessionsService.wait()` repose sur un `EventEmitter` **en mémoire** : quand l'utilisateur envoie ses réponses via l'API de
l'UI, l'événement réveille l'appel `ask_user` qui attendait. Ne séparez pas l'UI et le handler MCP dans deux processus sans
remplacer l'émetteur (polling SQLite, par exemple).

- **Serveur MCP sans état** : pas de `Mcp-Session-Id`, un `McpServer` et un transport par requête.
- **Reprise idempotente** : `findOrCreate` retrouve une session par hash du **titre et des questions**, tant qu'elle est en
  attente ou que ses réponses n'ont pas été livrées (`delivered_at`). Changer le titre ou une question crée une nouvelle session.
- **Édition par l'agent** : `update_questions` remplace les questions d'une session en attente, recalcule le hash et
  incrémente `revision`. L'UI sonde la session toutes les 5 s et se met à jour si `revision` change.
- **Attente choisie par l'agent** : `ask_user`, `update_questions` et `get_answers` ne bloquent **pas** par défaut
  (`AQ_WAIT_SECONDS` = 0) : ils rendent `pending` avec le `session_id` et l'adresse. L'agent attend avec un `wait_seconds`
  positif (jusqu'à 3600 s). Il n'est pas prévenu d'une réponse tardive : c'est à l'utilisateur de lui dire de rappeler
  `get_answers` (documenté dans le README).
- **Taille de la base** : ~3 Ko par session ; le reste est le WAL, que `createOrm` borne (`wal_autocheckpoint = 100`,
  `journal_size_limit`). **Ne jamais écrire en base dans une route lue en boucle** (l'UI sonde toutes les 5 s) : c'est
  pourquoi `GET /api/sessions/:id` n'écrit plus `last_seen_at`.
- **Un seul onglet, qui suit l'agent sans forcer la main** : l'UI garde un flux SSE `GET /api/events` ; `UiHub` en tient la
  liste. `maybeOpen` n'ouvre le navigateur que si `hub.hasUi` est faux. `ask_user` (session créée) appelle
  `hub.announce(session)` : événement `new-session`, rejoué à l'onglet qui se connecte dans les 10 s. C'est l'UI qui décide
  (`core/live.ts`) : navigation directe si aucun formulaire n'est en cours de saisie, sinon notification « Y aller /
  Ignorer » ; titre préfixé de « (1) » en arrière-plan. Aucun événement sur `update_questions` : la page concernée le voit en
  sondant (`SessionState.pendingUpdate`), **propose** la nouvelle version et suspend l'envoi (`canSubmit`), car le serveur
  valide contre la version à jour. Marche aussi avec `AQ_NO_OPEN=1`.
- **Le SDK envoie déjà un `: keepalive` SSE** toutes les 15 s sur `/mcp` : inutile d'en ajouter.

## Les descriptions d'outils sont des prompts

Les descriptions de `ask_user` / `get_answers`, celle de `wait_seconds` et le message `pending` sont lus par les modèles :
les modifier change le comportement des agents.

- `ask_user` exclut explicitement la validation d'un plan (« NOT for asking the user to approve… ») : les agents s'en
  servaient comme d'un bouton « OK ». Un test en garde la formulation.
- Elle suggère de l'exécuter en tâche de fond, de façon conditionnelle (« if your client can »).
- Par défaut l'appel ne bloque pas : elle dit de poursuivre ce qui ne dépend pas des réponses, d'appeler `get_answers`
  quand il le faut, et de ne passer `wait_seconds` que si l'agent ne peut plus avancer (`waitingAdvice`, qui suit
  `AQ_WAIT_SECONDS`). Risque connu : un modèle qui oublie les réponses ou boucle sur `get_answers` sans `wait_seconds` ;
  le message `pending` redonne la consigne.
- Avec `AQ_NO_OPEN=1` (Docker), `relayHintOf` (aussi envoyé en `instructions` du serveur MCP) demande à l'agent de donner
  l'adresse de la liste **avant** un appel unique à `ask_user`.

## Sécurité

Deux profils. **Local** : pas de compte, écoute sur `127.0.0.1`, à ne pas exposer. **Server** : comptes, mots de passe
(scrypt), cookie de session + CSRF par `Sec-Fetch-Site`, jetons d'API pour MCP, derrière un reverse proxy HTTPS ;
`AQ_TRUST_PROXY` dit combien de proxys croire pour l'adresse du client ; le navigateur du serveur n'est jamais ouvert.

- Les en-têtes de sécurité viennent de `app.useSecurityHeaders()` (`http/security-headers.ts`) avec `useDefaults: false`
  pour la CSP (celle de Nest contient `upgrade-insecure-requests`, qui casserait l'UI en HTTP sur localhost).
  `http-setup.ts` ne pose que `Cache-Control: no-store` sur `/api` et `/auth`. Les journaux masquent le jeton de
  `/auth/invitations/<jeton>`.
- Le hook `onRequest` de `http-setup.ts` vérifie `Host` et `Origin` (DNS rebinding). Origines supplémentaires :
  `AQ_ALLOWED_ORIGINS`, **jamais `*`**.
- Le CORS vient de `app.enableCors()` (origines de `http/allowed.ts`) et s'applique aussi à `/mcp`, bien que `@nestjs/mcp`
  y fasse `reply.hijack()`. Un pré-vol exige `Access-Control-Request-Method`. Les contrôles `allowedOrigins` du module MCP
  sont désactivés : ceux de `http-setup.ts` font foi.
- **CSP et Angular** : l'UI est construite avec `security.autoCsp`, qui publie l'empreinte de son script inline dans une
  balise `<meta>` CSP de `index.html`. `contentSecurityDirectives()` reprend cette politique dans l'en-tête ;
  `scripts/build-server.ts` échoue si `index.html` a du JS inline sans cette balise.
- Le markdown vient d'un agent : `marked` puis le nettoyage d'Angular (`[innerHTML]`). Ne pas contourner avec
  `bypassSecurityTrust…`.

## Règles et conventions

- Textes de l'UI et messages d'erreur renvoyés par l'API en **français** (l'UI les affiche tels quels) ; tout le reste en
  **anglais**, y compris les messages de terminal (erreurs de configuration, bannière de démarrage, stderr du lanceur
  `--stdio`, scripts de build) : documentation
  (README, `docs/`, CONTRIBUTING…), commentaires de code (aucun commentaire français ne doit subsister), descriptions de
  tests (`describe` / `it`), identifiants et descriptions d'outils MCP. Les messages de commit sont en anglais. Ce
  `CLAUDE.md` reste en français.
- Style imposé par Prettier (tabulations, guillemets doubles, 120 colonnes, un attribut par ligne dans les templates).
  Ne pas formater à la main.
- `any` interdit ; composants Angular en `OnPush`.
- **Destructuration systématique** : quand une fonction n'utilise que quelques propriétés d'un objet reçu, les destructurer
  dans la signature (`relayHintOf({ noOpen, baseUrl }: AppConfig)`), y compris pour les valeurs par défaut d'options.
  Exceptions : l'objet est transmis tel quel, ou c'est une dépendance injectée (`this.config`).
- **Un package Nest d'abord (back)** : tout ce qu'un package Nest sait gérer passe par lui, jamais par du code maison.
  Avant d'écrire de l'infrastructure, lire la doc Nest, chercher le package, vérifier sa compatibilité (Nest 12, Fastify 5,
  Bun et Node) ; ne garder du code maison que si aucun ne convient, en le justifiant ici.
  Déjà en place : `@nestjs/serve-static`, `app.useSecurityHeaders()`, `app.enableCors()`, `@nestjs/terminus`, `@Sse()`,
  `@nestjs/authentication`, `@nestjs/mcp`, `@nestjs/config` (injection seulement : `registerAs("app")`,
  `ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true, load })`, `@Inject(appConfig.KEY)` ; aucun `.env`, pas de
  `ConfigService`). **Code maison gardé, et pourquoi** :
    - `loadConfig` (`config/config.ts`) : la config sert avant que Nest existe (adaptateur, niveaux de journal) et à
      l'évaluation des décorateurs `@Tool` ; il est appelé à l'entrée (`main.ts`). **Essayé et écarté** : `validate` de
      `@nestjs/config` comme source : il recopie les clés dans `process.env` (sous Windows `port` écrase `PORT`), une erreur
      levée pendant l'initialisation de Nest n'affiche **rien** avec `AQ_LOG=silent`, et il ne s'applique pas aux objets
      `AppConfig` construits par les tests.
    - Lanceur `stdio/` : outil en ligne de commande, pas du back Nest (aucun package Nest ne couvre un pont stdio ↔ HTTP
      ni le démarrage d'un process détaché). Il s'appuie sur les transports du SDK MCP (`@modelcontextprotocol/client`,
      désormais en `dependencies`).
    - `EventEmitter` de Node dans `SessionsService.wait` plutôt que `@nestjs/event-emitter` : pas d'attente avec délai,
      `AbortSignal` et réveil à l'arrêt (seulement `waitFor`).
    - `LoginThrottle` plutôt que `@nestjs/throttler` : il ne compte pas les seuls échecs, par identifiant et par adresse.
    - Garde Host/Origin, `Cache-Control: no-store` et journal des requêtes dans `http-setup.ts` : aucun package ne les
      fournit (un intercepteur ne voit ni les refus des gardes, ni les réponses `hijack`).
- Les types partagés vivent dans `packages/shared/` : ne pas les redéclarer. Aucune étape de build après un changement.
- Après un changement de comportement visible (variable `AQ_*`, outil, flux), mettre le README et les pages concernées de `docs/` (guide, operations, reference, development) à jour.

### Règles de travail

Détail dans `.claude/rules/git-workflow.md`.

- **Avant chaque commit** : rejouer `bun run lint`, `bun run format:check`, `bun run build` et `bun run test`, et donner le
  résultat. Pas de commit si l'un échoue.
- **Jamais de `git push` sans accord explicite**, demandé dans une question distincte après le commit.
- Ne jamais commiter `.mcp.json` (modification locale de l'utilisateur).
- Modifier les fichiers avec l'outil Edit, pas avec `sed`.

## Vérifier

Serveur lancé (`bun run start`), puis :

```bash
curl -s -X POST http://127.0.0.1:4317/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Pour répondre sans navigateur : `POST /api/sessions/<id>/answers` avec `{"<question_id>":{"selected":["<option_id>"],"text":""}}`.
Un `ask_user` sans `wait_seconds` rend `pending` aussitôt ; avec un `wait_seconds` positif il se termine dès que cette
requête est envoyée.

## Docker

`Dockerfile` : build de l'UI et du serveur, installation du tarball dans l'étape de build, puis image `oven/bun:alpine`
(utilisateur `bun`, uid 1000 ; `HEALTHCHECK` sur `/health`) avec `AQ_BIND_HOST=0.0.0.0`, `AQ_NO_OPEN=1`,
`AQ_DATA_DIR=/data`. `docker-compose.yml` contient `agent-questions` et un service `llama` (essai avec un modèle local),
**non nécessaire** pour Claude Code : `docker compose up -d --build agent-questions`.

Piège : le port est publié sur le `127.0.0.1` de la machine qui fait tourner Docker ; un client sur une autre machine
(Windows vers une VM Linux, par exemple) ne le voit pas sans tunnel SSH.

## Pistes

- Vérifier que les autres clients (Codex, etc.) savent parler MCP HTTP (avec en-têtes pour un jeton).
- Délai d'attente des outils côté clients (`tool_timeout_sec` de Codex…) face à un `wait_seconds` élevé.
- Réponse **poussée** à l'agent plutôt que relevée par `get_answers` : les *channels* de Claude Code sont en research
  preview ; les tasks MCP (`io.modelcontextprotocol/tasks`) ne sont gérées par aucun client.
- `get_answers` est redondant avec `ask_user` + `session_id`, mais le supprimer casserait les consignes déjà écrites.
- Pas de nettoyage automatique des anciennes sessions. Les tests E2E ne couvrent pas Docker (le CI le teste à part).
