# AGL-1855 — TOTP MFA for non-SSO accounts: design, and what it costs

Status: **designed, not started.** Recommendation is **do not ship before
Sept 1** — reasoning in "Verdict up front". Written 2026-08-20 against
`b20d46912`.

Scope: the customer console (`app.aglyn.com`). Firebase Authentication /
Google Cloud Identity Platform. TOTP only.

## Verdict up front

Build it, but not in the twelve days before the first paying customers arrive.

The design below is small in the sense that matters to a planning meeting —
one enrolment card, one challenge step, one staff action, no schema — and
large in the sense that matters to a launch: **it modifies the sign-in path,
and it cannot be exercised anywhere but production.**

Three facts drive the recommendation, each established rather than assumed:

1. **The Firebase Auth emulator does not implement TOTP.** It is SMS-only.
   So there is no local, no CI and no `console-e2e` coverage available for any
   part of this, and the first real execution of the enrolment and challenge
   flows would be against live Identity Platform. Details and evidence below —
   the estimate on the issue assumed the opposite.
2. **It adds a new permanent-lockout class**, on a product that already has a
   live one (AGL-1888). A person who loses their authenticator cannot get back
   in by resetting their password: a password reset does not clear enrolled
   second factors. The only door is staff-mediated, and the support process
   that would open it does not exist yet.
3. **The first thing it breaks is not the sign-in page.** It is the password
   change form, which re-authenticates by calling
   `signInWithEmailAndPassword` — see "What breaks on day one". That is a
   bug we would be shipping into the launch window, not a feature.

What we can say to a security questionnaire in the meantime is already true
and already published in the shape reviewers expect: SSO orgs get MFA at their
own IdP and we do not permit a bypass around it (AGL-1128/1129), passkeys are
available and phishing-resistant, and the trust page leads with what we do not
have. Adding "TOTP for password accounts — on the roadmap, not shipped" to
that list costs a sentence.

**Estimate: 5–7 engineering days** for phase 1, plus a support runbook, plus a
production smoke that cannot be rehearsed. Phase 2 (org-level enforcement)
is **3–4 days on top**, and is larger than it sounds because the enforcement
machinery it would "reuse" is not the shape it needs. The issue's 3–5 / 1–2
was costed against emulator-backed tests and an interstitial that exists.
Neither is real.

## Decisions to record

These are product decisions, made here so they are not re-litigated in review.

| Decision | Why |
| -- | -- |
| **TOTP only. No SMS.** | Per-message cost, SIM-swap, and a phone-number PII store on every enrolled account — the last is the expensive one, because it is a new class of personal data with retention and export obligations attached. Identity Platform lets us enable TOTP without enabling SMS; do that. |
| **No recovery codes in v1.** | Recovery codes are a second credential store we would own, back up, rotate, display once, and support. Firebase does not provide them, so it is a from-scratch subsystem. Staff-mediated reset covers the same failure at a tenth of the code — at the cost of a support ticket, which at our current customer count is the correct trade. Revisit when the volume makes it wrong. |
| **A passkey satisfies the second-factor requirement.** | A passkey is possession plus user verification; it is already multi-factor. Nagging a passkey user to add TOTP pushes them back toward passwords, which is backwards. This has a mechanical consequence — see "The passkey bridge cannot be challenged". |
| **SSO accounts never get a second factor from us.** | Their IdP owns MFA. This is enforced structurally rather than by a UI check: see "Why an SSO user cannot enrol, structurally". |
| **Staff accounts are in scope, not a separate project.** | Staff sign in through the same console with a `staff` custom claim, in the same project pool (`apps/console/app/api/auth/staff-self-check/route.ts`). They are the highest-value accounts we have. Any MFA we ship for customers covers them by construction — which is good, and means the staff lockout risk is *our* risk first. |

## Facts established

### There is no MFA code in the repo

`multiFactor`, `MultiFactor`, `TotpMultiFactor`, `totp`, `otpauth` — zero hits
across `apps/` and `libs/` at `b20d46912`. Confirmed, not inherited from the
issue.

Two things do exist and are misleading:

- `libs/shared/data/enums/src/lib/firebase-auth.ts` already carries the
  strings `MFA_REQUIRED` ("Multi-factor authentication is required."),
  `MFA_INFO_NOT_FOUND` and `INVALID_MFA_SESSION` in `AuthErrorMessage`. They
  are generic copy with no flow behind them. `MFA_REQUIRED` is **not** in
  `AuthErrorNotice`, so if it ever fired today it would render as a red
  terminal error with no way to continue.
