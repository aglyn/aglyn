# @aglyn/plugins-outreach

Outreach (AGL-2974): one-to-one, multi-step email sequences a rep sends from
their own connected mailbox, logged on the CRM's records.

Two halves, like the CRM plugin:

- **Console** (`registerOutreachConsole`, client barrel): the organization-level
  Outreach hub at `/[orgSlug]/outreach/<section>`, declared through
  `ConsoleExtension.orgNavItems`, behind `release_outreach`, the
  `features.outreach` entitlement and the `outreach.use` permission.
- **Console API** (`registerOutreachConsoleApi`, `@aglyn/plugins-outreach/server`):
  handlers under the `outreach/` prefix, served by the console's
  `/api/[...pluginApi]` dispatcher.

The document model shared by both halves is `src/lib/model/outreach.types.ts`.
Every `outreach*` collection is written by the server alone.
