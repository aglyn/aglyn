# MCP Registry entry

`server.json` is a copy of Aglyn's entry in the official
[MCP Registry](https://registry.modelcontextprotocol.io), published as
`com.aglyn.app/mcp`. It describes the remote MCP server at
`https://app.aglyn.com/api/mcp`. Clients sign in through the server's own OAuth
discovery, or send an API key in the optional `Authorization` header.

Its `name`, `title`, `description`, `websiteUrl` and `remotes` must match the
server card the console serves at `/api/mcp/server-card`.
`npm run check:agent-readiness` and `apps/console/specs/mcp-discovery-agreement.spec.ts`
fail when they differ.

## Publishing a change

Published versions are immutable. Any change to the entry needs a new
`version` in `server.json`.

1. Sign in with the domain's key:

   ```sh
   mcp-publisher login dns --domain aglyn.com
   ```

   Supply the private key the way `mcp-publisher` asks for it. The registry
   checks the key against the TXT record on `aglyn.com`. The private key is kept
   outside this repository. Never commit it, and never paste
   it into a file here.

2. Publish from this folder:

   ```sh
   mcp-publisher publish
   ```

3. Confirm that the registry serves the new version, then commit the matching
   `server.json` here.
