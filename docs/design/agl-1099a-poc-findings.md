# AGL-1099a PoC — does the in-memory-persistence bet hold?

**Status:** proof-of-concept complete. No feature code, no production configuration changed.
**Tests the bet in:** `docs/design/agl-1099a-cross-domain-session-handoff.md` §5 / D6.
**Measured:** 2026-08-09.

The design names one claim as the thing that must be proved before 1099b starts:

> `initializeAuth(app, { persistence: inMemoryPersistence })` with **no**
> `popupRedirectResolver` … removes the need for Firebase authorized-domain
> entries and for `frame-ancestors`, keeps the credential prompt on an origin we
> control, and keeps a refresh token out of IndexedDB on a domain whose DNS the
> customer can re-point at themselves.

## Verdict

**The bet holds — with one correction, one downgrade, and one addition.**

| # | Claim | Verdict |
| --- | --- | --- |
| 1 | A custom-token sign-in works without an authorized-domain entry | **HOLDS** — but gated on App Check, see §2 |
| 2 | No request to `/__/auth/iframe`; no `frame-ancestors` entry needed | **HOLDS** — measured, zero requests |
| 3 | Interactive OAuth becomes structurally impossible | **HOLDS for OAuth only.** "Sign-in never happens on the custom domain, enforced structurally" (AGL-1353) is **too strong** — see §3 |
| 4 | The refresh token stays out of IndexedDB | **HOLDS** — verified by inspection — but it is **one line away from being undone**, and six such lines exist today (§4) |
| 5 | *(unstated)* Nothing else durable survives on the origin | **FALSE.** Firestore's persistent cache writes document bodies to the same IndexedDB (§5) — **fixed 2026-08-13 by AGL-1456**, which makes the cache `memory` on `ephemeral` origins; still owed a real-browser re-run of the §5 dump to confirm |
| 6 | `form_post` would destroy the verifier binding | **HOLDS** — measured, not reasoned (§6) |

**The correction that matters most:** the design says the scope reduction is that
a custom domain needs no Firebase authorized-domain entry. That is true. But it
does not reduce per-customer provisioning to zero — it **moves** it. App Check is
**enforced on Identity Platform** in `aglyn-main`, so the handoff cannot complete
at all until the customer's domain is on the App Check reCAPTCHA key's allowlist.
The design calls that "the commercial ceiling"; it is also a **hard functional
prerequisite**, and 1099d is therefore a blocker for 1099c, not a parallel track.

---

## 1. Method, and what was and was not touched

Two throwaway origins on one local process, chosen so the cross-site properties
are real rather than simulated:

- `http://127.0.0.1:8791` — stands in for `console.acme-agency.com`.
- `http://localhost:8792` — stands in for `auth.aglyn.com`.

`localhost` and `127.0.0.1` are different hosts with no registrable domain in
common, so the browser treats them as **cross-site** for `SameSite` — while both
remain "potentially trustworthy" origins, so `Secure` cookies still work over
plain HTTP. That is what makes the cookie half of the handoff testable without
provisioning a second domain.

They also differ in exactly the way this PoC needs: **`localhost` is in both
allowlists; `127.0.0.1` is in neither.** Same server, same page, same app id —
the origin is the only variable.

**Production was read, never written.** Every production probe used a
deliberately invalid custom token, so the request either fails at a gate (a
401/403 naming the gate) or reaches token validation (`400
INVALID_CUSTOM_TOKEN`) — which is the discriminator this PoC is built on. No
user was created, no domain attached, no allowlist edited, no rules deployed.
Sign-in successes were measured against the **Auth emulator**.

---

## 2. Does it work? Yes — and App Check, not authorized domains, is the gate

### Firebase's authorized-domain list is not the constraint

The list is publicly readable and has **14 entries**:

```
GET https://identitytoolkit.googleapis.com/v1/projects?key=<NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY>
→ 200
localhost, aglyn-main.firebaseapp.com, aglyn-main.web.app, admin.aglyn.com,
api.aglyn.com, vercel.app, aglyn-console.vercel.app, app.aglyn.com,
tenant.aglyn.app, auth.aglyn.io, aglyn.io, aglyn.com, auth.aglyn.com, app.aglyn.io
```

