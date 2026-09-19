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
| AI-emitted node trees (AGL-2905) | A model answers a generate request with a flat node map — component ids, parent/child pairs, props and `sx` it chose — and the renderer spreads props onto the DOM. | OK by construction: the ONLY path such a tree takes into storage is `validateAiNodeTree` (`libs/plugins/ai/src/lib/runtime/ai-node-tree.ts`), which composes `sanitizeMarketplaceDefinition` over the surface's allowlist from the generated palette (`libs/plugins/ai/src/lib/runtime/ai-palette.generated.ts`, produced by `tools/scripts/generate-ai-palette.mts` from the registered plugin bundles and drift-checked by `check:ai-palette`), then enforces the besigner's `restrictChildren`/`restrictParent`, drops unknown props, refuses a missing required prop, holds `sx` to a fixed key set and a token/number/CSS-length grammar (no `url(`, `expression(`, `!important`, `@import`), caps copy by role, admits links only to a host screen, a root-relative path or `https:`, admits media only as a DAM reference or `https:`, and caps the map at `NODE_MAP_MAX_BYTES`. Ids are minted fresh on the way out. Fuzzed per surface in `ai-node-tree.spec.ts`; a route that writes a model's tree without it is the defect. |
| An `href`/`src` a component or layout property feeds (AGL-2933) | A published node's own address is checked when it is published, but a property's value is set later, by whichever page places the component or screen sits inside the layout, and the graft splices it into the prop an element spreads onto the DOM — a `javascript:` Link value or a `data:text/html` Image value reached the element, and the image element runs no URL rule of its own. | **Fixed:** `resolveComponentPropTokens` (`libs/aglyn/src/lib/app-utils/compose-reusable-components.ts`) holds every `href`/`src` a `{{prop.*}}` token fed to `isSafeNodeUrl` (`node-url-policy.ts`) — the published-node rule plus the site's own screen, collection and media references — after substitution, and removes the prop where it fails. Canvas, Preview, detach, layouts and the tenant all compose through it. A value opening with a later binding (`{{host.url}}/about`) is left to it, with what follows judged as though the binding came to nothing. Publishing keeps an `href`/`src` bound whole to a declared Link/Image property (`sanitizeMarketplaceDefinition`'s `declaredProps`), since both ends of the binding are checked. Pinned in `compose-reusable-components-url-props.spec.ts`, `marketplace-props.spec.ts` and `apps/tenant/specs/component-property-values-render.spec.ts`. |
| Marketplace component and layout property declarations (AGL-2933) | A published component or layout carries the properties its tree binds to, and each declaration is publisher-written: a Link default becomes an installed page's `href`, an Image default a `src`, a Formatted document or Long text default a body, and labels, help text and option labels render in the installer's console. | OK by construction: publish, install and update all pass the list through `sanitizeMarketplaceProps` (`libs/plugins/marketplace/src/lib/model/marketplace-props.ts`), which keeps only a declaration's own keys and holds each default to the rule the published tree meets — Link to `SAFE_HREF`, Image to `SAFE_SRC`, a document to `sanitizeAuthorHtml` with no removals and no script-scheme link target, a Style value to no `url(`/`expression(`/`@import`/declaration punctuation, every other text to no script scheme. A refused default, label or option label is cleared; the property is never dropped, so its field and `{{prop.*}}` survive empty. Pinned in `libs/plugins/marketplace/src/lib/server/marketplace-props.spec.ts`. |
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
  re-run in the staff review queue; 20 publishes/publisher/day. The
  verifier PARSES the bundle since AGL-964 — computed access on a global,
  the `Function` constructor through `.constructor()`, `import()` with a
  runtime specifier, and every network call diffed against the manifest's
  declared origins, which is the check that fails a publish the CSP would
  otherwise have blocked silently in production. Verdicts are pinned to
  {sha256, verifier version} and swept weekly (AGL-1086), so a rule added
  today reaches versions published last year.
- **Residual risk**: a signed bundle IS first-party-grade code — review
  before signing is the real control. The static verifier reduces
  reviewer load; it is a lint, not a sandbox, and it reports which of its
  checks could not run (AGL-1087) rather than letting silence read as a
  pass. Rotation:
  `tools/scripts/generate-plugin-trust-key.mjs` →
  `tools/scripts/resign-realm-plugins.mjs` → swap public keys
  (docs/PLUGIN_LOADING.md has the order-of-operations).