- `qrcode.react` is already a dependency (used by the commerce POS page), so
  QR rendering is free.

### The SDKs we are on already support it

- `firebase` 12.17.1 — `TotpMultiFactorGenerator.generateSecret` /
  `assertionForEnrollment` / `assertionForSignIn`, `TotpSecret`,
  `TotpSecret.generateQrCodeUrl(accountName, issuer)`,
  `getMultiFactorResolver`. All present in the installed typings.
- `firebase-admin` 14.2.0 — `TotpMultiFactorInfo` exists in
  `user-record.d.ts`, so `getUser(uid).multiFactor.enrolledFactors` **reads**
  TOTP factors. Staff can see whether an account has one.

### But the Admin SDK cannot write a TOTP factor — only clear all of them

`UpdateMultiFactorInfoRequest = UpdatePhoneMultiFactorInfoRequest`. The write
side models phone only. What it *can* do is
`updateUser(uid, { multiFactor: { enrolledFactors: null } })`, documented as
"all of the user's existing second factors are removed".

That is enough for staff-mediated recovery, and it is the whole of what staff
recovery can be: **clear everything, the customer re-enrols.** There is no
selective removal. Since we offer exactly one factor type this is not a
practical limit — but it is a fact to verify against a real account before
building the UI around it, not to assert from typings.

### Project-level MFA config is not settable from the Admin SDK

`MultiFactorConfig` (`state`, `factorIds`, `providerConfigs` with
`totpProviderConfig.adjacentIntervals`) is on **tenant** config. Project-level
MFA is a one-time change in the Identity Platform console or via
`identitytoolkit projects.updateConfig`. So the prerequisite really is a
console toggle, as the issue said — and it is not something a deploy can do,
which means it needs to be recorded somewhere durable. `docs/FIRESTORE_MANUAL_CONFIG.md`
and `docs/STORAGE_MANUAL_CONFIG.md` are the existing precedent for
"configuration that lives outside the repo"; this belongs beside them.

### The Auth emulator is SMS-only — this is the load-bearing cost

firebase-tools 15.24.0, `lib/emulator/auth/operations.js`:

```js
function mfaEnrollmentStart(state, reqBody) {
  assert((state.mfaConfig.state === "ENABLED" || state.mfaConfig.state === "MANDATORY") &&
    state.mfaConfig.enabledProviders?.includes("PHONE_SMS"),
    "OPERATION_NOT_ALLOWED : SMS based MFA not enabled.");
  ...
  assert(reqBody.phoneEnrollmentInfo, "INVALID_ARGUMENT : ((Missing phoneEnrollmentInfo.))");
```

`mfaEnrollmentFinalize` is the same shape and requires `phoneVerificationInfo`.
The string `totp` appears in `lib/emulator/auth/` **only** in `apiSpec.js` —
the generated OpenAPI schema — and in none of `operations.js`, `state.js`,
`handlers.js`. The emulator knows the request *shape* and implements none of
the behaviour.

Consequences, stated plainly because they are the reason for the verdict:

- `docs/E2E_LOCAL.md`'s emulator suite cannot cover enrolment or the sign-in
  challenge. Neither can `apps/console-e2e`.
- What we *can* test is the code around the SDK calls with the SDK mocked.
  That is the exact shape memory has burned us on twice — a test double that
  does not model real semantics manufactures false greens. A mock that returns
  a `TotpSecret` and a resolver proves our branching, and proves nothing about
  whether Identity Platform accepts the call.
- Therefore the real verification is a manual production smoke on a throwaway
  account: enrol, sign out, sign in with a code, use a wrong code, use an
  expired code, unenrol, staff-clear, re-enrol. That is a checklist a person
  runs, not a suite CI runs, and it has to be re-run after any change to the
  sign-in path forever.

If someone wants to reduce this cost, the only lever is a hermetic fake of
the `identitytoolkit` MFA endpoints, which is a project of its own and would
itself be an unfaithful double.

## What breaks on day one

These are not new features. They are existing code paths that change behaviour
the moment the first account enrols, and they have to be in phase 1.

### 1. The password change form re-logs-in, and will hard-fail

