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

1. ~~**Storage rules** are still any-authed write~~ — RESOLVED (AGL-85):
   uploads/deletes moved behind `/api/media/upload` (ID token + host-admin
   + server-side quota, Admin SDK writes); `cloud/firebase-storage.rules`
   now denies all client writes (public read for site assets). Deploy with
   `firebase deploy --only storage`.
2. **Render-time HTML sanitization on the tenant** (defense-in-depth for
   the `html` prop) — sanitizer currently runs at commit time only.
3. Screen-link resolved hrefs come from the host routing map (slug-derived,
   safe by construction).

## Realm-tier plugins threat model (AGL-437 addendum)

The trusted-realm tier (AGL-420) intentionally trades the iframe sandbox
for full app-realm access on STAFF-SIGNED bundles. What keeps that honest:

- **Trust chain**: content-addressed artifact + pinned sha256 + Ed25519
  signature over the sha (fail-closed) + `revocations` kill switch + host
  ABI generation check. Every link verified before a byte executes, on
  both the client (blob import) and server (temp-file import) paths.
- **Blast-radius controls**: realm grants are super-staff only and
  adminAudit'd; remote SERVER bundles additionally need the per-deploy
  env master switch + explicit allowlist, and every server load writes an
  adminAudit event (`plugins.remoteServer.load`) with the sha and app.
- **Publisher-side friction**: static verification (entry exports,
  self-containment, forbidden APIs, size) enforced by the publish API and
  re-run in the staff review queue; 20 publishes/publisher/day.
- **Residual risk**: a signed bundle IS first-party-grade code — review
  before signing is the real control. The static verifier reduces
  reviewer load; it is not a sandbox. Rotation:
  `tools/scripts/generate-plugin-trust-key.mjs` →
  `tools/scripts/resign-realm-plugins.mjs` → swap public keys
  (docs/PLUGIN_LOADING.md has the order-of-operations).
