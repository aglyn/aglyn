# @aglyn/plugins-ai

The AI plugin for Aglyn: the in-console assistant, the Besigner copy assistant, generative building and automation jobs, and the usage metering and access controls around them. It is provider-generic: every feature talks to a provider contract, and vendor specifics live only under `src/lib/providers`. Install it if you run the Aglyn console and want AI features in it; it is a first-party plugin, not a standalone library.

> Beta. Published from the Aglyn monorepo under the `beta` dist-tag; APIs can change between beta releases.

## Install

    npm install @aglyn/plugins-ai@beta

Peer dependencies: `react`, `next`, `@mui/material`, `@mui/x-data-grid`, `firebase`, and `firebase-admin` for the server entries.

## What's in it

**On a published site.** Nothing. The plugin has no site registrar, and the tenant runtime loads no server surface of it, so nothing that serves a published site can reach a provider. What a job builds (a page, a component, a form) is saved as ordinary Aglyn documents.

**Console** (`registerAiConsole`, the `console` and `staff` registrar in `plugins.config.json`). The plugin adds no nav item. Everything is mounted through zones the console shell and other plugins host, so no console page imports it:

- The assistant dock (`assistPanel`) and a provider the shell mounts around every console page for the Besigner copy assistant, with controls in the `besignerToolbar` and `besignerInspector` slots.
- "Describe it" entry points and cards on the site's screens, components, layouts, templates, forms, theme, SEO and automations pages (`hostScreens`, `hostComponents`, `hostLayouts`, `hostTemplates`, `hostForms`, `hostTheme`, `hostSeo`, `seoFields`, `hostAutomations`, `automationEditor`, `automationRun`, `hostFirstRun`, `orgSites`).
- Cards in zones other plugins host: product copy, import and the products hub (`productEditor`, `productImport`, `productsHub`), record insights, email drafts and import column matching (`recordInsights`, `recordEmail`, `importMapping`), and A/B test variants and results (`experimentVariants`, `experimentResult`).
- Usage and access: credit and usage cards on billing (`orgBillingUsage`), per-member cards and columns (`orgMember`, `orgMembersListColumn`, `hostMembers`), and staff cards, columns and one staff page (`staffOrg`, `staffUser`, `staffOrgsListColumn`, `staffOrgUsageColumn`).

**Server** (`registerAiConsoleApi`, the `consoleApi` registrar, exported from `@aglyn/plugins-ai/server`). It registers the first-party providers, every job kind, and the routes under the `ai` and `assist` prefixes with `registerPluginApiRoute`:

- Assistant: `assist/chat`, `assist/feedback`, `assist/edit-applied`, `ai/assist`.
- Jobs: `ai/jobs`, `ai/jobs/batch`, `ai/jobs/:jobId/cancel`, `ai/jobs/:jobId/resume`, `ai/jobs/:jobId/events`, the scheduled jobs beat, `ai/insights/:jobId`, `ai/crm/:jobId`, `ai/seo/apply`, `ai/generate/component`.
- Usage and access: `ai/usage`, `ai/allotments`, `ai/models`, `ai/host-permissions`, `ai/billing/credits`, `ai/billing/overage`.
- Staff: `ai/admin/org`, `ai/admin/orgs-spend`, `ai/admin/user`, `ai/admin/signals`, `ai/admin/overage`.

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
