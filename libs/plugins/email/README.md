# @aglyn/plugins-email

The Email plugin for Aglyn: email designs built in Besigner from email-safe blocks, plus the topics, audience lists, sending domains and suppressions that mail rides on. Install it if you are running or building on the Aglyn platform and want designed email.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-email@beta

Peer dependencies:

- `@mui/material`
- `@mui/x-data-grid`
- `firebase`
- `firebase-admin`
- `next`
- `react`

None is optional. `firebase-admin` and `next` are used by the server half (`@aglyn/plugins-email/server`).

## What's in it

This package is a first-party Aglyn plugin. It is loaded through Aglyn's plugin manager: the apps read its entry in the monorepo's `plugins.config.json`, import the module each surface names, and call the registrar declared for that surface. It is not a standalone library; installing it on its own loads nothing.

This plugin owns email designs, the topic catalog, lists, sending identities and domains, and suppressions. It does not own campaigns: sending a campaign, and the message list, report and composer pages, belong to the marketing plugin (`@aglyn/plugins-marketing`). The two meet through zones each hosts for the other, described below.

### In Besigner

`registerEmailPlugin()` registers the email blocks as canvas components: `emailSection`, `emailText`, `emailRichtext`, `emailImage`, `emailButton`, `emailDivider`, `emailSpacer`, `emailProduct` and `emailHtml`. An email is designed like any screen, and the core's email renderer turns the same node tree into inline-styled table HTML and plain text at send time.

### In the console

`registerEmailConsole()` registers:

- An **Emails** nav item and page at `/emails`, with the sections Messages, Templates, Audiences, Topics, Sending and Suppressions as routes. It requires the `data.manage` permission and is code-split.
- The same page at the organization level, `/[orgSlug]/emails` (an `orgNavItems` entry, served by the shell's generic org route to org-wide members). Audiences and topics are the organization's; messages, templates, sending identities and suppression lists are read site by site over a capped batch of sites, and every write that belongs to a site asks which one.
- Two zones this plugin hosts for the plugin that owns campaigns: the whole body of the Messages section (under a site, and on the organization's page with `hostId: null` and the org mount), and the recipients table under a template's report. This package draws neither.
- Five widgets drawn in zones the campaign owner's pages host: `campaignTopicSelect`, `campaignTopicOptions`, `campaignSenderEditor`, `campaignDesignCreate` and `campaignDesignPreview`. Each reports back through a callback; none writes a campaign.

### On the server

`@aglyn/plugins-email/server` imports `firebase-admin` and is kept out of the client entry point.

- `registerEmailApi()` (the `tenantApi` surface) registers the recipient-facing pages behind signed links: `email/unsubscribe`, `email/resubscribe`, `email/preferences` and `email/confirm`.
- `registerEmailConsoleApi()` (the `consoleApi` surface) registers list membership routes (`email/list-rule-preview`, `email/list-members-preview`, `email/list-members-add`), the staged list import routes, the suppression routes, and an email design draft writer on the core's resource-drafts seam.

Routes are served by the host app's API dispatcher under `/api/`.

### Entry points

| import | contents |
| -- | -- |
| `@aglyn/plugins-email` | `BUNDLE_ID`, the email block components and their schemas, `registerEmailConsole`, the site half, and the model (template reports, sending-domain status, and report types re-exported from `@aglyn/shared-ui-email-campaigns`) |
| `@aglyn/plugins-email/site` | `registerEmailPlugin` and `EMAIL_BUNDLE` only, with no console code |
| `@aglyn/plugins-email/server` | `registerEmailApi`, `registerEmailConsoleApi` and the list handlers |
| `@aglyn/plugins-email/*` | any module under `src/lib/`. Console components are deep-imported from `@aglyn/plugins-email/components/...` and are deliberately not re-exported from the root |

## Usage

The registrars are normally called by Aglyn's generated plugin loaders. Called directly:

```ts
// Canvas half
import { registerEmailPlugin } from '@aglyn/plugins-email/site'
registerEmailPlugin()

// Console app
import { registerEmailConsole } from '@aglyn/plugins-email'
registerEmailConsole()

// Server-only API dispatcher
import {
  registerEmailApi,
  registerEmailConsoleApi,
} from '@aglyn/plugins-email/server'
registerEmailApi()
```

## How it fits

A plugin may import the tenant runtime, the renderer, the Besigner logic, the core and the shared packages. It never imports another plugin, and the core never imports a plugin. Email depends on `@aglyn/aglyn`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance` and `@aglyn/shared-*` packages, including `@aglyn/shared-ui-email-campaigns` and `@aglyn/shared-util-email`. Its relationship with the marketing plugin runs entirely through plugin zones and widget slots registered with the core, so neither package imports the other.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/email
