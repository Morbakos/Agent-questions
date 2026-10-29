# Agent Questions

Un serveur MCP + une UI Angular pour poser à l'utilisateur des questions **longues ou complexes**
(contexte en markdown, code, nombreuses options, champs libres), là où l'outil de questions intégré
d'un agent (AskUserQuestion dans Claude Code, `request_user_input` dans Codex…) devient difficile à lire.

```
Agent ──MCP (Streamable HTTP, POST /mcp)──▶ ask_user ──▶ SQLite (sessions, brouillons, réponses)
                                               │                        ▲
                                               ▼                        │
                                    ouvre http://127.0.0.1:4317/s/<id> ─┘  (UI Angular)
```

## Démarrage

Prérequis : Node ≥ 22.13 (SQLite intégré via `node:sqlite`, aucune dépendance native).

```bash
npm install --legacy-peer-deps   # le flag contourne un bug de npm 10.9 avec les peers d'Angular 21
npm run build
npm start            # bundle racine : UI + MCP sur http://127.0.0.1:4317
```

Enregistrer le serveur auprès d'un agent :

```bash
# Claude Code
claude mcp add --transport http agent-questions http://127.0.0.1:4317/mcp
```

Pour les autres agents (Codex, Cursor, VS Code…), déclarez une URL MCP HTTP `http://127.0.0.1:4317/mcp`
selon leur configuration (le nom exact du champ varie, à vérifier dans leur doc).

Pour inciter l'agent à l'utiliser, ajoutez dans `CLAUDE.md` / `AGENTS.md` :

> Pour toute décision qui demande plusieurs questions ou beaucoup de contexte, utilise l'outil MCP
> `ask_user` plutôt que de poser les questions dans le terminal. Si le résultat est `pending`,
> appelle `get_answers` avec le `session_id`, ne repose jamais les mêmes questions. Si l'utilisateur te dit
> qu'il a répondu, appelle `get_answers` avec le `session_id` de la session concernée.

## Claude Code, Codex et autres clients en stdio

Le serveur se lance aussi comme un serveur MCP « classique » (stdio) : le client le démarre lui-même, il n'y a rien à
lancer à la main.

Le paquet racine `@morbakos/agent-questions` est publié sur GitHub Packages. GitHub Packages exige une authentification même pour
lire un paquet public : créez un jeton (classic) avec le droit `read:packages`, puis ajoutez dans votre `~/.npmrc` :

```ini
@morbakos:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_votre_jeton
```

```bash
claude mcp add agent-questions -- npx -y @morbakos/agent-questions --stdio
```

Codex (`~/.codex/config.toml`) :

```toml
[mcp_servers.agent-questions]
command = "npx"
args = ["-y", "@morbakos/agent-questions", "--stdio"]
```

Depuis un clone du dépôt, remplacez la commande par `node /chemin/absolu/dist/index.js --stdio`
(après `npm install --legacy-peer-deps && npm run build`).

Le mode `--stdio` ne contient aucune logique : il vérifie qu'un serveur HTTP répond sur `AQ_PORT` (4317 par défaut),
le démarre sinon (processus détaché, journal dans `<AQ_DATA_DIR>/daemon.log`), puis relaie les messages MCP vers
`/mcp`. L'UI, la base SQLite et l'attente des réponses restent dans ce serveur unique, ce qui a trois conséquences :

- plusieurs agents partagent la même UI et les mêmes sessions (pas de conflit de port) ;
- les questions en attente survivent à la fermeture de l'agent ;
- le serveur HTTP n'est pas arrêté avec l'agent : arrêtez-le avec `kill` quand vous n'en avez plus besoin.

Les variables `AQ_*` du processus stdio sont transmises au serveur qu'il démarre. Un serveur déjà lancé (à la main ou
par un autre agent) est réutilisé tel quel, avec sa propre configuration. Pour un client qui parle HTTP, le mode
précédent reste valable : `claude mcp add --transport http agent-questions http://127.0.0.1:4317/mcp`.

`ask_user` attend jusqu'à `AQ_WAIT_SECONDS` (480 s). Si votre client coupe les appels longs plus tôt, baissez cette
valeur ou réglez son délai d'attente des outils (Codex : voir `tool_timeout_sec`, à vérifier dans la documentation de
votre version).

### Si l'appel expire (timeout)

Quand l'attente s'arrête avant que vous ayez répondu (`AQ_WAIT_SECONDS` écoulé, ou appel coupé par le client),
l'agent reçoit `pending` ou une erreur de délai, et rien ne l'avertit que vous répondrez plus tard.

**Vos réponses ne sont pas perdues** : elles sont enregistrées dans la base, avec votre brouillon, même si plus aucun
appel n'est en cours. En revanche, **c'est à vous de demander à l'agent de les récupérer** : écrivez-lui par exemple
« j'ai répondu, récupère mes réponses ». Il appelle alors `get_answers` avec le `session_id`.

