# Besigner content security review (2026-07-07)

Scope: every path where user-authored besigner/tenant content becomes
markup, requests, or storage. Verdicts below; fixes shipped in the same PR.

## Findings & status

| Surface | Risk | Status |
| -- | -- | -- |
| Firestore `hosts/**` rules | **Critical.** Any-authed read/write let any signed-up account edit other tenants' screens — stored XSS (rich-text `html` prop) + defacement + reading their form submissions. | **Fixed:** whole subtree scoped to the host `admins` map (+ staff). Host create requires self-admin. Deploy: `firebase deploy --only firestore:rules`. |
| ScreenLink external `href` | `javascript:`/`data:` URLs stored in props execute on visitor click. | **Fixed:** protocol allowlist (`http(s)`, `mailto:`, `tel:`, relative, `#`) at render time — covers JSON-editor-authored values too. |
| Rich text (`html` prop) | dangerouslySetInnerHTML on canvas + tenant. | OK by design: commit-time allowlist sanitizer (tags-only, attributes stripped, safe link hrefs, spec-pinned). Residual: an admin can hand-write `html` via the JSON editor for their **own** site — same trust level as Squarespace code injection; cross-tenant writes are closed by the rules fix. Render-time sanitization on the tenant is a possible defense-in-depth follow-up. |
| Image `src` | Arbitrary URL in an `img src` attribute. | OK: attribute-context only (no scriptable protocols execute in `img src` in modern browsers); React escapes the attribute. |
| Form submissions | Visitor-supplied strings. | OK: server caps field count/size, honeypot, rate limit, monthly quota; inbox renders via React text nodes (escaped). Writes go through the Admin SDK; client-side writes now require host-admin. |
| Collection entries | Plain-text body split into paragraphs. | OK: React-escaped; no HTML path. |
| SEO fields / titles | Rendered through `<Head>` children. | OK: React escapes text nodes and attribute values. |
| sitemap/robots/RSS | Reflected values. | OK: XML-escaped; robots is static. |
| Analytics collector | Unauthenticated increments. | Accepted: counter-inflation only (no reads/overwrites); path keys sanitized; per-doc daily granularity bounds damage. |

## Known residual items

1. **Storage rules** are still any-authed write: Firebase Storage rules
   cannot read the host `admins` map, so per-host authorization there needs
   either per-host custom claims or moving uploads behind an authenticated
   API route (recommended follow-up before GA; metadata mirror writes are
   already admin-scoped by the Firestore fix).
2. **Render-time HTML sanitization on the tenant** (defense-in-depth for
   the `html` prop) — sanitizer currently runs at commit time only.
3. Screen-link resolved hrefs come from the host routing map (slug-derived,
   safe by construction).