`127.0.0.1` is absent, and a custom-token sign-in from `127.0.0.1` still reached
Identity Toolkit's token validation. **Authorized domains do not gate
`signInWithCustomToken`.** The design is right, and AGL-1099's item 2 can be
dropped.

*(Incidental, for AGL-1344: the list carries both bare `vercel.app` **and**
`aglyn-console.vercel.app`. The working second console is
`aglyn-console-aglyn.vercel.app`, which is matched by the bare entry, not by the
specific one. Removing the bare entry is the effective fix; the specific entry is
separate and should be reviewed in the same pass.)*

### App Check is enforced on Identity Platform, and that is the gate

Every unattested call is refused **before** token validation, regardless of
`Origin` or `Referer`:

```
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=…
  (no App Check header; Origin/Referer varied across four probes)
→ 401 UNAUTHENTICATED  "Firebase App Check token is invalid."
```

`accounts:createAuthUri` behaves the same. This is consistent with the lore
already in the tree at `apps/console/hooks/use-presence.ts:186-196`, where a
second Firebase app without App Check had its very first
`signInWithCustomToken` rejected with `auth/firebase-app-check-token-is-invalid`.

### The decisive A/B

Identical page, identical config, only the origin differs:

| Origin | In the reCAPTCHA allowlist | `initializeAppCheck` → `getToken` | `signInWithCustomToken` |
| --- | --- | --- | --- |
| `http://localhost:8791` | **yes** | **token minted, 941 chars** | reached token validation → `auth/invalid-custom-token` ("Invalid assertion format") |
| `http://127.0.0.1:8791` | **no** | `appCheck/recaptcha-error` | `auth/firebase-app-check-token-is-invalid` |

The `localhost` row is the proof of the whole chain: with
`inMemoryPersistence` and **no** `popupRedirectResolver`, the app instance
carries an App Check token to Identity Toolkit and gets all the way to
credential validation. Only the deliberately-garbage token failed.

The `127.0.0.1` row is the proof of the constraint: the failure is at the
**reCAPTCHA solve**, i.e. the key's origin verification, not at Firebase Auth.

Against the Auth emulator, with the same in-memory/no-resolver instance:

```
signInWithCustomToken   → RESOLVED  { uid: "poc-handoff-user", isNew: true }
getIdToken()            → RESOLVED  (352 chars)
getIdToken(true)        → RESOLVED  (forced refresh works; the refresh token is in memory)
onAuthStateChanged      → [ null, "poc-handoff-user" ]
```

**Half (a) of the PoC passes.** The three-state `useUser` contract (AGL-1261)
survives intact; only the *content* of the first emission changes.

### A third allowlist: answered, and a warning

The design flags GCP API-key HTTP-referrer restrictions as an unverified risk.
Probed:

```
POST https://securetoken.googleapis.com/v1/token?key=…
  Referer: https://console.acme-agency.example/
→ 400 INVALID_REFRESH_TOKEN
```

An arbitrary hostile `Referer` passed key validation, which a referrer-restricted
key would not permit. **No referrer restriction is blocking this path today** —
though a restriction could be added later, so 1099d should still record it.

That probe surfaced something more important. `securetoken.googleapis.com` — the
**ID-token refresh endpoint** — is **not** App Check enforced. So a refresh token
is exchangeable for ID tokens **from any origin, with no attestation**. That is
precisely why keeping it out of IndexedDB matters: App Check protects the
*initial* sign-in, and protects nothing at all afterwards.

---

## 3. "Structurally impossible" is true of OAuth, and only OAuth

With `initializeAuth(app, { persistence: inMemoryPersistence })` and no resolver:

| Call | Result |
| --- | --- |
| `signInWithPopup` | **THREW** `auth/argument-error` |
| `signInWithRedirect` | **THREW** `auth/argument-error` |
| `getRedirectResult` | **THREW** `auth/argument-error` |
| `linkWithPopup` | **THREW** `auth/argument-error` |
| `reauthenticateWithPopup` | **THREW** `auth/argument-error` |

