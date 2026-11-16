# Aglyn for Claude

Connects Claude to your Aglyn workspace and teaches it how to work there.

- **The connector** (`.mcp.json`): Aglyn's tools for sites, datasets,
  contacts and the CRM, form submissions, orders, products, bookings and
  media. You sign in to Aglyn and choose the workspace and access level; no
  key to copy.
- **Skills**: `aglyn` (working with the tools), `aglyn-console` (designing
  pages and changing settings in the console through a browser), and
  `aglyn-read-site` (reading any published Aglyn site as clean text).

## Claude Code

```bash
claude plugin marketplace add aglyn/aglyn
```

```bash
claude plugin install aglyn@aglyn
```

Then run `/mcp`, choose **aglyn**, and sign in.

## Claude on the web, desktop and mobile

Add a custom connector with the address `https://app.aglyn.com/api/mcp`, then
sign in when asked. Step by step:
https://docs.aglyn.com/marketing-and-automation/workflows-and-actions/claude

## Using an API key instead

Scripts and servers with nobody to sign in can send an API key from
**Settings → API keys** as `Authorization: Bearer aglyn_sk_…` to the same
address. See https://docs.aglyn.com/api.
