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
npm install
npm run build
npm start            # UI + MCP sur http://127.0.0.1:4317
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
> appelle `get_answers` avec le `session_id`, ne repose jamais les mêmes questions.

## Docker, mcpo et Open WebUI

```bash
docker compose up -d --build          # agent-questions + mcpo
```

- Dans Open WebUI, ajoutez un serveur d'outils OpenAPI avec l'URL `http://mcpo:8000/agent-questions`
  (clé : celle passée à `--api-key` dans `docker-compose.yml`). Les conteneurs doivent partager un réseau Docker.
- Open WebUI (v0.6.31 et plus récent d'après sa documentation) sait aussi se connecter directement à un serveur
  MCP Streamable HTTP : URL `http://agent-questions:4317/mcp`, sans mcpo.
- Dans Docker, le navigateur ne s'ouvre pas tout seul : l'agent doit afficher l'URL renvoyée (`pending`).
  Avec un modèle local, demandez-lui d'appeler `ask_user` avec `wait_seconds: 0`, de donner le lien, puis
  d'appeler `get_answers` quand vous avez répondu.
- Variables utiles : `AQ_BIND_HOST` (0.0.0.0 dans l'image), `AQ_ALLOWED_HOSTS` (noms Host acceptés, ex. `agent-questions`),
  `AQ_PUBLIC_URL` (URL ouverte par votre navigateur).

## Développement

```bash
npm run dev:server   # serveur avec rechargement, accepte l'origine localhost:4200
npm run dev:ui       # ng serve sur :4200, proxy /api vers :4317
```

## Outils MCP

**`ask_user`** : `{ title?, questions[], session_id?, wait_seconds? }`

Une question : `{ id, header?, prompt, context_markdown?, type: "single" | "multi" | "text", options?[], allow_other?, required?, placeholder? }`
(`prompt` et `context_markdown` sont en markdown).

Résultat : `{ status: "answered" | "declined" | "pending", session_id, answers[] | url }`.

**`get_answers`** : `{ session_id, wait_seconds? }` : attend ou récupère les réponses d'une session.

## Choix de conception

- **Reprise idempotente** : un même jeu de questions (hash du contenu) retrouve la session en cours, ou une
  session répondue dont l'agent n'a pas encore reçu les réponses. L'agent ne repose donc pas deux fois les mêmes
  questions si l'utilisateur ferme la page, ou si la connexion saute. Une fois les réponses livrées, le même
  jeu de questions crée une nouvelle session.
- **Brouillons** : chaque modification est enregistrée en base (600 ms de debounce).
- **Attente** : l'appel d'outil reste ouvert (réponse en JSON ou SSE, selon le transport) et se termine quand l'utilisateur
  envoie ses réponses. Au bout de `AQ_WAIT_SECONDS` (480 par défaut), il répond `pending` avec le `session_id`.
  Des notifications de progression sont envoyées toutes les 15 s si le client fournit un `progressToken`.
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
| `AQ_PUBLIC_URL` | `http://127.0.0.1:<port>` | URL de l'UI vue par le navigateur |
| `AQ_UI_DIR` | `ui/dist/ui/browser` | Dossier de l'UI construite |
| `AQ_DEV` | | `1` pour accepter l'origine du `ng serve` |

## Limites connues

- Ce squelette n'a pas été compilé ni exécuté à sa création (pas d'accès réseau pour installer les dépendances).
  Le premier `npm install && npm run build` peut révéler de petites erreurs de version ou de typage.
- Les types de l'UI (`ui/src/app/models.ts`) dupliquent ceux du serveur : à synchroniser à la main.
- Pas de nettoyage automatique des anciennes sessions.
- Si le client MCP coupe les appels longs avant `AQ_WAIT_SECONDS`, baissez cette valeur ou réglez le timeout côté client.