Les sessions passées (répondues ou refusées) restent consultables : la page d'accueil de l'UI les liste sous
« Historique », 50 par page (« Charger plus »), et un clic affiche les questions avec vos réponses ou votre motif de
refus, en lecture seule.

Si l'agent a perdu ce `session_id` (appel coupé avant de l'avoir reçu, nouvelle conversation) :

- le `session_id` est dans l'URL de la page du formulaire : `http://127.0.0.1:4317/s/<session_id>` (la même page
  s'ouvre depuis l'historique). Vous pouvez le lui donner ;
- ou demandez-lui de rappeler `ask_user` avec **exactement le même titre et les mêmes questions** : le serveur
  retrouve la session existante (voir « Reprise idempotente ») et renvoie vos réponses au lieu d'en créer une
  nouvelle. Si l'agent change le titre ou reformule une question, le serveur ouvre une nouvelle session vide.

## Docker et Open WebUI

```bash
docker compose up -d --build agent-questions
```

Ou l'image publiée sur GitHub Container Registry (la base SQLite est dans le volume `/data`) :

```bash
docker run -d --name agent-questions -p 127.0.0.1:4317:4317 -v aq-data:/data ghcr.io/morbakos/agent-questions:latest
claude mcp add --transport http agent-questions http://127.0.0.1:4317/mcp
```

Pour un autre port côté hôte, passez-le aussi au serveur (`-e AQ_PORT=4318 -p 127.0.0.1:4318:4318`) : le serveur
refuse les requêtes dont l'en-tête `Host` ne correspond pas à son port (`Host non autorisé`).

