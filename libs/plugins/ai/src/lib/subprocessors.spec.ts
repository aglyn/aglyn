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
import {
  AI_CATALOG_PROVIDERS,
  ANTHROPIC_CRM_ASSISTANCE_DISCLOSED,
  ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD,
  anthropicDataReceived,
} from './providers/catalog'
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  OPENAI_COMPAT_BASE_URL_ENV,
} from './providers/openai-compatible'
import { listAiProviders } from './providers/registry'
import { VERTEX_IMAGE_LOCATION_ENV, vertexImageHost } from './providers/vertex-image-endpoint'
import { aiSubprocessors } from './subprocessors'

/** The Anthropic row as `/legal/subprocessors` carries it. */
const PUBLISHED_ANTHROPIC_ROW = {
  host: 'api.anthropic.com',
  entity: 'Anthropic, PBC',
  region: 'United States',
  purpose:
    "AI features of the Services, including the Aglyn Assist helper: creating, editing and reviewing content, drafts and settings for a customer’s site, store and CRM, and explaining and summarizing the customer’s own setup and data",
  publishedOn: '2026-10-07',
  reason:
    "Reached through the AI plugin's Anthropic adapter (`libs/plugins/ai/src/lib/providers/anthropic.ts`) by the doors that call the AI runtime. `libs/plugins/ai/src/lib/server/assist-chat.ts` is gated by `release_assist` AND the key, and a generation job's text step by `release_ai_generative`; `libs/plugins/ai/src/lib/server/ai-assist.ts` carries NO release flag, so setting `ANTHROPIC_API_KEY` in production is by itself what starts this flow. `assist-anthropic-subprocessor-gate.spec.ts` holds the per-door detail and is the deeper guard for this one vendor.",
  dataReceived:
    "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its pages and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. For product copy, the store's name, the product's name, type, description, tags, options and search listing, the store's category names, and the product's first media-library photo as a copy at most 768 px on its longer edge with its metadata stripped; never another media file, a price, stock, an order or a customer. For products, categories and discounts proposed from a brief, the store's name and its existing category names. For an automation drafted from a brief, which of CRM, webhooks and bookings the plan includes; for an explanation, the automation's outline (trigger, conditions, each step's text with the names of the lists, campaigns, workflows, webhooks and datasets it uses and whether each exists, and a workflow's function names and expressions) and, for a failed run, its time, steps and recorded errors, with email addresses removed and never the triggering event's data. For an insight, the figure reports available and aggregate tables: traffic with top page paths, referrers and campaign tags; form views and submissions; revenue, orders and best-selling product names; bookings by service; campaign subjects with delivery, open and click rates; A/B test and variant conversions; and, for a dataset the member can see, field names and types, record and fill counts, number ranges and totals grouped by a value at least three records share. Email addresses and phone numbers are removed, and no individual record is sent. For CRM assistance, the opened record as the CRM shows it, with all of its standard and custom fields, including contact details, notes, timeline and related records. An email draft adds the request and the record's merge field names; an import sends the field names and types and each column's header and value kind, never a row. No account identifiers or authentication tokens, and no email address outside an opened CRM record.",
}

/** The hosts the Google Vertex AI row reaches: global, then the US and EU multi-regions. */
const VERTEX_HOSTS = [
  'aiplatform.googleapis.com',
  'aiplatform.us.rep.googleapis.com',
  'aiplatform.eu.rep.googleapis.com',
]

/** The Google Vertex AI row as `/legal/subprocessors` carries it (AGL-3602, legal v12). */
const PUBLISHED_GOOGLE_VERTEX_ROW = {
  entity: 'Google LLC (Google Cloud Vertex AI)',
  region: 'Global — Google selects where requests are processed',
  purpose:
    "AI image generation: creating images for a customer's media library from a description a user writes",
  publishedOn: '2026-10-07',
  reason:
    "Reached through the AI plugin's Vertex AI image adapter (`libs/plugins/ai/src/lib/providers/vertex-image.ts`) by the Media library's Create with AI door (`libs/plugins/ai/src/lib/server/ai-media-image.ts`) for every kind that is not drawn as SVG, as the platform's own service account. Off unless `AI_IMAGE_VERTEX_PROJECT` names a Google Cloud project; the console offers those kinds only where `NEXT_PUBLIC_AI_IMAGE_PHOTOS` is `on`. The request carries the description and the kind's fixed style wording, the shape and fixed settings, and nothing else.",
  dataReceived:
    "The description the user writes and the shape requested, and the generated image returned. No account identifiers, email addresses, or other content of the customer's site.",
}

/**
 * The data cell the Anthropic row carried until it was republished on
 * October 5, 2026 (AGL-3520, legal v10): the published one with the
 * disclosed CRM sentence and the old closing sentence. Production still
 * sends exactly this while `release_crm_assist_whole_record` is off, so the
 * wording stays in the catalog and is pinned here as reviewed text.
 */