All five fail synchronously, before any network request. **Half (b) of the PoC
passes**, and the enumerated resource list for the page contains **zero**
requests matching `/__/auth/`. No auth helper iframe is loaded, so the custom
domain needs no `frame-ancestors` entry for sign-in. AGL-1099's item 3 shrinks to
the tenant-framing question the design already identified.

**But the following also ran on that same instance:**

| Call | Result |
| --- | --- |
| `createUserWithEmailAndPassword` | **RESOLVED** — account created |
| `signInWithEmailAndPassword` | **RESOLVED** — signed in |
| `new RecaptchaVerifier(...)` | **RESOLVED** — constructed |
| `signInWithPhoneNumber` | reached the network; rejected only by **App Check**, not by the missing resolver |

None of these need a `popupRedirectResolver`. Passkey sign-in
(`signInWithCustomToken` after a WebAuthn ceremony) does not either.

So the SDK configuration blocks the **federated** family and nothing else.
Nothing structural stops someone shipping a password form on the custom domain —
which is exactly the "credential prompt on an origin we control" property the
design is buying. D6's own wording ("Interactive **OAuth** becomes structurally
impossible") is accurate; **AGL-1353's summary — "sign-in never happens on the
custom domain, enforced structurally" — is not, and should be corrected before it
is quoted as a security property.**

The real control is that the custom domain must not *render* a sign-in route.
That is route-level discipline plus a test, not a consequence of `initializeAuth`.

---

## 4. The property is one line away from being undone — and six such lines exist

The most important operational finding. On an instance created with
`inMemoryPersistence`, calling `setPersistence` at runtime is **accepted**, and
the refresh token immediately goes to disk:

```
before setPersistence   refresh token in persistent storage: ABSENT
setPersistence(auth, browserLocalPersistence)   → RESOLVED "accepted"
re-sign-in
after  setPersistence   refresh token in persistent storage: PRESENT
```

The console calls exactly that, today, in **six** places:

- `apps/console/app/(auth)/signin/page.tsx:108`
- `apps/console/app/(auth)/signup/page.tsx:256`
- `apps/console/app/(auth)/sso/page.tsx:146`
- `apps/console/components/session-reauth-dialog.component.tsx:205`
- `apps/console/utils/passkeys.ts:133`
- `libs/shared/util/fbclient/src/lib/controllers/app-controller.ts:422`

Any one of them reached on a custom console domain silently re-persists a refresh
token to an origin whose DNS the customer controls — no error, no warning, and
the post-detach hazard is back in full.

There is also a **second auth instance**: `apps/console/hooks/use-presence.ts:340`
does `getAuth(presenceApp)` on a separately-initialized app with default
persistence. Changing only the shared provider leaves presence persisting.

**Therefore the design must not describe this as structural.** It is a
convention with six existing violations and two instances to configure. It needs
a guard — a lint rule or a runtime assertion on custom-domain hosts — and
§7 needs a test that asserts the refresh token is absent from IndexedDB after
sign-in, not merely that `initializeAuth` was called with the right argument.

---

## 5. Does the refresh token stay out of IndexedDB? Yes. Does everything else? No.

Verified by dumping **every** IndexedDB database and object store on the origin,
then searching the whole dump for the exact `refreshToken` string held in memory.
Two apps signed in on the same origin at the same time, one in-memory, one
`indexedDBLocalPersistence`:

```
refreshTokenSearch: {
  inMemoryAuthRefreshToken:     "ABSENT",
  controlLocalAuthRefreshToken: "PRESENT"
}
```

`firebaseLocalStorageDb → firebaseLocalStorage` held exactly **one** row — the
control's — with the refresh token in plaintext under
`stsTokenManager.refreshToken`. The in-memory instance wrote nothing.

After a full page reload on that origin:

```
afterReload: { inMemoryAuth: null, indexedDbAuth: "control" }
```

**The design's stated reason the post-detach hazard goes away is correct.**

### But the claim as written is too broad

