# @aglyn/shared-util-email

One place that sends outbound **application** email, via
[Resend](https://resend.com).

Before this library the same ~30 lines of `fetch('https://api.resend.com/emails')`
were copy-pasted across 10 files, each reading the env vars itself and each
handling failure a little differently. Consolidating them means the provider,
the sender identity, and the failure semantics change in one place (AGL-709).

## What is and is not in scope

| Mail | Sent by | Here? |
| --- | --- | --- |
| Invites, receipts, usage summaries, campaigns, staff alerts | Resend | ✅ |
| Verification, password reset | Firebase Auth | ❌ |
| Inbound mail to `@aglyn.com` mailboxes | Google Workspace | ❌ |

## Configuration

Two env vars, read at call time:

```
RESEND_API_KEY=re_xxxxxxxx
USAGE_EMAIL_FROM="Aglyn <noreply@aglyn.com>"
```

**Both** are required. With either missing, `sendEmail()` warns and returns
`{ sent: false, reason: 'unconfigured' }` — it does not throw, so local and
preview environments run fine without a Resend account.

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
console tell a user honestly whether a message actually went out (AGL-708).

Optional fields: `html`, `headers` (e.g. `List-Unsubscribe`), `tags` (webhook
attribution), `replyTo`, and `from` (overrides the configured sender — rarely
correct, since the point of `USAGE_EMAIL_FROM` is one verified identity).

### The transport boundary

`postResendEmail()` is the only function that POSTs to Resend's send endpoint,
and it **throws** on a payload with no `to` rather than putting it on the wire.
Such a payload cannot become a message; Resend answers `422
missing_required_field`, which costs an API call and then sits in the vendor
dashboard looking exactly like mail that failed to deliver, carrying nothing
that names the code responsible. `sendEmail()` filters recipients long before
this point, so ordinary senders never meet the guard — it is there because
`RESEND_SEND_ENDPOINT` is exported and a module that fetches it directly
bypasses every check `sendEmail()` owns.

## Checking configuration

```typescript
import { isEmailConfigured, describeEmailConfig, checkEmailCredentials }
  from '@aglyn/shared-util-email'
```

- `isEmailConfigured()` — both vars present. Use it to answer `501` from a
  route instead of pretending to have sent.
- `describeEmailConfig()` — env presence plus the sender and its domain, with
  the API key never included.
- `checkEmailCredentials()` — asks Resend whether the key is accepted
  **without sending anything**, by `GET`ting the domains collection and
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
