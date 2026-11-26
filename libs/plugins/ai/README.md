# @aglyn/plugins-ai

The AI plugin for Aglyn: the in-console assistant, the Besigner copy assistant, generative building and automation jobs, and the usage metering and access controls around them. It is provider-generic: every feature talks to a provider contract, and vendor specifics live only under `src/lib/providers`. Install it if you run the Aglyn console and want AI features in it; it is a first-party plugin, not a standalone library.

> Published to npm from the Aglyn monorepo. Versions follow [semantic versioning](https://semver.org).

## Install

    npm install @aglyn/plugins-ai

Peer dependencies: `react`, `next`, `@mui/material`, `@mui/x-data-grid`, `firebase`, and `firebase-admin` for the server entries.

## What's in it

**On a published site.** The AI chat (AGL-4250), and nothing else: `registerAiSite` (`@aglyn/plugins-ai/site`, the `site` registrar) draws the chat's launcher, and `registerAiSiteApi` (`@aglyn/plugins-ai/site-server`, the `tenantApi` registrar) registers the page enricher that gives a page its chat slice and the visitor's doors `ai/site-chat` (an answer streamed as Server-Sent Events, the console Assist wire shape), `ai/site-chat/history` and `ai/site-chat/handoff`. A published site loads no other AI door. The chat is off until the release flag `release_ai_site_chat` is on for the workspace, the plan is Starter or above, AI is on for the site and its owner turns the chat on. Visitor turns spend the workspace's AI credits under a site-chat allotment with its own hard cap, and fail closed. Facts other plugins hold (a store's products and stays, open booking times, upcoming events) reach it through the core seam `core.site-chat-tools`; the model only PROPOSES an add-to-cart, reservation or booking, which the visitor's own press sends from their browser. What a job builds (a page, a component, a form) is saved as ordinary Aglyn documents.

**Console** (`registerAiConsole`, the `console` and `staff` registrar in `plugins.config.json`). The plugin adds no nav item. Everything is mounted through zones the console shell and other plugins host, so no console page imports it:

- The assistant, drawn in the console dock (`consoleDock`) and a provider the shell mounts around every console page for the Besigner copy assistant, with controls in the `besignerToolbar` and `besignerInspector` slots.
- The AI jobs indicator in the console's top bar (`consoleTopBar`): what the workspace's jobs are doing, and the way to them.
- "Create with AI" entry points and cards on a site's pages list and its components, layouts, templates, forms, email templates, products, theme, SEO, automations and Functions & Variables pages (`hostScreens`, `hostComponents`, `hostLayouts`, `hostTemplates`, `hostForms`, `hostEmailTemplates`, `productsCreate`, `hostTheme`, `hostSeo`, `seoFields`, `hostAutomations`, `automationEditor`, `automationRun`, `hostLogic`, `logicFunctionEditor`, `logicReferenceIssue`, `hostFirstRun`, `orgSites`).
- Cards in zones other plugins host: product copy, import and the products hub (`productEditor`, `productImport`, `productsHub`), record insights, email drafts and import column matching (`recordInsights`, `recordEmail`, `importMapping`), A/B test variants and results (`experimentVariants`, `experimentResult`), overlay copy and new overlays on the Marketing page (`overlayEditor`, `hostOverlays`), a campaign from a brief on its Campaigns section (`hostCampaigns`), the figures in words on its Conversions section and campaign reports (`marketingInsights`), and a funnel drafted from a description and its results explained (`funnelsCreate`, `funnelInsight`).
- Usage and access: credit and usage cards on billing (`orgBillingUsage`), per-member cards and columns (`orgMember`, `orgMembersListColumn`, `hostMembers`), and staff cards, columns and one staff page (`staffOrg`, `staffUser`, `staffOrgsListColumn`, `staffOrgUsageColumn`).

**Server** (`registerAiConsoleApi`, the `consoleApi` registrar, exported from `@aglyn/plugins-ai/server`). It registers the first-party providers, every job kind, and the routes under the `ai` and `assist` prefixes with `registerPluginApiRoute`:

