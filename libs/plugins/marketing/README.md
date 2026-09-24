# @aglyn/plugins-marketing

The Marketing plugin for Aglyn: announcement bars and popups (overlays), A/B experiments, and email campaigns, with the console section that manages them, the runtime that shows them on a published site, and the server routes behind both. Install it if you run the Aglyn console and tenant runtime and want these features; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-marketing@beta

Peer dependencies: `react`, `next`, `@mui/material`, `@mui/x-data-grid`, `firebase`, and `firebase-admin` for the server entry.

## What's in it

The plugin declares four registrars in `plugins.config.json`, plus a `site` module so a published page can load the site half alone.

**On a published site** (`registerMarketingPlugin`, the `site` registrar, exported from `@aglyn/plugins-marketing/site`). It registers one site runtime, `marketing-site-runtime`, with `registerSiteRuntime`. The runtime is not a canvas element: the tenant page renders it generically, and it draws the active announcement bars and popups, applies experiment variants and runs the page's client automations from the data the server enricher wrote. In the editor's Preview, where no enricher runs, it rebuilds that data on the client through a deferred import.

**Console** (`registerMarketingConsole`, the `console` registrar):

- A `Marketing` nav item at `/marketing` with the sections Overview, Campaigns, Conversions, Overlays and A/B testing. Each section is a route; the page is code-split.
- The same page at the organization level, `/[orgSlug]/marketing`, declared in `orgNavItems` with the site's sections in the site's order. Campaigns and their sends belong to the organization (`orgs/{orgId}/emailCampaigns`, `orgs/{orgId}/campaigns`): the org hub lists every one, places a campaign on every site or on chosen sites (`visibleTo`), and asks which site an email is sent as before writing it; a site's hub lists the campaigns placed on that site. Overlays, A/B tests and conversions are each one site's, so the org hub reads them per site and bounded: Overview sums the org's sends and each site's overlay and test figures as server aggregates, for a capped number of sites; Overlays and A/B testing list every site's, one page of sites at a time, switch an overlay on or off, and send every edit to the site's own hub; Conversions shows the site picked under "Conversions on". Overlays and A/B testing carry their plan flags on the org sections, so an organization without the plan reads nothing per site. Both levels share the `release_marketing` flag. The organization's messages are its Emails page's; the old `/[orgSlug]/marketing/emails/…` addresses redirect there (`apps/console/next.config.js`).
- Campaigns end to end. The plugin owns the campaign composer, test sends, scheduling, reports and recipients. The individual messages are listed on the Emails page, but that page belongs to the email plugin, which hosts an `emailMessages` zone; this plugin fills it with the message list, one message's page and its composer. It also fills `emailTemplateRecipients` (who received the sends built from a template).
- Widgets in other hosts' slots: the "Last campaign" card on the site dashboard (`hostDashboard`), the campaigns card in the Inbox (`inboxCampaigns`), and campaign attribution on a record's page (`crmRecordAttribution`, `inboxRecordAttribution`).
- Zones this plugin hosts for other plugins to fill, registered with `registerPluginZone`: two on the A/B testing card (beside the variants, and below a test's results), and five bare zones in the campaign composer and on a message's page for whichever plugin keeps the mail itself: the topic picker, the topic options, the add-a-sender editor, the design creator and the sent-design preview.
- A record route for `campaign`, at both the site and the organization level, so another plugin can link to a campaign without knowing this plugin's URLs.

**Server**, exported from `@aglyn/plugins-marketing/server`:

- `registerMarketingApi` (the `tenantApi` registrar): the `experiments/track` beacon, which counts exposures and conversions for a running experiment and can finish a test whose auto-winner rule is met, and a site page enricher (`registerSitePageEnricher`) that adds overlays, automations and experiments to a page's data.
- `registerMarketingConsoleApi` (the `consoleApi` registrar): `campaigns/send`, `campaigns/manage`, `campaigns/recipients`, `campaigns/process-scheduled`, `lists/materialize`, and the delivery events webhook at `email/events`. It also registers the campaign draft writer on the core's resource-drafts seam and figure readers for campaign and experiment results.

**Exports from `.`**

- `registerMarketingConsole`, `registerMarketingPlugin`, `BUNDLE_ID`.
- Overlays: `HostOverlay`, `resolveActiveOverlays`, `overlayMatchesPath`, `overlayActiveAt`, `overlayStatus`, `compareOverlayPrecedence`, `popupSuppressed`.
- Experiments: `HostExperiment`, `ExperimentVariant`, `assignExperimentVariant`, `validateExperiment`, `compareVariants`, `evaluateAutoWinner`, `experimentResultRows`, `describeVariantComparison`.
- The site contract types (`AnnouncementBarData`, `PopupData`, `ScreenExperiment`, `ClientAutomation`), `compileClientAutomations`, and the campaign figures helpers (`campaignFormsRollup`, `campaignFormTotals`).

## Usage

The plugin is loaded through Aglyn's plugin manager: the generated loader manifests import the package and call the registrars named in `plugins.config.json`, and a published page loads the site half only where the site runs the feature. An app that wires plugins by hand calls them once at startup:

```ts
// published site, client side: the site half alone
import { registerMarketingPlugin } from '@aglyn/plugins-marketing/site'
registerMarketingPlugin()

// console, client side
import { registerMarketingConsole } from '@aglyn/plugins-marketing'
registerMarketingConsole()

// server side: tenant runtime and console
import {
  registerMarketingApi,
  registerMarketingConsoleApi,
} from '@aglyn/plugins-marketing/server'
```

Import the site half from `./site`, not from the root: the root entry also carries the console registrar and its pages.

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`), the tenant packages (`@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance`) and generic `@aglyn/shared-*` packages. It imports no other plugin. Everything it shares with the email, CRM, Inbox, commerce and AI plugins crosses through core seams: console zones and slots, record routes, resource drafts and figure readers. The core never imports this package.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/marketing