`apps/console/app/(app)/manage/user/page.tsx:443-461` — `handleSecuritySave`
calls `signInWithEmailAndPassword(firebaseAuth, user.email, oldPassword)` and
then `updatePassword`. Once TOTP is enrolled that call throws
`auth/multi-factor-auth-required`, and the current `catch` renders
``Error: ${JSON.stringify(e)}`` into a snackbar.

So the first thing an enrolled user sees is a JSON blob where "change
password" used to be. This must become `reauthenticateWithCredential` with the
same resolver flow as sign-in. (The `JSON.stringify` snackbar is a
pre-existing defect regardless of MFA — it is the generic catch on that form.)

### 2. Google sign-in throws it too

`auth/multi-factor-auth-required` is not password-specific. The Google popup
path (`signInWithPopup`) and the mobile redirect path
(`apps/console/hooks/use-google-redirect-result.tsx`) both need the resolver.
Handling only the password form ships a flow where enrolled users can sign in
one way and not the other.

### 3. `MFA_REQUIRED` is classified as a hard error

It needs to move into `AuthErrorNotice` (the amber, recoverable class that
already holds `CREDENTIAL_TOO_OLD_LOGIN_AGAIN` and `PASSKEY_NOT_COMPLETED`),
or the challenge step will render underneath a red "something went wrong".

### 4. `close` and `export` gate on `auth_time`, and a challenge moves it

`apps/console/app/api/account/close/route.ts` (5 min) and
`.../export/route.ts` (60 min) refuse on a stale `auth_time`. A second-factor
sign-in issues a fresh `auth_time`, so these get *more* correct, not less.
Worth a test either way — `auth_time` is also what
`apps/console/app/api/_lib/device-revocation.ts` compares against, and that
one is a lockout mechanism.

## Design

### Enrolment

Lives in the **Security** section of `/manage/user`
(`apps/console/app/(app)/manage/user/page.tsx`, `sections` entry `security`),
below the password form and beside `<PasskeysCard />`. A new
`TwoFactorCard` component, same shape as `PasskeysCard`.

States: not enrolled → set up → enrolled.

Setup flow, all client-side against the Firebase SDK — **no new API route,
because there is nothing for a server to hold**:

1. `multiFactor(user).getSession()`
2. `TotpMultiFactorGenerator.generateSecret(session)` → `TotpSecret`
3. Render `secret.generateQrCodeUrl(user.email, 'Aglyn')` through the existing
   `qrcode.react`, plus `secret.secretKey` as selectable text for people
   entering it by hand. Both, always — a QR alone fails anyone whose
   authenticator is on the same device as the browser.
4. The person enters one 6-digit code →
   `TotpMultiFactorGenerator.assertionForEnrollment(secret, code)`
5. `multiFactor(user).enroll(assertion, displayName)` where `displayName` is
   a short label the person can type ("iPhone", "1Password"), defaulted, so
   the enrolled-state card and any future second factor are distinguishable.

Gates before step 1:

- **Email verified.** Identity Platform refuses enrolment on an unverified
  email (`UNVERIFIED_EMAIL : Need to verify email first before enrolling
  second factors`). The console already requires a verified email to mint a
  session, so this holds — but surface it as a message rather than letting the
  SDK error through.
- **Recent login.** `enroll` requires it, and this is **new behaviour for this
  page**: passkey enrolment has no freshness check today
  (`requirePasskeyEligibleUser` checks tenant and email verification, not
  `auth_time`). Reuse the `close-account-card.component.tsx` pattern —
  `reauthenticateWithCredential` for password accounts,
  `reauthenticateWithPopup(user, reauthProvider(user))` otherwise — rather
  than `SessionReauthDialog`, which is for an expired session and not for
  "prove it is you before a sensitive change".
- **Not an SSO account.** Structural, see below; the card is simply not
  rendered when `ssoGoverned`.

### Where the secret lives, and who can read it

Nowhere we control, and nobody at Aglyn.

The TOTP shared secret is generated by Identity Platform and returned to the
enrolling browser exactly once, inside the `TotpSecret` object, so it can be
shown as a QR and a key. **It is never sent to an Aglyn server, never written
to Firestore, and is not readable afterwards by anyone** — not by staff, not by
the Admin SDK, not by a database dump. `getUser(uid).multiFactor.enrolledFactors`
returns a `TotpMultiFactorInfo` carrying an enrolment id, a display name and an
enrolment time. No secret.

