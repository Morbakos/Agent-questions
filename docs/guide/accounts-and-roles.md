# Accounts and roles

Agent Questions has two deployment profiles, chosen with `AQ_DEPLOYMENT_MODE`. They have different security models.

| | `local` (default) | `server` |
| --- | --- | --- |
| For | One user on their own machine | Several users, private network or Internet |
| Login | None: every request is the single local user | Accounts with passwords, or API tokens for MCP |
| Listens on | `127.0.0.1`, `::1` or `localhost` only | The network, behind an HTTPS reverse proxy |
| Accounts, roles, tokens | Not available (`/account` and `/admin/*` do not exist for you) | Yes |
| Opens the browser | Yes, unless `AQ_NO_OPEN=1` | Never |

The server refuses to start on a dangerous or incomplete combination and names the variable to fix. How to deploy each
profile: [Deployment profiles](../operations/deployment-profiles.md). This page covers what users and admins do.

## Roles

| Role     | UI label        | Can                                                                           |
| -------- | --------------- | ----------------------------------------------------------------------------- |
| `member` | Collaborateur   | Answer their own questions, change their password, manage their own API tokens |
| `admin`  | Administrateur  | Everything a member can, plus manage accounts and view all sessions read-only  |

Finer-grained permissions do not exist yet.

Each user sees only their own sessions, in the UI, through MCP, and in the live events stream. A session of someone else
is "not found" (404), never "forbidden", so its existence is not revealed.

## First start: the administrator

On first start, when the database has no account, the server creates an administrator:

- username: `AQ_ADMIN_USERNAME` (default `admin`; 3 to 40 characters: letters, digits, `.`, `-`, `_`, starting with a
  letter or digit);
- password: `AQ_ADMIN_PASSWORD` (10 to 200 characters). If unset, a random password is generated and printed **once** in
  the server log as a warning. Note it, then change it after your first login.

Sessions that already existed in the database from the `local` profile are attached to this first administrator.
After the first start these variables have no effect: manage accounts in the UI.

## Inviting people

An admin opens "Utilisateurs" (users):

1. Under "Inviter une personne", enter a username and a role, then "Créer et inviter".
2. The page shows an invitation link, valid for 7 days. **It is shown once**: copy it and send it to the person.
3. The person opens the link ("Bienvenue"), chooses a password (10 to 200 characters, entered twice) and is signed in.

An invitation is single-use. The "Nouveau lien" button on a user issues a new link and invalidates the previous one: use
it if a link expired or was lost. Only a hash of the link is stored.

The account list shows each user's status: "Actif", "Invitation en attente" (invitation pending: no password chosen yet)
or "Désactivé" (disabled).

### Managing accounts

| Button                      | Effect                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Promouvoir / Rétrograder    | Switch between `admin` and `member`. Disabled on your own row.                              |
| Désactiver / Réactiver      | Disable: closes the user's sign-in sessions and live streams and deletes their pending invitations; their API tokens stop working. Disabling asks for confirmation, with the box "Supprimer aussi ses jetons d'API" (also delete their API tokens) checked by default. Re-enabling is one click: the user signs in again, and the tokens work again only if you left the box unchecked. Disabling is not offered on your own row. |
| Nouveau lien                | New invitation link (also usable to reset a forgotten password).                            |

There is always at least one active administrator: the server refuses (409) to demote or disable the last one.

## Signing in and sessions

- Sign in at `/login` ("Connexion") with username and password. The browser never holds a token: the session is an
  `HttpOnly` cookie (`__Host-sid` over HTTPS, `sid` over plain HTTP outside localhost).
- A sign-in session lasts at most 7 days and ends after 1 day without activity. Sign out with "Se déconnecter".
- 10 failed attempts in 15 minutes, counted per username and per client address, block sign-in with HTTP 429, even with the
  right password. Behind a reverse proxy, set `AQ_TRUST_PROXY` so addresses are told apart (see
  [Reverse proxy](../operations/reverse-proxy.md)).
- Pages from another origin cannot act for a signed-in user (CSRF protection by `Sec-Fetch-Site` / `Origin`), except
  origins you list in `AQ_ALLOWED_ORIGINS`.
- Passwords are hashed with scrypt.

### Changing your password

"Mon compte" > "Mot de passe": current password, new password (10 to 200 characters), confirmation. Your other
sign-in sessions are closed ("Vos autres sessions ouvertes seront fermées"). A wrong current password is refused (403)
and counts toward the attempt limit.

There is no "forgot password" flow: ask an admin for a new link ("Nouveau lien").

## API tokens for MCP clients

A token lets an MCP client (Claude Code, Codex, Cursor...) act as you. In "Mon compte" > "Jetons personnels":

1. Enter a name (up to 60 characters, for example "Claude Code sur mon portable") and "Créer un jeton".
2. The token (`aq_<id>_<secret>`) is shown **once**, with a ready-to-paste `claude mcp add ...` command. The browser
   does not store it; the server keeps only a hash.
3. "Révoquer" deletes a token immediately.

Limits and properties:

- up to 20 tokens per user;
- a token expires after one year;
- a token opens **only** `/mcp`: not the UI API, not your account. The session cookie, conversely, does not open `/mcp`;
- a disabled account's tokens are refused. If the administrator also chose to delete them when disabling the account, they are gone for good: after re-enabling, create new ones.

How to use a token in a client: [Connect your agent](connect-your-agent.md#shared-server-api-token).

## Admin supervision

An admin sees every user's sessions in "Sessions" (columns: owner, status, creation date, newest first, 50 per page) and
opens one to read its questions and answers. This is **read-only**: an admin cannot answer, decline, or edit a session
for its owner, and cannot save a draft. Each read is written to the server log (`supervision` logger, with the admin's
username and the session id).

Supervision exists so that an admin can see what is waiting and on whose behalf. Tell your users that it exists.

## From `local` to `server`

You can start a `server` deployment on a database created in `local` profile: existing sessions are attached to the first
administrator. Going back to `local` is not covered: that profile has no accounts.
