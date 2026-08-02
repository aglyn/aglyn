# Plugin platform: competitive gap analysis (vs Strapi) & v2 roadmap

July 2026. Benchmarked against Strapi 5's plugin ecosystem (Plugin SDK,
Admin Panel API, Server API, custom fields, Strapi Market) — the most
mature comparable plugin platform in the CMS/site-builder space. Companion
docs: `docs/PLUGIN_LOADING.md` (current architecture),
`apps/docs/docs/developers/plugins/*` (authoring guides). Tracked in Linear project
**"Plugin platform v2: DX, marketplace & docs"**.

## Where Aglyn is already ahead

| Capability | Aglyn | Strapi |
| --- | --- | --- |
| Untrusted third-party code | Cross-origin sandboxed PluginFrame (CSP from manifest, capability-scoped bridge, host-mediated fetch) | None — plugins are fully-trusted npm packages in-process |
| Trust tiers | Sandbox → staff-signed realm tier (Ed25519 over sha256, fail-closed) | Single tier; ✅ badge is review-only, not enforced |
| Content integrity | Content-addressed immutable artifacts, sha-pinned installs, revocation kill switch | npm semver ranges (mutable dist-tags) |
| Runtime install | Install → enable → load per workspace with **no deploy** | npm install + rebuild + redeploy |
| Per-tenant enablement | `org.enabledPlugins` switchboard + per-request API gate | Global `config/plugins.js` per deployment |
| Billing-integrated marketplace | Paid listings, Stripe purchases, seller payouts | Free listings only |
| Entitlement gating | Plan entitlements compose with enablement per surface | n/a |

## Gaps (Strapi has it, Aglyn doesn't — or barely)

### Developer experience — the adoption blocker
- **No scaffolding CLI.** Strapi: `npx @strapi/sdk-plugin init` generates a
  working plugin skeleton. Aglyn: copy an existing `libs/plugins/*` by hand
  (first-party) or start from a 40-line demo (marketplace realm).
- **No local dev loop for marketplace authors.** Strapi: `watch` /
  `watch:link` (yalc) hot-reloads a plugin inside a running app. Aglyn:
  publish → install → reload; no way to iterate against a live workspace.
- **No pre-publish verification.** Strapi: `strapi-plugin verify` checks
  the built output. Aglyn: publish accepts any bundle under the size cap.
- **No plugin config schema.** Strapi: `config` with defaults + validator,
  read via `strapi.plugin(name).config`. Aglyn: plugins hand-roll settings
  storage; no per-plugin org settings document or generic settings UI.
- **Partial lifecycle.** Strapi: `register` → `bootstrap` (after ALL
  plugins registered, for cross-plugin wiring) → `destroy`. Aglyn: per-
  surface register fns only; no post-registration phase, no teardown.

### Extension surfaces
- **Injection zones are informal.** Strapi documents predefined + custom
  zones with `injectComponent`. Aglyn has 5 widget slots as bare strings —
  no exported catalog, no zones on org settings, host detail, admin, or
  besigner inspector.
- **No custom field types.** Strapi plugins register field types (input
  component + yup validator + underlying data type) that appear in the
  content-type builder. Aglyn datasets/forms have fixed field types.
- **No plugin-declared permissions.** Strapi plugins declare RBAC actions
  surfaced in the roles editor. Aglyn plugins consume shell-resolved
  permissions but can't contribute new keys.
- **No i18n registration** (`registerTrads` equivalent) for plugin UI.
- **No cron/scheduled-job registry** for plugin server halves.
- **No MCP/AI tool registration** (Strapi 5 ships an MCP server extension
  letting plugins expose AI-callable tools).

### Marketplace content & trust workflow
- **Thin listings.** Strapi Market requires logo, categories, README docs,
  repository link, license; renders full docs on the listing. Aglyn
  listings: displayName + description + category string + price — no logo,
  screenshots, README/publisher docs, links, or license; the detail page
  has nothing for a buyer to read.
- **No review workflow surface.** Strapi: submission form → business
  review → security review → listed, with a ✅ verified badge and explicit
  unverified-risk disclaimers. Aglyn: trust granting exists (sign-plugin
  API) but there is no submission status, review queue UI, checklist, or
  badge rendering.
- **No compatibility declarations.** Strapi plugins pin peer-dependency
  ranges (and v4/v5 major split). Aglyn manifests don't declare a host ABI
  version or platform version range; the loader can't refuse a bundle
  built for a future ABI.
- **Install lifecycle loose ends.** Installing a realm plugin doesn't add
  it to `org.enabledPlugins`; uninstalling doesn't remove it; no
  update-available indicator (pinned vs `latestVersion`).

### Release-flag coverage (internal ask)
8 of 13 first-party plugins have release flags (`contacts, bookings,
events, data_store, workflows, redirects, commerce_v2, marketplace`).
**Missing: marketing, email, inbox, logic** (mui is always-on base).
Flags also gate only nav/pages via FeatureGate — they don't feed the
plugin loader, so a flagged-off plugin still loads its bundles and serves
its API.

### Documentation
Strapi ships: full API reference per extension point, step-by-step
guides, custom-field/marketplace/publishing docs, a design-system kit
doc, contributor docs. Aglyn has 3 authoring pages + 1 architecture doc.
Missing: API reference for the plugin-manager surface, end-to-end
walkthroughs (scaffold → dev → verify → publish → install → uninstall),
an extension-point/slot/env reference, worked examples beyond the demo,
and a publisher handbook (listing authoring, docs-for-listing, updates).

## Roadmap (Linear waves)

1. **Flags & management** — release-flag all plugins and feed flags into
   the loader/API gate; unified console "Plugins & add-ons" page
   (first-party toggles + flag/entitlement state + marketplace installs
   with update/uninstall); install↔enablement sync.
2. **DX/SDK** — scaffolding CLI, bundle verifier (shared with the publish
   API), realm dev loop (dev-only unsigned localhost loads), plugin config
   framework, loader lifecycle v2 (bootstrap/destroy).
3. **Marketplace v2** — listing content (logo/screenshots/README/links/
   license), detail page that renders publisher docs, staff review queue +
   verified badges, ABI/version compatibility enforcement.
4. **Extension surfaces** — exported slot catalog + new zones, custom
   field types, plugin-declared permissions, scheduled jobs.
5. **Performance & security** — bundle budgets, loader metrics, server
   cold-start audit, publish rate limits, realm-load audit events, key
   rotation runbook.
6. **Docs suite** — API reference, walkthroughs, reference guides,
   examples, publisher handbook.