This is the single best property of the design and the reason for doing it in
the SDK rather than rolling our own TOTP: **a full compromise of our Firestore
and our Admin credentials does not yield anybody's second factor.** It is also
why recovery cannot be "staff read the secret back to you" — there is nothing
to read.

The corollary is the one to write on the support runbook: *if the browser tab
is closed between step 3 and step 5, the secret is gone and setup starts over.*

### Sign-in challenge

In `apps/console/app/(auth)/signin/page.tsx`, and in the Google redirect
result hook, and in the password-change reauth:

1. Catch `auth/multi-factor-auth-required`.
2. `getMultiFactorResolver(auth, error)` → `resolver.hints`.
3. Since we offer exactly one factor type, pick `hints[0]` rather than
   building a chooser. Assert `factorId === TotpMultiFactorGenerator.FACTOR_ID`
   and fall through to a plain error if it is not — that is the branch which
   fires if SMS is ever enabled by accident, and it should say so rather than
   crash.
4. Swap the form for a 6-digit code step (`inputMode="numeric"`,
   `autoComplete="one-time-code"`, paste-friendly, no auto-submit on the sixth
   character — people paste and people mistype).
5. `TotpMultiFactorGenerator.assertionForSignIn(hints[0].uid, code)` →
   `resolver.resolveSignIn(assertion)`.
6. From there the existing path is unchanged: the resulting `UserCredential`
   produces an ID token, and `POST /api/auth/session` mints `__session` as
   today.

Error paths that need real copy, because this is where enrolled users get
stuck: wrong code, code reused, clock drift (the most common and the least
guessable — say "check your phone's clock"), too many attempts
(`TOO_MANY_ATTEMPTS_TRY_LATER`), and the resolver session expiring
(`INVALID_MFA_SESSION`) which must send them back to the start of sign-in
rather than leaving a dead form.

Identity Platform's `adjacentIntervals` (TOTP clock-skew tolerance) is a
project config knob. Leave it at the default; note it exists so the first
clock-drift support ticket does not turn into an investigation.

### Interaction with the session/cookie model

Almost none, and that is deliberate.

`apps/console/app/api/auth/session/route.ts` mints `__session` (14 days,
`HttpOnly`, `SameSite=Lax`, `Secure`, `Domain=.{WORKSPACE_DOMAIN}` on the
workspace domain) from a verified ID token, with `checkRevoked` on both the
mint and the exchange. The challenge happens **before** an ID token exists, so
the mint sees a normal token and needs no change to work.

What it *should* gain, as defence in depth:

- **Read `firebase.sign_in_second_factor`.** Nothing in the repo reads it
  today. For a user whose Admin-SDK record shows an enrolled factor, a mint
  presenting a token with no second-factor claim means the client skipped the
  challenge — which should not be possible, and is exactly the kind of thing
  worth refusing rather than trusting. One `getUser` per mint is too expensive;
  the cheap version is to refuse only when the *claim is absent and the token's
  `sign_in_provider` is `password`*, and to accept everything else. Cheap, but
  see the next section before writing it.

Not changed: session lifetime (a second factor at sign-in does not justify a
longer cookie, and shortening it for enrolled users punishes the people doing
the right thing), the idle-logout hook, the device list, or per-device
revocation.

Enrolling and unenrolling **must** call `revokeRefreshTokens` on the owning
pool, via the existing `apps/console/app/api/_lib/device-revocation.ts` path —
the whole point of adding a factor is that sessions predating it were held
under weaker terms. That library already documents the three gates and the
`auth_time` epoch comparison; do not build a second mechanism beside it.

### The passkey bridge cannot be challenged

`apps/console/app/api/auth/passkeys/signin/verify/route.ts` finishes a passkey
sign-in with `createCustomToken(uid)` and the browser calls
`signInWithCustomToken`. Firebase does not apply an MFA challenge to a
custom-token sign-in, and the resulting token carries no
`sign_in_second_factor`.

So: **a passkey sign-in bypasses the TOTP challenge, silently, and there is no
configuration that changes that.** Given the decision above — a passkey is
already multi-factor — this is the behaviour we want. But it has to be said
out loud in three places or it will be discovered as a "vulnerability":

1. In the enrolment card's copy, so a user with both does not believe TOTP is
   gating every sign-in.
2. In whatever the defence-in-depth mint check does — the check must not
   refuse a custom-token sign-in for lacking a second-factor claim, or
   passkeys stop working the day the first person enrols TOTP. This is the
   trap in the paragraph above, and it is why the refusal is scoped to
   `sign_in_provider === 'password'`.