- Assistant: `assist/chat`, `assist/feedback`, `assist/edit-applied`, `ai/assist`.
- The site chat's owner doors: `ai/site-chat/settings` and `ai/site-chat/conversations`.
- Jobs: `ai/jobs`, `ai/jobs/batch`, `ai/jobs/:jobId/cancel`, `ai/jobs/:jobId/resume`, `ai/jobs/:jobId/events`, the scheduled jobs beat, `ai/insights/:jobId`, `ai/crm/:jobId`, `ai/seo/apply`, `ai/experiments/versions`, `ai/generate/component`.
- Usage and access: `ai/usage`, `ai/allotments`, `ai/models`, `ai/host-permissions`, `ai/billing/credits`, `ai/billing/overage`.
- Staff: `ai/admin/org`, `ai/admin/orgs-spend`, `ai/admin/user`, `ai/admin/signals`, `ai/admin/overage`, `ai/admin/credits`.

**Declarations.** Three light entries the core reads before any surface loads:

- `registerAiDeclarations` (`@aglyn/plugins-ai/declarations`, also exported from `.`): the plugin's entitlements, its config schema and its activity codes. Idempotent.
- `registerAiServerDeclarations` (`@aglyn/plugins-ai/declarations.server`): platform event subscriptions, the account-erasure sweep for a person's AI usage, and the usage alert contributor.
- `aiSubprocessors` (`@aglyn/plugins-ai/subprocessors`): the third-party hosts the registered providers send data to, for the subprocessor inventory.

**Source layout under `src/lib`**

- `providers/`: the provider contract (`AiProvider`), the registry (`AI_PROVIDER_CONTRACT`, `registerAiProvider`), the model catalog, the routing table, and two adapters, `anthropic.ts` and `openai-compatible.ts`.
- `runtime/`: the one runtime every route calls (`runAiRequest`), the gate, the answer cache, the palette and the node-tree validator.
- `jobs/`: the generation job machine, its steps and the beat.
- `tools/`: the tool definitions the job steps hand a provider.
- `usage/` and `billing/`: the meter every route reserves and records through, per-member allotments, and overage.
- `insights/`, `activity/`, `model/`: figure readers and the digest, activity codes, and the job and usage shapes the cards and routes share, free of any server dependency.
- `components/`: the dock, the cards and the staff page.

## Usage

The plugin is loaded through Aglyn's plugin manager: the console's generated loader manifests import the package and call the registrars named in `plugins.config.json`. An app that wires plugins by hand calls them once at startup:

```ts
// console, client side
import { registerAiConsole } from '@aglyn/plugins-ai'
registerAiConsole()

// console, server side
import { registerAiConsoleApi } from '@aglyn/plugins-ai/server'
registerAiConsoleApi()
```

Adding a provider. Another plugin registers its own adapter against the same contract from its server entry; the first-party adapters register themselves only when no provider is registered yet, so one registered earlier is not displaced:

```ts
import { registerAiProvider, type AiProvider } from '@aglyn/plugins-ai/server'

declare const myProvider: AiProvider
registerAiProvider(myProvider, { pluginId: 'my-plugin' })
```

An `AiProvider` names the environment variable that carries its key (`apiKeyEnv`), reads it itself (`readApiKey`), lists its models, and implements `complete` and `stream`. The platform default provider is the one named by the `AI_PROVIDER` environment variable when it is registered, otherwise the first registered; `AI_DEFAULT_MODEL` overrides the model for every step kind.

## How it fits

A plugin package (`scope:plugin`). It depends on the core (`@aglyn/aglyn`), the tenant packages (`@aglyn/tenant-runtime`, `@aglyn/tenant-data-admin`, `@aglyn/tenant-feature-instance`) and generic `@aglyn/shared-*` packages. It imports no other plugin. Where a job writes another plugin's resource, such as a campaign, an email design or an automation, that plugin registers a draft writer on a core seam and this one calls the seam; where a job reads another plugin's figures or records, that plugin registers a reader. The core never imports this package, and only `src/lib/server.*` is declared as having side effects.

## License

Apache-2.0. Source: https://github.com/aglyn/aglyn/tree/main/libs/plugins/ai
