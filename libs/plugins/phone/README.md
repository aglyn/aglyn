# @aglyn/plugins-phone

Aglyn Phone (AGL-4251): a business number per workspace, answered by its team
in Aglyn. Two-way texts, calls forwarded to cell phones, voicemail with a
transcript, calls placed from the business number, and every text and call on
the customer's CRM timeline.

Off behind the release flag `release_phone`. A workspace also needs the
`phone` entitlement, which only the $15/mo **Phone** add-on (Starter and Pro)
or a staff entitlement override switches on, and members need `phone.use`
(`phone.manage` to set it up).

## Why its own plugin, not the sms plugin grown

`@aglyn/plugins-sms` is platform infrastructure: one shared Twilio Messaging
Service for order texts, no switch, no page, reached only through core's
`core.messaging.sms`. Phone is a merchant product with a release flag, an
add-on, an org page and a Twilio **subaccount per workspace**, whose webhooks
are signed by that subaccount's own token, so they cannot share
`/api/sms/inbound`. Plugins never import each other, so Phone carries its own
small Twilio client.

## Layout

- `twilio/twilio-client.ts` — Twilio REST over `fetch` (subaccounts, numbers,
  messages, calls, A2P 10DLC brand and campaign, toll-free verification,
  porting), `fetch` injectable. `twilio/twiml.ts` — the TwiML it answers with.
- `server/phone-service.ts` — numbers, threads, texts, registration, porting.
  `server/voice-service.ts` — hours routing, forwarding, voicemail and its
  transcript, missed-call text, click-to-call. Both run on
  `server/phone-repository.ts` (Firestore, or the in-memory twin in specs).
- `server/routes.ts` — member routes behind `server/route-gate.ts`, and
  Twilio's signed `phone/hooks/*` webhooks.
- `components/*` — the console's Phone page: Inbox, Calls, Setup, Settings.
- `usage-axes.ts`, `plan-entitlements.ts`, `declarations.ts` — the add-on, its
  pool (300 minutes, 300 texts) and the two metered bands billed at cost + 30%.

## Storage

All under `orgs/{orgId}`: `phoneAccount`, `phoneNumbers`, `phoneThreads` (+
`messages`), `phoneCalls`, `phoneSettings`, `phoneCompliance`, `phonePorts`.
Top-level, server-only: `phoneNumberIndex/{e164}` and
`phoneSubaccountIndex/{sid}`. No client reads or writes any of them.

## Nothing reaches Twilio in development

Specs run on `testing/fake-twilio.ts`. The live client needs
`TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (the platform's parent account)
and `NEXT_PUBLIC_CONSOLE_URL` for the webhook origin.