D6 says "the only credential that survives a tab close is our `HttpOnly` cookie."
The console also initializes Firestore with
`persistentLocalCache({ tabManager: persistentMultipleTabManager() })`
(`libs/tenant/feature/instance/src/lib/hooks/firebase/firebase-services.tsx:181-190`).
Running that exact configuration and reading one document put the **document
body** in the origin's IndexedDB:

```
firestore/<app>/<project>/main → remoteDocumentsV14:
  { collectionGroup: "orgSlugs", documentId: "aglyn",
    document: { fields: { orgId: { stringValue: "org_SENTINEL_VALUE_9f3a" } … } } }
```

(A sentinel value seeded into the emulator, then found in IndexedDB — the cache
stores full document contents, not just metadata.) Plus `localStorage` keys
`firestore_clients_…`, `firestore_online_state_…`, `firestore_sequence_number_…`.

So after a detach and a DNS re-point, the new controller of that origin cannot
harvest a **credential** — but can read every org, host, member and settings
document the console cached there. That is customer data, not account takeover,
and it is a materially smaller problem — but the design should say so rather than
claim the origin is clean. `firebase-app-check-database` is likewise created on
the origin (empty in these runs; it would hold a short-lived App Check token in
production).

**Recommendation:** detach must also instruct the client to clear the Firestore
cache, or the custom domain should run Firestore with `memoryLocalCache()`. The
latter interacts with AGL-1066 (the cached-emission staleness signal) and should
be decided deliberately, not inherited.

> **Decided 2026-08-13 (AGL-1456): `memoryLocalCache()`, and not clear-on-detach.**
> Clearing on detach only reaches a browser that comes back to the origin, and a
> browser that comes back is not the threat — the threat is the profile that
> already stopped visiting. `localCacheFor()` in
> `libs/tenant/feature/instance/src/lib/hooks/firebase/firestore-cache.ts` keys
> the cache off the same `authPersistence` declaration that selects the auth
> persistence class, so `ephemeral` gets both or neither.
>
> On the AGL-1066 interaction, which this note was right to flag: the effect is
> **in the safe direction** for these hosts. `fromCache` and `serverDenied` are
> per-listener facts and are untouched. What changes is that a listener whose
> server listen is being refused no longer has a disk-warm cache to keep serving
> arbitrarily-old data from on a fresh page load — the fault surfaces instead of
> being papered over, which is the behaviour AGL-1066 wishes it had everywhere.
> The retry loop AGL-1440 §1 describes is unchanged; it is keyed on denials, not
> on the cache.
>
> The LRU collector (`memoryLruGarbageCollector()`) rather than the eager
> default is a read-cost mitigation only — both are memory-only, so the security
> property is identical.

---

## 6. The handoff shape — what was testable, and what it showed

Implemented end to end across the two origins: verifier cookie planted host-only
(`HttpOnly; Secure; SameSite=Lax`), 303 to the auth host, `location.replace`
back with `{rid}.{S}` in the fragment, `history.replaceState`, same-origin POST
to redeem.

| Property | Result |
| --- | --- |
| Fragment reaches either server's access log | **No.** The auth host logged only `?handoff={rid}`; the custom domain logged `GET /auth/handoff` with no fragment. Verified against the servers' own request lines |
| Fragment cleared from the address bar | Yes — `hashAfterReplaceState: ""` |
| Verifier cookie rides the **cross-site GET** return leg | **Yes** — `sec-fetch-site: cross-site`, cookie present. `SameSite=Lax` permits it |
| Verifier cookie rides a **cross-site POST** (`form_post`) | **No** — `rawCookieHeader: null`. **D1's reason for rejecting `form_post` is now measured, not argued** |
| Redemption POST is same-origin with the verifier | Yes — `Origin: http://127.0.0.1:8791`, `sec-fetch-site: same-origin` |
| Replay of the same `{rid, S}` | **401** `status-redeemed` |
| `Secure` cookie accepted on a trustworthy non-HTTPS origin | Yes (a property of the harness, not of production) |

**Single use as a real Firestore transaction** (design §7 test 1, which requires
concurrency — a serial test does not exercise the property). Against the
Firestore emulator, with every check inside the transaction and the transaction
always writing the document it read:

