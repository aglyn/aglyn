---
sidebar_position: 3
title: Environment variables
description: Every environment variable a self-hosted Aglyn deployment reads — what it drives, where to get its value, what shape it takes, and whether changing it needs a rebuild.
---

# Environment variables

This is the per-variable reference for a self-hosted install. The setup order —
Firebase project, security rules, indexes, TTL policies, reverse proxy — is in
[Self-hosting](./self-hosting.md); read that first and keep this page open
beside it while you fill in `.env.selfhost`.

Everything here was read out of the source rather than copied from the template.
Where a variable is absent from `.env.selfhost.example`, this page says so,
because the template is what most operators actually fill in.

## Read this before you set anything {#build-vs-runtime}

:::danger Some of these are frozen when the image is built

Next.js replaces the literal text `process.env.NAME` with its value **at build
time**. It does that for three groups:

1. Anything named `NEXT_PUBLIC_*`, in both server and browser code.
2. Anything listed in a `next.config.js` `env` block — `with-aglyn.nextjs.config.js`,
   `apps/console/next.config.js` and `apps/tenant/next.config.js` each declare one.
3. Anything reachable from `apps/console/middleware.ts`, which is compiled into
   the **edge** bundle. The edge runtime has no request-time environment at all.

For every variable in those groups, changing the value in `.env.selfhost` and
restarting the container **does nothing**. There is no error and no warning: the
old value is literally compiled into the JavaScript that is running. You have to
`docker compose build` again.

Only the dot form is substituted — the bracket form `process.env['NAME']` never
is — so a variable read that way stays runtime-only even when its neighbors are
not.
:::

Every row carries a **When** column:

| When | Meaning |
| --- | --- |
| **Runtime** | Read on each request or at process start. Change it and restart the container. |
| **Build** | Frozen into the image. Change it and run `docker compose build` before `up`. |

And a **Need** column:

| Need | Meaning |
| --- | --- |
| **Required** | The deployment does not work without it. |
| **Feature** | One named feature is off without it. The row says which, and what you see. |
| **Optional** | A default applies. The row gives it. |
| **Aglyn-only** | Read by the code but only meaningful on Aglyn's own hosted deployment. Leave unset. |

---

## Firebase — identity and data {#firebase}

