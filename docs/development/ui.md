# UI

`packages/ui` is an Angular 21.1 single-page application: standalone components, signals, `OnPush` change detection, SCSS, and `marked` for markdown. UI strings are in French.

## Structure

```text
src/
  main.ts, index.html, styles.scss
  styles/            _tokens, _base, _layout, _forms, _markdown, _mixins (partials)
  testing/           test doubles and fixtures (dom.ts, fixtures.ts)
  app/
    app.ts, app.routes.ts
    core/            api.ts, accounts-api.ts, auth.ts, live.ts, app.config.ts, errors.ts,
                     validators.ts, params-reuse-strategy.ts
    shared/          markdown.pipe.ts
    features/
      home/          pending list and paginated history
      session/       session.ts, question.ts, session-state.ts (one question form)
      auth/          login, invite
      account/       password and personal API tokens (server profile)
      admin/         users, sessions, session-detail (admin only)
```

Routes (`app.routes.ts`) are lazy-loaded with `loadComponent`:

| Path                    | Page                          | Guard         |
| ----------------------- | ----------------------------- | ------------- |
| `/`                     | Home: pending list + history  | none          |
| `/s/:id`                | One question session          | none          |
| `/login`                | Sign-in                       | none          |
| `/invite/:token`        | Accept an invitation          | none          |
| `/account`              | "Mon compte"                  | `serverGuard` |
| `/admin/users`          | "Utilisateurs"                | `adminGuard`  |
| `/admin/sessions`       | "Sessions des utilisateurs"   | `adminGuard`  |
| `/admin/sessions/:id`   | One user's session, read-only | `adminGuard`  |
| `**`                    | Redirects to `/`              |               |

The route guards are a convenience for navigation. Real access control is on the server (`@Roles("admin")`, owner filtering in repositories).

## Conventions

- Every component is standalone with `changeDetection: ChangeDetectionStrategy.OnPush` (enforced by ESLint).
- State lives in signals. Derived state uses `computed`, side effects use `effect`.
- Selectors use the `app` prefix (`app-question`).
- Templates are formatted by Prettier with one attribute per line; do not format by hand.
- HTTP calls go through `core/api.ts` (`ApiService`) and `core/accounts-api.ts`, never directly from components.
- Component SCSS stays in the component. `src/styles.scss` only `@use`s the partials in `src/styles/`. Markdown injected through `[innerHTML]` escapes encapsulated styles, so its rules (`.md`) stay global in `_markdown.scss`.
- Production budgets: initial bundle warns at 500 kB and errors at 1 MB; a component style warns at 4 kB and errors at 8 kB.

## Identity

The browser never handles a token. In the `server` profile the session is an `HttpOnly` cookie set by the server. `AuthService` (`core/auth.ts`) loads the identity from `GET /auth/me` and exposes `me`, `isServer` and `isAdmin` signals. In the `local` profile `/auth/me` answers `{ mode: "local", ... }` and the UI shows no sign-in and no account menu.

`authInterceptor` redirects to `/login` (with `returnUrl`) on a 401 from a same-origin call, except on public routes and the public calls (`/auth/login`, `/auth/invitations/`, `/auth/me`). `safeReturnUrl` only accepts a path of the application, never an external URL. There is no anti-CSRF header: the server relies on the `Sec-Fetch-Site` and `Origin` headers the browser adds itself.

## Following the agent

`LiveService` (`core/live.ts`) keeps one `EventSource` on `GET /api/events`. It is started when the identity is known and stopped on sign-out (`app.ts` follows `auth.me()`). On a refusal that closes the stream (401, 403) it reconnects with an exponential delay from 2 s to 60 s.

When a `new-session` event arrives, the UI decides, so the server never forces a navigation:

