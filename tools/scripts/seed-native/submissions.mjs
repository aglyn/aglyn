/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A site's forms for the Aglyn app's Forms screens (AGL-3622): four in use
 * and one retired, each with what it collected.
 *
 * Shapes are what `/api/hosts/resources` writes to `hosts/{hostId}/forms/{id}`
 * for a form: the allowed fields (`displayName`, `slug`, the declared
 * `fields`, `routing`), `newFormListFields` (`nameLower`, `nameTokens`,
 * `nameReversed`, `searchTokens`, `retired`, `inCampaign`, `stats`) and the
 * create stamps. `stats` holds the counters the submit route increments; the
 * submission counts agree with the rows `seed/inbox.mjs` writes for the same
 * form ids. A site member reads them under the host catch-all.
 *
 * Production-shaped (AGL-4002): every production form carries its design as
 * `nodes` (msgpack bytes, the console's new-form tree) with `rootId`, and the
 * opened ones a `versionId` whose version lives at
 * `hosts/{hostId}/forms/{id}/versions/{versionId}` with the same bytes. One
 * form in use (`newsletter`) has never been opened, so the app's Design in the
 * Besigner mints its first version from the form's own design. Only the
 * emulator seed (it passes `project`) writes them: the review org's recording
 * (`lib/review-org-seed.mjs`) lands in a live org and re-points ids, which
 * it cannot do inside opaque bytes, so its forms stay as they were.
 */
import { encode as msgpack } from '@msgpack/msgpack'
import {
  LEGACY_FORM_FIELD_COMPONENT_ID,
  formFieldToElements,
} from '../../../libs/plugins/forms/src/lib/model/form-field-elements.ts'

/** The canvas root id (`CANVAS_ROOT_ELEMENT_ID`). */
const CANVAS_ROOT = '_@_'

/**
 * A form's stored design: the console's New form tree (`host-forms-card.component.tsx`) with each question as MUI's
 * separate form elements under the form element, built by the forms plugin's own `formFieldToElements` — the rule
 * the presets and the formField backfill follow — so the Besigner draws the questions, not a bare Send button.
 * Stored as msgpack bytes, as production stores it.
 */
const formNodes = (formId, formName, fields = []) => {
  const nodes = {
    [CANVAS_ROOT]: { $id: CANVAS_ROOT, componentId: 'div', nodes: ['formRoot'] },
    formRoot: {
      $id: 'formRoot',
      componentId: 'form',
      pluginId: 'forms',
      parentId: CANVAS_ROOT,
      props: { formId, formName },
      nodes: [],
    },
  }
  for (const f of fields) {
    const legacy = {
      $id: `field-${f.fieldName}`,
      componentId: LEGACY_FORM_FIELD_COMPONENT_ID,
      parentId: 'formRoot',
      props: {
        fieldName: f.fieldName,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required === true,
        ...(f.options ? { options: f.options } : {}),
      },
    }
    const built = formFieldToElements(legacy, nodes)
    if (!built) continue
    Object.assign(nodes, built.nodes)
    nodes[built.rootId] = { ...nodes[built.rootId], parentId: 'formRoot' }
    nodes.formRoot.nodes.push(built.rootId)
  }
  return msgpack(nodes)
}

const key = (text) => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** `nameSearchTokens` from `libs/aglyn/src/lib/app-utils/name-search.ts`: word prefixes, 12 deep. */
function nameSearchTokens(text) {
  const tokens = new Set()
  for (const word of key(text).split(' ')) {
    if (!word) continue
    const capped = word.slice(0, 12)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= 120) return [...tokens]
    }
  }
  return [...tokens]
}

/** `formListFields` from `libs/aglyn/src/lib/app-utils/forms.ts`. */
function formListFields({ id, displayName, slug }) {
  return {
    nameLower: key(displayName),
    nameTokens: nameSearchTokens(displayName),
    nameReversed: [...key(displayName)].reverse().join(''),
    searchTokens: [
      ...new Set([
        ...nameSearchTokens(displayName),
        ...nameSearchTokens(String(slug ?? '').replace(/-+/g, ' ')),
        ...nameSearchTokens(id),
      ]),
    ],
  }
}

const field = (fieldName, label, fieldType, extra = {}) => ({ fieldName, label, fieldType, ...extra })