Firebase is not optional in self-hosting v1: Auth, Firestore, Storage, Realtime
Database and Remote Config are the platform's identity and data layer. Create a
project at [console.firebase.google.com](https://console.firebase.google.com)
and enable all of them.

### Client SDK config {#firebase-client}

**Where to get these:** Firebase console → **Project settings** → **General** →
*Your apps* → add a **Web app** → copy the `firebaseConfig` object. Each field
below maps to one key of it.

Every one is `NEXT_PUBLIC_*`, so every one is **Build**. These end up in the
browser bundle by design — Firebase web config is public, and access is
controlled by your security rules, not by hiding these values.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Required | Build | The project id, e.g. `bramble-platform`. Also the last of four sources the SAML SSO auth origin is derived from. |
| `NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY` | Required | Build | `apiKey`. Starts `AIza…`. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Required | Build | `authDomain`, e.g. `bramble-platform.firebaseapp.com`. |
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Required | Build | `databaseURL` — Realtime Database, not Firestore. Presence and live collaboration use it. |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Required | Build | `storageBucket`, e.g. `bramble-platform.firebasestorage.app`. Bare bucket name, no `gs://`. |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Required | Build | `messagingSenderId` — a numeric string. |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Required | Build | `appId`, e.g. `1:123456789012:web:abc123def456`. |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | Optional | Build | `measurementId`, `G-XXXXXXXXXX`, present only if you enabled Google Analytics on the Firebase project. Unset, Firebase Analytics is not configured and server-side conversion events carry no GA client id, so a purchase cannot be stitched back to the browser session that made it. |
| `NEXT_PUBLIC_FIREBASE_AUTH_HANDLER_HOST` | Optional | Build | A branded host serving `/__/auth/handler` and used as the SAML ACS origin. Precedence: this → `auth.<workspace domain>` → the auth domain above. A bare hostname, e.g. `auth.example.com`. It must also be a Firebase **authorized domain** and a registered OAuth redirect URI. |
| `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` | Feature | Build | The reCAPTCHA v3 **site key**, only if you enable Firebase App Check. Unset, App Check registration is skipped and the app logs one line saying so. |

:::tip App Check is per Firebase *app*, and the key has its own allowlist
If you set `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY`, the reCAPTCHA key's own domain
allowlist has to cover every origin you serve — your console host and your site
apex. reCAPTCHA matches a listed name and everything beneath it, never its
parent, so listing `example.com` does not cover `sites.example.com`.
:::

### Admin service account {#firebase-admin}

**Where to get these:** Firebase console → **Project settings** → **Service
accounts** → **Generate new private key**. That downloads a JSON file; three of
its fields become environment variables.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `FIREBASE_PRIVATE_KEY` | Required | Runtime | The `private_key` field **with its literal `\n` escapes left in place**, wrapped in double quotes: `"-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"`. The code replaces `\n` with real newlines itself. |
| `FIREBASE_CLIENT_EMAIL` | Required | Runtime | The `client_email` field, e.g. `firebase-adminsdk-x1y2z@bramble-platform.iam.gserviceaccount.com`. |
| `FIREBASE_PROJECT_ID` | Required *(setup scripts)* | Runtime | The `project_id` field. The **running apps** read `NEXT_PUBLIC_FIREBASE_PROJECT_ID`; this unprefixed one is what the `tools/scripts/*` setup, migration and backfill scripts read. Set both, to the same value. |

The Admin SDK initializes only when `FIREBASE_PRIVATE_KEY`,
`FIREBASE_CLIENT_EMAIL` and `NEXT_PUBLIC_FIREBASE_PROJECT_ID` are all present.
Miss any one and initialization is skipped silently at module load; the
containers still serve pages and `/api/health` answers `500`.

:::warning `docker run --env-file` mangles the private key
`docker run` does not strip the quotes around a value, so
`FIREBASE_PRIVATE_KEY="-----BEGIN…"` arrives with the quote characters attached
and you get `Failed to parse private key` with an OpenSSL
`DECODER routines::unsupported` stack. The quotes have to stay in the file, so
use `docker compose up`, which strips them.
:::

#### Seven template lines that nothing reads {#firebase-unused}

`.env.selfhost.example` carries the whole service-account JSON, but only the
three fields above are ever read. These seven are inert — nothing in the console,
the tenant runtime, the cloud functions or the setup scripts looks at them:

`FIREBASE_TYPE` · `FIREBASE_PRIVATE_KEY_ID` · `FIREBASE_CLIENT_ID` ·
`FIREBASE_AUTH_URI` · `FIREBASE_TOKEN_URI` ·
`FIREBASE_AUTH_PROVIDER_X509_CERT_URL` · `FIREBASE_CLIENT_X509_CERT_URL`

Nor does the Admin SDK read them behind our backs — the recurring guess, and it
is wrong. Every `initializeApp` in the product builds its credential with
`cert({ projectId, clientEmail, privateKey })`, an explicit three-field object;
that overload accepts no other fields, and no code path hands the SDK a whole
service-account object assembled from the environment. The setup scripts that
use `applicationDefault()` instead read `GOOGLE_APPLICATION_CREDENTIALS`, a
path to a JSON file, not these variables.

Leaving them blank changes nothing. They are in the template so the block reads
as a whole service account and a copy-paste from the JSON does not look
half-done.

### Firestore and Storage {#firestore-storage}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `FIRESTORE_DATABASE_ID` | Optional | Runtime | Points **every** Admin-SDK Firestore accessor — console, tenant and every `tools/scripts/*` run — at a named database instead of `(default)`. Read at call time, so a restart picks it up. Unset or empty targets `(default)`. The case for setting it is disaster recovery: `gcloud firestore databases restore` creates a new named database, and this repoints the apps at it with no code change. |
| `FIREBASE_DATABASE_URL` | Required *(setup scripts)* | Runtime | The Realtime Database URL again, for the setup scripts. The apps read `NEXT_PUBLIC_FIREBASE_DATABASE_URL`. |
| `FIREBASE_STORAGE_BUCKET` | Required *(setup scripts)* | Runtime | The bucket name again, for the setup scripts. The apps read `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`. |
| `FIRESTORE_EXPORT_BUCKET` | Optional | Runtime | Destination bucket for the scheduled Firestore export, and the bucket `/api/health/backups` inspects for backup age. Default `<projectId>-firestore-exports`. Bare GCS bucket name, no `gs://`. Point it at a bucket in a sibling project for cross-project DR. If neither the default nor your value exists, exports fail and the backups health check reports missing or stale backups. |
| `GCLOUD_PROJECT` | Optional *(scripts only)* | Runtime | Read only by the `tools/scripts/*.mjs` maintenance and backfill scripts, where it defaults to `aglyn-main`. **No app or cloud-function code reads it** — the runtime resolves the project from the Admin SDK credentials. Set it to your project id before running any script, or the script targets a project name you cannot reach and fails. |

:::note Bucket CORS is a file, not a variable
`cloud/storage-cors.json` in the repository is Aglyn's own live bucket policy —
it names `https://app.aglyn.com`, and a test asserts it stays byte-identical to
what our bucket serves. It is applied with `gcloud --cors-file`, which cannot
read environment variables. **Copy it, replace the origin with your console's,
and apply your copy.** Without that, every upload over 3 MB dies at the CORS
preflight as a generic "try again".
:::

---

## The addresses this install calls its own {#addresses}

This is the group most often left at its default, and several of the defaults
are *Aglyn's* addresses. Every one is **Build**.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CONSOLE_URL` | Required | Build | Full origin of your console, no trailing slash: `https://console.example.com`. Feeds the tenant's fallback redirect, the edit-hint return allowlist, the auth-action link base and the CSP `frame-ancestors` list. Default `https://app.aglyn.com`, so unset sends a visitor who lands on an unresolvable host to Aglyn's console and builds password-reset links on it. |
| `NEXT_PUBLIC_WORKSPACE_DOMAIN` | Required | Build | The apex organization workspaces hang off, bare: `example.com`. A workspace `acme` is advertised at `acme.example.com`. Point a wildcard `*.example.com` at your console, or that URL does not resolve. |
| `NEXT_PUBLIC_TENANT_DOMAIN` | Required | Build | The apex your published sites' subdomains hang off, bare: `sites.example.com`. **Defaults to `aglyn.app`** — Aglyn's cloud — so leaving it unset makes your console display and link every one of your sites at an address you do not control, and makes each published site advertise that address as its canonical origin to search engines, feed readers and inboxes. |
| `NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME` | Required | Build | The CNAME target your console prints and verifies in the custom-domain wizard. Normally the same value as `NEXT_PUBLIC_TENANT_DOMAIN`. Default `sites.aglyn.app`. |
| `AGLYN_TENANT_HOST_CNAME` | Required | Build | **The same value again, without the prefix.** This is the load-bearing half: the tenant middleware matches the incoming `Host:` header against it. Leave it blank and nothing matches, so every visitor to every published site is redirected to your console — the deployment looks broken rather than misconfigured. Inlined through `apps/tenant/next.config.js`, so it must be right before `docker compose build`, not merely before `up`. |
| `NEXT_PUBLIC_AGLYN_TENANT_APEX_ADDRESSES` | **Set it** | Build | Comma-separated IPv4 addresses the custom-domain wizard tells a customer to point an **apex** domain at. **Default is Vercel's anycast set** (`216.198.79.1`, `76.76.21.21` and three more) — Aglyn's own infrastructure. Unset, your console instructs your customers to point their apex DNS at a network you do not run. |
| `AGLYN_TENANT_APEX_ADDRESSES` | **Set it** | Runtime | The same list again, server-side, used when `/api/domains/verify` checks an apex. Set both to the same value: setting only this one leaves the wizard printing the default list while the route verifies yours. |
| `NEXT_PUBLIC_APP_URL` | Optional | Build | Base for the staff enterprise-billing Stripe checkout return URL, used only when the request supplies no `Origin`. Default `https://app.aglyn.com`. This is the only reader; everything else uses `NEXT_PUBLIC_CONSOLE_URL`. |
| `NEXT_PUBLIC_DOCS_ORIGIN` | Optional | Build | Where **every** documentation link points: AI-assist citations, console help, besigner help, and the `documentation` URL your own REST API returns. Default `https://docs.aglyn.com` — this documentation, which stays broadly correct for a self-host install. Point it at your own build of `apps/docs` if you publish one. |
| `NEXT_PUBLIC_AGLYN_DOCS_URL` | Deprecated | Build | The older name for the same thing, still honored so an existing install does not break. `NEXT_PUBLIC_DOCS_ORIGIN` wins where both are set. Setting only this one retargets the console and besigner links while Assist citations keep the default. |
| `AGLYN_SILOED_HOST` | Optional | Build | Origin the besigner editor iframe is loaded from. Unset it resolves to the console's own origin, which is what a self-host install wants. Set it only if you serve the besigner from a separate host. A bare hostname, or a value already starting `//` or `http`. |

Two more addresses are set by the image rather than by you:

| Variable | Set to | Note |
| --- | --- | --- |
| `PORT` | `4200` console, `4500` tenant | Compose publishes both on `127.0.0.1`. |
| `HOSTNAME` | `0.0.0.0` | Listens inside the container's own network namespace. Do not change it to reach the container from outside — that is what the proxy is for. |

---

## Your reverse proxy, the client IP, and geo {#proxy}

### `X-Forwarded-For`: tell the product how many proxies you run {#xff}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AGLYN_TRUSTED_PROXY_COUNT` | Recommended | Runtime | How many proxies sit between the internet and the container. One reverse proxy is `1`, which is also the default. A CDN in front of your own proxy is `2`. `0` means nothing is in front and forwarding headers are ignored entirely. Not a header index — you never have to work out which end of the list to count from. |

Every client address in the product is read through one reader, which takes the
hop this number identifies and ignores everything to its left. With N proxies in
front, the last N entries of `x-forwarded-for` were written by your proxies and
are the only ones a caller cannot forge; the outermost of them recorded the
address it actually saw, which is the visitor.

:::danger Set this if you run more than one proxy

nginx's usual `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`
**appends**. A request arriving with a header the client typed —
`X-Forwarded-For: 1.2.3.4` — leaves your proxy as `1.2.3.4, <real address>`. At
the default of one trusted proxy the product reads `<real address>` and the
forged value is discarded, which is what you want. Configure `2` when a CDN sits
in front, or the reader names your own proxy instead of the visitor — several
visitors then share one rate-limit bucket and limits bite sooner than they
should.

Too high is the safer direction than too low: a chain shorter than the configured
depth is clamped to its leftmost entry, which was still written by a proxy you
trust.
:::

What this protects:

- **Authentication throttles** — passkey sign-in (both ceremony steps),
  password-reset mailbombing, identifier resolution, storefront member login and
  member recovery.
- **Provisioning throttles** — organization creation (the bot-farm control), site
  creation, screen-password unlock, form submission, newsletter signup, booking
  creation, visitor plugin writes, the pre-auth REST budget.
- **Unauthenticated beacons** — the console and tenant error collectors, CSP
  reports, attribution, analytics collection.
- **Stored evidence** — the address printed in the new-device sign-in alert email
  and stored on the user's device record, and the `ipAddress` written onto the
  clickwrap legal-acceptance record. Here a spoofed value is durable rather than
  merely a bypass: it is what an account owner reads when deciding whether a
  sign-in was theirs.

A single reverse proxy needs no configuration at all. Either style works:

```nginx
# nginx — either form is correct at AGLYN_TRUSTED_PROXY_COUNT=1.
# $proxy_add_x_forwarded_for appends, and the appended entry is the one read.
location / {
    proxy_pass         http://127.0.0.1:4200;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_set_header   X-Real-IP         $remote_addr;
}
```

```caddy
# Caddy — reverse_proxy sets X-Forwarded-For itself. Nothing to add.
console.example.com {
    reverse_proxy 127.0.0.1:4200
}
```

```yaml
# Traefik — leave insecure OFF and name the proxies you actually trust,
# so Traefik's own chain is one you can count.
entryPoints:
  websecure:
    address: ':443'
    forwardedHeaders:
      insecure: false
      trustedIPs:
        - 10.0.0.0/8        # your own load balancers only
```

If a CDN sits in front of your own proxy, that is two hops: set
`AGLYN_TRUSTED_PROXY_COUNT=2` and restrict your proxy to the CDN's egress ranges,
so nothing can reach it around the CDN and shorten the chain.

`x-real-ip` and RFC 7239 `Forwarded` are read too, in that order, when
`x-forwarded-for` carries nothing usable — so a proxy that sets one of those
instead works without configuration. When nothing readable arrives the product
gets **no address** rather than a placeholder, and each control decides for
itself: address-keyed rate limits are skipped rather than collapsing every
anonymous caller into a single shared bucket, and stored evidence records that
the address is unknown instead of recording a guess.

`docker-compose.yml` publishes both containers on `127.0.0.1` so nothing can
reach them without passing your proxy. **Do not widen that binding.** If your
proxy runs on another host, put it on this host's network or firewall the
published port to the proxy alone — a directly reachable container is a chain of
zero trusted hops, and no header reading survives that.

### Geo headers {#geo}

Three features read the visitor's country off a request header, and one reads the
city. On Aglyn's cloud those come from Vercel's edge. A container has no edge —
it gets whatever its proxy puts there.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AGLYN_GEO_COUNTRY_HEADER` | Feature | **Build** | Name of the header carrying ISO 3166-1 alpha-2, lower-cased. Default `x-vercel-ip-country`. Behind Cloudflare: `cf-ipcountry`. |
| `AGLYN_GEO_REGION_HEADER` | Feature | **Build** | Name of the header carrying the ISO 3166-2 subdivision, bare (`43`) or prefixed (`UA-43`) — both are read, and a single digit is zero-padded. Default `x-vercel-ip-country-region`. Cloudflare sends no subdivision; leave it blank there. |
| `AGLYN_GEO_CITY_HEADER` | Optional | **Build** | Name of the header carrying the city. Default `x-vercel-ip-city`. Percent-encoding is decoded; anything over 64 characters is rejected, so a proxy leaking a user-agent under this name cannot become a "city". |

These are **build**-time because `apps/console/middleware.ts` pulls the sanctions
gate — and through it the geo reader — into the edge bundle, which has no
request-time environment. Set them before `docker compose build`.

**Unset does not mean broken.** Each of the three falls through a chain of names
that common edges already use, in this order:

| | Country | Region | City |
| --- | --- | --- | --- |
| 1 | *your configured name* | *your configured name* | *your configured name* |
| 2 | `cf-ipcountry` | `x-appengine-region` | `cf-ipcity` |
| 3 | `x-appengine-country` | `x-client-geo-region` | `x-appengine-city` |
| 4 | `x-client-geo-country` | `cloudfront-viewer-country-region` | `x-client-geo-city` |
| 5 | `cloudfront-viewer-country` | `x-geo-region` | `cloudfront-viewer-city` |
| 6 | `fastly-geo-country` | `x-region-code` | `x-geo-city` |
| 7 | `x-geo-country` | | `x-city` |
| 8 | `x-country-code` | | |
| 9 | `x-country` | | |

A name you configure always wins over the fallbacks, so a deployment behind
Cloudflare, CloudFront, App Engine or Fastly usually works with none of the three
set. `XX`, `T1` and `ZZ` are rejected as non-countries rather than treated as
country codes. There is deliberately **no IP-geolocation lookup**: sending a
visitor's address to a third party to decide what to ask them about privacy would
itself be a disclosure, and a subprocessor.

There is one further fallback, and it is client-side and console-only: when both
the session cache and `/api/consent/region` produce nothing, the console infers a
**consent** posture from the browser's own time zone. It answers only for the
EEA / prior-consent set and returns "unknown" rather than guessing anywhere else.
The tenant runtime has no such fallback.

**What geo drives, and what happens with no signal:**

| Feature | With a country | With no country |
| --- | --- | --- |
| Sanctions / embargo gate — console pages, session minting, org creation | Blocks `CU`, `IR`, `KP`, `SY`, and — matched on the **region** header alone — Crimea, Sevastopol, Donetsk and Luhansk. A blocked visitor gets **HTTP 451** with a plain page naming your operator identity. | **Fails open.** Nothing is blocked. Logged once per instance as `[sanctions-geo] FAILING OPEN`. A country of `UA` with no region header logs a second, unthrottled line, because the sub-country entries cannot be evaluated. |
| Consent posture — `/api/consent/region`, console and tenant | Region-conditional consent defaults apply. | Falls back to **opt-in**, the strictest posture, and logs `[consent-geo] FALLING TO OPT-IN`. |
| New-device sign-in alert email | Names city, region and country. | The email says `Unknown location`, and that string is stored on the device record. |
| Staff breach-notification report | Buckets data subjects by country, read back off that stored string. | Its widest bucket counts nobody. The report stays honest about what it does not know — it just knows nothing. |

The tenant runtime is deliberately **not** wired to the sanctions gate. That is a
decision, not a gap.

---

## Secrets this deployment signs with {#secrets}

Generate each with `openssl rand -hex 32`. All are **runtime**, all are
server-only, and none of them may ever be prefixed `NEXT_PUBLIC_`.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `TOKEN_SIGNING_SECRET` | Required | Runtime | Signs commerce download links, gift-card links, gated-video streams, media access and edit-hint tokens. **Must be identical for console and tenant** — compose shares one env file, so it is. The code fails closed: unset, it throws rather than issuing an unsigned link. |
| `MEMBER_SESSION_SECRET` | Required | Runtime | Signs the storefront member session cookie (30-day TTL). Unset **or empty**, a fresh random key is generated per boot, so members are signed out on every container restart and replicas disagree with each other. An empty value is treated as unset, not as a key. |
| `REVALIDATE_SECRET` | **Set it** | Runtime | The shared secret the console sends when it asks the tenant runtime to drop a published page from cache. Easy to miss, because its absence is completely silent: unset, the console never sends the request at all and records the reason as `not-configured`: publishing reports success and the live page keeps serving the old HTML for up to 10 minutes and the old site documents for up to an hour. Set the same value on both containers. |
| `EMAIL_UNSUBSCRIBE_SECRET` | Feature | Runtime | HMAC key over `{hostId}:{email}` for one-click unsubscribe links. Falls back to `CRON_SECRET`; with **neither** set, campaign sends answer `501` and every unsubscribe link answers `400`. |
| `CRON_SECRET` | Feature | Runtime | The shared secret every scheduled-job route checks — see [Scheduled jobs](#cron). It is also the fallback unsubscribe key above, which makes rotating it a two-step operation: rotating it alone permanently breaks the unsubscribe link in every marketing email already delivered. |
| `PLUGIN_JOBS_SECRET` | Feature | Runtime | Authorizes the tenant's `/api/plugins/run-jobs` endpoint, which the every-minute beat POSTs. Unset, that route answers `501` and **no scheduled plugin job ever runs** — no scheduled publishing, no booking-hold expiry. On the cloud-functions side it is a Secret Manager secret, not a plain variable. |
| `VERCEL_LOG_DRAIN_SECRET` | Aglyn-only | Runtime | Signature secret for the Vercel log-drain receiver. Fails closed if unset, which is the correct state off Vercel. |
| `AGLYN_PROBE_TOKEN` | Optional | Runtime | Sent as `x-aglyn-probe` by the scheduled jobs and the uptime scripts so a bot-protection layer in front of your console lets them through. Only needed if you have such a layer; unset, the header is simply not sent. Never send it to a third-party host. |

### Requiring SSO for a domain you own {#sso}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AGLYN_SSO_REQUIRED_DOMAINS` | Feature | Runtime | `domain=gcipTenantId` pairs, comma- or space-separated: `example.com=bramble-tenant-a1b2c`. Empty governs nothing, which is the right default. Anything unparseable is dropped rather than throwing — this sits on the sign-in path and a malformed value must not take authentication down. |
| `AGLYN_SSO_DOMAIN_ENFORCEMENT` | Feature | Runtime | Exactly `on` starts **refusing** sign-ins that violate the rule above. Anything else is off. Both halves are needed: this switch alone governs nothing. |

:::warning Keep an account the rule cannot refuse
A wrong tenant id here locks you out of your own console. The rule is about a
*domain*, not about staff — staff can be granted to any account, on any domain,
in any pool — so keep one owner account on an ungoverned domain before you turn
enforcement on.
:::

### Session and auth-link settings {#auth-settings}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AUTH_ACTION_ALLOWED_ORIGINS` | Optional | Runtime | Comma-separated extra origins a password-reset or verify-email link may be built on when the request supplies one. Empty — the default — means request-supplied origins are always ignored and the link is built on `NEXT_PUBLIC_CONSOLE_URL`, which is the safe state. **This is a security boundary:** a wrong entry lets a request-supplied host receive a live reset code. Intended for preview deployments. |
| `NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES` | Optional | Build | Idle window before the console signs a user out. Default `60`. A non-numeric value makes the comparison `NaN`, so the idle logout **silently never fires** — there is no clamping and no warning. |

---

## Stripe {#stripe}

Stripe is optional. Without it, commerce checkout and paid platform plans are
unavailable and the rest of the platform runs.

**Where to get these:** [dashboard.stripe.com](https://dashboard.stripe.com) →
**Developers** → **API keys** for the two keys, **Developers** → **Webhooks** for
the signing secrets, and **Product catalogue** → each price → its price id.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `STRIPE_SECRET_KEY` | Feature | Runtime | `sk_live_…` or `sk_test_…`. Enough on its own for **storefront commerce checkout**. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Feature | Build | `pk_live_…` / `pk_test_…`. Needed for **platform plan checkout**; the secret key alone is not enough. |
| `STRIPE_WEBHOOK_SECRET` | Feature | Runtime | `whsec_…` for the endpoint you create at `https://console.example.com/api/billing/webhook`. Without it, webhook-driven state — subscription changes, payment settlement — is never applied: the money moves and your database never hears about it. |
| `STRIPE_WEBHOOK_SECRET_TEST` | Optional | Runtime | A second accepted signing secret so test-mode deliveries verify while live keys are in force. Each is tried in turn; the webhook route answers `501` only when all three secrets are unset. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Feature | Runtime | `whsec_…` for the **Connect** destination, which feeds Connect readiness. Unset, those deliveries fail signature verification with `400` behind a green "Active" badge in the Stripe dashboard. |
| `STRIPE_WEBHOOK_URL` | Optional | Runtime | The endpoint URL the billing health check expects to find registered in your Stripe account. **Default is Aglyn's URL**, so a self-host operator who leaves it unset gets a permanent `endpoint-missing` red on `/api/health/billing`. Must match the URL exactly as Stripe stores it. |
| `STRIPE_LIVEMODE` | Optional | Runtime | Overrides whether this deployment considers itself the live one. Normally inferred from the key prefix. Exactly `true` or `false` — anything else, `1` included, falls through to inference. |

:::danger Localhost with live keys
`STRIPE_SECRET_KEY` does not know it is on your laptop. If you copy a filled-in
`.env.selfhost` into a development checkout, swap in test keys.
:::

#### Which events to subscribe {#stripe-webhook-events}

A signing secret only proves the delivery is real. If the endpoint is not
**subscribed** to an event, Stripe never sends it, the handler answers nothing,
your dashboard stays green, and the state it drives simply never moves — a
refund that never revokes an entitlement looks exactly like a healthy
integration.

Subscribe your platform endpoint to **all ten**:

```
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
checkout.session.completed
invoice.finalized
invoice.paid
invoice.payment_failed
charge.refunded
charge.dispute.created
charge.dispute.closed
```

**Connect is a second destination, not more events on the first one.**
Connected-account events are delivered only to an endpoint created with
`connect: true`, it carries its own signing secret
(`STRIPE_CONNECT_WEBHOOK_SECRET`), and it needs one event:

```
account.updated
```

Without it, a merchant whose Stripe account is later restricted keeps selling
against a stale readiness flag, and the shopper meets the failure at payment
time. Create that destination with the metadata `aglyn_scope=connect` — Stripe's
API does not report the `connect` flag back, so that marker is how the health
check recognizes it.

`/api/health/billing` reports what is missing under `unsubscribedRequiredEvents`.
Check it after any change to your Stripe account, not only at setup.

### Plan and add-on price ids {#stripe-prices}

Only needed if you **sell platform plans to your own users**. A single-tenant
install normally leaves the whole block empty. All are **runtime**, all take a
Stripe price id (`price_…`), and none is in `.env.selfhost.example`.

Base plan, one per plan per interval:

```
STRIPE_PRICE_STARTER          STRIPE_PRICE_STARTER_YEARLY
STRIPE_PRICE_PRO              STRIPE_PRICE_PRO_YEARLY
STRIPE_PRICE_BUSINESS         STRIPE_PRICE_BUSINESS_YEARLY
STRIPE_PRICE_SCALE            STRIPE_PRICE_SCALE_YEARLY
STRIPE_PRICE_ADVANCED         STRIPE_PRICE_ADVANCED_YEARLY
STRIPE_PRICE_AGENCY           STRIPE_PRICE_AGENCY_YEARLY
```

There is deliberately no `STRIPE_PRICE_ENTERPRISE`: Enterprise is quoted per deal
and is not self-serve. `free` has nothing to sell.

Per-plan add-ons. The name is assembled at call time as
`STRIPE_PRICE_{PLAN}_{KIND}[_YEARLY]`, so every combination below is a real
variable the code looks up:

| Add-on | Name pattern |
| --- | --- |
| Extra manager seat | `STRIPE_PRICE_{STARTER\|PRO\|BUSINESS\|SCALE\|ADVANCED\|AGENCY}_EXTRA_SEAT[_YEARLY]` |
| Extra members | `STRIPE_PRICE_{…}_EXTRA_MEMBER[_YEARLY]` |
| Extra datasets | `STRIPE_PRICE_{…}_EXTRA_DATASET[_YEARLY]` |
| Extra hosts | `STRIPE_PRICE_{…}_EXTRA_HOST[_YEARLY]` |

Flat add-ons, priced the same across plans:

```
STRIPE_PRICE_POS_REGISTER     STRIPE_PRICE_POS_REGISTER_YEARLY
STRIPE_PRICE_EVENT_CALENDAR   STRIPE_PRICE_EVENT_CALENDAR_YEARLY
```

:::warning Half-configured add-ons sell and then read back empty
The sell path only uppercases the plan name, so it will happily create a
subscription against any price id you configured. The read-back path recognizes
an add-on by matching the id against the same list. Configure a price for sale
and forget its variable and the purchase succeeds while the entitlement it was
supposed to grant is written as zero — and seat add-ons *are* entitlement inputs,
raising host limits and register counts and flipping features on. Configure a
plan's add-ons in full, or not at all.
:::

Metered usage, if you bill API usage:

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `STRIPE_PRICE_METERED` / `STRIPE_PRICE_METERED_YEARLY` | Feature | Runtime | Price ids for the metered component. |
| `STRIPE_METER_ID` | Feature | Runtime | The Stripe **Billing meter** id, `mtr_…`. Checked before price ids so a re-minted price keeps working. With neither this nor a metered price configured, the usage-reporting route withholds reporting rather than reporting into the dark. |
| `STRIPE_METER_EVENT_NAME` | Optional | Runtime | The meter's `event_name`. Default `aglyn_metered_usage`. If it does not match the name configured on the meter, Stripe accepts every event and none of them is ever priced. |
| `STRIPE_METERED_BACKFILL` | Optional | Runtime | `boundary` (default), `immediate` or `off` — when a metered item is attached to existing subscriptions. Matched lowercased but **untrimmed**, so `"immediate "` with a trailing space silently resolves to `boundary`. |

### Billing cutover dates {#billing-switches}

Each turns a billing behavior on from a chosen **month** rather than
immediately, so enabling it cannot reach backwards and retro-bill. Format is
`YYYY-MM`; a full date, `true`, `1` or a typo all fail closed and change nothing.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AUTO_LOCK_BILLING_FROM` | Optional | Runtime | First month the sweep may auto-suspend organizations delinquent past a 30-day grace. Unset, nothing ever auto-locks. |
| `BILL_ASSIST_TOKENS_FROM` | Optional | Runtime | First month Assist token cost appears on an invoice. Unset, assist usage is measured but never billed. |
| `BILL_ORG_LIBRARY_STORAGE_FROM` | Optional | Runtime | First month media-library bytes are charged. Unset, storage is metered and cap-enforced but not charged. |
| `BILL_EMAIL_SEND_OVERAGE_FROM` | Optional | Runtime | First month email past the plan's included band is charged, as `YYYY-MM`. Unset, the overage is measured, shown on the billing page and priced into the cost model, but never reaches an invoice. Not retroactive: no month before the one named here is ever charged, however late it is set. |

---

## Email {#email}

**Where to get these:** [resend.com](https://resend.com) → **API Keys**, and
**Domains** to verify the domain you send from.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Feature | Runtime | `re_…`. Without it every outbound send — invites, receipts, password resets, campaigns, security alerts — is an inert no-op. Nothing errors; mail simply does not arrive. |
| `USAGE_EMAIL_FROM` | Feature | Runtime | The single verified sender identity for **all** outbound mail, not just usage mail — it gates the "is email configured" check every sender consults. A bare address or `Bramble <billing@example.com>`. It has to be on a domain you verified in Resend, or Resend rejects the send. Unset, every sender no-ops or answers `501` with an actionable message; nothing throws. |
| `RESEND_WEBHOOK_SECRET` | Optional | Runtime | Svix signing secret (`whsec_…`) verifying Resend's delivery, open, click, bounce and complaint webhooks. Unset, that endpoint answers `501` and nothing is recorded: no open/click statistics, no bounce suppressions, and no per-recipient delivery history on the staff user page. |
| `RESEND_READ_API_KEY` | Optional | Runtime | A **full-access** Resend key, used only by the staff *Import delivery history* action to read already-sent mail into the per-recipient delivery log. Deliberately separate from `RESEND_API_KEY`, which is sending-scoped and answers every read with `401 restricted_api_key` — a leaked sending key must not be able to enumerate everyone you have ever emailed. Unset, the import answers `501` and says so; the live webhook feed is unaffected. |
| `RESEND_DOMAINS_API_KEY` | Optional | Runtime, **console only** | A **full-access** Resend key, used only to create a customer's sending domain (`POST /domains`) and read back the DKIM record it issues. A third key on purpose: `RESEND_API_KEY` is sending-scoped and cannot create anything, and `RESEND_READ_API_KEY` is for reading message history. Set it on the **console** project only — a key that can create a domain can also list every domain in the account and mint further keys, and the tenant runtime serves published sites to the public. Unset, a requested domain stops at `requested`, has no records to publish, refuses sends, and the console says `pendingProvider` rather than showing an empty DKIM row. |
| `AGLYN_SENDING_DOMAIN_PROVIDER` | Optional | Runtime, console only | `resend` or `none`. Unset, the deployment detects: `resend` when `RESEND_DOMAINS_API_KEY` is present, `none` otherwise. An unrecognized value logs `[sending-domain-provider] unknown AGLYN_SENDING_DOMAIN_PROVIDER` and falls back to detection. An explicit value always wins, `none` included. Naming `resend` without the key still issues nothing — the driver reports "not configured" rather than failing. |
| `AGLYN_TENANT_MAIL_APEX` | Optional | Runtime | The apex a site's own sending domain hangs off, bare: a site with the pinned label `northwind` sends from `northwind.{this value}`. Default `mail.{NEXT_PUBLIC_TENANT_DOMAIN}`, so an install that has set its tenant apex already has a mail namespace inside its own zone and needs nothing here. Set it only to put mail in a **different** zone — a separate registrable domain is the strongest form of the reputation split, since one site's list quality then cannot reach the domain your own account mail leaves on. A value **equal to** the web apex is ignored and the default used instead: a mail namespace that is also the web namespace lets a renamed site's freed web slug become a name another site's mail is signed for. Unset on an install that also left `NEXT_PUBLIC_TENANT_DOMAIN` unset, every site's sending domain is built inside Aglyn's `mail.aglyn.app`, which you cannot publish records into — provisioning stops at `requested` and sends are refused. |
| `AGLYN_SENDING_DOMAIN_CAPACITY` | Optional | Runtime, console only | How many sending domains this deployment may hold at the mail provider. A whole number; default `10`, and a blank or unparsable value falls back to it. Resend caps domains **per account** by plan (Free 3, Pro 10, Scale 1000) and every site's subdomain is its own domain object, so there is no wildcard that escapes the cap. The default is the lowest paid tier's allowance, so a deployment that has not been told its plan refuses before the vendor does: over the ceiling a site's provisioning ends `at-capacity` with that reason stored on the record and logged as `[provision-sending-domain] at the sending-domain ceiling`, rather than failing at the provider with a message about somebody else's billing. The allowance is a **bundled quota, not a per-domain price** — Resend meters emails and contacts, never domains — so the cheap way past the ceiling is the flat domain add-on ($20/mo for 100 more domains, on Pro or Scale), and a tier upgrade buys the same domains for considerably more. Choose the tier by send volume, then raise this to the allowance that tier plus its add-ons carries. `-1` switches the check off for a provider with no such limit. A domain that already holds a DKIM key is never re-counted, so a raised ceiling does not strand the sites already mid-provision. |
| `AGLYN_EMAIL_SPF_INCLUDE` | Optional | Runtime | The SPF mechanism printed in the DNS instructions a customer follows to send from their own domain. Default `amazonses.com`, which is what Resend sends through. Change it only if you front a different provider. A blank value falls back to the default rather than being honored: an empty SPF include would print an instruction that authorizes nobody, and the customer would publish a record that silently fails their mail. **Not** taken from the provider's response even when it offers one: the SPF and return-path records come from these settings, and only the DKIM record comes from the provider. |
| `AGLYN_EMAIL_RETURN_PATH_HOST` | Optional | Runtime | The host a customer's return-path (bounce) CNAME is pointed at, printed in the same instructions. Default `feedback-smtp.us-east-1.amazonses.com` — note the embedded **region**, which must match the region your provider actually sends from, or bounce processing goes to a host that is not listening. Blank falls back to the default, for the same reason as the SPF include. |
| `AGLYN_EMAIL_MARKETING_CAP_PER_DAY` | Optional | Runtime | How many marketing messages one person may receive from one site in a rolling 24 hours — a campaign, a member post, an abandoned-cart reminder, a back-in-stock alert and a workflow email all count toward it. Default `5`, which is above the worst legitimate day and exists to stop a runaway (a workflow firing on every form submission, a member post published repeatedly). Whole number, 1–1000; a blank, unparsable or out-of-range value falls back to the default rather than switching the ceiling off, because a control a typo can disable is not a control. Over the ceiling, the **send is skipped and nobody is removed** — no contact is deleted, no audience trimmed, no unsubscribe recorded — and the cron sweeps retry on the next beat. Transactional mail is never counted or refused. |
| `AGLYN_EMAIL_SUNSET_AFTER_DAYS` | Optional | Runtime | Engagement-based sunsetting, **off unless you set it**. A whole number of days, 30–3650. When set, an automated marketing message is skipped if this site has been mailing the address for longer than the window and the address has neither opened nor clicked anything inside it. A blank, unparsable or out-of-range value reads as **off** — the opposite of the cap above, because a typo there weakens a guard that is already on and a typo here would switch on a refusal nobody asked for. Nobody is removed: no unsubscribe, no suppression, no contact or list change, and the very next message after the person opens or clicks anything goes. Campaigns are exempt, like the frequency cap, because a campaign shows its recipient count before it is sent. Transactional mail is never affected. |
| `EMAIL_UNSUBSCRIBE_SECRET` | Feature | Runtime | See [Secrets](#secrets). |
| `STAFF_ALERT_EMAIL` | Optional | Runtime | One internal inbox for platform-operations alarms — GDPR erasure due, Assist margin guard. **One address**, not a comma list. Unset, the alarms evaluate and mail nobody, with no error. |

Alarm thresholds. All are integers, all fail to their default on a blank or
unparsable value, and all are inert unless `STAFF_ALERT_EMAIL`, `RESEND_API_KEY`
and `USAGE_EMAIL_FROM` are all set. Each accepts `-1` as a deliberate
forced-failure lever for proving the alert path works.

| Variable | Default | Drives |
| --- | --- | --- |
| `RATE_LIMIT_ALARM_MAX_CALLS` | `0` | Rate-limiter fallback calls tolerated in the window before `/api/health/rate-limits` reports degraded. |
| `SERVER_ERROR_ALARM_MAX_ERRORS` | `5` | Uncaught server errors tolerated in a 30-minute window. |
| `SIGNUP_ALARM_MAX_PER_HOUR` | `10` | Organization creations per hour before the signup-wave alarm. Sized for single-digit-org production — a real launch will trip it. |
| `SIGNUP_REFUSAL_ALARM_MAX_PER_HOUR` | `50` | Refused (429'd) organization creations per hour. |
| `USAGE_ALERT_APPROACH_PCT` | `80` | How close to a plan quota a workspace gets before it is warned. Strictly between 0 and 100; you cannot disable the warning with it. The at-cap alert is fixed at 100. |

---

## Analytics and advertising {#analytics}

:::warning The advertising ids are Aglyn's own marketing funnel. Leave them unset.

`NEXT_PUBLIC_ADS_CONVERSION_ID`, `NEXT_PUBLIC_ADS_SIGNUP_LABEL` and
`NEXT_PUBLIC_ADS_SUBSCRIBE_LABEL` identify a Google Ads account and two
conversion actions inside it, so that Aglyn's own signup and subscribe events
reach Aglyn's own advertising account.

`NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` and
`NEXT_PUBLIC_GTM_CONTAINER_ID` are the same kind of value one step further: they
build **retargeting audiences**, so a hardcoded one would put your users into
Aglyn's advertising lists — a disclosure you never made about people we have no
basis to hold. Your own advertising tags are your own business; set your own ids
or leave every one of these blank.

Nothing is compiled in, and the code fires **nothing** when they are unset — no
tag, no request. The half-configured case is handled too: an id with an empty
label would produce a target Google Ads accepts and files against the account's
default conversion, so the code returns nothing instead.

There is no default **because** analytics is permitted to emit on any production
build including a self-hosted one. A hardcoded id would have every operator
reporting their users' signups into Aglyn's ad account. Leave them blank, or set
your own.
:::

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_ADS_CONVERSION_ID` | Aglyn-only / your own | Build | Google Ads conversion id, `AW-` plus digits. Google Ads → **Goals** → *Conversions* → the tag's id. |
| `NEXT_PUBLIC_ADS_SIGNUP_LABEL` | Aglyn-only / your own | Build | The opaque conversion **label** for the signup action, from the same screen. Fires only when the id is also set. |
| `NEXT_PUBLIC_ADS_SUBSCRIBE_LABEL` | Aglyn-only / your own | Build | The conversion label for the subscribe action. |
| `NEXT_PUBLIC_META_PIXEL_ID` | Aglyn-only / your own | Build | Meta (Facebook/Instagram) Pixel id — digits only. Loads the pixel **in the console**, and only for a visitor whose recorded consent grants the advertising category. Blank loads nothing. |
| `NEXT_PUBLIC_LINKEDIN_PARTNER_ID` | Aglyn-only / your own | Build | LinkedIn Insight Tag partner id — digits only, from LinkedIn Campaign Manager → **Analytics** → *Insight Tag*. Same consent gate as the pixel above. Blank loads nothing. |
| `NEXT_PUBLIC_GTM_CONTAINER_ID` | Aglyn-only / your own | Build | Google Tag Manager container, `GTM-` plus 5–10 characters. Gated on the visitor's **analytics** consent, never anything looser — a container is a loader, and it is the likeliest thing on a page to carry an advertising tag. What it loads is decided in Google's UI and is invisible to this codebase, so set it only if you know what is in the container you are pointing at. Blank loads nothing. |
| `GA4_MEASUREMENT_ID` | Optional | Runtime | `G-XXXXXXXXXX` for **server-side** GA4 measurement-protocol events — Stripe webhook revenue, publish events, things no browser can send. Google Analytics → **Admin** → *Data streams* → your stream. |
| `GA4_API_SECRET` | Optional | Runtime | The measurement-protocol API secret for that stream. Both are needed; with either missing, every server-side hit is dropped silently — no log, no throw. Note this path has no consent gate, and its custom dimensions must be registered in GA4 or the events land unreportable. |
| `NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD` | Development only | Build | Re-enables analytics on a non-production build. A build using it stamps `traffic_type: internal` on every hit unconditionally, so it cannot be used to collect real traffic. Leave unset. |

`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` is different in kind — it belongs to your
own Firebase project. See [Firebase client config](#firebase-client).

---

## AI assist {#assist}

**Where to get the key:** [console.anthropic.com](https://console.anthropic.com)
→ **API keys**. Bring your own; nothing is compiled in.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | Feature | Runtime | `sk-ant-…`. Powers the console Assist panel and the besigner's "Rewrite with AI". Without it both answer `501` and say they are not configured. The console panel is additionally behind the `release_assist` flag, which is **off** by default in Remote Config. |
| `ASSIST_MODEL` | Optional | Runtime | The model id Assist calls. Default `claude-sonnet-5`. An id absent from the built-in rate table falls back to approximate rates, so cost telemetry and the margin alarm become estimates — and the prompt-cache minimum moves with the model, so a swap can silently stop caching. |
| `ASSIST_FREE_DAILY_LIMIT` | Optional | Runtime | Messages per free workspace per UTC day. Default **10**. |
| `ASSIST_ENTITLED_MONTHLY_LIMIT` | Optional | Runtime | Messages per entitled workspace per month. Default **1000**. |
| `ASSIST_ORG_MONTHLY_COGS_LIMIT_USD` | Optional | Runtime | Dollar ceiling per workspace per month, measured against metered cost rather than an assumed cost per message. Default **40**. The literal word `off` removes the ceiling. Junk, empty, zero and negative values all read as unconfigured and take the default, so a typo can neither open the ceiling nor close it to `$0`. |
| `ASSIST_ORG_MONTHLY_COGS_ALERT_USD` | Optional | Runtime | Dollar figure at which a workspace's spend raises a **staff** margin alarm, below the hard ceiling. Default **25**. Delivery needs `STAFF_ALERT_EMAIL` and `USAGE_EMAIL_FROM`. |

Message counting happens in a transaction **before** the model is called, so a
refused request spends nothing. A workspace at the ceiling is refused rather than
quietly downgraded to a cheaper model.

---

## Scheduled jobs {#cron}

Three separate mechanisms, and missing any of them is quiet rather than loud.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `CRON_SECRET` | Feature | Runtime | Shared secret every scheduled route checks, accepted as `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`. Unset, every one of those routes refuses. `openssl rand -hex 32`. |
| `AGLYN_JOB_RUNNER_URL` | Feature *(cloud functions)* | Runtime | The tenant origin the every-minute beat POSTs: `https://sites.example.com/api/plugins/run-jobs`. **No default, deliberately.** |
| `AGLYN_CONSOLE_URL` | Feature *(cloud functions)* | Runtime | The origin that **serves** your console — never one that redirects to it, because a redirect drops the POST body and the `x-cron-secret` header. **No default, deliberately.** |

What `CRON_SECRET` being unset silently switches off:

- **Scheduled campaign sends.** You can schedule a campaign in the console, watch
  it be accepted, and watch its send time pass with nothing delivered and no
  error anywhere.
- **Audit archival**, so the audit collection grows past its retention window and
  the retention promise goes quietly unkept.
- **Erasure runs**, so personal data a customer asked you to delete is still
  there while the clock on that request runs.
- **Metered usage roll-up**, so nothing is metered into Stripe and the monthly
  usage document is never written — which in turn means every usage budget is
  structurally unable to fire and the billing card permanently reads that the
  month has not been totalled.
- **Usage budget alerts** and the **monthly usage summary email**.
- **Booking reminders, abandoned-cart mail and restock mail.**
- **The weekly Firestore export**, which is the restore point independent of
  managed backups.
- **Orphaned plugin-artifact reaping**, which then accumulates unbounded.
- **Pending custom-domain completion**, so a domain whose DNS has settled stays
  dark until someone presses Re-attach by hand.

The schedule Aglyn runs, as a starting point for your own scheduler. Times are
UTC; every entry is an authenticated POST to the path shown on your console
origin, except the last, which targets your tenant origin.

| Cron | Path | What it does |
| --- | --- | --- |
| `* * * * *` | tenant `/api/plugins/run-jobs` | Scheduled publishing, booking-hold expiry |
| `*/15 * * * *` | `/api/campaigns/process-scheduled` | Scheduled campaign sends |
| `*/15 * * * *` | `/api/admin/finish-domain-attachments` | Completes custom domains once DNS settles |
| `0 2 * * *` | `/api/billing/report-usage` | Meters the closed month into Stripe |
| `0 3 * * *` | `/api/admin/audit-archive` | Archives audit rows |
| `0 4 * * *` | `/api/admin/run-erasures` | Executes due erasure requests |
| `0 7 * * *` | `/api/billing/report-usage?month=current` | Current-month usage |
| `0 8 * * *` | `/api/billing/usage-alerts` | Budget warnings, auto-lock sweep |
| `0 * 1-2 * *` | `/api/billing/usage-email` | Monthly usage summaries |
| `0 5 * * 1` | `/api/admin/firestore-export` | Weekly export |
| `30 5 * * 1` | `/api/admin/reap-plugin-artifacts` | Orphaned artifact reaping |
| `0 6 * * 1` | `/api/admin/reverify-plugin-versions` | Re-checks published plugin verdicts |
| `30 6 * * 1` | `/api/admin/backfill-scope` | Scope drift backfill |
| `30 7 * * 1` | `/api/admin/reverify-sso-domains` | Re-verifies SSO domain ownership |

:::caution Anything hourly or slower breaks a promise the product makes
The campaign composer accepts a send time down to the minute, so a scheduler
that only runs hourly turns "send at 09:05" into "send some time after 10:00".
`/api/health/crons` is the check that notices; it reds a fifteen-minute job after
roughly three missed fires, and a daily one after somewhere between six and
thirty hours of silence. Nothing polls that endpoint for you — point your own
uptime monitor at it, or the only place a silent job shows up is a page nobody
opens.
:::

The two `cloud/functions` URLs have no default because they used to have one: it
pointed at a specific published site, so a deployment that missed the variable
POSTed to a stranger every minute carrying its own `PLUGIN_JOBS_SECRET` while
none of its own jobs ran. Unset, each beat now refuses to fire and logs the
variable name once per tick.

Both live in a dotenv file under `cloud/functions/` — copy
`cloud/functions/.env.example` to `.env.<your-project-id>` **before your first**
`firebase deploy --only functions`. The Firebase CLI writes whatever that file
contains onto the deployed service, so a missing file does not mean "keep the
current values", it means "deploy with none".

`CRON_SECRET` and `PLUGIN_JOBS_SECRET` reach the function through Secret Manager
(`firebase functions:secrets:set CRON_SECRET`), not through `.env.selfhost`, and
must equal the console's and the tenant's respectively.

:::danger Never let two schedulers run the same job
`report-usage` meters a closed month into Stripe. A day on which two runners both
fired it is a day your customers were billed twice.
:::

---

## Plugins and the sandbox {#plugins}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `PLUGIN_ARTIFACTS_BUCKET` | Feature | Runtime | The **separate** GCS bucket holding executable plugin bundles — the code refuses to store executable code in the app bucket. Unset, plugin publishing and artifact serving both answer `501`. A bare bucket name. Note the bucket is invisible to the Firebase console; manage it in the Google Cloud console. |
| `PLUGIN_ARTIFACTS_BASE` | Optional | Runtime | Origin the server-side remote-bundle loader fetches from. Falls back to `NEXT_PUBLIC_PLUGIN_ORIGIN`. Only relevant with remote server bundles enabled. |
| `NEXT_PUBLIC_PLUGIN_ORIGIN` | Feature | Build | Full origin the plugin sandbox iframe and bundles are served from, and the entry added to the CSP `frame-src`. **Must be a different origin from the app** — the cross-origin boundary is the sandbox. Unset, realm plugins do not load and installed executable plugins render as nothing, because the CSP has no entry for them. |
| `PLUGIN_TRUST_PRIVATE_KEY` | Feature | Runtime | Signs realm trust grants. Base64 PKCS8 DER Ed25519, generated by `tools/scripts/generate-plugin-trust-key.mjs`. Unset, the grant action answers `501`. **Console only** — never deploy it to a tenant runtime. |
| `PLUGIN_TRUST_PUBLIC_KEY` | Feature | Runtime | The server-side verification key, base64 raw Ed25519. Required with remote server bundles enabled; unset there, no bundle loads at all — it fails closed rather than degrading to a hash check. |
| `NEXT_PUBLIC_PLUGIN_TRUST_PUBLIC_KEY` | Feature | Build | The same public key again, for browser-side verification of realm bundles. A mismatch with the server-side name refuses every bundle. |
| `PLUGIN_JOBS_SECRET` | Feature | Runtime | See [Secrets](#secrets). |

Development-only, and never to be set on a real deployment:
`NEXT_PUBLIC_PLUGIN_DEV` (exactly `enabled`, and hard-gated off when
`NODE_ENV=production`), `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES` (comma-separated
`pluginId=url` pairs whose hostnames must be `localhost` or `127.0.0.1`),
`PLUGIN_REMOTE_SERVER` (exactly `enabled` — the master switch for bundles that
register API routes in-process, the highest-blast-radius switch in the platform),
and `PLUGIN_REMOTE_SERVER_BUNDLES` (a comma-separated `listingId@version`
allowlist; nothing loads implicitly from installs, so an empty list loads nothing
even with the switch on).

### The sandbox loader service {#plugin-loader}

If you deploy `tools/plugin-loader/origin` — the small separate service that
serves the sandbox iframe on its own origin — it reads two variables **from its
own environment**, not from the console container, and they are not
`NEXT_PUBLIC_*` because it is not a Next app:

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `PLUGIN_LOADER_CONSOLE_URL` | Required *(loader)* | Runtime | Your console's origin, scheme and host, no path. |
| `PLUGIN_LOADER_TENANT_DOMAIN` | Required *(loader)* | Runtime | The apex your published sites hang off. `*.<this>` is what may frame the sandbox. |

Unset, the loader points at Aglyn's console: `frame-ancestors` would name only
Aglyn's hosts, so **your** console could never frame **your** sandbox — a blank
iframe the browser blocks — while its two manifest lookups would arrive at
Aglyn's marketplace API carrying your listing and host ids and return 404s that
silently strip every plugin's declared network capability.

---

## Who runs this install {#operator}

The reasoning is in
[Self-hosting → Who runs this install](./self-hosting.md#who-runs-this-install).
The reference rows:

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_OPERATOR_NAME` | **Set it** | Build | Your legal or trading name. Printed on the public abuse intake, the §512 counter-notice intake, the lockdown 503, the media quarantine notice and the sanctions 451. There is no fallback to Aglyn's name; unset renders an explicit "not configured". |
| `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` | **Set it** | Build | The address those same pages tell people to write to. |
| `NEXT_PUBLIC_OPERATOR_LEGAL_EMAIL` | Optional | Build | A separate mailbox for legal and copyright notices. Defaults to the support address, so one mailbox is a complete configuration. |
| `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` | Optional | Build | Where your own terms, privacy and DMCA pages live, no trailing slash. The signup clickwrap links here, and it governs which origin counts as a published legal document. |
| `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_NAME` | Optional | Build | Designated agent's name. **Both** this and the address must be set before the block renders at all — a mailbox with no legal person or no physical address behind it is not a designation. |
| `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_ADDRESS` | Optional | Build | Physical address. |
| `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_EMAIL` | Optional | Build | Agent email. Omitting it leaves that line out rather than inventing one. |
| `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_PHONE` | Optional | Build | Agent phone. §512(c)(2) enumerates all four. |
| `NEXT_PUBLIC_OPERATOR_DMCA_AGENT_REGISTERED` | Optional | Build | Exactly `true`, and **only if** you have actually registered the agent with the U.S. Copyright Office. Naming an agent does not set it and nothing infers it. |

:::warning `NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN` follows your origin, not your publication state
The list of paths treated as published legal documents is committed in the
repository. Point the origin at yours and the marketplace publisher-agreement
gate answers "published" for
`<your-origin>/legal/marketplace-publisher-agreement` whether or not that page
exists. Publish it at that path before you enable marketplace publishing.

Separately, the acceptance **record** is still pinned to Aglyn's document
snapshots — version, sha256 and byte count. Your user follows a link to your
terms and the row written into your Firestore names our bytes. Treat the recorded
evidence as unusable and rely on your own acceptance flow if you need one that
stands up.
:::

### Renaming the product {#brand}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_PLATFORM_BRAND_NAME` | Optional | Build | What this deployment calls itself: browser-tab titles, the installable app on a home screen, the relying-party name the OS shows when a user saves a passkey, transactional email, and the `generator` / `x-powered-by` fingerprint on every published site. Default `Aglyn`. Setting it also drops the Aglyn trademark line from the console footer — the source is Apache-2.0 and yours, the names are not. |
| `NEXT_PUBLIC_PLATFORM_BRAND_LEGAL_NAME` | Optional | Build | The legal entity for copyright lines. Defaults to `<brand> LLC`, which is a US company form — set it explicitly if you are not one. |
| `NEXT_PUBLIC_PLATFORM_SUPPORT_URL` | Optional | Build | Where "need help?" links point. Falls back to `NEXT_PUBLIC_OPERATOR_SUPPORT_EMAIL` as a `mailto:` before it ever falls back to Aglyn's support page. |
| `NEXT_PUBLIC_PLATFORM_HOME_URL` | Optional | Build | Destination of the "Made with …" badge on published free-tier sites. Unset on a renamed brand, the badge renders as plain text with no link. |
| `NEXT_PUBLIC_PLATFORM_MARK_URL` | Optional | Build | The square logo mark in that badge — a site-relative path is preferable, so it resolves on custom domains too. It sits on a dark pill, so supply a light variant. Unset on a renamed brand, the badge is text only. |

Brand **images** are not environment variables: the favicon, app icons and social
card live under `apps/console/public/_static/images/brand` and
`apps/tenant/public/_static/images/brand`. Replace the files in your Docker build
context.

---

## Sales tax, and what to do if you are not in Texas {#tax}

:::info The three variables below are the BOOTSTRAP. The control is in the console.

Where you file and the numbers you file under live in **Staff → Platform settings
→ Sales tax filing**, where changing them needs the `super` staff role and no
deploy. Registering in a new state is an operator action, so it must not require
an environment edit and a release.

`AGLYN_TAX_JURISDICTION`, `AGLYN_TAX_REGISTRATION_ID` and `AGLYN_TAX_FILING_ID`
are what a fresh install runs on before anybody opens that page: they fill in
every field the console has not stored. **Anything stored in the console wins**,
and the card names the layer each value came from — so a variable you set and
then override is listed by name as *not in force* rather than quietly ignored.
Clearing the stored record in the console hands these their layer back.

Unset, and with nothing stored, the jurisdiction is `US-TX` and the identifiers
are absent, so both surfaces read `NOT CONFIGURED` rather than printing anyone
else's numbers.

Texas is the one jurisdiction with a form this software knows. Everywhere else
gets a **return breakdown** — what was collected, and where — labeled as raw
material for filing by hand rather than as a return.
:::

Tax **collection** and tax **filing** are different things in this product, and
only one of them is portable.

### Collection is a real feature, and jurisdiction-neutral {#tax-collection}

Storefront tax is configured per store, in the console, not by environment
variable, and there is nothing Texas-specific about it:

- Rates are `{ country, state?, pct }` entries. `country` is any ISO 3166-1
  alpha-2 code and `state` any subdivision; the most specific match wins, and a
  country-only rate covers the whole country.
- Tax-inclusive pricing is supported, which is what VAT- and GST-style pricing
  needs.
- Modes are `manual`, `stripe` or `none`. Under `stripe`, Stripe Tax computes
  against **whatever registrations your own Stripe account holds**, and the tax
  lands in **your** balance.
- An unset mode refuses the sale rather than silently zero-rating it.
- The merchant-facing tax summary is gated on host and organization membership,
  not on staff, and contains no jurisdiction assumption.

Your own platform billing behaves the same way: subscription and add-on checkouts
enable Stripe automatic tax, so it too is computed against your registrations.

### Filing follows the jurisdiction you configure {#tax-filing}

`/admin/tax-return` is behind the `staff` claim, and on your own deployment you
control your own claims — so you will see it. What you get is:

- **Your own numbers.** It reads your Firestore: your platform revenue, your
  storefront tax collected, your marketplace purchases. Nothing phones home, and
  the by-jurisdiction breakdown underneath is genuinely useful.
- **On your own jurisdiction's lines.** The filing figures read the bucket named
  by the configured jurisdiction, and the page heading, the figures card and the
  export all name it. A code that matches no bucket makes every figure read
  `0.00`, so it is refused at the console's own input and, for a code that
  arrived through the environment where nothing validates it, raised on the
  return as a **blocking** finding rather than filed as a quiet zero.
- **As a form only where a form is known.** Texas gets Form 01-114's own lines
  and a Webfile-shaped export. Every other jurisdiction gets the period, the
  gross, the taxable base and the tax collected, split by the destination region
  the tax was computed for, under a banner saying it is for manual filing and is
  not a submittable return. There is no second state's form, no VAT or GST
  return, and no tax engine beyond Stripe Tax.
- **From the period your obligation began.** The picker floors at **Earliest
  filable period** in Platform settings, which defaults to September 2026 —
  Aglyn's own first taxable month. Set your own and the menu offers your
  periods; the page reads the setting before it builds the menu, so the floor is
  right on first paint.
- **With liability sentences written for a marketplace facilitator**, sourced
  from Aglyn's terms and its reading of its own position. The mechanics are the
  same wherever this runs; the conclusions are not advice about your
  registration.

### Setting it up {#tax-what-to-do}

Set these to bring a fresh install up already filing correctly, or leave them
unset and configure it in **Staff → Platform settings → Sales tax filing**, which
is the same three values with an audit trail and no redeploy. Everything below is
the bootstrap layer: a value stored in the console outranks it.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AGLYN_TAX_JURISDICTION` | Bootstrap | Runtime | Where this deployment files until the console stores a jurisdiction, as an ISO 3166-1 alpha-2 country with an optional subdivision — `US-TX`, `US-CA`, `GB`, `DE`. It is looked up as a key in the report's own buckets, which are `COUNTRY-STATE` where an address carries a state and `COUNTRY` where it does not, so write it the same way. Default `US-TX`. |
| `AGLYN_TAX_REGISTRATION_ID` | Bootstrap | Runtime | The number the authority knows you by — a Texas taxpayer number, a seller's permit, a VAT number. Printed on the return page and in the exported working papers; the console shows only a last four. **Server-only**: never prefix it with `NEXT_PUBLIC_`. |
| `AGLYN_TAX_FILING_ID` | Bootstrap | Runtime | The filing-portal credential where one exists, such as the Texas Webfile number — which the Comptroller's eSystems treats as an authentication code, so it is **server-only** for the same reason and more urgently. Required alongside the registration id for `US-TX`; optional everywhere else, because most authorities issue one number. The console never shows it back at all. |
| `TX_WEBFILE_NUMBER` | Deprecated | Runtime | The former name of `AGLYN_TAX_FILING_ID`. Still read when the environment's jurisdiction is `US-TX`, so an existing deployment is not unset by the rename. |
| `TX_TAXPAYER_NUMBER` | Deprecated | Runtime | The former name of `AGLYN_TAX_REGISTRATION_ID`, read under the same condition. |

Both identifier variables are only in force while the jurisdiction in force is
the one they were configured for. Change the jurisdiction in the console and they
stop applying — one authority's registration number is never filed under another,
so the return reads `NOT CONFIGURED` until the new authority's numbers are
entered.

With none of them set and nothing stored, the page says so and names what to set,
and the export writes `NOT CONFIGURED …` rather than a blank cell someone files
from — which is the correct output for a deployment that does not file at all.

Two things this page cannot do for you, whatever you set: it does not decide
whether you are a marketplace facilitator where you operate, and it does not know
your authority's form. Configure collection properly in each store's tax
settings, register where you owe, and read the working papers rather than
transcribing a screen.

---

## Caching, ISR, and running more than one replica {#caching}

Single-container is the supported shape.

Published pages are ISR-cached with a 10-minute window, site documents sit behind
a one-hour render cache, and **no shared cache handler is configured** — so every
replica keeps its own on-disk cache. Publishing POSTs `/api/revalidate` on the
tenant, which busts the one replica that answered. The console reports an instant
publish while every other replica keeps serving the old page for up to 10 minutes
and the old documents for up to an hour.

If you scale out, either put a sticky-session proxy in front or fan the
revalidate POST out to every replica yourself. Nothing errors in either case,
which is what makes it worth knowing.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `REVALIDATE_SECRET` | **Set it** | Runtime | See [Secrets](#secrets). Without it, no publish ever busts any cache. Set the same value on both containers: the console will not send the request without it, and the tenant endpoint answers `503` naming the variable rather than quietly doing nothing. |

:::warning Your cache rules set your real takedown window

Several endpoints send `s-maxage` with little or no browser `max-age`, on the
assumption that a shared cache honors it — the per-host manifest and `robots.txt`
at 5 minutes to an hour, sitemaps and feeds at 5 minutes, screen-node and
commerce endpoints at 60–300 seconds. Behind a proxy that caches nothing they are
simply recomputed per request: correct, slower, and several of them hit Firestore
each time.

The consequence that is not about performance is media takedown. When staff
disable a file, the reach of that action is derived from the media CDN's own
cache directives, and the console prints those numbers to the person clicking the
button: the origin stops serving it within about **15 seconds**, a browser that
already has it keeps it for up to **60 seconds**, and a shared cache keeps it for
up to **one hour** — because the media route sends `s-maxage=3600`. Immutable
content-addressed URLs and copies already downloaded are not reachable at all,
and the product says so rather than implying a number.

**Those figures describe Aglyn's cache, not yours.** If your proxy or CDN caches
media for longer than an hour, that is how long a removed asset can still be
served after you remove it — and that is the window your abuse and §512 responses
are effectively promising. Decide it deliberately, and if you change it, change
what you tell people.
:::

---

## Domains: how a hostname becomes reachable {#domains}

Registering a name used to be a call to Vercel's API, so a Docker install had no
way to make a workspace subdomain resolve at all — it advertised a URL and
skipped the registration. The hosting vendor is a **driver** now, and you pick
one.

This section is the per-variable reference. [Domain providers](./domain-providers.md)
is the runbook beside it: how to choose a driver, the wildcard path end to end
with worked Caddy and nginx configurations, a complete worked webhook endpoint,
what each status state means for you, and how to migrate from one driver to
another.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AGLYN_DOMAIN_PROVIDER` | Optional | Runtime | `vercel`, `wildcard`, `webhook` or `none`. Unset, the deployment detects: `vercel` when `VERCEL_TOKEN` is present, `none` otherwise. An unrecognized value logs `[domain-provider] unknown AGLYN_DOMAIN_PROVIDER` and falls back to detection. An explicit value always wins, `none` included — switching a driver off while its credentials are still in the environment means it. |

| Driver | For |
| --- | --- |
| `vercel` | Aglyn's own hosting, and anyone else on Vercel. |
| `wildcard` | **The ordinary Docker answer.** A container behind a proxy that already answers for `*.example.com`. |
| `webhook` | Anything else — Caddy, Traefik, cert-manager, a registrar's API, a shell script. |
| `none` | Names are handled entirely outside the product. Not an error state, and not something logged forever. |

:::note Detection never picks `wildcard`, and that is deliberate
The wildcard driver reports a name as serving **without checking anything** —
there is nothing to check, because the operator's DNS record and certificate
either cover the apex or they do not. Inferring it from an apex somebody merely
configured would have the console show a green chip beside an address that
resolves nowhere. Claiming to serve a name is your assertion to make, so it takes
your explicit setting.
:::

Every driver is bound by the same contract, which is worth knowing before you
write one: it never throws (an exception here would fail an organization
creation over a DNS API), `attach` on an already-attached name is success, and
`skipped` means "not my job" rather than "it went wrong". A status of `unknown`
is treated as serving, because a probe that could not answer is not evidence of
a problem. Every call is bounded at **5 seconds**.

### `wildcard` {#domains-wildcard}

Point one wildcard DNS record at your proxy, hold one wildcard certificate, and
every workspace subdomain and platform site subdomain resolves the moment it is
created. There is no API to call because there is nothing to register.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_TENANT_APEX` | Do not set | Runtime | Read in exactly one place — the memoization key that decides whether the selected driver may be reused — and by nothing else in the product. Setting it changes no behavior. The wildcard suffix default comes from `NEXT_PUBLIC_TENANT_DOMAIN`, which is the variable that key was meant to watch, so the memo does not notice a change to it. That only shows up where the environment changes inside one process, which a container's does not. |
| `AGLYN_DOMAIN_WILDCARD_SUFFIXES` | Optional | Runtime | Comma-separated apexes your DNS and certificate already cover. A leading `*.` is tolerated and stripped: `*.example.com, sites.example.com`. Defaults to `NEXT_PUBLIC_WORKSPACE_DOMAIN` plus `NEXT_PUBLIC_TENANT_DOMAIN`, which are the names the product itself hands out. **An explicit list replaces those defaults rather than adding to them** — if you set it, list every apex you serve. |

:::warning A wildcard covers exactly one label
`*.example.com` serves `a.example.com`. It does **not** serve `a.b.example.com`,
and it does not serve `example.com` itself — and a certificate issued for
`*.example.com` covers exactly the same set. The driver matches that rule rather
than "ends with the suffix", because the looser test would report a two-label
name as serving and the visitor would meet a TLS error before you did.
:::

A name **outside** your suffixes — a customer's own `shop.acme.com` — is not
covered by anybody's wildcard. This driver has no way to add it and no way to see
it, so it says so: `skipped` on attach, `unknown` on status. It never claims such
a name is serving, and it never calls it broken either, because an operator who
added a vhost by hand has a working domain the driver cannot see. If you want
customer domains registered automatically, use `webhook`.

Detaching is honest in the same way: a wildcard cannot un-serve one of its names,
so a removed workspace subdomain keeps resolving until the app itself stops
recognizing the slug.

### `webhook` {#domains-webhook}

Aglyn POSTs the three operations to an endpoint you run. What is behind it is
your business.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `AGLYN_DOMAIN_WEBHOOK_URL` | Required *(webhook)* | Runtime | The endpoint. Ignored by every other driver. |
| `AGLYN_DOMAIN_WEBHOOK_TOKEN` | Optional | Runtime | Sent as `Authorization: Bearer …`. Omitted entirely when unset. |

:::danger Put this endpoint on your own network
The request carries the bearer token and the names of your customers' domains,
and the reply decides whether the console tells someone their site is live.
:::

**The request.** `POST` to your URL, `Content-Type: application/json`:

```json
{
  "action": "attach",
  "scope": "tenant",
  "domain": "shop.acme.com",
  "redirectTo": "acme.com"
}
```

- `action` is `attach`, `detach` or `status`.
- `scope` says which app should answer for the name: `console` for the admin app
  and its workspace subdomains, `tenant` for published sites.
- `redirectTo` appears **only** when the name should forward rather than serve —
  how a renamed workspace keeps its old slug working. It is always a bare
  hostname; Aglyn normalizes it before the wire, and refuses to send anything
  that is not one. If your layer cannot express a redirect, answer `skipped`
  rather than attaching a serving name: a serving twin is a second live copy of
  the console on a name that was supposed to forward.

**The reply.** `200`, with an outcome for `attach` and `detach`:

```json
{ "outcome": "attached", "detail": "added to caddy" }
```

`outcome` is one of `attached`, `detached`, `already-exists`, `not-found`,
`skipped` or `failed`. `already-exists` is success — Aglyn re-attaches on
reconcile passes and expects idempotence. `detail` is optional, reaches operator
logs, and is truncated at 200 characters.

For `status`, a state:

```json
{
  "state": "ownership-pending",
  "verification": [
    { "type": "TXT", "domain": "_acme-challenge.shop.acme.com", "value": "…" }
  ],
  "conflicts": []
}
```

`state` is one of `serving`, `certificate-pending`, `ownership-pending`,
`dns-misconfigured`, `not-attached`, `skipped` or `unknown`. `verification`
carries the records a customer must add at their registrar and is shown to them.
`conflicts` lists records answering for the name that are not yours — a
non-empty list on an otherwise-serving domain is the case where it resolves
correctly only some of the time.

Note `certificate-pending` is **not** treated as serving: the name is routed but
no certificate exists yet, so a visitor meets a TLS error. Do not report
`serving` until the certificate is issued.

:::warning A typo must never read as success
An unrecognized `outcome` is taken as **`failed`**, and an unrecognized `state`
as **`unknown`** — both logged with what arrived. An endpoint that answers
`{"outcome":"attach"}` has registered nothing, and accepting it would leave a
workspace advertising a URL that resolves nowhere. A non-`200`, a timeout or a
connection error is `failed` for attach and detach, and `unknown` for status —
never `not-attached`, because an endpoint that did not answer is not evidence
that the name is missing.
:::

**A worked endpoint**, driving Caddy's admin API. This is the whole shape; the
error handling is yours:

```js
// node server.js — reachable only from the Aglyn containers.
import { createServer } from 'node:http'

const TOKEN = process.env.WEBHOOK_TOKEN
const CADDY = 'http://127.0.0.1:2019'

createServer(async (req, res) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end()
    return
  }
  const body = JSON.parse(await new Response(req).text())
  const { action, scope, domain } = body
  const upstream = scope === 'console' ? 'console:4200' : 'tenant:4500'
  const id = `aglyn-${domain}`

  const reply = (payload) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  if (action === 'attach') {
    // Caddy provisions the certificate itself once the route exists.
    const route = {
      '@id': id,
      match: [{ host: [domain] }],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: upstream }],
        },
      ],
    }
    const put = await fetch(`${CADDY}/id/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route),
    })
    if (put.ok) return reply({ outcome: 'already-exists' })
    const post = await fetch(`${CADDY}/config/apps/http/servers/srv0/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(route),
    })
    return reply(
      post.ok
        ? { outcome: 'attached' }
        : { outcome: 'failed', detail: `caddy ${post.status}` },
    )
  }

  if (action === 'detach') {
    const gone = await fetch(`${CADDY}/id/${id}`, { method: 'DELETE' })
    return reply(gone.ok ? { outcome: 'detached' } : { outcome: 'not-found' })
  }

  if (action === 'status') {
    const route = await fetch(`${CADDY}/id/${id}`)
    if (!route.ok) return reply({ state: 'not-attached' })
    // Only call it serving once TLS actually answers — Caddy will have a route
    // before it has a certificate, and `certificate-pending` is the state for
    // that gap.
    const tls = await fetch(`https://${domain}/`, { method: 'HEAD' }).catch(
      () => null,
    )
    return reply({ state: tls ? 'serving' : 'certificate-pending' })
  }

  reply({ outcome: 'failed', detail: 'unknown action' })
}).listen(9099)
```

Traefik is the same endpoint writing a dynamic-configuration file its file
provider watches, and answering `status` from whether the router exists and its
certificate resolver has issued. cert-manager is the same endpoint creating and
reading a `Certificate` resource.

### `vercel` {#domains-vercel}

Only this driver reads the Vercel credentials. They are its configuration, not a
general requirement of the product.

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `VERCEL_TOKEN` | Required *(vercel)* | Runtime | API token. Its presence is also what detection keys on when `AGLYN_DOMAIN_PROVIDER` is unset. |
| `VERCEL_TENANT_PROJECT_ID` | Required *(vercel)* | Runtime | The project the `tenant` scope attaches to. |
| `VERCEL_CONSOLE_PROJECT_ID` | Required *(vercel)* | Runtime | The project the `console` scope attaches to — workspace subdomains. A separate project from the one above. |
| `VERCEL_TEAM_ID` | Optional *(vercel)* | Runtime | Team scope on those API calls. |

### Customer custom domains, per driver {#domains-custom}

A customer connecting `shop.acme.com` goes through the same seam. What the
console can promise them depends on which driver you chose:

| Driver | A customer's own domain |
| --- | --- |
| `webhook` | **Registered automatically.** Your endpoint is asked to attach it, and the wizard reports what your endpoint reports. This is the driver to pick if you sell custom domains. |
| `vercel` | Registered automatically, on your Vercel project. |
| `wildcard` | **Not registered.** The name is outside your wildcard by definition — no wildcard covers somebody else's apex — so the driver returns `skipped` and the console answers `501`. |
| `none` | Not registered; `501`. |

The `501` reads *"Domain attachment is not configured on this deployment (no
domain provider — set `AGLYN_DOMAIN_PROVIDER`)"*, and the same answer is given
whether there is no driver at all or a driver that does not manage this
particular name — which is honest, because from the customer's side those are the
same situation.

What you see then: the domain **is** saved, an info toast says "platform
attachment pending", and the domain sits in a red alert saying it "is not
attached to our hosting platform, so it serves nothing", beside a **Retry
attachment** button that cannot succeed until the deployment can register the
name.

**The site serves anyway.** The Firestore claim on the domain is written before
the refusal, and the tenant runtime resolves an unrecognized hostname against
that claim. So on `wildcard` or `none`:

1. Point the customer's DNS at your reverse proxy.
2. Route that hostname to the tenant container by hand.
3. The site is served.

:::caution The canonical redirect stays off, so the site answers on two addresses
The refusal marks the host record as having a pending attachment, and the
canonical-domain redirect refuses to fire while that mark is set. So
`acme.sites.example.com` never redirects to `acme.com` — both serve the same
pages, which splits search ranking between them. Clearing that pending mark on
the host record restores the redirect. Moving to the `webhook` driver avoids the
situation rather than repairing it.
:::

An attach that a driver accepts is still checked before the customer is told
their domain is live: the console asks for the name's status and refuses to show
a green chip on `certificate-pending`, because a routed name with no certificate
answers with a TLS error. `unknown` and `skipped` statuses do not block an
otherwise-successful attach — a status API that could not answer is not evidence
of a problem.

Domain **verification** works everywhere: it requires an exact CNAME match, or an
apex address match when the name carries no CNAME at all — which is why
[`AGLYN_TENANT_APEX_ADDRESSES`](#addresses) matters.

:::danger Upgrade if your image predates the verification fix
There is a soft pass in the verify step that accepts *any* CNAME, for local
development where no DNS points at a tenant edge. It used to be enabled by the
*absence* of a hosting vendor's environment variable — which a container never
sets — so it was **on in production on every self-host install**, and any domain
carrying any CNAME to anywhere verified. A user of your platform could claim a
domain they do not control. It now keys on `NODE_ENV`, which both Dockerfiles set
to `production` in the image that actually runs.
:::

### Other Vercel variables {#vercel}

Nothing to set. These exist because Aglyn's own deployment runs on Vercel, and on
a container they are absent and the code handles it.

| Variable | Need | Notes |
| --- | --- | --- |
| `VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_GIT_COMMIT_SHA` | Aglyn-only | Injected by Vercel, never present on a container. |
| `VERCEL_LOG_DRAIN_SECRET`, `VERCEL_LOG_DRAIN_VERIFY` | Aglyn-only | Signature and ownership-verification values for a Vercel log drain. |

---

## Documentation site build {#docs-build}

`apps/docs` is a standalone Docusaurus package. It is not part of
`docker compose`; build and publish it separately if you want your own
documentation site, and skip this section if you do not.

Every value here is read at **build** time by `docusaurus build`, from that
build's environment. None is `NEXT_PUBLIC_*` — Docusaurus is not Next.

| Variable | Need | Value |
| --- | --- | --- |
| `DOCS_URL` | Optional | The canonical origin your docs are served at. Canonical tags and the sitemap are built from it, so leaving it at the default makes your build claim `docs.aglyn.com`. |
| `DOCS_ORGANIZATION_NAME` | Optional | Name in the footer copyright line. Default `Aglyn LLC`, followed by Aglyn's trademark attribution. Setting it replaces the name **and** drops the attribution. |
| `DOCS_GA_TRACKING_ID` | Optional | Your own GA4 measurement id, `G-XXXXXXXXXX`. Blank loads no analytics tag at all. |
| `DOCS_ERROR_BEACON_ENDPOINT` | Optional | Where uncaught browser errors POST — e.g. `https://console.example.com/api/errors`. Blank installs no handlers. If you point it at your own console, set `NEXT_PUBLIC_DOCS_ORIGIN` on that **console** to your docs origin so its CORS grant accepts you. |
| `DOCS_STATUS_TARGETS` | Optional | What `/status` probes, as comma-separated `name\|label\|origin` triples: `console\|Console\|https://console.example.com,sites\|Sites\|https://sites.example.com`. Blank probes nothing and says so. |
| `DOCS_META_PIXEL_ID` | Optional | Meta Pixel id for the docs site — digits only. Loads only for a reader whose consent record grants advertising; see the note below. Blank loads nothing. |
| `DOCS_ADS_CONVERSION_ID` | Optional | Google Ads id, `AW-` plus digits. Rides the `gtag.js` the analytics tag already loaded rather than fetching a second copy. Same consent gate. Blank loads nothing. |
| `DOCS_LINKEDIN_PARTNER_ID` | Optional | LinkedIn Insight Tag partner id — digits only. Same consent gate. Blank loads nothing. |
| `DOCS_GTM_CONTAINER_ID` | Optional | Google Tag Manager container, `GTM-` plus 5–10 characters. Gated on **analytics** rather than advertising, matching the analytics tag beside it. What a container loads is decided in Google's UI and is invisible to this codebase. Blank loads nothing. |
| `DOCS_STATUS_FALLBACK_URL` | Optional | An **independent** status page to send readers to when `/status` itself will not load — `/status` is served from your own infrastructure, so an outage broad enough to take that down takes the status page with it. A single `http(s)` URL; anything else is dropped rather than rendered. |