3. On the trust page, if we claim MFA. "MFA on password sign-in; passkey
   sign-in is itself multi-factor" is a true sentence. "MFA on all sign-ins"
   is not.

### Why an SSO user cannot enrol, structurally

SSO accounts live in a **per-org GCIP tenant**, not the project pool
(`sso.tenantId` on `orgs/{orgId}`). MFA configuration is per-pool: enabling
TOTP on the project config does not enable it on any tenant, and tenants
default to MFA `DISABLED`.

So an SSO user cannot enrol even if a UI bug showed them the card — the
`getSession()` call fails at the pool. The UI check (`ssoGoverned`, already
computed on the `/manage/user` page) is a courtesy, not the control. That is
the right way round, and it is the same posture passkeys already take
(`requirePasskeyEligibleUser` refuses `decoded.firebase?.tenant` with
`sso-tenant-unsupported`).

**Standing rule to write down:** whoever enables TOTP in the Identity Platform
console must enable it on the **project**, and must leave every tenant's MFA
config alone. A tenant-level enable would silently start offering a second
factor to an org whose IdP already provides one, which is the thing the SSO
customer bought their way out of.

### Losing the device

The honest version, because the fallback path is what a security reviewer
actually asks about.

**A password reset does not clear MFA.** `account-recovery` →
`/api/auth/send-password-reset` mints an out-of-band code and changes the
password; the enrolled factor survives. So a person who has lost their
authenticator and reset their password still cannot sign in. This must be said
in the reset email flow or it produces a support ticket that reads like a bug.

Ways back in, in order of preference:

1. **A second enrolled factor.** Identity Platform allows more than one. The
   enrolment card should invite a second one ("add a backup authenticator")
   rather than treating enrolment as done — the cheapest recovery is the one
   that needs no support at all.
2. **A passkey.** A user with a passkey signs in through the bridge, which is
   not challenged, and can unenroll from `/manage/user` themselves. Worth
   saying in the enrolment card copy: *add a passkey and you have your own way
   back*.
3. **Staff-mediated clear.** New `clearMfa` action on
   `apps/console/app/api/admin/users/manage/route.ts`, which already has the
   right machinery: an `ACTIONS` allow-list, `authForPool` so it lands on the
   pool the uid really lives in (AGL-2005), `adminAudit`, and a **required
   free-text reason** (the `erase` action's pattern — copy it; a factor reset
   is an identity decision and the reason is the only record of who was
   verified and how). Implementation is
   `updateUser(uid, { multiFactor: { enrolledFactors: null } })` followed by
   `revokeRefreshTokens`, and a `notifyUsers` message to the account so the
   clear is never invisible to its owner.

What does not exist and has to be written: **the identity-verification
procedure staff follow before running (3).** Without it, `clearMfa` is a
support-social-engineering hole with an audit log attached. This is a
`docs/staff-console/` page and a decision about what counts as proof, and it
is the real reason phase 1 is 5–7 days and not 3.

**Lockout risk is not hypothetical here.** `sso-enforcement.ts` already
refuses to run without a designated break-glass account because
`zach@aglyn.com` is in a permanent-lockout state today (AGL-1888). If staff
accounts enrol TOTP and the staff who can run `clearMfa` are the same people,
the recovery path can be locked behind the thing it recovers. Before any staff
account enrols: at least two staff, at least one with a passkey, and the
Firebase console as the true break-glass.

### Console UI, in full

| Surface | File | Change |
| -- | -- | -- |
| Two-factor card | new `apps/console/components/two-factor-card.component.tsx` | not-enrolled / setup / enrolled; QR + manual key; label; remove; "add a backup" |
| Security section | `apps/console/app/(app)/manage/user/page.tsx` | mount the card; extend the reauth gate to enrolment |
| Password change | same file, `handleSecuritySave` | `reauthenticateWithCredential` + resolver; stop rendering `JSON.stringify(e)` |
| Sign-in | `apps/console/app/(auth)/signin/page.tsx` | catch, resolver, code step |
| Google redirect | `apps/console/hooks/use-google-redirect-result.tsx` | same |
| Error classes | `libs/shared/data/enums/src/lib/firebase-auth.ts` | `MFA_REQUIRED` → `AuthErrorNotice`; real copy for the four stuck states |
| Staff user manage | `apps/console/app/api/admin/users/manage/route.ts` + its admin UI | `clearMfa` action, required reason, audit, notify |
| Staff user detail | admin users UI | show "Two-factor: enrolled 2026-08-20 (iPhone)" from `TotpMultiFactorInfo` — staff cannot answer "do they have MFA?" today |
| Session mint | `apps/console/app/api/auth/session/route.ts` | optional `sign_in_second_factor` check, scoped to `sign_in_provider === 'password'` |

