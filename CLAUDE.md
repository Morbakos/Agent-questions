# CLAUDE.md

Agent Questions : un serveur MCP + une UI web pour poser à l'utilisateur des questions longues ou complexes
(markdown, code, nombreuses options). L'agent appelle `ask_user`, l'utilisateur répond dans un formulaire, la réponse
revient dans l'appel d'outil. Le README décrit l'usage ; ce fichier décrit comment travailler sur le code.

## Stack et structure

Monorepo npm (workspaces `server` et `ui`), Node ≥ 22.13, TypeScript strict.

- `server/` : Fastify 5, SDK MCP (`@modelcontextprotocol/sdk`), zod 3, SQLite via `node:sqlite` (intégré, pas de
  dépendance native). ESM `NodeNext` : les imports relatifs portent l'extension `.js`.
  - `src/index.ts` : point d'entrée. Sans option, démarre le serveur HTTP. Avec `--stdio`, lance le relais.
  - `src/http.ts` : Fastify. API de l'UI (`/api/sessions…`), endpoint MCP `POST /mcp`, UI statique, `/health`.
  - `src/mcp.ts` : les outils MCP `ask_user` et `get_answers`.
  - `src/sessions.ts` : `SessionStore` (SQLite + attente des réponses).
  - `src/stdio.ts` : mode stdio (relais, voir plus bas).
  - `src/schema.ts` : schémas zod des questions et réponses, validation des réponses.
  - `src/config.ts` : variables d'environnement `AQ_*`. `src/open.ts` : ouverture du navigateur.
- `ui/` : Angular 21.1, composants standalone, signals, rendu markdown avec `marked`. Routes : `/` (liste des questions
  en attente, rafraîchie toutes les 5 s) et `/s/:id` (formulaire d'une session). Styles globaux dans `src/styles.css`.

## Commandes

```bash
npm install --legacy-peer-deps   # sans le flag, npm 10.9 plante (« edgesOut ») sur les peers d'Angular 21
npm run build              # UI puis serveur (l'UI est lente à compiler)
npm run build -w server    # serveur seul : sert aussi de vérification de types
npm start                  # serveur sur http://127.0.0.1:4317 (UI incluse si construite)
npm run dev:ui             # ng serve sur :4200, proxy /api vers :4317
```

`npm run dev:server` utilise la syntaxe `AQ_DEV=1 …` de bash : sous PowerShell, faire
`$env:AQ_DEV="1"; npm run dev -w server`.

**Il n'y a ni tests automatisés ni script de lint.** Après une modification du serveur, au minimum
`npm run build -w server`, puis un essai réel (voir « Vérifier »).

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

## Conventions

- Textes de l'UI, commentaires et README en **français** ; identifiants et descriptions d'outils MCP en anglais
  (ils sont lus par les modèles). Les messages de commit existants sont en anglais.
- Serveur : guillemets doubles, virgules finales. UI : guillemets simples. Indentation de 2 espaces.
- `ui/src/app/models.ts` **duplique** les types de `server/src/schema.ts` : à modifier ensemble, à la main.
- Après un changement de comportement visible (variable `AQ_*`, outil, flux), mettre le README à jour.

## Vérifier

Serveur HTTP lancé (`npm start`), initialisation MCP puis appel d'outil :

```bash
curl -s -X POST http://127.0.0.1:4317/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Pour répondre sans navigateur : `POST /api/sessions/<id>/answers` avec `{"<question_id>":{"selected":["<option_id>"],"text":""}}`.
Un appel `ask_user` avec `wait_seconds` positif doit se terminer dès que cette requête est envoyée.

Le mode stdio se teste en lançant `node server/dist/index.js --stdio` avec un client qui envoie du JSON-RPC ligne par
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
- Pas de nettoyage automatique des anciennes sessions ; pas de tests automatisés.
- `docker-compose.yml.bak` est versionné et peut être supprimé. `mcpo.json` n'est plus utilisé par le compose actuel
  (reste de l'ancien montage Open WebUI + mcpo, décrit dans le README).
- Le textarea « Autre » de `question.ts` porte un attribut `type="text"` sans effet.