Every telemetry-shaped value here is **off when unset**, and that is the point:
unset means nothing is sent anywhere, never that it is sent to Aglyn.

The four advertising values need one more thing said about them. The docs site
is a static build with no consent dialog and no region endpoint of its own, so
its advertising tags are gated on the consent record the **console** wrote,
carried across on a cookie at the shared registrable domain. If your console is
not a sibling hostname of your docs — `app.example.com` and `docs.example.com`,
say — that cookie never arrives, no reader is ever counted as having granted
advertising, and these tags will correctly do nothing at all. Analytics is
unaffected; it runs on its own region-conditional default.

---

## Set by the image — do not put these in your env file {#image-set}

| Variable | Set to | Why you must not override it |
| --- | --- | --- |
| `AGLYN_STANDALONE` | exactly `1`, in the runner stage of both Dockerfiles | This is what tells the software it is a real deployment rather than a laptop. It gates the whole host-resolution switch, the canonical custom-domain redirect, and the CSP that drops Aglyn's own hostnames from your `frame-ancestors`. It is kept **out** of `.env.selfhost.example` on purpose: compose `env_file` overrides image `ENV`, so a line there would be a way to delete it and silently break serving. Only the string `1` counts — `true` and `yes` do nothing. |
| `NODE_ENV` | `production` | Several safety relaxations key on "not production", the custom-domain verify soft pass among them. |
| `PORT` | `4200` console, `4500` tenant | Compose publishes these on loopback. |
| `HOSTNAME` | `0.0.0.0` | Listens inside the container's namespace. |
| `NEXT_TELEMETRY_DISABLED` | `1` | No build telemetry leaves your machine. |