export async function seedForms({ put, uid, hostId, now, project }) {
  const storedDesigns = Boolean(project)
  const nowMs = now.getTime()
  const day = 24 * 60 * 60 * 1000
  const forms = [
    {
      id: 'contact',
      displayName: 'Contact us',
      fields: [
        field('name', 'Your name', 'text', { required: true, role: 'name' }),
        field('email', 'Email', 'email', { required: true, role: 'email' }),
        field('phone', 'Phone', 'text', { role: 'phone' }),
        field('message', 'How can we help?', 'textarea', { required: true }),
      ],
      lead: true,
      stats: { submissions: 4, leads: 3, views: 412, lastSubmissionAtMs: nowMs - 25 * 60 * 1000 },
      createdDaysAgo: 120,
    },
    {
      id: 'quote-request',
      displayName: 'Request a quote',
      fields: [
        field('name', 'Name', 'text', { required: true, role: 'name' }),
        field('email', 'Email', 'email', { required: true, role: 'email' }),
        field('company', 'Company', 'text'),
        field('budget', 'Budget', 'select', { options: ['Under $5k', '$5k–$20k', 'Over $20k'] }),
        field('details', 'Project details', 'textarea', { required: true }),
      ],
      lead: true,
      stats: { submissions: 3, leads: 3, views: 188, lastSubmissionAtMs: nowMs - 3 * 60 * 60 * 1000 },
      createdDaysAgo: 60,
    },
    {
      id: 'event-rsvp',
      displayName: 'Fall open house RSVP',
      fields: [
        field('name', 'Name', 'text', { required: true, role: 'name' }),
        field('email', 'Email', 'email', { required: true, role: 'email' }),
        field('guests', 'Guests', 'select', { options: ['1', '2', '3', '4'] }),
      ],
      lead: false,
      stats: { submissions: 1, leads: null, views: 95, lastSubmissionAtMs: nowMs - 2 * day },
      createdDaysAgo: 14,
    },
    {
      id: 'newsletter',
      displayName: 'Newsletter sign-up',
      fields: [field('email', 'Email', 'email', { required: true, role: 'email' })],
      lead: false,
      stats: { submissions: null, leads: null, views: 37, lastSubmissionAtMs: null },
      createdDaysAgo: 3,
      unopened: true,
    },
    {
      id: 'feedback-2025',
      displayName: 'Feedback survey 2025',
      fields: [
        field('rating', 'Rating', 'rating'),
        field('comments', 'Comments', 'textarea'),
      ],
      lead: false,
      retired: true,
      stats: { submissions: 0, leads: null, views: 0, lastSubmissionAtMs: null },
      createdDaysAgo: 300,
    },
  ]
  for (const form of forms) {
    const slug = form.id
    const versionId = storedDesigns && !form.unopened ? `${form.id}-v1` : null
    await put(`hosts/${hostId}/forms/${form.id}`, {
      displayName: form.displayName,
      slug,
      fields: form.fields,
      ...(storedDesigns ? { rootId: CANVAS_ROOT, nodes: formNodes(form.id, form.displayName, form.fields) } : {}),
      ...(versionId ? { versionId } : {}),
      routing: { lead: form.lead },
      ...formListFields({ id: form.id, displayName: form.displayName, slug }),
      retired: form.retired === true,
      ...(form.retired ? { archivedAt: new Date(nowMs - 30 * day) } : {}),
      inCampaign: false,
      stats: form.stats,
      createdAt: new Date(nowMs - form.createdDaysAgo * day),
      updatedAt: new Date(nowMs - Math.min(form.createdDaysAgo, 2) * day),
      createdBy: uid,
    })
    if (versionId) {
      await put(`hosts/${hostId}/forms/${form.id}/versions/${versionId}`, {
        formId: form.id,
        hostId,
        displayName: 'Initial version',
        rootId: CANVAS_ROOT,
        nodes: formNodes(form.id, form.displayName, form.fields),
        createdAt: new Date(nowMs - form.createdDaysAgo * day),
        createdBy: uid,
        updatedAt: new Date(nowMs - Math.min(form.createdDaysAgo, 2) * day),
      })
    }
  }
  return { forms: forms.length }
}
