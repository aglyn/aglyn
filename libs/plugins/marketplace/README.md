# @aglyn/plugins-marketplace

The Marketplace plugin for Aglyn: browsing, installing, updating and publishing marketplace listings from the console, and the server routes behind those actions. Install it if you run the Aglyn console and want the marketplace in it; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-marketplace@beta

Peer dependencies: `react`, `@mui/material`, `firebase`, `next`, and `firebase-admin` for the server entry.

## What's in it

**On a published site.** Nothing of its own. What a listing installs (a component, site template, layout, theme, dataset schema, email template, email starter or plugin) is copied into the site's own collections and renders through the normal pipeline, so there is no separate site bundle.

**Console** (`registerMarketplaceConsole`, the `console` registrar in `plugins.config.json`). The plugin adds no nav item. It exposes its UI through widget slots that the console app renders without importing the plugin:

- `orgMarketplace`: browse and install, at organization scope.
- `marketplaceListing`: the content of one listing's detail page.
- `orgAddons`: the installed add-ons card, with upgrade, uninstall and sharing an install with the whole organization.
- `pluginSiteSet`: which sites one installation applies to.

It also registers a `rating` custom field type (`registerCustomFieldType`) with a starred input.

**Server** (`registerMarketplaceConsoleApi`, the `consoleApi` registrar, exported from `@aglyn/plugins-marketplace/server`). Routes registered with `registerPluginApiRoute` under the `marketplace` prefix:

- Install: `marketplace/install`, `install-plugin`, `install-layout`, `install-template`, `install-theme`, `install-dataset-schema`, `install-email-starter`, `install-email-template`, and `update-artifact` for reconciling an installed copy with a newer published version.
- Publish: `marketplace/publish`, `publish-plugin`, `publish-layout`, `publish-template`, `publish-theme`, `publish-dataset-schema`, `publish-email-starter`, `publish-email-template`, `publisher-profile`, `verification-request`.
- Listings: `marketplace/listing-versions`, `preview-image`, `reviews`, `report`.
- Paid listings: `marketplace/checkout` and `marketplace/connect`, plus a handler on the platform billing webhook (`registerBillingWebhookHandler`).

The server entry also registers the server side of the `rating` field type, so its validators run on write paths where no client loaded the plugin.

**Exports from `.`**

- `registerMarketplaceConsole`, `BUNDLE_ID` (`'marketplace'`).
- `MarketplaceBrowse`, `HostPluginsCard`, `PluginSiteSetPanel` and the `useMarketplaceActions` hook, shared with the console's listing and publisher routes.
- The marketplace model: `MarketplaceListing`, `MarketplacePublisherProfile`, `InstallPin`, `ARTIFACT_TYPE_LABELS`, `listingArtifactLabel`, `installTargetsFor`, `resolveInstallPlan`, `resolvePluginInstallState`, `resolveUninstallTargets`, `validateListingContent`, `validatePublisherProfileContent`, `isValidPublisherHandle`, and the artifact update helpers `planArtifactUpdate` and `applyArtifactUpdate`.

## Usage

The plugin is loaded through Aglyn's plugin manager: the console's generated loader manifests import the package and call the registrars named in `plugins.config.json`. An app that wires plugins by hand calls them once at startup:

```ts
// console, client side
import { registerMarketplaceConsole } from '@aglyn/plugins-marketplace'
registerMarketplaceConsole()

// console, server side
import { registerMarketplaceConsoleApi } from '@aglyn/plugins-marketplace/server'
registerMarketplaceConsoleApi()
```

Model helpers import from the root:

```ts
import {
  listingArtifactLabel,
  validateListingContent,
  type MarketplaceListing,
} from '@aglyn/plugins-marketplace'
```

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`), the tenant packages (`@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance`) and generic `@aglyn/shared-*` packages. It imports no other plugin: the element that draws an installed marketplace plugin on a page belongs to `@aglyn/plugins-mui`, and the two meet through core registries. The core never imports this package; the console reaches it through the loader manifest and the slots above.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/marketplace
