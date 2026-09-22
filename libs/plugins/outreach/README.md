# @aglyn/plugins-outreach

Sequences: one-to-one, multi-step email sequences a rep sends from
their own connected mailbox, logged on the CRM's records. A sequence
enrolls a contact or a lead (AGL-3234): an enrollment names which record the
person is, a lead is judged and merged as the contact it would be, and when
the lead converts its enrollment follows it to the contact through the
core's lead-conversion seam.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

```bash
npm install @aglyn/plugins-outreach@beta
```

A plugin is loaded through Aglyn's plugin manager (`@aglyn/aglyn`) by the console and the tenant runtime; it is not a standalone library.

The name people read is **Sequences**. The lib, the package, the
release flag, the entitlement, the permission key, the collections and the API
prefix stay `outreach`: they are stored vocabulary and live URLs, and no
reader sees them.

Two halves, like the CRM plugin:

- **Console** (`registerOutreachConsole`, client barrel): the organization-level
  Sequences hub at `/[orgSlug]/outreach/<section>`, declared through
  `ConsoleExtension.orgNavItems`, behind `release_outreach`, the
  `features.outreach` entitlement and the `outreach.use` permission.
- **Console API** (`registerOutreachConsoleApi`, `@aglyn/plugins-outreach/server`):
  handlers under the `outreach/` prefix, served by the console's
  `/api/[...pluginApi]` dispatcher.

Two more entries, neither of them loaded by the tenant runtime:

- **Console-only server declarations** (`registerOutreachConsoleServerDeclarations`,
  `@aglyn/plugins-outreach/declarations.console-server`): the workspace and
  account erasers, registered at the console's boot. They revoke a rep's
  Google grant with `OUTREACH_TOKEN_KEY`, which only the console holds.
- **Subprocessors** (`outreachSubprocessors`, `@aglyn/plugins-outreach/subprocessors`):
  the third-party hosts the plugin's code names, which the manifest generator
  writes into the console's subprocessor inventory.

The document model shared by both halves is `src/lib/model/outreach.types.ts`.
Every `outreach*` collection is written by the server alone.

## Mailboxes

`src/lib/mailboxes` and `src/lib/transport` connect a rep's own
Google mailbox and talk to it:

| module | does |
| -- | -- |
| `mailboxes/mailbox-routes` | connect (signed single-use state, PKCE, OpenID nonce), settings, pause, test and disconnect |
| `mailboxes/oauth-state` | the signed `state` and its pending record under `orgs/{orgId}/outreachOAuthStates` |
| `mailboxes/mailbox-credentials` | the refresh token sealed with the shared secret box, in `outreachMailboxCredentials` |
| `mailboxes/mailbox-transport` | opens a mailbox's Gmail client for the runtime, and marks one reconnect-required |
| `mailboxes/mailbox-erasure` | what a workspace or account erasure revokes and deletes |
| `transport/gmail-client` | the fetch-based Gmail API client: send, full and metadata thread reads, search, send-as |
| `transport/send-message` | the one door a send goes through, including the engine's composed email |
| `transport/rfc5322` | the plain-text RFC 5322 writer |

`OUTREACH_TOKEN_KEY`, `GOOGLE_OUTREACH_CLIENT_ID` and
`GOOGLE_OUTREACH_CLIENT_SECRET` are read by `mailboxes/outreach-config` alone,
and `outreach-credential-isolation.spec.ts` holds that no tenant file reaches it.

## The engine

`src/lib/engine` is every decision the sending runtime makes, as
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
| `mailbox-notice` | the email a mailbox's owner gets when it pauses itself or needs reconnecting |
| `gateway-block` | whether a hard bounce is the recipient domain's gateway refusing the sender, rather than one unknown address |
| `do-not-contact-domain` | how a domain on the do-not-contact list is spelled |

`engine/do-not-contact` derives the do-not-contact document id with
`node:crypto`, so it is not in the barrel: import
`@aglyn/plugins-outreach/engine/do-not-contact` from server code.

## The sending runtime

`src/lib/runtime` runs the engine against real mailboxes, in the
console alone — each run opens a rep's sealed grant:

| module | does |
| -- | -- |
| `runtime/send-job` | `outreach-send`: due enrollments claimed in a transaction that reserves the mailbox's day, gates asked again, the email composed with its unsubscribe link and sent, the step recorded and filed on the contact's timeline; task steps file the rep's task |
| `runtime/sync-job` | `outreach-sync`: replies, out-of-office answers, opt-outs and bounces read with `format=full` and classified by the engine; the mailbox's health evidence and its automatic pause |
| `runtime/unsubscribe-link`, `runtime/unsubscribe-route` | the signed one-click link (`GET` and RFC 8058 `POST /api/outreach/unsubscribe`), a recipient link that outlives a paused rollout, and the `+unsubscribe` mailto |
| `runtime/enrollment-events` | status changes as the engine's events, and an opt-out recorded on every list |
| `runtime/mailbox-notices` | the owner told, once, when a mailbox pauses itself or needs reconnecting |
| `runtime/timeline` | the contact's timeline, through the core's record-timeline seam |
| `runtime/person-erasure` | the enrollments a person erasure deletes, and the do-not-contact entry it keeps |

Both jobs are declared on the core's `plugin-console-crons` from the
console-only declarations, which run them every fifteen minutes from
`/api/admin/plugin-crons` and give each a row on `/api/health/crons`. Their
dependencies are `runtime/runtime-deps`; `runtime/fixtures/fake-gmail` is the
in-memory mailbox the emulator specs run them against.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/outreach
