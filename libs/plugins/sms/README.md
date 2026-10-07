# @aglyn/plugins-sms

Text messages for Aglyn sites, behind core's `core.messaging.sms` contract
(`@aglyn/aglyn/plugin-manager/plugin-sms-messaging`). A plugin that wants to
text someone (commerce's order updates) resolves the contract; it never
imports this package.

- `sms-provider.ts` — the vendor contract (`SmsProvider`); `twilio-provider.ts`
  is the first adapter (REST over `fetch`, no SDK).
- `sms-messaging.ts` — the rules every vendor sits behind: E.164
  normalization, the platform phone suppression list (STOP), a per-workspace
  hourly ceiling, and at-cost metering to `orgs/{orgId}/smsUsage/{YYYY-MM}`.
- `sms-usage-meter.ts` — the monthly usage sweep's reading; billed at cost
  (`SMS_MARKUP` = 0).
- `server/inbound-route.ts` — Twilio's signed inbound webhook at
  `/api/sms/inbound` on the console, recording STOP and START.

Unconfigured until `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_MESSAGING_SERVICE_SID` are set; every surface offers email only until
then.
