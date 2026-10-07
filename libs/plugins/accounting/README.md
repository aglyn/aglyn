# @aglyn/plugins-accounting

Posts a workspace's commerce sales, refunds, Aglyn fees and Stripe payouts to
QuickBooks Online or Xero (AGL-3614), or through Codat to QuickBooks Desktop,
NetSuite, Sage, FreshBooks, Zoho Books, Wave and the rest Codat reaches
(AGL-3636, `server/providers/codat.ts`).

- `@aglyn/plugins-accounting` — the console page (Connection, Sync activity)
  and the client-safe model: the provider-neutral transforms in
  `model/accounting-transforms.ts`.
- `@aglyn/plugins-accounting/server` — the console API routes.
- `declarations.console-server` — the sync tick on the console's
  `plugin-console-crons` beat, and the workspace eraser that revokes the grant.

Env-gated: a provider is offered only when its app credentials
(`INTUIT_CLIENT_ID`/`INTUIT_CLIENT_SECRET`/`INTUIT_ENVIRONMENT`, or
`XERO_CLIENT_ID`/`XERO_CLIENT_SECRET`, or `CODAT_API_KEY`) and `ACCOUNTING_TOKEN_KEY` are set on
the console, and the page is behind `release_accounting`, off by default.