### Stamping which build you are running {#build-stamp}

| Variable | Need | When | Value |
| --- | --- | --- | --- |
| `COMMIT_REF` | Optional | **Build** | An identifier for the build. `/api/health` reports it as `commit`, and client and server error reports and the staff config report all carry it. Best passed as a build argument, which changes per build: `COMMIT_REF=$(git rev-parse HEAD) docker compose up --build`. The build argument wins where both are set. Unset, the health body reports `commit: null` honestly rather than inventing one. The Dockerfiles read it in the **build** stage, so passing it at `docker run` is too late. |
| `BUILD_ID` | Optional | **Build** | An explicit build id, checked before `COMMIT_REF`. Use it if you stamp builds with something of your own. |
| `PACKAGE_VERSION` | Set by the build | **Build** | Read from `package.json` at build time and reported by `/api/health` as `version`. Setting it in the environment does nothing. |
| `AGLYN_REGION` | Optional | Runtime | Labels which replica answered, in health reports and rate-limit degradation markers. Checked before `VERCEL_REGION`, `FLY_REGION`, `AWS_REGION` and `AWS_DEFAULT_REGION`. Unset with none of those present, markers record no region, so a multi-replica operator cannot tell which instance shed load. |
| `NEXT_PUBLIC_DEPLOY_ENV` | Set by the build | **Build** | Written from `VERCEL_ENV` by each app's config, so it is undefined on a container. Undefined reads as "unknown deployment", which is the self-host default and permits analytics to emit on a production build. Setting it in the environment is overwritten at build. |

