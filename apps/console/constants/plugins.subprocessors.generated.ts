/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The plugins' SUBPROCESSORS (AGL-2984): what each plugin's
 * `subprocessors` entry returned when this file was generated, written
 * down as data. The subprocessor inventory folds it in through core's
 * `foldPluginSubprocessors`, naming every plugin's recipients without
 * importing a plugin.
 * Source of truth: plugins.config.json and the entries it names.
 */

import type { PluginSubprocessorManifestEntry } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'

export const PLUGIN_SUBPROCESSORS: readonly PluginSubprocessorManifestEntry[] = [
  {
    pluginId: 'ai',
    subprocessors: [
      {
        host: "api.anthropic.com",
        entity: "Anthropic, PBC",
        region: "United States",
        purpose: "AI-assisted features in the console and the site editor: the Aglyn Assist helper, including changes it proposes to a page, component, or layout open in the editor; editor assistance (rewriting element copy, drafting blog bodies, generating a section layout); and AI generation, which creates drafts and proposals for a customer's site from a brief, such as copy, layouts, templates, search titles and descriptions, and theme changes",
        publishedOn: "2026-09-15",
        reason: "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
        dataReceived: "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its screens and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. No account identifiers, email addresses or authentication tokens.",
      },
    ],
  },
]
