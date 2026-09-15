/**
 * @jest-environment node
 */
/**
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

/**
 * The plugin's subprocessor declarations (AGL-2984): the rows the
 * subprocessor inventory publishes for this plugin, derived from the
 * provider catalog and the registered adapters. The Anthropic row is pinned
 * field for field to the published entry, so changing its wording is an
 * edit made here on purpose rather than a side effect of editing the
 * catalog.
 */

import { anthropicProvider } from './providers/anthropic'
import { AI_CATALOG_PROVIDERS } from './providers/catalog'
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  OPENAI_COMPAT_BASE_URL_ENV,
} from './providers/openai-compatible'
import { listAiProviders } from './providers/registry'
import { aiSubprocessors } from './subprocessors'

/** The Anthropic row as `/legal/subprocessors` carries it. */
const PUBLISHED_ANTHROPIC_ROW = {
  host: 'api.anthropic.com',
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

afterEach(() => {
  delete process.env[OPENAI_COMPAT_BASE_URL_ENV]
})

describe('the AI plugin declares its subprocessors (AGL-2984)', () => {
  it('derives exactly the Anthropic row the inventory publishes, field for field', () => {
    expect(aiSubprocessors()).toStrictEqual([PUBLISHED_ANTHROPIC_ROW])
  })

  it("takes the host and the credential's name from the registered adapter", () => {
    const [row] = aiSubprocessors()
    expect(row?.host).toBe(anthropicProvider.endpointHost)
    expect(row?.reason).toContain(`\`${anthropicProvider.apiKeyEnv}\``)
    // The catalog ships in the browser bundle, so its wording carries a
    // placeholder where the credential's name goes, and every placeholder is
    // filled by the time a row is derived.
    expect(JSON.stringify(AI_CATALOG_PROVIDERS)).not.toContain(anthropicProvider.apiKeyEnv)
    expect(JSON.stringify(aiSubprocessors())).not.toMatch(/\{[A-Za-z]+\}/)
  })

  it('takes nothing from the OpenAI-compatible provider, even with its endpoint configured', () => {
    process.env[OPENAI_COMPAT_BASE_URL_ENV] = 'https://gateway.example/v1'
    // The provider is registered and reports the configured host, so the
    // empty contribution below is the catalog's answer and not an absence.
    const provider = listAiProviders().find((entry) => entry.id === OPENAI_COMPATIBLE_PROVIDER_ID)
    expect(provider?.endpointHost).toBe('gateway.example')
    expect(aiSubprocessors().map((row) => row.host)).toEqual([anthropicProvider.endpointHost])
  })
})
