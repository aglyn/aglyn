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

/*==========================================
 * A FORM ON A PAGE BROUGHT IN, REBUILT AS THE SITE'S OWN (AGL-4083).
 *
 * A fresh site has no saved form, so an import that placed only a form the
 * site already had left "Send us a message" with nothing under it. A form on
 * a page brought in is rebuilt from its fields, by code and with no model:
 * the same fields, required marks and button, built of MUI's separate form
 * elements as the Forms page builds them, and saved as a form draft of the
 * site, as a form job saves one (`aiFormDraft`, `writeAiDraft`). Its answers
 * land in the site's Inbox, and the consent field every form that asks for an
 * email carries takes the place of the source's own marketing box. A form
 * with a password or a card field never gets here: the reader leaves it out.
 *
 * A site that already has this form places it. A site with no room for
 * another keeps the page's words and is told why. The form's id comes from
 * the job and the form's fields, so a pass run twice writes one form.
 *=========================================*/

import { createHash } from 'node:crypto'
import { FORM_COMPONENT_ID, FORM_DISPLAY_NAME_MAX_LENGTH, FORM_INPUT_ELEMENT_IDS, isMarketingConsentFieldName } from '@aglyn/aglyn/app-utils/forms'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { NodeType, type NodesMap } from '@aglyn/aglyn/types/nodes'
import type { AiJob, AiJobItemLedger, AiJobOutput } from '../model/ai-jobs.types'
import type { AiSiteImportPage, AiSiteImportState, SiteImportLayout, SiteImportLayoutNode } from '../model/ai-site-import'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import { readSiteInventory } from '../runtime/site-inventory'
import type { SiteImportBlock, SiteImportForm, SiteImportFormField } from '../site-import/site-import-html'
import { aiFormDraft, aiFormDraftViolations } from './ai-job-form-step'
import { writeAiDraft } from './ai-job-drafts'

/** What a rebuilt form is called where no heading stands above it. */
export const AI_SITE_IMPORT_FORM_DEFAULT_NAME = 'Contact form'

/** The node a rebuilt form hangs from. */
const FORM_NODE_ID = 'importedForm'

/** Customer-safe sentences, on the page's row. */
export const AI_SITE_IMPORT_FORM_COPY = {
  rebuilt: (name: string) => `Your form “${name}” is rebuilt on this page, and what visitors send lands in your Inbox.`,
  noRoom: 'Your plan has no room for another form, so this page’s form is left out. Every word of the page is here.',
  notBuilt: 'This page’s form could not be rebuilt, so it is left out. Every word of the page is here.',
  leftOut: (fields: readonly string[]) => `A form can’t take a file here, so “${fields.join('”, “')}” is left out of it.`,
} as const

const clean = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()

/** A field's words in camelCase, for a name a form can submit under. */
function camelCase(words: string): string {
  const parts = words.match(/[A-Za-z0-9]+/g) ?? []
  return parts.map((part, at) => (at === 0 ? part.toLowerCase() : `${part[0]?.toUpperCase()}${part.slice(1).toLowerCase()}`)).join('')
}

/** The name a field submits under: the source's where it reads as one, else its words'. Never a second of one name. */
function fieldNameOf(field: SiteImportFormField, at: number, taken: Set<string>): string {
  const own = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(field.name) ? field.name : ''
  const base = own || camelCase(field.label ?? '') || `field${at + 1}`
  let name = base
  for (let next = 2; taken.has(name.toLowerCase()); next += 1) name = `${base}${next}`
  taken.add(name.toLowerCase())
  return name
}

/**
 * A form of a page brought in as a tree of the Form element and MUI's separate
 * form elements: each field a Form Control holding its Form Label and its
 * answer, a lone tick a Choice Label holding one Checkbox, as the Forms page
 * builds them. The tree `aiFormDraft` stamps, binds and declares.
 */