```
concurrent:  8 attempts → 1 succeeded, 7 failed, all with "status-redeemed"
noVerifier:               PASS — refused (verifier-mismatch)
wrongSecret:              PASS — refused (secret-mismatch)
wrongHost:                PASS — refused (host-mismatch)
failedAttemptDoesNotBurn: PASS — the legitimate holder can still redeem
```

Exactly one winner under contention. The `passkeys.ts` shape D2 adopts is sound
here, and the last case is worth keeping as a named test: a **failed** attempt
must not consume the record, or a wrong guess becomes a denial-of-service against
the legitimate user.

### One correction to D1's headers

The design puts `Referrer-Policy: no-referrer` on `/auth/handoff`. That governs
requests made *from* that page. The referrer on the **return navigation** is
controlled by the **auth host's** response. Measured, the default policy already
strips it to the origin (`http://localhost:8792/`, no path, no `rid`), so nothing
leaks — but if the auth host's policy is ever loosened, the `rid` would appear in
the custom domain's access log. Set the policy on both ends.

---

## 7. What could not be tested without a real second domain

Stated plainly rather than simulated:

1. **Whether a real customer domain, once added to the App Check reCAPTCHA
   allowlist, actually attests.** The `localhost` control proves an allowlisted
   origin attests and that the chain completes. It does not prove the allowlist
   accepts an arbitrary customer FQDN, how long propagation takes, or whether
   the entry can be added by API. That last question is still blocked on the
   unresolved GCP project-ownership item in the design's §5.
2. **The 250-domain ceiling**, and whether it applies to this key at all
   (classic v3 vs Cloud-managed). Not measurable from here.
3. **`Secure` cookie behaviour under a customer's own TLS/DNS**, and the two
   latent defects that depend on it (`cookieAttributes` gating `Secure` on
   `onWorkspaceDomain`; `rejectUnknownWorkspaceHost` returning `null`). The
   harness's origins are trustworthy-by-fiat, so it cannot exercise the failure.
4. **Real cross-registrable-domain `SameSite` behaviour under Safari ITP and
   Chrome's third-party-cookie changes.** The `localhost`/`127.0.0.1` pair is
   cross-site by the same rule, but browser heuristics keyed on eTLD+1 may differ.
   The verifier is host-only and first-party, so this is expected to be fine —
   expected, not measured.
5. **Whether the tenant app's `frame-ancestors` admits a custom console domain**
   for the besigner canvas and preview. Unchanged from the design's own note.

---

## 8. Recommendation

**1099b is safe to start**, with four amendments carried into it:

1. **Re-order the split.** 1099d (the App Check reCAPTCHA allowlist) is now a
   **blocker for 1099c**, not a parallel workstream. A domain that attaches and
   routes but cannot attest produces a console that renders and can never sign
   anyone in — the exact "looks finished" failure AGL-1099 warns about. Resolve
   the key's manageability *before* the first domain is attached.
2. **Downgrade "structural" to "enforced".** Correct AGL-1353's summary. Add a
   guard against `setPersistence` on custom-domain hosts, configure the presence
   app too, and write the test as "no refresh token in IndexedDB after sign-in"
   rather than "we passed the right argument".
3. **Decide the Firestore cache.** In-memory auth persistence does not make the
   origin clean. Either clear the cache on detach or run `memoryLocalCache()`
   there. — **Done (AGL-1456): `memoryLocalCache()`, keyed off the same
   `authPersistence` declaration.** See the decision note in §5.
4. **Keep the concurrency test.** The five cases in §6 are the ones that would
   catch a regression; the concurrent one is the only one that tests the actual
   property, and `failedAttemptDoesNotBurn` is missing from the design's §7 list.

Nothing measured here invalidates the design. The mechanism works, the security
property is real, and the two claims the design offered for falsification both
survived. What changed is the shape of the cost: the per-customer provisioning
step does not disappear, it moves to a list with a documented ceiling and an
unresolved automation story — and the "structural" guarantee is a discipline that
needs a guard.
