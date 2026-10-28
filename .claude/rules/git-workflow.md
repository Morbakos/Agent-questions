# Commit et push

- **Avant chaque commit** : rejouer `npm run lint`, `npm run format:check`, `npm run build` et `npm test` sur l'état
  exact qui sera commité, et donner le résultat à l'utilisateur. Ne pas commiter si l'un d'eux échoue.
- **Jamais de `git push` sans accord explicite de l'utilisateur**, demandé dans une question distincte après le commit
  (« je pousse ? »). Un « oui » à une question combinée (« je commite et pousse ? ») ne vaut pas accord pour le push.
- Ne jamais commiter `.mcp.json` (modification locale de l'utilisateur).
