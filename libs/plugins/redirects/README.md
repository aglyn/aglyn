# @aglyn/plugins-redirects

The Redirects plugin for Aglyn: URL redirect rules for a site, the console page that manages them, and the server hook that answers a request with a redirect before the site resolves a route. Install it if you run the Aglyn console and tenant runtime and want redirect rules; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-redirects@beta

Peer dependencies: `react`, `@mui/material`, `firebase`, and `firebase-admin` for the server entry.

## What's in it

**On a published site.** Nothing is drawn. Redirects are enforced on the server: `registerRedirectsApi` (the `tenantApi` registrar, exported from `@aglyn/plugins-redirects/server`) registers a site redirect resolver with `@aglyn/aglyn/server`. For each request the resolver is given the host and path and returns a destination and status code, or nothing.

**Console** (`registerRedirectsConsole`, the `console` registrar): a `Redirects` nav item at `/redirects`, gated by the `redirects` entitlement. The page is code-split and loads when opened.

**The rule model**, exported from `.`:

- `HostRedirect`: a rule's `source`, `destination`, `statusCode` (`REDIRECT_STATUS_CODES`), `kind` (`REDIRECT_KINDS`: `exact`, `prefix`, `regex`), `priority` and `enabled`.
- `matchRedirect(rules, path)`: evaluates rules in priority order and returns a `RedirectMatch` or `null`. Disabled, self-targeting and invalid rules never fire, and an external destination is served only when the rule records the publisher who approved it.
- `validateRedirectRule`, `compileRedirectRegex`, `normalizeRedirectSource`, `normalizeRedirectDestination`, `isExternalRedirectDestination`, `isSelfRedirect`, `REDIRECT_DEFAULT_PRIORITY`.
- `BUNDLE_ID` (`'redirects'`).

## Usage

The plugin is loaded through Aglyn's plugin manager: the generated loader manifests import the package and call the registrars named in `plugins.config.json`. An app that wires plugins by hand calls them once at startup:

```ts
// console, client side
import { registerRedirectsConsole } from '@aglyn/plugins-redirects'
registerRedirectsConsole()

// tenant runtime, server side
import { registerRedirectsApi } from '@aglyn/plugins-redirects/server'
registerRedirectsApi()
```

The matcher is pure and can be used directly:

```ts
import { matchRedirect, type HostRedirect } from '@aglyn/plugins-redirects'

const rules: HostRedirect[] = [
  { source: '/old', destination: '/new', statusCode: 301 },
]
const match = matchRedirect(rules, '/old')
// match?.destination === '/new'
```

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`), the tenant packages (`@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance`) and generic `@aglyn/shared-*` packages. It imports no other plugin, and the core never imports it: the tenant runtime asks whichever resolver is registered, and the console reaches the page through the loader manifest.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/redirects