export function aiSiteImportFormTree(form: SiteImportForm): { rootId: string; nodes: NodesMap } {
  const { formControl, formLabel, input, select, selectOption, radioGroup, radio, checkbox, choiceLabel, datePicker, timePicker } = FORM_INPUT_ELEMENT_IDS
  const nodes: NodesMap = {}
  const add = (id: string, componentId: string, parentId: string, props: Record<string, unknown>, children: readonly string[] = []) => {
    nodes[id] = { $id: id, type: NodeType.NODE, componentId, pluginId: AI_PALETTE[componentId]?.pluginId, parentId, nodes: [...children], props } as NodesMap[string]
    return id
  }
  const taken = new Set<string>()
  const children = form.fields.map((field, at) => {
    const id = `field${at}`
    const name = fieldNameOf(field, at, taken)
    const label = clean(field.label) || name
    const required = field.required ? { required: true } : {}
    const placeholder = field.placeholder ? { placeholder: field.placeholder } : {}
    const options = (field.options ?? []).map(clean).filter(Boolean)
    const choice = (index: number, words: string, element: string, props: Record<string, unknown>, parent: string) => {
      const box = add(`${id}-opt-${index}-input`, element, `${id}-opt-${index}`, props)
      return add(`${id}-opt-${index}`, choiceLabel, parent, { label: words }, [box])
    }
    // A lone tick is its own question: the words beside it say it all.
    if (field.type === 'checkbox' && options.length <= 1) return choice(0, options[0] ?? label, checkbox, { name, value: options[0] ?? label, ...required }, FORM_NODE_ID)
    const wrapper = (answers: readonly string[]) => add(id, formControl, FORM_NODE_ID, { fullWidth: true, ...required }, [add(`${id}-label`, formLabel, id, { children: label }), ...answers])
    if (field.type === 'checkbox') return wrapper(options.map((option, index) => choice(index, option, checkbox, { name, value: option }, id)))
    if (field.type === 'radio' && options.length) {
      const group = add(`${id}-input`, radioGroup, id, { name }, options.map((option, index) => choice(index, option, radio, { value: option, ...required }, `${id}-input`)))
      return wrapper([group])
    }
    if (field.type === 'select' && options.length) {
      const list = add(`${id}-input`, select, id, { name, fullWidth: true, ...required, ...placeholder }, options.map((option, index) => add(`${id}-opt-${index}`, selectOption, `${id}-input`, { children: option })))
      return wrapper([list])
    }
    if (field.type === 'date' || field.type === 'time') return wrapper([add(`${id}-input`, field.type === 'date' ? datePicker : timePicker, id, { name, ...required })])
    const type = ['email', 'tel', 'url', 'number'].includes(field.type) ? field.type : 'text'
    return wrapper([add(`${id}-input`, input, id, { name, type, ...(field.type === 'textarea' ? { multiline: true, minRows: 3 } : {}), ...placeholder, ...required, fullWidth: true })])
  })
  const submit = clean(form.submit)
  nodes[FORM_NODE_ID] = { $id: FORM_NODE_ID, type: NodeType.NODE, componentId: FORM_COMPONENT_ID, pluginId: AI_PALETTE[FORM_COMPONENT_ID]?.pluginId, nodes: children, props: submit ? { submitLabel: submit } : {} } as NodesMap[string]
  return { rootId: FORM_NODE_ID, nodes }
}

/** What identifies a form across a site's pages: what it asks and its button, never where it sits. */
export function aiSiteImportFormSignature(form: SiteImportForm): string {
  const shape = form.fields.map((field) => [field.type, field.name, clean(field.label), field.required === true, field.options ?? []])
  return createHash('sha256').update(JSON.stringify([shape, clean(form.submit)])).digest('hex').slice(0, 12)
}

/** Each form of a page's layout, with the nearest heading above it in its section: what it is called. */
export function aiSiteImportFormPlaces(layout: SiteImportLayout, blocks: readonly SiteImportBlock[]): Array<{ form: number; heading: string | null }> {
  const places: Array<{ form: number; heading: string | null }> = []
  let heading: string | null = null
  const note = (ref: number) => {
    const block = blocks[ref]
    if (block?.kind === 'heading') heading = clean(block.text) || heading
  }
  const visit = (nodes: readonly SiteImportLayoutNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'line') note(node.line)
      else if (node.kind === 'form') places.push({ form: node.form, heading })
      else if (node.kind === 'row') for (const cell of node.cells) visit(cell.nodes)
      else if (node.kind === 'group') for (const item of node.items) item.lines.forEach(note)
      else if (node.kind === 'tabs') for (const tab of node.tabs) visit(tab.panel)
    }
  }
  for (const section of layout.sections) {
    heading = null
    visit(section.nodes)
  }
  return places
}

/** The forms of a page still to rebuild or place: each one of its layout that asks something. */
export function aiSiteImportFormsOwed(page: Pick<AiSiteImportPage, 'read'>): Array<{ form: number; heading: string | null }> {
  const { read } = page
  if (!read?.layout || !read.forms?.length) return []
  return aiSiteImportFormPlaces(read.layout, read.blocks ?? []).filter((place) => (read.forms?.[place.form]?.fields.length ?? 0) > 0)
}

