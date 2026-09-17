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
    "AI-assisted features in the console and the site editor: the Aglyn Assist helper, including changes it proposes to a page, component, or layout open in the editor; editor assistance (rewriting element copy, drafting blog bodies, generating a section layout); and AI generation, which creates drafts and proposals for a customer's site from a brief or from what the site already holds, such as copy, layouts, templates, automations, search titles and descriptions, theme changes, product descriptions and tags, draft products, and store categories and discounts; explanations of a site's automations, including why an automation's run failed; AI insights, which answer a customer's questions about its own figures, such as site traffic, sales, bookings, forms, campaigns, A/B tests and datasets, and write a weekly summary of them for members who ask for one; and AI assistance in the CRM, which summarizes a contact, company, deal or lead for a user and suggests a next step, drafts a one-to-one email for the user to review and send, and suggests how the columns of a spreadsheet the user imports match CRM fields",
  publishedOn: '2026-09-17',
  reason:
    "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
  dataReceived:
    "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its screens and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. For product copy, the store's name, the product's name, type, description, tags, options and search listing, the store's category names, and the product's first media-library photo as a copy at most 768 px on its longer edge with its metadata stripped; never another media file, a price, stock, an order or a customer. For products, categories and discounts proposed from a brief, the store's name and its existing category names. For an automation drafted from a brief, which of CRM, webhooks and bookings the plan includes; for an explanation, the automation's outline (trigger, conditions, each step's text with the names of the lists, campaigns, workflows, webhooks and datasets it uses and whether each exists, and a workflow's function names and expressions) and, for a failed run, its time, steps and recorded errors, with email addresses removed and never the triggering event's data. For an insight, the figure reports available and aggregate tables: traffic with top page paths, referrers and campaign tags; form views and submissions; revenue, orders and best-selling product names; bookings by service; campaign subjects with delivery, open and click rates; A/B test and variant conversions; and, for a dataset the member can see, field names and types, record and fill counts, number ranges and totals grouped by a value at least three records share. Email addresses and phone numbers are removed, and no individual record is sent. For CRM assistance, the opened contact, company, deal or lead as the CRM shows it: its name and, by kind, job title, company, lifecycle stage, tags, capture history and counts, domain, industry, headcount, pipeline stages, status, amount, dates, lost reason, parties and lead status, with its notes, newest timeline entries and open tasks and deals. Email addresses and phone numbers in that text are replaced, and no email, phone or postal field, marketing consent, custom field value, team member or record id is sent. An email draft adds the request and the record's merge field names; an import sends the field names and types and each column's header and value kind, never a row. No account identifiers, email addresses or authentication tokens.",
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