---

## Development and Aglyn-internal variables {#internal}

Read by the code, but not operator configuration. Listed so that finding one in
the source does not send you looking for a value to put in it.

| Variable | What it is |
| --- | --- |
| `AGLYN_TENANT_DEMO` | The tenant host id served when the request host is the console apex or `localhost:4500`. Default `demo`. Aglyn's own demo deployment. |
| `AGLYN_CANARY_SITE_HOST`, `AGLYN_CANARY_MARKETING_HOST` | Which hosts the render canary at `/api/health/render` renders. The site one falls through to `AGLYN_TENANT_DEMO` then `demo`, so an install with no `demo` host gets a canary reporting red on a host that was never meant to exist. The marketing one derives from your workspace domain and grades `not-configured` — a deliberate failure, not a pass — when it cannot. |
| `AGLYN_TENANT_HOST_ID`, `AGLYN_TENANT_HOST_HOST`, `AGLYN_TENANT_HOST_HOSTNAME`, `AGLYN_TENANT_HOST_URL` | Single-host tenant pinning, for a one-site deployment. Not used by the multi-tenant compose shape. |
| `AGLYN_HOST`, `AGLYN_HOSTNAME`, `AGLYN_PORT`, `AGLYN_PROTOCOL`, `AGLYN_URL` | Build-time origin overrides in the shared Next config. Leave at the defaults. |
| `AGLYN_DISABLE_BOOT_WARMUP` | Skips the tenant's boot warm-up. A debugging aid. |
| `CONSENT_DEV_COUNTRY` | On a non-production build only, the country the consent endpoint answers when no geo header is present — the default is `US`, so the implied-consent path is testable on a laptop. Hard-gated off when `NODE_ENV=production`, so it can do nothing on a real deployment. |
| `NEXT_PUBLIC_AGLYN_TENANT_LOCAL_ORIGIN`, `NEXT_PUBLIC_AGLYN_TENANT_PREVIEW_HOST` | Where "Live" links point from a local or preview console. Both default to Aglyn's own addresses, which matters only on a preview build. |
| `NEXT_PUBLIC_ANALYTICS_ALLOW_NONPROD` | Development only. |
| `NEXT_PUBLIC_PLUGIN_DEV`, `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES`, `PLUGIN_REMOTE_SERVER`, `PLUGIN_REMOTE_SERVER_BUNDLES` | Local plugin development — see [Plugins](#plugins). |
| `FIREBASE_AUTH_EMULATOR_ENABLED`, `FIREBASE_FIRESTORE_EMULATOR_ENABLED`, `FIREBASE_DATABASE_EMULATOR_ENABLED`, `FIREBASE_STORAGE_EMULATOR_ENABLED`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_DATABASE_EMULATOR_HOST` | Firebase emulator wiring for local development. Never set these on a deployment — they point the SDK at an emulator that is not there. |
| `LINEAR_API_KEY`, `LINEAR_CUSTOMER_REPORTS_TEAM_ID`, `LINEAR_CUSTOMER_REPORTS_PROJECT_ID` | Your own issue tracker for the console's "Report an issue" dialog. See [Self-hosting → Customer issue reports](./self-hosting.md#issue-reports). |
| `RECAPTCHA_ADMIN_KEY_NAME` | The reCAPTCHA Enterprise key that customer custom domains are allowlisted on, as `projects/{project}/keys/{siteKey}`. Its last segment **must equal** `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` — naming a different key writes happily and attests nothing. Only relevant if you run App Check with reCAPTCHA Enterprise. |
| `AGLYN_DRIVE_MOUNT` | A **workstation** path: the directory containing the shared drives' folders (`Platform Docs` and its siblings), used by repository checks that cross-reference a repo file against its counterpart on the shared drive — the pricing source of truth, the decision log, the launch runbook, the legal originals, the generated feature matrix. **No default, and unset is not an error**: each of those checks skips its shared-drive leg and says so, because CI has no such mount and a check that failed without one would be red everywhere except one machine. Nothing here assumes Google Drive — any directory with `Platform Docs` inside it works. Not read by any app or container. |
| `NEXT_CACHE_MAX_GB` | A **workstation** disk guard used by `tools/scripts/clean-next.mjs`: over this many gigabytes, an app's `.next` directory is deleted before the dev server starts. Default `10`. Not a runtime cache setting and not read by any container. |
| `LOCKDOWN_DRILL` | Enables the timing-sensitive cases of a lockdown test. Test-only; no runtime effect. |
| `STRIPE_DUNNING_CHECK_KEY` | A Stripe key for a read-only CI script that compares your live dunning schedule against the committed one. Not read by any app. |
| `E2E_*`, `WIRE_*`, `SMOKE_*`, `DEV_DISK_*`, `RULES_*`, `*_CHECK_ACCESS_TOKEN`, `FIRESTORE_DEPLOY_ACCESS_TOKEN`, `VERCEL_DEEP_CLONE`, `DEPLOY_BRANCH`, `DEPLOY_REMOTE`, `TYPECHECK_CONCURRENCY`, `NEXT_ANALYZE_BUNDLE` | Repository tooling: end-to-end tests, smoke runs, CI gates, deploy scripts. Never read by a running container. |

---

## Related {#related}

- [Self-hosting](./self-hosting.md) — the setup runbook this reference belongs to
- [`docs/SELF_HOSTING.md`](https://github.com/aglyn/aglyn/blob/main/docs/SELF_HOSTING.md) — the repository runbook, with the Firebase and rules-deploy steps
- [`.env.selfhost.example`](https://github.com/aglyn/aglyn/blob/main/.env.selfhost.example) — the template you copy
- [White-label](../workspace-and-billing/white-label.md)
