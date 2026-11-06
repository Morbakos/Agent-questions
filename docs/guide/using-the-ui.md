# Using the UI

The UI is served by the same process as the MCP server, at `http://127.0.0.1:4317` by default (or `AQ_PUBLIC_URL`).
Its texts are in French; this page quotes them with an English gloss.

## Screens

| Address                 | Title (French)                    | Who          | Purpose                                      |
| ----------------------- | --------------------------------- | ------------ | -------------------------------------------- |
| `/`                     | Questions en attente              | everyone     | Pending questions and history                |
| `/s/<session_id>`       | the session title                 | everyone     | Answer a session, or read a closed one       |
| `/login`                | Connexion                         | `server`     | Sign in                                      |
| `/invite/<token>`       | Bienvenue                         | `server`     | Choose a password from an invitation link    |
| `/account`              | Mon compte                        | `server`     | Change password, manage API tokens           |
| `/admin/users`          | Utilisateurs                      | admin        | Create, invite, promote, disable accounts    |
| `/admin/sessions`       | Sessions des utilisateurs         | admin        | Read-only view of everyone's sessions        |
| `/admin/sessions/<id>`  | Session d'un utilisateur          | admin        | Read-only view of one session                |

The header shows the brand link "Questions de l'agent" (back to the list). In the `server` profile it also shows, for
admins, "Sessions" and "Utilisateurs", then your username (link to your account) and "Se déconnecter" (sign out). The
`local` profile has no login and no account pages.

## The list

"Questions en attente" lists your pending sessions: title, number of questions and reception time. It refreshes every
5 seconds (and not while the tab is hidden). Click one to answer.

Below, "Historique" lists answered and declined sessions, newest first, 50 per page ("Charger plus" loads the next
page). Each entry says "répondue" (answered) or "refusée" (declined) and when.

## Answering a session

The page has an outline on the left ("Plan") and the form on the right.

- The outline lists each question by its `header` (or `id`), marks answered ones with a check, and shows
  "N sur M répondues" (N of M answered). Click an entry to scroll to the question.
- Each question shows its prompt, then a collapsible "Contexte" block when the agent provided context (open by default).
  Prompts and context are markdown, sanitised before display.
- Choice questions show radio buttons (`single`) or checkboxes (`multi`). A "Recommandé" badge marks the agent's
  suggestion; it is not preselected.
- Under each option you pick, "+ Ajouter une précision" opens an optional note field. The agent receives it with that
  option. Unpicking the option removes its note.
- "Autre" is a free-text field for an answer that fits no option.
- "(facultatif)" marks optional questions.

Buttons:

- "Envoyer à l'agent" (send to the agent) is enabled when every required question is answered. Next to it you may see
  "N réponse(s) obligatoire(s) manquante(s)" (N required answers missing).
- "Ne pas répondre" (do not answer) opens a field "Pourquoi ne pas répondre ? (facultatif)" (why not answer? optional) and
  "Confirmer le refus" (confirm the refusal) / "Annuler". The agent receives the refusal and your reason.

After sending, the page shows "Réponses envoyées" (answers sent) or "Refus transmis" (refusal sent). You can close the tab.

If the server rejects the answers (for example because a question changed), the error shows under the buttons, with
the list of problems.

### Drafts

Everything you type is saved as a draft 600 ms after your last keystroke, and again when you leave the page. The footer
shows "Brouillon enregistré à HH:mm". If it shows "Brouillon non enregistré" in red, the save failed (server
unreachable): the final send is still possible. Reopen the same session later and the form is restored.

### When the agent edits the questions

If the agent calls `update_questions`, the open page notices within 5 seconds (polling; no push). It does not replace
the form while you type. Instead a banner appears:

> L'agent a modifié les questions. L'envoi est suspendu tant que vous n'avez pas affiché la nouvelle version.
> (The agent changed the questions. Sending is suspended until you show the new version.)

with the button "Afficher les nouvelles questions" (show the new questions). Sending stays disabled until you click it,
because the server validates your answers against the up-to-date questions. On click, the form shows the new version and
keeps your answers for questions whose `id` is unchanged (and options that still exist, with their notes). A notice then
says your answers were kept "quand c'était possible" (when possible).

### Read-only closed sessions

Opening an answered or declined session (from "Historique" or by its URL) shows it read-only: the prompts, and for each
question the options you picked, their notes and your free text ("Sans réponse" when empty). A declined session shows
"Vous avez refusé de répondre" with your reason. A session that does not exist or is not yours shows "Session
introuvable".

## One tab that follows the agent

When the agent creates a session, the server tries to get you to the form without piling up tabs.

- The UI keeps a live connection to the server (`GET /api/events`). The server opens the browser only if no UI of yours
  is connected (or one was opened less than 15 seconds ago). So there is one tab. It never opens a browser with
  `AQ_NO_OPEN=1`, in Docker, or in the `server` profile.
- If the tab is on the list, on a "sent" confirmation, or on a closed session, it goes straight to the new questions.
- If you are filling in another form, a notification appears: "Nouvelles questions : <title>" with "Y aller" (go) and
  "Ignorer" (dismiss). Your input is not interrupted, and it is saved in the draft anyway.
- If the tab is in the background, a site cannot bring itself to the foreground. The tab title becomes
  "(1) Questions de l'agent" until you come back to it.
- The connection reconnects by itself (retry delay from 2 s up to 60 s). It works with `AQ_NO_OPEN=1`: keep a tab open on
  the list and it follows the agent. Updates made by `update_questions` do not use this channel: only the page showing that
  session notices them.

Only your own tabs are notified; in the `server` profile one user's questions never reach another user's tabs.

## Accessibility notes

The form uses labelled groups, `aria-required`, status regions for banners and errors, and respects
`prefers-reduced-motion` when scrolling to a question.