- Open WebUI (v0.6.31 et plus récent d'après sa documentation) se connecte directement à un serveur MCP
  Streamable HTTP : URL `http://agent-questions:4317/mcp`. Les conteneurs doivent partager un réseau Docker.
- Dans Docker, le navigateur ne s'ouvre pas tout seul (`AQ_NO_OPEN=1`). La description de l'outil demande à l'agent
  de vous donner l'adresse de l'UI (`AQ_PUBLIC_URL`) **avant** d'appeler `ask_user`, puis de faire un seul appel qui
  attend la réponse. Ouvrez cette adresse et laissez-la ouverte : la liste des questions en attente se rafraîchit
  toute seule (toutes les 5 s), et la question y apparaît dès que l'agent l'envoie.
- Si votre interface n'affiche rien pendant qu'un outil attend (cas de certains clients de modèles locaux),
  demandez à l'agent d'appeler `ask_user` avec `wait_seconds: 0`, de vous donner le lien renvoyé, puis d'appeler
  `get_answers` quand vous avez répondu.
- Variables utiles : `AQ_BIND_HOST` (0.0.0.0 dans l'image), `AQ_ALLOWED_HOSTS` (noms Host acceptés, ex. `agent-questions`),
  `AQ_PUBLIC_URL` (URL ouverte par votre navigateur).

## llama.cpp (interface web de llama-server)

L'interface de `llama-server` est un client MCP qui s'exécute dans le navigateur : elle appelle donc directement
`http://127.0.0.1:4317/mcp` (transport Streamable HTTP, sans authentification).

- Lancez `llama-server` avec `--jinja` (requis pour l'appel d'outils).
- Le navigateur envoie un en-tête `Origin` : autorisez-le, par exemple
  `AQ_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080`. Le serveur répond alors aux requêtes de
  pré-vérification CORS (`OPTIONS /mcp`) pour ces origines uniquement.
- Quand `AQ_NO_OPEN=1` (cas de l'image Docker), la description de l'outil demande à l'agent de communiquer l'adresse
  de l'UI avant l'appel (voir « Docker » ci-dessus). Le formulaire se remplit sur `AQ_PUBLIC_URL`, pas dans le chat.

## Développement

```bash
npm run dev:server   # serveur avec rechargement, accepte l'origine localhost:4200
npm run dev:ui       # ng serve sur :4200, proxy /api vers :4317
npm test             # tests du serveur et de shared (Vitest), puis de l'UI (ng test)
npm run lint         # ESLint
npm run format       # Prettier (format:check pour vérifier seulement)
```

Le dépôt est un monorepo : `packages/shared/` (types et schémas communs), `packages/server/` (MCP, API, SQLite) et `packages/ui/` (Angular). Chaque workspace conserve ses scripts et dépendances ; `npm run build` orchestre leurs builds puis génère le bundle distribuable `dist/index.js` et l'UI dans `dist/ui/` à la racine. Le paquet publié sur GitHub Packages est le paquet racine `@morbakos/agent-questions`.
Les conventions et la marche à suivre pour ajouter un outil MCP sont dans `CLAUDE.md`.

## Outils MCP

**`ask_user`** : `{ title?, questions[], session_id?, wait_seconds? }`

Une question : `{ id, header?, prompt, context_markdown?, type: "single" | "multi" | "text", options?[], allow_other?, required?, placeholder? }`
(`prompt` et `context_markdown` sont en markdown). Une option : `{ id, label, description?, recommended? }` ; une option
`recommended` s'affiche avec un badge « Recommandé » (elle n'est pas présélectionnée).

Résultat : `{ status: "answered" | "declined" | "pending", session_id, answers[] | url }`.

**`get_answers`** : `{ session_id, wait_seconds? }` : attend ou récupère les réponses d'une session.

**`update_questions`** : `{ session_id, questions[], title?, wait_seconds? }` : remplace les questions d'une session
que l'utilisateur n'a pas encore clôturée (liste complète, pas un diff), puis attend les réponses comme `ask_user`.
Le formulaire ouvert se met à jour tout seul (sous 5 s) et le brouillon est conservé pour les questions dont l'`id`
est inchangé. Refusé si la session est déjà répondue ou refusée.

## Choix de conception

- **Reprise idempotente** : un même jeu de questions (hash du titre et du contenu) retrouve la session en cours, ou une
  session répondue dont l'agent n'a pas encore reçu les réponses. L'agent ne repose donc pas deux fois les mêmes
  questions si l'utilisateur ferme la page, ou si la connexion saute. Une fois les réponses livrées, le même
  jeu de questions crée une nouvelle session.
- **Brouillons** : chaque modification est enregistrée en base (600 ms de debounce).
- **Attente** : l'appel d'outil reste ouvert (réponse en JSON ou SSE, selon le transport) et se termine quand l'utilisateur
  envoie ses réponses. Au bout de `AQ_WAIT_SECONDS` (480 par défaut), il répond `pending` avec le `session_id`.
  Des notifications de progression sont envoyées toutes les 15 s si le client fournit un `progressToken`.
  Passé ce délai, l'agent n'est pas prévenu d'une réponse tardive : l'utilisateur doit lui demander de récupérer
  les réponses (voir « Si l'appel expire »).
- **Serveur MCP sans état** : pas de `Mcp-Session-Id`, un serveur MCP par requête. Les sessions de questions ont leur propre
  identifiant en base, indépendant du transport.
- **Sécurité locale** : écoute sur `127.0.0.1` uniquement, vérification des en-têtes `Host` et `Origin`
  (DNS rebinding). Pas d'authentification : ne l'exposez pas hors de votre machine sans en ajouter une.
- **Markdown** : rendu avec `marked`, puis nettoyé par Angular (`[innerHTML]`) car le contenu vient d'un agent.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `AQ_PORT` | `4317` | Port HTTP |
| `AQ_DATA_DIR` | `~/.agent-questions` | Dossier de la base SQLite |
| `AQ_WAIT_SECONDS` | `480` | Attente max avant de répondre `pending` |
| `AQ_NO_OPEN` | | `1` pour ne pas ouvrir le navigateur |
| `AQ_BIND_HOST` | `127.0.0.1` | Adresse d'écoute (`0.0.0.0` dans Docker) |
| `AQ_ALLOWED_HOSTS` | | Noms d'hôte supplémentaires acceptés (séparés par des virgules) |
| `AQ_ALLOWED_ORIGINS` | | Origines `http://hôte:port` supplémentaires autorisées à appeler `/mcp` depuis un navigateur (séparées par des virgules), ex. l'interface de llama-server. Jamais `*` : le serveur n'a pas d'authentification |
| `AQ_PUBLIC_URL` | `http://127.0.0.1:<port>` | URL de l'UI vue par le navigateur |
| `AQ_UI_DIR` | `dist/ui` du paquet (ou `packages/ui/dist/ui/browser` dans le dépôt) | Dossier de l'UI construite |
| `AQ_DEV` | | `1` pour accepter l'origine du `ng serve` |

## Limites connues

- Pas de test de bout en bout dans un navigateur, ni du mode `--stdio`.
- Pas de nettoyage automatique des anciennes sessions.
- Si le client MCP coupe les appels longs avant `AQ_WAIT_SECONDS`, baissez cette valeur ou réglez le timeout côté client.
- Après un timeout, l'agent ne sait pas que vous avez répondu : demandez-lui de récupérer les réponses
  (`get_answers` avec le `session_id`, présent dans l'URL du formulaire).

## Publication

Le seul paquet publié est `@morbakos/agent-questions` (`packages/server`) : `dist/index.js` est un bundle esbuild qui
inline `@agent-questions/shared`, et l'UI construite est copiée dans `dist/ui`. Les autres paquets restent privés.

```bash
npm run build                                   # shared, UI puis bundle du serveur
npm pack --dry-run -w @morbakos/agent-questions # vérifier le contenu du tarball
npm login --registry=https://npm.pkg.github.com # jeton avec le droit write:packages
npm publish -w @morbakos/agent-questions
```

`prepublishOnly` reconstruit le bundle et refuse de publier si l'UI n'est pas construite. Incrémentez `version` dans
`packages/server/package.json` avant chaque publication.

## Licence

[MIT](LICENSE)