Docs: `apps/docs/docs/workspace-and-billing/manage-account.md` (the Security
section currently says only "Change your password"),
`.../signing-in-and-sessions.md`, `apps/docs/src/pages/trust.md`
(Authentication currently lists neither passkeys nor MFA), and a
`docs/staff-console/` page for the verification procedure. `DOCS_HELP_TOPICS`
picks up new pages through `tools/scripts/generate-docs-help.mjs` — regenerate
and let `docs-links.spec.ts` gate it.

## Phase 2 — org-level enforcement, and why it is not cheap

The enterprise ask is `requireMfa` on the org: every member must have a second
factor.

The issue suggests piggybacking `libs/tenant/data/admin/src/lib/server/sso-enforcement.ts`.
That machinery is the wrong shape, and it is worth being precise about why,
because "reuse the SSO pattern" reads as a small job.

`enforceSsoSignInMethods` is a **one-time destructive sweep**: it lists the
org's tenant pool, strips non-IdP providers, revokes tokens, audits, notifies,
and refuses if the org would be locked out. There is no per-request gate and
no interstitial anywhere in it. A non-compliant member is stopped because
their password no longer exists.

MFA enforcement cannot work that way. You cannot strip an absent factor, and
you must not lock out a member who has simply not enrolled yet. It needs the
thing that does not exist: **a per-request policy gate that lets a
non-compliant member reach exactly one page — the enrolment card — and nothing
else.** The nearest existing shapes are `ssoDomainRefusal` (a 403 from the
session mint, all-or-nothing) and the legal-reacceptance banner (non-blocking
by design). Neither is a blocking-but-escapable interstitial.

So phase 2 is: an `mfaRequired` flag beside `sso` on the org doc, a compliance
predicate that must count a passkey as compliant, the interstitial and its
routing exception, a grace period so turning the switch on does not evict the
whole org mid-workday, a break-glass refusal modelled on `SSO_LOCKOUT_REFUSAL`,
and an org settings card next to `org-sso-card.component.tsx`. 3–4 days, and
it inherits every testing constraint above.

Do not promise it in the same breath as phase 1.

## Execution order, when it is scheduled

1. Enable MFA + TOTP on the **project** in Identity Platform; confirm every
   GCIP tenant stays `DISABLED`. Record it beside the other manual config.
2. Fix `handleSecuritySave` and the error classification **first**, before any
   enrolment UI exists. These are the day-one breaks; landing them early means
   the enrolment work is not also the thing that broke password changes.
3. Enrolment card + reauth gate + `revokeRefreshTokens`.
4. Sign-in challenge, all three entry points.
5. `clearMfa` staff action, audit, notification, and the verification
   procedure page. Not optional and not last-if-there-is-time — it is the
   recovery path.
6. Docs and trust-page wording.
7. Production smoke on a throwaway account, by hand, from the checklist in
   "The Auth emulator is SMS-only". Then a second pass with a *staff* account,
   with a second staff member standing by.

## Open questions for the account owner

1. **Ship after Sept 1, or does a named deal need it sooner?** The
   recommendation above assumes no signed enterprise deal is blocked on this
   line item. If one is, that changes the answer and not the cost.
2. **Do staff accounts enrol first, or last?** First is better security and
   worse blast radius — we would be the first people to hit any lockout.
3. **Is a support-mediated factor reset acceptable at all**, or does the
   answer have to be self-service (which means recovery codes, and a bigger
   phase 1)?

## Defects found in passing, not part of this design

- `apps/console/app/(app)/manage/user/page.tsx` `handleSecuritySave` renders
  ``Error: ${JSON.stringify(e)}`` into a snackbar for every failure, today,
  with no MFA involved. A wrong current password shows a JSON blob.
- Passkey enrolment (`requirePasskeyEligibleUser`) has no recent-login
  requirement, while closing the account has a 5-minute one. Adding a
  credential is a lower bar than removing one.
- `apps/docs/src/pages/trust.md`'s Authentication section does not mention
  passkeys at all, though they have shipped.
