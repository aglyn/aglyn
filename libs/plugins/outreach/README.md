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

## The engine

`src/lib/engine` (AGL-2979) is every decision the sending runtime makes, as
pure functions with no I/O, exported from the package root:

| module | decides |
| -- | -- |
| `sequence-validation` | what a sequence may be: 8 steps, 4 emails, 1–30 business days, subjects, bodies, windows, countries; and what activation refuses on |
| `gates` | who may be emailed, over a contact as stored and the results of the runtime's lookups, with a sentence per block |
| `schedule` | when a step comes due: business days in the mailbox's zone, clamped into the window, with jitter |
| `sending-capacity` | the daily cap and warm-up ramp, the per-run allowance, and which due enrollments go first |
| `enrollment-state` | the enrollment state machine, the new enrollment document, and what a completed step writes |
| `compose` | the email a step sends: merge fields, the mandatory footer, threading, unsubscribe headers |
| `thread-message` | the classifier's message shape, and the adapter from a Gmail API message |
| `delivery-status`, `opt-out-intent`, `thread-classification` | what came back: bounces, automatic replies, replies and opt-outs |
| `mailbox-health` | when a mailbox pauses itself |

`engine/do-not-contact` derives the do-not-contact document id with
`node:crypto`, so it is not in the barrel: import
`@aglyn/plugins-outreach/engine/do-not-contact` from server code.