const askedNames = (names: readonly string[]) => names.filter((name) => !isMarketingConsentFieldName(name)).map((name) => name.toLowerCase()).sort()

const sameFields = (a: readonly string[], b: readonly string[]) => {
  const [one, two] = [askedNames(a), askedNames(b)]
  return one.length === two.length && one.every((name, at) => name === two[at])
}

export interface AiSiteImportFormsDeps {
  readInventory?: typeof readSiteInventory
  writeDraft?: typeof writeAiDraft
}

export interface AiSiteImportFormsRebuilt {
  /** Each form of the page by its index on the read, and the saved form that takes its place; `null` where none does. */
  forms: Array<{ index: number; formId: string | null }>
  /** A ledger row for each form written, at no credits. */
  rows: AiJobItemLedger[]
  outputs: AiJobOutput[]
  /** What the page's row says of its forms. */
  note: string | null
}

/**
 * A page's forms as the site's own: one the site already has is placed, and
 * any other is saved as a form of the site (AGL-4083). Pure of any model, so
 * it spends nothing; a site with no room keeps the page's words and is told.
 */
export async function aiRebuildImportedForms(
  firestore: FirebaseFirestore.Firestore,
  input: { job: Pick<AiJob, '$id' | 'orgId' | 'createdBy'>; hostId: string; state: AiSiteImportState; page: AiSiteImportPage; org: Partial<AglynOrgBilling> | null; now: Date },
  deps: AiSiteImportFormsDeps = {},
): Promise<AiSiteImportFormsRebuilt> {
  const { job, hostId, state, page, org, now } = input
  const write = deps.writeDraft ?? writeAiDraft
  const inventory = await (deps.readInventory ?? readSiteInventory)(job.orgId, hostId, { firestore })
  const saved = (inventory?.forms ?? []).map((form) => ({ id: form.id, fields: form.fields ?? [] }))
  let met = state.pages.some((entry) => entry.forms?.length)
  const out: AiSiteImportFormsRebuilt = { forms: [], rows: [], outputs: [], note: null }
  const notes: string[] = []
  for (const place of aiSiteImportFormsOwed(page)) {
    const form = page.read?.forms?.[place.form] as SiteImportForm
    const signature = aiSiteImportFormSignature(form)
    const formId = `${job.$id}-form-${signature}`
    const name = (place.heading ?? '').slice(0, FORM_DISPLAY_NAME_MAX_LENGTH) || AI_SITE_IMPORT_FORM_DEFAULT_NAME
    const draft = aiFormDraft(aiSiteImportFormTree(form), { routing: { kind: 'inbox', list: null }, cannotCollect: [] }, { formId, name })
    const names = draft.fields.map((field) => field.fieldName)
    // A site's only form takes the first form an import meets, as it always has.
    const existing = saved.find((entry) => entry.id === formId || sameFields(entry.fields, names)) ?? (!met && saved.length === 1 ? saved[0] : undefined)
    met = true
    if (existing) {
      out.forms.push({ index: place.form, formId: existing.id })
      continue
    }
    if (aiFormDraftViolations(draft, formId, {}).length) {
      out.forms.push({ index: place.form, formId: null })
      notes.push(AI_SITE_IMPORT_FORM_COPY.notBuilt)
      continue
    }
    const written = await write(firestore, {
      kind: 'form',
      hostId,
      id: formId,
      uid: job.createdBy,
      org,
      name,
      nodes: draft.nodes,
      form: { rootId: draft.rootId, formNodeId: draft.formNodeId, fields: draft.fields, consentFieldName: draft.consentFieldName, routing: draft.routing },
      now,
    })
    if (written.ok === false) {
      if (written.status === 404) throw new Error(`site ${hostId} vanished while its form was rebuilt`)
      out.forms.push({ index: place.form, formId: null })
      notes.push(AI_SITE_IMPORT_FORM_COPY.noRoom)
      continue
    }
    saved.push({ id: formId, fields: names })
    out.forms.push({ index: place.form, formId })
    notes.push(AI_SITE_IMPORT_FORM_COPY.rebuilt(written.name))
    if (form.leftOut?.length) notes.push(AI_SITE_IMPORT_FORM_COPY.leftOut(form.leftOut))
    out.rows.push({ slot: `form-${signature}`, op: 'form', label: written.name, status: 'succeeded', attempt: 1, creditsSpent: 0, creditsRefunded: 0, outputs: [formId] })
    out.outputs.push({ resource: 'form', id: formId, versionId: written.versionId, hostId, hostSubdomain: written.hostSubdomain, label: written.name })
  }
  out.note = [...new Set(notes)].join(' ') || null
  return out
}
