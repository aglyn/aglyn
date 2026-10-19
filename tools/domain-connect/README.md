# Domain Connect templates (AGL-3963)

One-click DNS on a site's **Custom domain** card uses the open
[Domain Connect](https://www.domainconnect.org/) standard: the console sends
the site owner to their own DNS provider with a signed link, they approve, and
the provider writes Aglyn's records into their zone. The provider only does
that for a template it already holds, so these two files are what gets
published upstream:

| File | Applied when the owner typed | Records |
| -- | -- | -- |
| `aglyn.com.website.json` | the bare domain or its `www.` | `A @ → 216.198.79.1`, `CNAME www → sites.aglyn.app` |
| `aglyn.com.website-subdomain.json` | any other subdomain (`shop.example.com`) | `CNAME @ → sites.aglyn.app` (`hostRequired`) |

The values are the defaults in `libs/aglyn/src/lib/app-utils/tenant-dns-targets.ts`
(the same ones the card prints and the DNS check accepts), and
`libs/plugins/domains/src/lib/server/domain-connect/templates.spec.ts` fails if
they drift. Change a record here only together with that file, and bump
`version` (the upstream workflow refuses a changed template without one).

Both templates set `syncPubKeyDomain: aglyn.com`, so a provider refuses any
apply link that is not signed with the key published at
`_dcpubkeyv1.aglyn.com`. That is what keeps a stranger from building a link
that writes these records with a redirect of their own.

Nothing in this folder is sent anywhere by the repo. Each step below is done by
a person.

## 1. The signing key

```bash
# Makes a 2048-bit RSA pair. Writes the private key to a file (mode 0600) and
# prints it on one line for the variable store, plus the TXT records.
node tools/scripts/domain-connect-key.mjs --out ~/.aglyn/domain-connect-key.pem
```

1. Set `DOMAIN_CONNECT_PRIVATE_KEY` on the **console** project (Production
   only; Preview and Development stay unset, so one-click DNS stays off there)
   to the one-line value it prints.
2. Publish the public half. Dry run first, then for real:

   ```bash
   node tools/scripts/domain-connect-key.mjs --from ~/.aglyn/domain-connect-key.pem
   VERCEL_TOKEN=… VERCEL_TEAM_ID=… \
     node tools/scripts/domain-connect-key.mjs --from ~/.aglyn/domain-connect-key.pem --publish
   ```

   This adds two TXT records at `_dcpubkeyv1.aglyn.com`
   (`p=1,a=RS256,d=…` and `p=2,a=RS256,d=…`). Check them with
   `dig +short TXT _dcpubkeyv1.aglyn.com`.

Until the variable is set, discovery answers "not supported" for every domain
and the card is unchanged.

**Rotating:** make a new pair, publish it under `--key-host _dcpubkeyv2`, set
`DOMAIN_CONNECT_KEY_HOST=_dcpubkeyv2` with the new private key, and remove the
old TXT records once no link signed with the old key can still be in flight
(a day is plenty). The templates do not change.

## 2. Lint and test the templates

The upstream repository requires its linter (Go 1.22 or newer):

```bash
go install github.com/Domain-Connect/dc-template-linter@latest
cd tools/domain-connect
for file in aglyn.com.website.json aglyn.com.website-subdomain.json; do
  dc-template-linter -merge-or-fail "$file"; echo "fast track $file: $?"
  dc-template-linter -tolerate warn "$file"; echo "full check $file: $?"
  dc-template-linter -cloudflare "$file"; echo "cloudflare $file: $?"
  dc-template-linter -logos "$file"; echo "logos $file: $?"
done
```

⚠️ Not run in AGL-3963: the machine it was built on has no Go toolchain, and
installing one (or a release binary) was not done unattended. Run the loop
above before opening the pull request; every exit code must be 0.

`-logos` fetches `logoUrl`, which is the logo's file in this public
repository on `raw.githubusercontent.com`. It is not on `aglyn.com` on purpose:
the edge's bot protection answers every non-browser request there with 429,
which would refuse the linter and a DNS provider's own logo fetch alike.

Then test both templates in the online editor,
<https://domainconnect.paulonet.eu/dc/free/templateedit>: paste each file,
confirm the syntax check passes, apply it to a test domain at the root
(`host` empty) and, for the subdomain template, with `host` set (e.g. `shop`),
and press **Copy Markdown** to get the shareable result link the pull request
template asks for.

## 3. Submit to github.com/Domain-Connect/Templates

1. Fork <https://github.com/Domain-Connect/Templates>.
2. Copy both files, unchanged, to the repository root. The names are
   `<providerId>.<serviceId>.json`, which these already are.
3. Open one pull request with the repository's PR template, every section
   filled in and its structure unchanged, and paste the two editor links from
   step 2.

Suggested title: `Add aglyn.com website templates`

Suggested description, to adapt into the PR template's sections:

> Aglyn is a website builder. These two templates point a customer's domain at
> their Aglyn website: `website` writes the zone root's A record and `www`'s
> CNAME together (the site serves one and redirects the other), and
> `website-subdomain` writes one CNAME on the subdomain the customer chose.
> Both are fixed — no variables — and both set `syncPubKeyDomain` so every
> apply link must be signed; the key is published at `_dcpubkeyv1.aglyn.com`.
> Synchronous flow only, with `redirect_uri` on `app.aglyn.com`
> (`syncRedirectDomain`).

## 4. Onboard with the DNS providers that ask for it

Many DNS providers pick templates up from the repository once it is merged.
Cloudflare documents a separate email step after the merge
(<https://developers.cloudflare.com/dns/reference/domain-connect/>). No other
provider's onboarding contact was confirmed while building this; for the rest,
the Domain Connect site's contact form and Slack are the documented way in.

### Draft: Cloudflare (send only after the pull request is merged)

To: `domain-connect@cloudflare.com`
Subject: Domain Connect onboarding: aglyn.com (website, website-subdomain)

> Hello,
>
> We'd like to onboard two Domain Connect templates for Aglyn, a website
> builder, so Cloudflare customers can point their domain at their Aglyn
> website in one step. Both were merged into the Domain Connect Templates
> repository:
>
> - aglyn.com / website: <link to aglyn.com.website.json on the master branch>
> - aglyn.com / website-subdomain: <link to aglyn.com.website-subdomain.json on the master branch>
>
> The details you ask for:
>
> - **syncPubKeyDomain TXT records:** `_dcpubkeyv1.aglyn.com`
> - **Logo:** attached as SVG (`aglyn-logo-mark-blue.svg`). The templates'
>   `logoUrl` is https://raw.githubusercontent.com/aglyn/aglyn/main/apps/tenant/public/_static/images/brand/aglyn-logo-500x500.png.
> - **Default proxy status:** DNS only (not proxied) for every record, the A
>   and both CNAMEs. Our hosting edge issues the site's certificate itself and
>   needs to receive the traffic directly.
> - **Flow:** synchronous only; redirect_uri is on app.aglyn.com.
> - **Test account:** <a Cloudflare account ID, if we want the template
>   limited to it first>
>
> Thank you,
> <name>, Aglyn

Attach `apps/tenant/public/_static/images/brand/aglyn-logo-mark-blue.svg`.

## What happens once a provider has the template

Nothing to deploy. With `DOMAIN_CONNECT_PRIVATE_KEY` set, the card asks each
typed domain's provider (`_domainconnect` TXT, then its settings, then whether
it holds our template) and shows "Connect automatically with <provider>" only
when all three answer. Everything else keeps the printed records.