const SUPERSEDED_ANTHROPIC_DATA_RECEIVED =
  "What the user submits — a question, instruction or brief, with the earlier messages of the same Assist conversation — and the content of the element, post, section or page being worked on, with the generated response. On Pro and above, the organization's name and the console route and host travel with an Assist question. For an edit the assistant proposes in the besigner, an outline of the open page, component or layout: element and component ids, layer names, shortened setting values and the selected element's styles. For a generation job, the site inventory: the names and addresses of its pages and collections, the names of its components, layouts, templates, forms and datasets with their prop and field names, and the theme's summary, colors and fonts. For a theme change, the site's current theme settings and brand colors as hex values, from the organization's brand settings, the site logo in the media library or a public page the brief links to. For features that review or write search information, the text and structure of the pages concerned. For product copy, the store's name, the product's name, type, description, tags, options and search listing, the store's category names, and the product's first media-library photo as a copy at most 768 px on its longer edge with its metadata stripped; never another media file, a price, stock, an order or a customer. For products, categories and discounts proposed from a brief, the store's name and its existing category names. For an automation drafted from a brief, which of CRM, webhooks and bookings the plan includes; for an explanation, the automation's outline (trigger, conditions, each step's text with the names of the lists, campaigns, workflows, webhooks and datasets it uses and whether each exists, and a workflow's function names and expressions) and, for a failed run, its time, steps and recorded errors, with email addresses removed and never the triggering event's data. For an insight, the figure reports available and aggregate tables: traffic with top page paths, referrers and campaign tags; form views and submissions; revenue, orders and best-selling product names; bookings by service; campaign subjects with delivery, open and click rates; A/B test and variant conversions; and, for a dataset the member can see, field names and types, record and fill counts, number ranges and totals grouped by a value at least three records share. Email addresses and phone numbers are removed, and no individual record is sent. For CRM assistance, the opened contact, company, deal or lead as the CRM shows it: its name and, by kind, job title, company, lifecycle stage, tags, capture history and counts, domain, industry, headcount, pipeline stages, status, amount, dates, lost reason, parties and lead status, with its notes, newest timeline entries and open tasks and deals. Email addresses and phone numbers in that text are replaced, and no email, phone or postal field, marketing consent, custom field value, team member or record id is sent. An email draft adds the request and the record's merge field names; an import sends the field names and types and each column's header and value kind, never a row. No account identifiers, email addresses or authentication tokens."

afterEach(() => {
  delete process.env[OPENAI_COMPAT_BASE_URL_ENV]
})

describe('the AI plugin declares its subprocessors (AGL-2984)', () => {
  it('derives exactly the rows the inventory publishes, field for field', () => {
    expect(aiSubprocessors()).toStrictEqual([
      PUBLISHED_ANTHROPIC_ROW,
      ...VERTEX_HOSTS.map((host) => ({ ...PUBLISHED_GOOGLE_VERTEX_ROW, host })),
    ])
  })

  it("names the image adapter's global and multi-region endpoints, never a single region", () => {
    process.env[VERTEX_IMAGE_LOCATION_ENV] = 'us-central1'
    try {
      expect(VERTEX_HOSTS).toEqual([vertexImageHost('global'), vertexImageHost('us'), vertexImageHost('eu')])
      expect(aiSubprocessors().map((row) => row.host)).not.toContain(vertexImageHost())
    } finally {
      delete process.env[VERTEX_IMAGE_LOCATION_ENV]
    }
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
    expect(aiSubprocessors().map((row) => row.host)).toEqual([
      anthropicProvider.endpointHost,
      ...VERTEX_HOSTS,
    ])
  })
})

describe('CRM assistance is worded as the whole record (AGL-3520)', () => {
  it('publishes the whole-record wording, republished on October 5, 2026', () => {
    const [row] = aiSubprocessors()
    expect(row?.dataReceived).toBe(anthropicDataReceived(ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD))
    expect(row?.dataReceived).toContain(ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD.record)
    expect(row?.dataReceived).not.toContain('no email, phone or postal field, marketing consent, custom field value, team member or record id is sent')
  })

  it('keeps the flag-off wording it replaced, differing only in its CRM sentences', () => {
    const superseded = anthropicDataReceived(ANTHROPIC_CRM_ASSISTANCE_DISCLOSED)
    expect(superseded).toBe(SUPERSEDED_ANTHROPIC_DATA_RECEIVED)
    const published = PUBLISHED_ANTHROPIC_ROW.dataReceived
    const withoutCrm = (text: string, crm: { record: string; never: string }) =>
      text.replace(crm.record, '<record>').replace(crm.never, '<never>')
    expect(withoutCrm(published, ANTHROPIC_CRM_ASSISTANCE_WHOLE_RECORD)).toBe(
      withoutCrm(superseded, ANTHROPIC_CRM_ASSISTANCE_DISCLOSED),
    )
  })
})
