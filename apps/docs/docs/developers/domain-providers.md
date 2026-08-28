---
sidebar_position: 4
title: Domain providers
description: Make hostnames actually resolve on a self-hosted install — choose a domain driver, run the wildcard path end to end, or implement the webhook contract against your own proxy.
---

# Domain providers

Aglyn hands out hostnames. A workspace gets `{slug}.<your workspace domain>`,
a published site gets `{subdomain}.<your tenant domain>`, and a customer can
connect `shop.acme.com` of their own. Something has to make each of those
resolve, and on a self-hosted install that something is not a hosting vendor's
API — it is a **driver** you choose.

This page is the runbook. [Environment variables](./self-hosting-environment.md#domains)
is the per-variable reference for the same system; keep it open beside this one
rather than reading one instead of the other. This page answers *which driver,
and what do I have to build*; that page answers *what does this variable do*.

## Which driver {#choosing}

Answer these about your own setup, in order. The first "yes" is your driver.

1. **Are you deploying to Vercel?** → `vercel`. The two projects — console and
   tenant — are the driver's configuration.
2. **Do you intend to let customers connect their own domains?** → `webhook`.
   This is the only driver on a self-host that can register a name you do not
   already own, because registering somebody else's `shop.acme.com` means
   touching your proxy, and only you know how to do that.
3. **Otherwise: does one wildcard DNS record and one wildcard certificate cover
   every name you serve?** → `wildcard`. This is the ordinary Docker answer.
4. **Are hostnames handled entirely outside the product** — a platform team's
   own DNS pipeline, or an install that only ever uses path routing? → `none`,
   or leave it unset.

```bash
AGLYN_DOMAIN_PROVIDER=wildcard   # vercel | wildcard | webhook | none
```

Unset, the deployment **detects**: `vercel` when `VERCEL_TOKEN` is present,
`none` otherwise. An explicit value always wins, `none` included — switching a
driver off while its credentials are still in the environment means it. An
unrecognized value logs `[domain-provider] unknown AGLYN_DOMAIN_PROVIDER` and
falls back to detection, so a typo cannot silently disable domains.

:::note Detection never picks `wildcard`
The wildcard driver reports a name as serving **without checking anything** —
there is nothing to check, because your DNS record and certificate either cover
the apex or they do not. Inferring it from an apex somebody merely configured
would put a green chip beside an address that resolves nowhere. Claiming to
serve a name is your assertion, so it takes your explicit setting.
:::

### What each driver cannot do {#limits}

| Driver | Cannot |
| --- | --- |
| `wildcard` | **Register a customer's own domain.** No wildcard covers somebody else's apex. It also cannot see such a name to report on it, and cannot un-serve one of the names it does cover. |
| `webhook` | Nothing structural — but it can do only what the endpoint you write can do, and it is bound by a 5-second deadline per call. |
| `vercel` | Work without a Vercel account. Both project ids are required; one token and one team serve both. |
| `none` | Anything. That is the point, and it is not an error state. |

The choice is not permanent — see [Migrating between drivers](#migrating).

### What every driver owes {#contract}

Worth knowing before you write one, and worth knowing as an operator because it
explains what you will see in logs:

- **It never throws.** An exception here would fail an organization creation
  over a DNS API. Every call returns an outcome.
- **`attach` is idempotent.** A name already registered comes back as
  `already-exists`, which is success — reconcile passes and create paths both
  run without coordinating.
- **`skipped` means "not my job", not "it went wrong".** It is what an
  unconfigured driver returns, and callers treat it as neither success nor
  failure.
- **`unknown` is not evidence of a problem.** A status probe that could not
  answer must not strand every domain on a deployment whose driver has no
  status API. See [Status states](#status-states).
- **Every call is bounded at 5 seconds.** These are awaited — organization
  creation and rename wait for them — so an unresponsive DNS API would
  otherwise turn "the subdomain is not attached yet" into "the workspace could
  not be created".

## The `wildcard` path, end to end {#wildcard}

Four things have to be true, and the driver checks none of them — it takes your
word for all four. Do them in this order.

The worked example below uses the shape `.env.selfhost.example` ships with:

| Value | Serves | Container |
| --- | --- | --- |
| `NEXT_PUBLIC_CONSOLE_URL=https://console.example.com` | The console | `127.0.0.1:4200` |
| `NEXT_PUBLIC_WORKSPACE_DOMAIN=example.com` | Workspace subdomains, `{slug}.example.com` | `127.0.0.1:4200` |
| `NEXT_PUBLIC_TENANT_DOMAIN=sites.example.com` | Published sites, `{subdomain}.sites.example.com` | `127.0.0.1:4500` |

Note that a workspace subdomain is served by the **console** container and a
site subdomain by the **tenant** container. They are two wildcards pointing at
two upstreams, not one.

### 1. DNS {#wildcard-dns}

One record per apex you serve, plus the console's own name:

```dns
console.example.com.        300  IN  A  203.0.113.10
*.example.com.              300  IN  A  203.0.113.10
*.sites.example.com.        300  IN  A  203.0.113.10
```

Add `AAAA` records alongside if you serve IPv6. If your proxy sits behind a
load balancer with a hostname rather than an address, use `CNAME` for the
wildcards and an `ALIAS`/`ANAME` for anything at an apex.

### 2. Certificates {#wildcard-certificates}

**One certificate per wildcard**, and a wildcard certificate can only be issued
over a **DNS-01** challenge — HTTP-01 cannot prove control of a whole apex.
That means your ACME client needs credentials for your DNS provider's API. This
is the step that surprises people; budget for it.

```
*.example.com          # a.example.com — and nothing deeper
*.sites.example.com    # a.sites.example.com
console.example.com    # or fold it into the first certificate as a SAN
```

:::warning A wildcard covers exactly one label
`*.example.com` serves `a.example.com`. It does **not** serve
`a.b.example.com`, and it does not serve `example.com` itself — and a
certificate issued for `*.example.com` covers exactly the same set.

This is why two apexes need two records and two certificates, and why the
driver matches one label rather than "ends with the suffix". The looser test
would report `a.b.example.com` as serving and your visitor would meet a TLS
error before you did.
:::

### 3. The proxy rules {#wildcard-proxy}

The tenant runtime resolves the `Host` header itself, so you need one rule per
apex — never one per site.

Caddy, with a DNS-01 resolver (this needs a Caddy binary built with your DNS
provider's module, via `xcaddy`; the stock binary has no DNS plugins):

```caddy
{
	email ops@example.com
}

console.example.com {
	reverse_proxy 127.0.0.1:4200
}

*.example.com {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:4200
}

*.sites.example.com {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}
	reverse_proxy 127.0.0.1:4500
}
```

nginx, with certificates already issued by certbot's DNS plugin. Note the
`server_name` ordering: nginx matches an exact name before a wildcard, and a
one-label wildcard before a longer one, so `*.sites.example.com` wins over
`*.example.com` for `acme.sites.example.com`:

```nginx
server {
	listen 443 ssl;
	server_name console.example.com;
	ssl_certificate     /etc/letsencrypt/live/console.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/console.example.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:4200;
		proxy_set_header Host              $host;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header X-Forwarded-For   $remote_addr;
	}
}

server {
	listen 443 ssl;
	server_name *.example.com;
	ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:4200;
		proxy_set_header Host              $host;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header X-Forwarded-For   $remote_addr;
	}
}

server {
	listen 443 ssl;
	server_name *.sites.example.com;
	ssl_certificate     /etc/letsencrypt/live/sites.example.com/fullchain.pem;
	ssl_certificate_key /etc/letsencrypt/live/sites.example.com/privkey.pem;

	location / {
		proxy_pass http://127.0.0.1:4500;
		proxy_set_header Host              $host;
		proxy_set_header X-Forwarded-Proto $scheme;
		proxy_set_header X-Forwarded-For   $remote_addr;
	}
}
```

`X-Forwarded-For` is not decoration. Every rate limiter in the product keys on
the address read from it at the hop `AGLYN_TRUSTED_PROXY_COUNT` names — see
[the proxy-count warning in Self-hosting](./self-hosting.md#reverse-proxy)
before you put a CDN in front of this.

### 4. Tell Aglyn {#wildcard-env}

```bash
AGLYN_DOMAIN_PROVIDER=wildcard
# Optional. Defaults to NEXT_PUBLIC_WORKSPACE_DOMAIN plus NEXT_PUBLIC_TENANT_DOMAIN,
# which is what the shape above wants. A leading `*.` is tolerated and stripped.
AGLYN_DOMAIN_WILDCARD_SUFFIXES=
```

Set the list explicitly only if you serve apexes the product did not hand out.
**An explicit list replaces the defaults rather than adding to them** — if you
set it, list every apex you serve.

:::danger An unnamed apex covers nothing
There is no hardcoded fallback behind those two variables, deliberately. This
driver *asserts* that the names it covers are being served, so a default would
have your install report `serving` for an apex you do not own and never named.
With `AGLYN_DOMAIN_WILDCARD_SUFFIXES` empty **and** both
`NEXT_PUBLIC_WORKSPACE_DOMAIN` and `NEXT_PUBLIC_TENANT_DOMAIN` unset, the
wildcard driver covers nothing at all: every name is `skipped` on attach and
`unknown` on status.
:::

### Verify it {#wildcard-verify}

Create a workspace and open `{slug}.example.com`. It should serve the console
with a valid certificate. Then publish a site and open its subdomain under your
tenant apex.

If the certificate is wrong but the page loads, you have a one-label problem —
check that the name you opened is exactly one label below a certificate you
hold.

### What `wildcard` will not claim {#wildcard-honesty}

A name **outside** your suffixes — a customer's own `shop.acme.com` — is not
covered by anybody's wildcard. The driver has no way to add it and no way to
see it, so it says so: `skipped` on attach, `unknown` on status. It never
reports such a name as serving on the strength of a suffix it does not match,
and it never calls it broken either, because an operator who added a vhost by
hand has a working domain the driver cannot see.

Detaching is honest in the same way. A wildcard cannot un-serve one of its
names, so `detach` returns `not-found` — there is no entry to remove — and a
removed workspace subdomain keeps resolving until the app itself stops
recognizing the slug.

## The `webhook` contract {#webhook}

Aglyn `POST`s three operations to one endpoint you run and takes its word for
the answer. What is behind it is entirely your business: Caddy's admin API, a
Traefik dynamic-configuration file, a cert-manager `Certificate`, a registrar's
API, or twenty lines of shell.

This is the extension point rather than a module path the app imports, because
a module path does not survive the product: both apps are bundled by Next, so a
path resolved at runtime is not in the bundle, and an operator running a built
image has no build step in which to add one. A webhook needs no rebuild.

```bash
AGLYN_DOMAIN_PROVIDER=webhook
AGLYN_DOMAIN_WEBHOOK_URL=http://127.0.0.1:9099/domains
AGLYN_DOMAIN_WEBHOOK_TOKEN=a-long-random-string   # optional
```

:::danger Put this endpoint on your own network
The request carries the bearer token and the names of your customers' domains,
and the reply decides whether the console tells someone their site is live.
:::

### The request {#webhook-request}

`POST` to your URL, with `Content-Type: application/json` and — only when
`AGLYN_DOMAIN_WEBHOOK_TOKEN` is set — `Authorization: Bearer <token>`. When it
is unset the header is omitted entirely rather than sent empty.

```json
{
  "action": "attach",
  "scope": "tenant",
  "domain": "shop.acme.com",
  "redirectTo": "acme.com"
}
```

| Field | Values |
| --- | --- |
| `action` | `attach`, `detach` or `status`. |
| `scope` | `console` — the admin app, its workspace subdomains and any white-label console domain. `tenant` — published sites and customers' own domains. |
| `domain` | Always lowercased, trimmed, and with any trailing dot removed. |
| `redirectTo` | Present **only** when the name should forward rather than serve. Always a bare hostname. |

`redirectTo` is a registration, not a special case: create the name carrying the
redirect, or point an existing entry at the target. Two things in the product
send it — a site's platform subdomain forwarding to that site's custom domain,
and the secondary names of a multi-name white-label console domain forwarding to
the primary. Aglyn reduces the value to a bare hostname before the wire and
**refuses to send anything that is not one**, answering `failed` with
`invalid-redirect` without ever calling you.

If your layer cannot express a redirect, answer `skipped` rather than attaching
a serving name. A serving twin is a second live copy of the app on a name that
was supposed to forward, and the product has an app-level canonical redirect
that covers the gap.

### The replies {#webhook-replies}

Answer `200`. For `attach` and `detach`, an outcome:

```json
{ "outcome": "attached", "detail": "wrote traefik router" }
```

`outcome` is one of `attached`, `detached`, `already-exists`, `not-found`,
`skipped` or `failed`. `detail` is optional, reaches operator logs, and is
trimmed to 200 characters. It is never shown to a customer.

For `status`, a state:

```json
{
  "state": "ownership-pending",
  "verification": [
    { "type": "TXT", "domain": "_acme-challenge.shop.acme.com", "value": "…" }
  ],
  "conflicts": [
    { "type": "A", "name": "shop.acme.com", "value": "198.51.100.7" }
  ]
}
```

`verification` carries the records the customer must add at their registrar and
**is shown to them**. `conflicts` lists records answering for the name that are
not yours — a non-empty list on an otherwise-serving domain is the case where
the name resolves correctly only some of the time. Both default to empty and
both are ignored unless they are arrays.

### What Aglyn does with a bad answer {#webhook-bad-answers}

:::warning A typo must never read as success
An unrecognized `outcome` is taken as **`failed`**, and an unrecognized `state`
as **`unknown`** — both logged with what arrived. An endpoint that answers
`{"outcome":"attach"}` has registered nothing, and accepting it would leave a
workspace advertising a URL that resolves nowhere with nothing downstream ever
asking again.
:::

| What happened | `attach` / `detach` | `status` |
| --- | --- | --- |
| Non-`2xx` | `failed`, `detail` is the status code | `unknown`, `detail` is the status code |
| Connection refused, DNS failure | `failed`, `detail` `network` | `unknown`, `detail` `network` |
| No answer within 5 seconds | `failed`, `detail` `timeout` | `unknown`, `detail` `timeout` |
| `200` with an unparseable or missing body | `failed`, `detail` `bad-outcome` | `unknown`, `detail` `bad-state` |
| `200` with a value outside the vocabulary | `failed`, `detail` `bad-outcome` | `unknown`, `detail` `bad-state` |

Note the asymmetry, which is deliberate. A failed `status` is never
`not-attached`: an endpoint that did not answer is not evidence that the name is
missing, and reporting one as the other would strand every live domain the
moment your service restarted. A failed `attach`, though, really is a failure —
the caller has to know the name was not registered.

### Six rules your endpoint owes {#webhook-rules}

1. **Answer within five seconds.** Never block on certificate issuance inside
   `attach`; write the route, answer, and report the certificate from `status`.
2. **Be idempotent.** `attach` on a name you already have is `already-exists`,
   which Aglyn treats as success.
3. **Only ever answer with a value from the vocabulary above.**
4. **Return `skipped` for a name you do not manage** — not `failed`. `skipped`
   is "not my job"; `failed` means something broke.
5. **Do not say `serving` until TLS actually answers.** `certificate-pending`
   exists for the gap between "routed" and "has a certificate", and it is
   explicitly *not* treated as serving.
6. **Do not invent `ownership-pending` or `dns-misconfigured`** unless you
   really checked. Both block the domain in the console.

### A worked endpoint: Traefik's file provider {#webhook-traefik}

A complete implementation, adaptable to any proxy that reads configuration from
disk. It writes one router file per domain, deletes it on detach, and answers
`status` from Traefik's own API plus its ACME store. No dependencies.

Define the two services **once**, in a base file Traefik's file provider also
watches, so per-domain files only ever add a router:

```yaml
# /etc/traefik/dynamic/00-aglyn-services.yml
http:
  services:
    aglyn-console:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:4200"
    aglyn-tenant:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:4500"
```

```js
// aglyn-domains.mjs — bind to loopback; reachable only from the Aglyn containers.
import { createServer } from 'node:http'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'

const TOKEN = process.env.WEBHOOK_TOKEN ?? ''
const DYNAMIC_DIR = '/etc/traefik/dynamic'
const ACME_STORE = '/etc/traefik/acme.json'
const TRAEFIK_API = 'http://127.0.0.1:8080'
const RESOLVER = 'le'

const routerName = (domain) => `aglyn-${domain.replace(/[^a-z0-9]/g, '-')}`
const routerPath = (domain) => join(DYNAMIC_DIR, `${routerName(domain)}.yml`)

/** One router, optionally carrying a redirect middleware. */
function routerFile(domain, scope, redirectTo) {
  const name = routerName(domain)
  const service = scope === 'console' ? 'aglyn-console' : 'aglyn-tenant'
  const lines = [
    'http:',
    '  routers:',
    `    ${name}:`,
    '      entryPoints: ["websecure"]',
    '      rule: "Host(`' + domain + '`)"',
    `      service: ${service}`,
  ]
  if (redirectTo) {
    lines.push(`      middlewares: ["${name}-redirect"]`)
  }
  lines.push('      tls:', `        certResolver: ${RESOLVER}`)
  if (redirectTo) {
    lines.push(
      '  middlewares:',
      `    ${name}-redirect:`,
      '      redirectRegex:',
      '        regex: "^https?://[^/]+/(.*)"',
      // Temporary and revocable on purpose — this forwarding is a product
      // decision the console can withdraw, not a permanent property of the name.
      `        replacement: "https://${redirectTo}/\${1}"`,
      '        permanent: false',
    )
  }
  return lines.join('\n') + '\n'
}

/** Written whole, then moved into place: Traefik must never read a half-file. */
async function writeRouter(domain, scope, redirectTo) {
  const path = routerPath(domain)
  await writeFile(`${path}.tmp`, routerFile(domain, scope, redirectTo), 'utf8')
  await rename(`${path}.tmp`, path)
}

async function routerLive(domain) {
  const res = await fetch(
    `${TRAEFIK_API}/api/http/routers/${routerName(domain)}@file`,
  ).catch(() => null)
  if (!res?.ok) return false
  const router = await res.json().catch(() => null)
  return router?.status === 'enabled'
}

async function certificateIssued(domain) {
  const raw = await readFile(ACME_STORE, 'utf8').catch(() => 'null')
  const store = JSON.parse(raw || 'null')
  const certs = store?.[RESOLVER]?.Certificates ?? []
  return certs.some(
    (cert) =>
      cert?.domain?.main === domain ||
      (cert?.domain?.sans ?? []).includes(domain),
  )
}

const reply = (res, payload) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

createServer(async (req, res) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end()
    return
  }
  let body
  try {
    body = JSON.parse(await new Response(req).text())
  } catch {
    return reply(res, { outcome: 'failed', detail: 'unparseable request' })
  }
  const { action, scope, domain, redirectTo } = body
  if (typeof domain !== 'string' || !domain) {
    return reply(res, { outcome: 'failed', detail: 'no domain' })
  }

  try {
    if (action === 'attach') {
      const existed = await routerLive(domain)
      await writeRouter(domain, scope, redirectTo)
      // Answer NOW. Traefik picks the file up in milliseconds, but the
      // certificate takes seconds to minutes and Aglyn abandons this call at
      // five. `status` is where the certificate gets reported.
      return reply(res, {
        outcome: existed ? 'already-exists' : 'attached',
        detail: 'traefik file provider',
      })
    }

    if (action === 'detach') {
      try {
        await unlink(routerPath(domain))
        return reply(res, { outcome: 'detached' })
      } catch {
        return reply(res, { outcome: 'not-found' })
      }
    }

    if (action === 'status') {
      if (!(await routerLive(domain))) {
        return reply(res, { state: 'not-attached' })
      }
      return reply(res, {
        state: (await certificateIssued(domain))
          ? 'serving'
          : 'certificate-pending',
      })
    }
  } catch (error) {
    // Answering `failed` beats throwing: a thrown request reaches Aglyn as a
    // connection error, which is the same verdict with less in the log.
    return reply(res, { outcome: 'failed', detail: String(error).slice(0, 200) })
  }

  reply(res, { outcome: 'failed', detail: `unknown action ${action}` })
}).listen(9099, '127.0.0.1')
```

Two things this deliberately does not do, and neither is an oversight. It never
answers `ownership-pending`, because Traefik's DNS-01 challenge is between
Traefik and your DNS provider and there is nothing for a customer to add. And it
never answers `dns-misconfigured`, because it does not resolve the name — a
router that exists with no certificate is `certificate-pending` whether the
cause is a slow issuance or DNS that never pointed here, and reporting the
stronger state without checking would block a domain that was about to work.

**Other proxies, same endpoint.** Caddy is this endpoint driving the admin API
at `:2019` with `PATCH /id/<id>` and `POST /config/.../routes` (there is a
worked Caddy version in
[the environment reference](./self-hosting-environment.md#domains-webhook)).
cert-manager is this endpoint creating a `Certificate` resource and reading its
`Ready` condition for `status`. A registrar's API is this endpoint plus a
`CNAME` write.

## When no driver is configured {#unconfigured}

This is a supported state, not a broken one. A deployment can legitimately have
names handled entirely outside the product, and the correct behavior there is
silence rather than a failure logged on every signup forever.

**Workspace subdomains.** The attach returns `skipped` and the organization is
created anyway — the console is path-routed and `{console}/{slug}` is the
canonical form, so a workspace with no subdomain is fully usable. The console
still *advertises* `{slug}.<workspace domain>`, so that name has to resolve some
other way or it will not load. The deployment says so **once per process**, not
once per signup:

```
[workspace-domains] no domain provider — workspace subdomains are not
registered by this deployment. Point a wildcard DNS record for *.example.com at
your console, route it there, and set AGLYN_DOMAIN_PROVIDER=wildcard — or the
workspace URL the console shows will not resolve.
```

**A customer's custom domain.** `/api/domains/attach` answers **501**:

> Domain attachment is not configured on this deployment (no domain provider —
> set `AGLYN_DOMAIN_PROVIDER`).

The same `501` is given whether there is no driver at all or a driver that does
not manage this particular name — which is honest, because from the customer's
side those are the same situation. The customer sees an info toast, the domain
sits behind a red alert saying it is not attached, and a **Retry attachment**
button that cannot succeed until the deployment can register the name.

**The site serves anyway.** The Firestore claim on the domain is written before
the refusal, and the tenant runtime resolves an unrecognized hostname against
that claim. So on `wildcard` or `none`:

1. Point the customer's DNS at your reverse proxy.
2. Route that hostname to the tenant container by hand.
3. The site is served.

What the refusal actually costs is the **canonical redirect**. A host carrying
`cnameAttachmentPending` is not treated as having a live custom domain, so the
platform subdomain keeps serving the site rather than forwarding to the custom
domain, and both addresses serve the same pages until the flag clears.

## Status states {#status-states}

`attach` answers "did the registration succeed", which is a weaker question than
"is this name serving". A domain can be registered and serve nothing — ownership
unproven, DNS not pointed, certificate not issued — and all three follow a
perfectly successful attach. `status` is the question the console actually
renders.

| State | What it means | Visitors sent there? | Your move |
| --- | --- | --- | --- |
| `serving` | Registered, routed, certificate covers it. | Yes | Nothing. |
| `certificate-pending` | Accepted and routed, but no certificate exists yet, so the name answers with a **TLS error**. | **No** | Wait. If it never clears, look at your ACME client. |
| `ownership-pending` | The provider is holding the name until a challenge record is added. `verification` carries the record and is shown to the customer. | **No** | The customer adds the record at their registrar. |
| `dns-misconfigured` | The provider's own DNS check says the records do not point here. `conflicts` names foreign records answering for it. | **No** | Fix the records; remove any conflicting ones. |
| `not-attached` | The name is not registered on this deployment at all. | **No** | Attach it — or find out which deployment holds it. |
| `skipped` | No driver, or a driver that does not manage this name. | Yes | Nothing, unless you meant to manage it. |
| `unknown` | The probe could not answer. | Yes | Nothing on its own. Look for a pattern. |

:::note Why `unknown` counts as serving
A status probe that could not answer is not evidence of a problem. Treating it
as one would strand every live domain on a deployment whose driver has no status
API to ask — which is most of them, `wildcard` included. The failure mode of the
other choice is far worse: every customer's working site going dark in the
console because your endpoint restarted.
:::

`certificate-pending` is the one people expect to be treated as serving and it
is not. The name is accepted and routed, but the destination answers with a TLS
error — which for a customer who has just been told their site is live is worse
than a 404.

### Nothing has to be watched by hand {#completer}

An attach that came back short records `cnameAttachmentPending` on the host, and
`/api/admin/finish-domain-attachments` re-probes those hosts and clears the flag
once the name has become healthy. It runs **every fifteen minutes**, uses exactly
the same definition of "serving" as the door it completes for, and **never
attaches anything new** — the worst a run can do is nothing. It needs
`CRON_SECRET` set, and answers `501` if the deployment has no domain driver at
all.

## Migrating between drivers {#migrating}

Every domain variable is read at **runtime**, so switching drivers is an env
change and a restart — not a rebuild. (`NEXT_PUBLIC_WORKSPACE_DOMAIN` and
`NEXT_PUBLIC_TENANT_DOMAIN` are the exception, and you are not changing those
here.)

### `wildcard` → `webhook`, to start selling custom domains {#migrating-webhook}

The usual move. Everything the wildcard covered still has to work afterwards,
which is the part worth planning.

1. **Stand up the endpoint** and test it with `curl` before Aglyn ever sees it —
   an `attach`, a `status`, and a `detach` against a throwaway name.
2. **Teach it your wildcard apexes.** Once the driver is `webhook`, *every*
   name goes through it, workspace subdomains included. Those names are already
   served by your wildcard, so the endpoint should recognize them and answer
   `already-exists` for `attach` and `serving` for `status`, rather than writing
   a per-name route it does not need:

   ```js
   const WILDCARD = ['example.com', 'sites.example.com']
   const underWildcard = (domain) =>
     WILDCARD.some((suffix) => {
       if (!domain.endsWith(`.${suffix}`)) return false
       const label = domain.slice(0, -(suffix.length + 1))
       return label.length > 0 && !label.includes('.')
     })
   ```

   Answering `skipped` for them is also correct and costs nothing — it is what
   the wildcard driver itself did.
3. **Switch and restart**:

   ```bash
   AGLYN_DOMAIN_PROVIDER=webhook
   AGLYN_DOMAIN_WEBHOOK_URL=http://127.0.0.1:9099/domains
   AGLYN_DOMAIN_WEBHOOK_TOKEN=…
   ```

4. **Re-attach the domains that were refused while you had no driver for them.**
   Nothing does this for you: the completer cron only *probes*, so a domain that
   was never registered stays `not-attached` forever. Open each affected site's
   domain settings and press **Retry attachment**. New connections go through
   the new driver from the moment it is live.

### `webhook` → `wildcard`, or to `none` {#migrating-down}

Set the value and restart. Names your endpoint registered do not disappear —
they are in your proxy's configuration, and Aglyn will simply stop asking about
them. Customer domains outside your wildcard will start reporting `unknown`
rather than a real state, and new ones will be refused with the `501` above.

Be explicit rather than removing credentials: `AGLYN_DOMAIN_PROVIDER=none` wins
over a `VERCEL_TOKEN` that is still in the environment, which is exactly how you
switch a driver off without hunting down its configuration first.

### Moving on or off Vercel {#migrating-vercel}

`vercel` is the only driver detection will select on its own, so a
`VERCEL_TOKEN` left in an environment file will quietly take over a deployment
that meant to use something else. Set `AGLYN_DOMAIN_PROVIDER` explicitly on any
install where that token exists for another reason.

:::caution The reconcile script is Vercel-only
`tools/scripts/reconcile-workspace-domains.mjs` — the drift check and backfill
for workspace subdomains — still talks to Vercel's API directly and refuses to
run without `VERCEL_TOKEN` and `VERCEL_CONSOLE_PROJECT_ID`. It has not been
moved onto the driver seam. On `wildcard` there is nothing for it to do anyway,
since every covered name resolves without registration; on `webhook` you have
no equivalent backfill and should reconcile from your own endpoint's records.
:::

## Related

- [Self-hosting](./self-hosting.md) — the full runbook, including
  [which addresses this install calls its own](./self-hosting.md#addresses) and
  [the reverse-proxy rules](./self-hosting.md#reverse-proxy).
- [Environment variables](./self-hosting-environment.md#domains) — the
  per-variable reference for everything on this page.
- [Custom Domains](../building-sites/custom-domains/overview.md) — what a site
  owner sees at the other end of all this.
