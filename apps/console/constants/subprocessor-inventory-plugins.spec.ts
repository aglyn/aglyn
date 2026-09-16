/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { PLUGIN_SUBPROCESSORS } from './plugins.subprocessors.generated'
import { derivePublishedRows, EGRESS_HOSTS } from './subprocessor-inventory'

/**
 * A plugin's recipients reach the published list (AGL-2984).
 *
 * The registry writes no plugin's vendor: it folds in the declarations the
 * generated subprocessors manifest carries. This pins what the fold produces
 * for the one plugin that declares a recipient, field for field against the
 * published row, so the row cannot change, or drop out of
 * `derivePublishedRows()`, as a side effect of a plugin, catalog or
 * generator edit.
 */

/** The Anthropic entry as `/legal/subprocessors` publishes it. */
const PUBLISHED_ANTHROPIC_ENTRY = {
  disposition: 'subprocessor',
  entity: 'Anthropic, PBC',
  region: 'United States',
  purpose:
    "AI-assisted features in the console and the site editor: the Aglyn Assist helper, including changes it proposes to a page, component, or layout open in the editor; editor assistance (rewriting element copy, drafting blog bodies, generating a section layout); and AI generation, which creates drafts and proposals for a customer's site from a brief, such as copy, layouts, templates, search titles and descriptions, and theme changes",
  publishedOn: '2026-09-15',
  reason:
    "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
  dataReceived:
    "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its screens and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. No account identifiers, email addresses or authentication tokens.",
}

describe('plugin-declared subprocessors reach the registry (AGL-2984)', () => {
  it("folds the AI plugin's Anthropic entry in, field for field as published", () => {
    expect(EGRESS_HOSTS['api.anthropic.com']).toStrictEqual(PUBLISHED_ANTHROPIC_ENTRY)
  })

  it('keeps the Anthropic, PBC row in the derived list, reaching the host', () => {
    const row = derivePublishedRows().find((entry) => entry.entity === 'Anthropic, PBC')
    expect(row).toEqual({
      entity: 'Anthropic, PBC',
      purpose: PUBLISHED_ANTHROPIC_ENTRY.purpose,
      region: PUBLISHED_ANTHROPIC_ENTRY.region,
      publishedOn: PUBLISHED_ANTHROPIC_ENTRY.publishedOn,
      reaches: ['api.anthropic.com'],
    })
  })

  it('declares every host in the manifest as a subprocessor', () => {
    // The manifest is read, not assumed: the AI plugin's row is in it.
    expect(PLUGIN_SUBPROCESSORS.map((entry) => entry.pluginId)).toContain('ai')
    const hosts = PLUGIN_SUBPROCESSORS.flatMap((entry) =>
      entry.subprocessors.map((declaration) => declaration.host),
    )
    expect(hosts).toContain('api.anthropic.com')
    for (const host of hosts) {
      expect([host, EGRESS_HOSTS[host]?.disposition]).toEqual([host, 'subprocessor'])
    }
  })
})
