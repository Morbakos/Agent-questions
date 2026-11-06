# User guide

Agent Questions lets an AI agent ask you long or complex questions (markdown, code, many options) in a web form instead
of the terminal. The agent calls the MCP tool `ask_user`; you answer in the browser; the answers go back to the agent.

This guide is for people who use Agent Questions with their agents. To run or secure a server, see
[Operations](../operations/index.md). To work on the code, see [Development](../development/index.md).

## Start here

1. Run the server and register it with your agent: [Connect your agent](connect-your-agent.md).
2. Learn the vocabulary (session, question, draft, revision): [Concepts](concepts.md).
3. Answer questions in the browser: [Using the UI](using-the-ui.md).

## Pages

| Page                                        | Read it to                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| [Concepts](concepts.md)                     | Understand sessions, question types, answers, drafts and revisions            |
| [Connect your agent](connect-your-agent.md) | Register the MCP server in Claude Code, Codex, Cursor, VS Code and others     |
| [Using the UI](using-the-ui.md)             | Know what each screen does and how the tab follows the agent                  |
| [Accounts and roles](accounts-and-roles.md) | Use the shared `server` profile: invitations, API tokens, admin supervision   |
| [Rules and limits](rules-and-limits.md)     | Look up the numbered business rules and every size bound                      |
| [Troubleshooting](troubleshooting.md)       | Fix timeouts, forgotten answers, 401/403 errors, a browser that does not open |

## Reference

- Tool parameters and results: [MCP tools](../reference/mcp-tools.md)
- Every `AQ_*` variable: [Configuration](../reference/configuration.md)
