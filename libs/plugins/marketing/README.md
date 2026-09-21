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
- Campaigns end to end. The plugin owns the campaign composer, test sends, scheduling, reports and recipients. The individual messages are listed on the Emails page, but that page belongs to the email plugin, which hosts an `emailMessages` zone; this plugin fills it with the message list, one message's page and its composer. It also fills `emailTemplateRecipients` (who received the sends built from a template).
- Widgets in other hosts' slots: the "Last campaign" card on the site dashboard (`hostDashboard`), the campaigns card in the Inbox (`inboxCampaigns`), and campaign attribution on a record's page (`crmRecordAttribution`, `inboxRecordAttribution`).
- Zones this plugin hosts for other plugins to fill, registered with `registerPluginZone`: two on the A/B testing card (beside the variants, and below a test's results), and five bare zones in the campaign composer and on a message's page for whichever plugin keeps the mail itself: the topic picker, the topic options, the add-a-sender editor, the design creator and the sent-design preview.
- A record route for `campaign`, so another plugin can link to a campaign without knowing this plugin's URLs.

**Server**, exported from `@aglyn/plugins-marketing/server`:

- `registerMarketingApi` (the `tenantApi` registrar): the `experiments/track` beacon, which counts exposures and conversions for a running experiment and can finish a test whose auto-winner rule is met, and a site page enricher (`registerSitePageEnricher`) that adds overlays, automations and experiments to a page's data.
- `registerMarketingConsoleApi` (the `consoleApi` registrar): `campaigns/send`, `campaigns/manage`, `campaigns/recipients`, `campaigns/process-scheduled`, `lists/materialize`, and the delivery events webhook at `email/events`. It also registers the campaign draft writer on the core's resource-drafts seam and figure readers for campaign and experiment results.

**Exports from `.`**

- `registerMarketingConsole`, `registerMarketingPlugin`, `BUNDLE_ID`.
- Overlays: `HostOverlay`, `resolveActiveOverlays`, `overlayMatchesPath`, `overlayActiveAt`, `popupSuppressed`.
- Experiments: `HostExperiment`, `ExperimentVariant`, `assignExperimentVariant`, `validateExperiment`, `compareVariants`, `evaluateAutoWinner`.
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