- If the user is already on `/s/<id>`, do nothing.
- If a form is being filled in (`live.editing()` is true), show the toast "Nouvelles questions : ..." with the buttons "Y aller" (go) and "Ignorer" (dismiss). `live.offer` is only non-null while a form is displayed.
- Otherwise navigate to the session directly.
- If the tab is in the background, prefix the title with "(1)" until it becomes visible again.

`SessionState` sets `live.editing` while its state is `ready`.

## Session page and polling

`SessionState` (`features/session/session-state.ts`) is provided by the page component, so there is one instance per page. Its states are `loading`, `missing`, `ready`, `answered`, `declined` and `closed`. A session that is already closed opens read-only (`closed`).

- **Draft.** Each edit schedules `PUT /api/sessions/:id/draft` after 600 ms (`DRAFT_DELAY_MS`). On destruction, a dirty draft is flushed, so leaving the page loses nothing. A failed save sets `draftFailed` and clears the "saved" indicator instead of pretending the input is stored.
- **Polling.** Every 5 s (`POLL_MS`), while the tab is visible and nothing is being sent, the page re-reads the session. If it is now `answered` or `declined` the state follows. If `revision` changed (the agent called `update_questions`), the new version is kept in `pendingUpdate`.
- **Agent edits are proposed, not applied.** `canSubmit` is false while `pendingUpdate` is set, because the server validates against the current stored version. `applyUpdate()` swaps in the new questions and keeps typed answers, dropping selected options that no longer exist.
- **Submit and decline** call `POST .../answers` and `POST .../decline`; server errors (including the 422 `details`) are shown in the form.

The home page (`features/home/home.ts`) refreshes the pending list every 5 s (`REFRESH_MS`) and loads the history 50 entries at a time with the `before` cursor (`<ms>:<id>`, opaque to the UI).

`ParamsReuseStrategy` recreates a routed component when only its parameters change. Without it, going from `/s/a` to `/s/b` would reuse the first page, which reads its id once.

## Markdown and security

Question `prompt` and `context_markdown` come from an agent and are untrusted. `MarkdownPipe` runs `marked` with a custom renderer, then the result is bound with `[innerHTML]`, so **Angular's sanitizer runs on it** (scripts, inline handlers). In addition the renderer:

- replaces images with their alt text and strips raw `<img>` tags, so opening a form never makes a request to a third party (IP address leak);
- opens links in a new tab with `rel="noopener noreferrer"`, so a link does not drop the form being filled in.

Never bypass the sanitizer with `bypassSecurityTrust...`. A Playwright test (`e2e/local.spec.ts`) checks that scripts and remote images do not survive.

The build uses `security.autoCsp`: Angular publishes the hash of its one inline script in a `<meta http-equiv="Content-Security-Policy">` tag in `index.html`. The server reuses that policy in its CSP header (`contentSecurityDirectives`), and `scripts/build-server.ts` fails if `index.html` has inline JavaScript without that tag. Do not add inline scripts or `onclick`-style attributes.

## Add a page

1. Create `packages/ui/src/app/features/<name>/<name>.ts` as a standalone `OnPush` component.
2. Add a lazy route in `app.routes.ts`:

   ```ts
   {
   	path: "reports",
   	title: "Rapports",
   	canActivate: [adminGuard], // only if the page needs it
   	loadComponent: () => import("./features/reports/reports").then((m) => m.ReportsComponent),
   },
   ```

3. Call the server through `core/api.ts` (add a method there). Put any new response type in `packages/shared/src/views.ts`, not in the UI.
4. If the page needs a new server route, follow [Add a controller](conventions.md#add-a-controller).
5. Write a `.spec.ts` next to the component (see [Testing](testing.md#ui-tests)).
6. Update the user documentation if the page is visible: [Using the UI](../guide/using-the-ui.md).

## Running

```bash
bun run dev:ui          # ng serve on :4200, /api proxied to :4317
bun run --cwd packages/ui build   # production build into packages/ui/dist/ui/browser
```

The proxy forwards `/api` only (see the [development guide](index.md#the-dev-loop) for the consequence for the `server` profile).
