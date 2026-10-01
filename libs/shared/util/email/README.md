# @aglyn/shared-util-email

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/shared-util-email@beta

One place that sends outbound **application** email, through a mail provider
the deployment chooses: [Resend](https://resend.com) by default, or the
operator's own sender behind a webhook.

Before this library the same ~30 lines of a vendor `fetch` were copy-pasted
across 10 files, each reading the env vars itself and each handling failure a
little differently. Consolidating them means the provider, the sender
identity, and the failure semantics change in one place.

## What is and is not in scope

| Mail | Sent by | Here? |
| --- | --- | --- |
| Invites, receipts, usage summaries, campaigns, staff alerts | the mail provider | ✅ |
| Verification, password reset | Firebase Auth | ❌ |
| Inbound mail to `@aglyn.com` mailboxes | Google Workspace | ❌ |

## Configuration

The sender, and the settings of the provider that carries the mail, read at
call time:

```
USAGE_EMAIL_FROM="Aglyn <noreply@aglyn.com>"
RESEND_API_KEY=re_xxxxxxxx             # the default provider
# or, for your own sender:
AGLYN_MAIL_WEBHOOK_URL=https://relay.internal/send
AGLYN_MAIL_WEBHOOK_TOKEN=…
```

Both the sender and the provider's settings are required. With either
missing, `sendEmail()` warns and returns `{ sent: false, reason:
'unconfigured' }` — it does not throw, so local and preview environments run
fine without a mail provider.

## The mail provider

`sendEmail()` decides whether, as whom and to whom a message leaves —
suppression, the send-rate governor, the phishing screen, the sending
identity, the unsubscribe footer. A `MailProvider` (`mail-provider.ts`) only
carries the finished message, and answers the platform's other questions
about mail in the platform's own vocabulary: whether its credential works,
what a delivery webhook said, what a received message contained, what the
account already sent.

`mail-providers.ts` picks the deployment's provider:

- `AGLYN_MAIL_PROVIDER` names one — `resend`, `webhook`, or an id a plugin or
  fork registered with `registerMailProvider()`.
- Unset, the first built-in with its settings wins: `resend` when
  `RESEND_API_KEY` is set, `webhook` when only `AGLYN_MAIL_WEBHOOK_URL` is,
  otherwise `resend`, unconfigured.
- A name that is neither built in nor registered is **refused**: every send
  is skipped with an error naming it, and nothing falls back to another
  vendor.

The built-ins are compiled into this library rather than registered by a
plugin because this is the transactional rail: it must send from every server
process with or without a plugin loaded, and a registration that did not
happen would look exactly like mail that is switched off.

The rest of the platform asks through `normalizeDeliveryEvents()`,
`readInboundMailEvent()` and `mailProviderReads()`, never through a provider
by name. `mail-provider-resend.ts` is the only module that knows Resend's
wire format, and `mail-provider-webhook.ts` documents the webhook's.

Setup and DNS are documented in [`docs/EMAIL_SETUP.md`](../../../../docs/EMAIL_SETUP.md).

## Usage

```typescript
import { sendEmail } from '@aglyn/shared-util-email'

const result = await sendEmail({
  to: 'someone@example.com',
  subject: 'You have been invited',
  text: 'Sign in to accept.',
  context: 'invite', // shows up in logs on failure
})

if (!result.sent) {
  // 'unconfigured' | 'no-recipient' | 'rejected' | 'network'
  console.warn('no mail went out:', result.reason)
}
```

`sendEmail()` **never throws**. Outbound mail is best-effort everywhere in
this codebase — a checkout must not fail because a receipt bounced — so every
outcome comes back as a result object. Do check `sent`: it is what lets the
console tell a user honestly whether a message actually went out.

Optional fields: `html`, `headers` (e.g. `List-Unsubscribe`), `tags` (webhook
attribution), `replyTo`, and `from` (overrides the configured sender — rarely
correct, since the point of `USAGE_EMAIL_FROM` is one verified identity).

### The transport boundary

`postResendEmail()` (in `mail-provider-resend.ts`) is the only function that
POSTs to Resend's send endpoint,
and it **throws** on a payload with no `to` rather than putting it on the wire.
Such a payload cannot become a message; Resend answers `422
missing_required_field`, which costs an API call and then sits in the vendor
dashboard looking exactly like mail that failed to deliver, carrying nothing
that names the code responsible. `sendEmail()` filters recipients long before
this point, so ordinary senders never meet the guard — it is there because
`RESEND_SEND_ENDPOINT` is exported and a module that fetches it directly
bypasses every check `sendEmail()` owns.

### The List-Unsubscribe setting

`list-unsubscribe.ts` is the one place the `List-Unsubscribe` /
`List-Unsubscribe-Post` (RFC 8058) pair is modeled, for every sender that makes
it a setting — an outreach sequence (default off) and a marketing campaign
(default on):

```typescript
import {
  decideListUnsubscribe,
  listUnsubscribeHeaders,
  readListUnsubscribeSetting,
} from '@aglyn/shared-util-email/list-unsubscribe'

const requested = readListUnsubscribeSetting(stored.listUnsubscribe, true)
const decision = decideListUnsubscribe({
  requested,
  recentVolume, // the organization's campaign messages in the last day
  sendVolume, // everyone this email will address
})
const headers = decision.on ? listUnsubscribeHeaders({ url: oneClickUrl }) : {}
```

`decideListUnsubscribe` is the bulk-sender guard: with the setting off, a send
that takes the organization to `EMAIL_LIST_UNSUBSCRIBE_BULK_THRESHOLD` messages
(default 5,000, Gmail's and Yahoo's line) carries the pair anyway, and the
decision says it was forced and why. The headers are plain headers, so any
provider behind `sendEmail` delivers them.

## Checking configuration

```typescript
import { isEmailConfigured, describeEmailConfig, checkEmailCredentials }
  from '@aglyn/shared-util-email'
```

- `isEmailConfigured()` — the provider has its settings and a sender is set.
  Use it to answer `501` from a route instead of pretending to have sent.
- `describeEmailConfig()` — which provider, which of its settings are
  missing, plus the sender and its domain, with no credential ever included.
- `checkEmailCredentials()` — asks the provider whether its credential is
  accepted **without sending anything**. A provider with no probe answers
  `unknown`. Resend's probe `GET`s the domains collection and
  reading the error NAME rather than the status. A `2xx`, or a
  `restricted_api_key`/`invalid_permission` rejection (what a sending-scoped
  key gets, and it can only be reached once Resend has authenticated the key),
  means the credential works. `missing_api_key`, `validation_error` and
  `suspended_api_key` mean it was refused. Anything else is `unknown`, never
  `invalid-key`. It never touches the send endpoint: a probe aimed there is
  logged by Resend as a `422` on `POST /emails` and reads, in the dashboard,
  as failed mail. It cannot confirm domain verification — only a real send
  does that.

These back the staff-only `/api/admin/email-health` route in the console.

## Running unit tests

Run `nx test shared-util-email` to execute the unit tests via
[Jest](https://jestjs.io).

Note: prefer bare `jest` over `nx test` when a test depends on env vars — `nx`
injects the root `.env`, which can turn a genuinely failing test green.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/shared/util/email
