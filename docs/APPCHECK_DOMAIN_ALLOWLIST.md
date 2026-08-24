# App Check reCAPTCHA domain allowlist

Every console origin has to be on the App Check reCAPTCHA key's
`allowedDomains`, or the browser there cannot mint an App Check token and
**every** Firestore read and every sign-in is refused. For a custom console
domain (AGL-1099) this is automated — `activateConsoleDomain` writes the entry
and refuses to mark the domain `active` if the write does not land. This doc is
the operator setup that automation depends on, and the evidence for why the
entry matters at all.

## Why an unlisted origin is fatal, not degraded

Measured against the live key on 2026-08-23 by requesting
`recaptcha/api2/anchor` with a base64 `co` origin — **both controls present**,
which is the only reason the reading means anything:

| Origin | On the key | Verdict |
| -- | -- | -- |
| `https://app.aglyn.com:443` | yes | **ACCEPTED** |
| `https://never-registered-9f3x.aglyn.com:443` | subtree of `aglyn.com` | **ACCEPTED** |
| `https://console.acme-agency.example:443` | no | **REJECTED** — "Invalid domain for site key" |
| `https://console.northwind-coffee.com:443` | no | **REJECTED** |

A rejected solve means `initializeAppCheck` → `getToken` fails with
`appCheck/recaptcha-error`, and Identity Platform then refuses the first
`signInWithCustomToken` with `401 UNAUTHENTICATED — "Firebase App Check token
is invalid"` *before* it validates the token
(`docs/design/agl-1099a-poc-findings.md` §2).

The customer-visible symptom is **"Missing or insufficient permissions"** —
the same string a Security Rules verdict produces. Anyone debugging it will
read the rules first and find nothing wrong. See
`feedback_appcheck_looks_like_permission_denied`.

## The key, and where it actually lives

The key behind `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` was auto-migrated into a
Google-created GCP project. It is **not** in `aglyn-main`, which is why years
of probes concluded it had no management API:

```
$ gcloud recaptcha keys list --project recaptcha-migrated-6c9712c2f71
SITE_KEY                                  DISPLAY_NAME
6LfnSnAbAAAAAG2PGTSOXQKQwv2snLGzMzuF1TWT  Aglyn

$ gcloud recaptcha keys describe 6LfnSnAb… --project recaptcha-migrated-6c9712c2f71 --format=json
{
  "name": "projects/52453122264/keys/6LfnSnAbAAAAAG2PGTSOXQKQwv2snLGzMzuF1TWT",
  "webSettings": {
    "allowAllDomains": false,
    "allowedDomains": ["aglyn.com", "localhost", "aglyn.app",
                       "auth.aglyn.com", "app.aglyn.com"],
    "allowAmpTraffic": true,
    "integrationType": "SCORE",
    "challengeSecurityPreference": "CHALLENGE_SECURITY_PREFERENCE_UNSPECIFIED"
  }
}
```

## Occupancy vs the limit — do not confuse them again

- The **limit** is quoted from the API reference for `WebKeySettings`: *"Each
  key supports a maximum of 250 domains."*
- The **occupancy** must be re-read every time. It was 9 entries on
  2026-08-03, 10 after AGL-1404 and **5 on 2026-08-23**. That 9 was quoted as a
  hard commercial ceiling for two weeks. A count is not a limit.

Because a listed entry covers its whole subtree but never its parents (proved
2026-08-10), the ceiling is 250 distinct **apex** domains, not 250 hostnames.
`readConsoleOriginAllowlist()` returns the live list rather than a count, for
exactly this reason.

## Operator setup

Two things, both one-time per deployment.

### 1. Grant the runtime service account write access on the key's project

The account is the one `firebase-admin` already runs as
(`FIREBASE_CLIENT_EMAIL`), and it needs `recaptchaenterprise.keys.get` and
`.update` on the project the **key** lives in — not `aglyn-main`. The
predefined `recaptchaenterprise.admin` / `.editor` roles also carry
`keys.delete` and `keys.retrievelegacysecretkey`, which a runtime identity
reachable from a console API route has no business holding, so use a custom
role:

```bash
gcloud iam roles create aglynConsoleDomainAllowlist \
  --project=recaptcha-migrated-6c9712c2f71 \
  --title="Aglyn console-domain allowlist writer" \
  --permissions=recaptchaenterprise.keys.get,recaptchaenterprise.keys.list,recaptchaenterprise.keys.update \
  --stage=GA

gcloud projects add-iam-policy-binding recaptcha-migrated-6c9712c2f71 \
  --member="serviceAccount:firebase-adminsdk-fcgi3@aglyn-main.iam.gserviceaccount.com" \
  --role="projects/recaptcha-migrated-6c9712c2f71/roles/aglynConsoleDomainAllowlist" \
  --condition=None
```

Applied on 2026-08-23. Verify it took by reading the key **as the service
account**, not as yourself — an owner account succeeding proves nothing about
the runtime:

```
GET https://recaptchaenterprise.googleapis.com/v1/projects/52453122264/keys/6LfnSnAb…
  Authorization: Bearer <token minted from FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY>
→ 200
```

Before the grant the same request returned:

```
403  Permission 'recaptchaenterprise.keys.get' denied on resource
     '//recaptchaenterprise.googleapis.com/projects/52453122264/keys/6LfnSnAb…'
```

### 2. Set `RECAPTCHA_ADMIN_KEY_NAME`

```
RECAPTCHA_ADMIN_KEY_NAME=projects/52453122264/keys/6LfnSnAbAAAAAG2PGTSOXQKQwv2snLGzMzuF1TWT
```

The last segment **must** equal `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY`; the code
refuses to write otherwise, because a resource name pointing at a different
key would be patched happily and attest nothing — a misconfiguration whose
symptom is identical to success.

Leaving it unset is only safe when `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` is also
unset (self-host, local dev): that combination means App Check is not running,
so there is no allowlist to maintain. **Site key set + admin key name unset is
a hard failure**, not a skip — under a "missing config → skip" rule such a
deployment would report every custom console domain ready while listing none
of them.

## What the automation does, and refuses to do

`libs/tenant/data/admin/src/lib/server/recaptcha-allowlist.ts`:

- reads the key, then `PATCH`es with `updateMask=webSettings.allowedDomains` —
  the narrowest path the API accepts. A mask addressing `webSettings` would
  carry whatever the caller sent and drop the siblings, and
  `allowAllDomains` dropped or defaulted to `true` is a key open to every
  origin on the internet;
- **re-reads the response** and fails unless every domain it sent is present
  and `allowAllDomains` is still `false`. A write the API accepted but did not
  apply is otherwise indistinguishable from success;
- lists the **exact** name, never relying on a parent entry's subtree cover —
  otherwise org A detaching `acme.com` would silently break org B's
  `console.acme.com`;
- lists the **serving** name only. Redirect twins (`www.acme.com` → apex) are
  308s that never execute the console and would spend a slot for nothing;
- removes only the exact entry on release. A suffix match would take
  `aglyn.com` off the key while releasing `console.aglyn.com`.

Propagation is **not instant**. Measured 2026-08-23: a newly added domain went
from REJECTED to ACCEPTED at the `api2/anchor` endpoint after ~80 s (rejected
at 0/20/40 s, accepted at 60–80 s) while an unlisted control stayed REJECTED
throughout. A customer told "your domain is ready" may still see a minute of
failures; the handoff (AGL-1902) should not be tested inside that window.

## Manual fallback

If the API path is unavailable, the entry can still be added by hand at
<https://www.google.com/recaptcha/admin/site/460344039> → **Settings** →
**Domains** → **Add a domain** → paste the bare hostname (no scheme, no path)
→ **Save**. Prefer the API: the console edit leaves no record anything else
can reconcile against.
