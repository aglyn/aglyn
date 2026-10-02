# @aglyn/plugins-marketplace

The Marketplace plugin for Aglyn: browsing, installing, updating and publishing marketplace listings from the console, and the server routes behind those actions. Install it if you run the Aglyn console and want the marketplace in it; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-marketplace@beta

Peer dependencies: `react`, `@mui/material`, `firebase`, `next`, and `firebase-admin` for the server entry.

## What's in it

**On a published site.** Nothing of its own. What a listing installs (a component, site template, layout, theme, dataset schema, email template, email starter or plugin) is copied into the site's own collections and renders through the normal pipeline, so there is no separate site bundle.

**Console** (`registerMarketplaceConsole`, the `console` registrar in `plugins.config.json`). The Marketplace hub at `/[orgSlug]/marketplace` is one `orgNavItems` entry, served by the console's generic org plugin route: browse, installed, licenses, and the seller sections. The report and review queues are `staffPages`. On console pages that are not the marketplace, it draws into widget slots the console renders without importing the plugin:

- `hostArtifactPublish`: the publish dialog for something a console page holds (a layout, a theme, a site template).
- `orgPluginInstalls`: the workspace's installed marketplace plugins, on its Plugins page.
- `pluginInstallStatus`: whether an installation runs the newest installable version, on its installation page.
- `pluginSiteSet`: which sites one installation applies to.
- `staffOverview`: recent purchases and the refund-reversal recovery queue, on the staff overview.
- `templateGallery`: the "Marketplace templates" shelf of a site's template gallery, installing through `install-template`.
- `templateInstallStatus`: "Update available" on a library row whose template it installed, re-installing through `install-template`.

It declares `templateSource` in `plugins.config.json`: the `source.type` its template install stamps, and the "Marketplace" badge a site's library shows for it.

It also registers a `rating` custom field type (`registerCustomFieldType`) with a starred input.

**Server** (`registerMarketplaceConsoleApi`, the `consoleApi` registrar, exported from `@aglyn/plugins-marketplace/server`). Routes registered with `registerPluginApiRoute` under the `marketplace` prefix:

- Install: `marketplace/install`, `install-plugin`, `install-layout`, `install-template`, `install-theme`, `install-dataset-schema`, `install-email-starter`, `install-email-template`, and `update-artifact` for reconciling an installed copy with a newer published version.
- Publish: `marketplace/publish`, `publish-plugin`, `publish-layout`, `publish-template`, `publish-theme`, `publish-dataset-schema`, `publish-email-starter`, `publish-email-template`, `publisher-profile`, `verification-request`.
- Listings: `marketplace/listing-versions`, `preview-image`, `reviews`, `report`.
- Paid listings: `marketplace/checkout` and `marketplace/connect`, plus a handler on the platform billing webhook (`registerBillingWebhookHandler`).

The server entry also registers the server side of the `rating` field type, so its validators run on write paths where no client loaded the plugin.

A listing type whose copies live in another plugin's storage is that plugin's to read and write: `install-dataset-schema`, `publish-dataset-schema` and `update-artifact` keep the listing, its gates, the purchase, the provenance stamp and the tally, and ask the type's owner for the rest through `@aglyn/aglyn/plugin-manager/plugin-artifact-types` (the data plugin keeps `datasetSchema`). With no owner in the deployment the doors refuse (`501`, or `503` when the declared owner did not start) before anything is written.

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
