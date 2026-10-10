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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { memberCanSee } from '@aglyn/aglyn/app-utils/organizations'
import { checkDatasetQuota, checkEntitlement, checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { defaultScopeForNewResource, newResourceScopeFields } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftCheck,
  type PluginDraftContext,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { dataStorageRefusal } from '@aglyn/tenant-data-admin/server/data-storage-gate'
import {
  memberHasOrgPermission,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin/server/organizations'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  coerceDocumentValues,
  datasetIntegrityFields,
  defaultDatasetFieldId,
  validateDocument,
  type DatasetFieldType,
  type DatasetModel,
} from '../model/dataset-models'
import {
  RECORD_PAGE_ADDRESS_FIELD_TYPE,
  RECORD_PAGE_ADDRESS_MAX,
  uniqueRecordAddresses,
} from '../record-pages/record-pages'

/**
 * A DATASET ANOTHER PLUGIN ASKS FOR (AGL-3616).
 *
 * The draft writer this plugin registers for the `dataset` resource on the
 * core's resource-drafts seam. Aglyn AI builds a menu, a team, a list of
 * services or a portfolio as a dataset, the way the docs teach a person to,
 * and asks for the writer by name, so every rule is this plugin's:
 *
 *  - THE DOCUMENT is the one the Data card's create makes: a display name,
 *    the flat `fields` mirror and a typed model, the org's Default sharing
 *    for the site it is made from (`defaultScopeForNewResource`), and the
 *    seeded records, each with the integrity and filter index every record
 *    write carries. Where a record page is wanted the model gains a "Page
 *    address" field that fills from a text field, and every seeded record a
 *    unique address (`uniqueRecordAddresses`), so the member's Record pages
 *    save has nothing left to fill.
 *  - THE ROOM is `datasetsPerOrg` (add-ons included, `checkDatasetQuota`),
 *    counted INSIDE the transaction that creates, as the datasets route
 *    counts it; the records are held to `recordsPerDataset` and the dataset
 *    storage band.
 *  - THE PLAN is `dataStore` (Starter and up), THE FLAG `release_data_store`,
 *    and THE ROLE an org member who may edit org data (owner, admin or
 *    editor) with `data.manage`, whose access reaches the site — refused in
 *    the route's own words.
 *  - THE CHECK holds every record to the model it is written under
 *    (`validateDocument`), so what is seeded is what a person could type.
 *
 * Nothing is published. The writer touches the one new dataset and its
 * records; a page shows them only where a person (or a job's draft page)
 * places a repeat over it.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resource name this writer is registered under. */
export const DATASET_DRAFT_RESOURCE = 'dataset'

/** The longest dataset name, as the datasets route keeps it. */
export const DATASET_DRAFT_NAME_MAX = 120
/** The most fields a drafted dataset is made with, and the longest name. */
export const DATASET_DRAFT_FIELDS_MAX = 16
export const DATASET_DRAFT_FIELD_NAME_MAX = 60
/** The most records a draft is seeded with. */
export const DATASET_DRAFT_RECORDS_MAX = 24
/** The longest text value a seeded record keeps. */
export const DATASET_DRAFT_VALUE_MAX = 2_000
/** The most entries a seeded list value keeps. */
export const DATASET_DRAFT_LIST_MAX = 12

/**
 * The field types a caller names, in words a person reads, and the type
 * each one is stored as. A date or a time is written as text the way a
 * visitor reads it ("Saturday 8 November, 7 pm"): a stored timestamp renders
 * as a number in a repeat's `{{item.<field>}}`.
 */
export const DATASET_DRAFT_FIELD_TYPES = {
  text: 'text',
  number: 'float',
  integer: 'int32',
  boolean: 'bool',
  list: 'sorted',
} as const satisfies Record<string, DatasetFieldType>

export type DatasetDraftFieldType = keyof typeof DATASET_DRAFT_FIELD_TYPES

const DRAFT_TYPES = Object.keys(DATASET_DRAFT_FIELD_TYPES) as DatasetDraftFieldType[]

/** The datasets route's refusals, word for word. */
export const DATASET_DRAFT_ROLE_REFUSAL = 'Editing org data requires the editor role'
export const DATASET_DRAFT_PERMISSION_REFUSAL = 'Your organization role does not allow editing organization data'
export const DATASET_DRAFT_PLAN_REFUSAL = 'Datasets require a Starter plan or higher'
export const DATASET_DRAFT_RELEASE_REFUSAL = 'Datasets are not available for this workspace yet'
export const DATASET_DRAFT_SCOPE_REFUSAL = 'Your access to this organization does not reach that site'
export const DATASET_DRAFT_STORAGE_REFUSAL = 'Dataset storage is full on this plan — upgrade in Billing'

/** The route's refusal at the plan's dataset allowance. */
export function datasetDraftLimitRefusal(quota: ReturnType<typeof checkDatasetQuota>): string {
  return quota.upgradeRequired
    ? `Dataset limit reached (${quota.limit}) — upgrade in Billing`
    : `Dataset limit reached (${quota.limit}) — add extra datasets for $${quota.addonPriceUsd}/mo each or upgrade in Billing`
}

/** The route's refusal at the plan's record allowance. */
export function datasetDraftRecordLimitRefusal(limit: number): string {
  return `Record limit reached (${limit}) — upgrade in Billing`
}

/** One field as a caller names it. */
export interface DatasetDraftField {
  name: string
  /** Absent is text. */
  type?: DatasetDraftFieldType
  required?: boolean
}

/**
 * What a caller sends as `content`. Each record's values are keyed by the
 * field NAME the caller gave, since the caller has no ids yet; the writer
 * mints the ids (`roast_preference` from "Roast preference").
 */
export interface DatasetDraftContent {
  /** The dataset's name; the request's `name` stands in when absent. */
  name?: string
  fields: DatasetDraftField[]
  records?: Array<Record<string, unknown>>
  /**
   * A text field, by name, a "Page address" field fills from (AGL-3475):
   * asked for where a record page will show each record at its own address.
   */
  pageAddressFrom?: string
}

/** What the writer reports about a dataset. */
export interface DatasetDraftFacts {
  fields: Array<{ id: string; name: string; type: DatasetFieldType }>
  records: number
  /** The page-address field's id, where the dataset has one. */
  addressField: string | null
}

/** The draft as the writer will store it. */
export interface DatasetDraftRead {
  name: string
  model: DatasetModel
  /** Each record's values by field id, coerced and addressed. */
  records: Array<Record<string, unknown>>
  addressField: string | null
}

export type DatasetDraftContentRead =
  | { ok: true; value: DatasetDraftRead }
  | { ok: false; problems: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Text on one line: controls and runs of space folded to one space. */
function line(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\s]+/gu, ' ').trim() : ''
}

/** A value as a seeded record keeps it, before the model coerces it. */
function seedValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\r\n?/g, '\n').trim().slice(0, DATASET_DRAFT_VALUE_MAX)
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? line(entry) : entry))
      .filter((entry) => entry !== '' && entry !== null && entry !== undefined)
      .slice(0, DATASET_DRAFT_LIST_MAX)
  }
  return value
}

/** The content as the writer reads it, or every problem that stops it. Pure. */
export function readDatasetDraftContent(content: Readonly<Record<string, unknown>>): DatasetDraftContentRead {
  const problems: string[] = []
  const name = line(content['name'])
  if (!name) problems.push('The dataset needs a name')
  else if (name.length > DATASET_DRAFT_NAME_MAX) {
    problems.push(`The name is longer than ${DATASET_DRAFT_NAME_MAX} characters`)
  }

  const rawFields = content['fields']
  const model: DatasetModel = { fields: {}, order: [] }
  /** Field name, lowercased → id. */
  const byName = new Map<string, string>()
  if (!Array.isArray(rawFields) || !rawFields.length) {
    problems.push('The dataset needs at least one field')
  } else if (rawFields.length > DATASET_DRAFT_FIELDS_MAX) {
    problems.push(`A dataset is made with at most ${DATASET_DRAFT_FIELDS_MAX} fields`)
  } else {
    for (const raw of rawFields) {
      const fieldName = isRecord(raw) ? line(raw['name']) : ''
      const rawType = (isRecord(raw) ? raw['type'] : undefined) ?? 'text'
      if (!fieldName) {
        problems.push('Each field needs a name')
        continue
      }
      if (fieldName.length > DATASET_DRAFT_FIELD_NAME_MAX) {
        problems.push(`The field "${fieldName.slice(0, 20)}…" has a name longer than ${DATASET_DRAFT_FIELD_NAME_MAX} characters`)
        continue
      }
      if (!(DRAFT_TYPES as readonly unknown[]).includes(rawType)) {
        problems.push(`The field "${fieldName}" is one of ${DRAFT_TYPES.join(', ')}`)
        continue
      }
      if (byName.has(fieldName.toLowerCase())) {
        problems.push(`Two fields are both called "${fieldName}"`)
        continue
      }
      const id = defaultDatasetFieldId(fieldName, new Set(model.order))
      if (!id) {
        problems.push(`The field "${fieldName}" needs a name with a letter in it`)
        continue
      }
      model.fields[id] = {
        name: fieldName,
        type: DATASET_DRAFT_FIELD_TYPES[rawType as DatasetDraftFieldType],
        ...(isRecord(raw) && raw['required'] === true ? { required: true } : {}),
      }
      model.order.push(id)
      byName.set(fieldName.toLowerCase(), id)
    }
  }

  // The page address: a text field the address fills from, once.
  let addressField: string | null = null
  const rawAddress = content['pageAddressFrom']
  if (rawAddress !== undefined && rawAddress !== null && rawAddress !== '') {
    const sourceId = byName.get(line(rawAddress).toLowerCase())
    if (!sourceId || model.fields[sourceId]?.type !== 'text') {
      problems.push('A page address fills from one of the dataset’s text fields')
    } else {
      addressField = defaultDatasetFieldId('slug', new Set(model.order))
      model.fields[addressField] = {
        name: 'Page address',
        type: 'text',
        customType: RECORD_PAGE_ADDRESS_FIELD_TYPE,
        slugFrom: sourceId,
      }
      model.order.push(addressField)
    }
  }

  const rawRecords = content['records'] ?? []
  const records: Array<Record<string, unknown>> = []
  if (!Array.isArray(rawRecords)) {
    problems.push('Records are a list of values by field name')
  } else if (rawRecords.length > DATASET_DRAFT_RECORDS_MAX) {
    problems.push(`A dataset is seeded with at most ${DATASET_DRAFT_RECORDS_MAX} records`)
  } else if (!problems.length) {
    rawRecords.forEach((raw, index) => {
      if (!isRecord(raw)) {
        problems.push(`Record ${index + 1} is not a set of values`)
        return
      }
      const input: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(raw)) {
        const id = byName.get(line(key).toLowerCase())
        if (!id) {
          problems.push(`Record ${index + 1} names "${line(key).slice(0, 40)}", which is not a field`)
          continue
        }
        input[id] = seedValue(value)
      }
      const values = coerceDocumentValues(model, input)
      // An empty value is no value: it is not stored, as the card stores none.
      for (const [id, value] of Object.entries(values)) {
        if (value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length)) {
          delete values[id]
        }
      }
      const errors = validateDocument(model, values)
      for (const error of Object.values(errors)) problems.push(`Record ${index + 1}: ${error}`)
      if (!Object.keys(values).length) problems.push(`Record ${index + 1} has no values`)
      records.push(values)
    })
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }

  // Every seeded record its own address, unique within the dataset.
  if (addressField) {
    const source = model.fields[addressField]?.slugFrom as string
    const assigned = uniqueRecordAddresses(records.map((values, index) => ({ id: String(index), source: values[source] })))
    records.forEach((values, index) => {
      const address = assigned.get(String(index))
      if (address) values[addressField as string] = address.slice(0, RECORD_PAGE_ADDRESS_MAX)
    })
  }
  return { ok: true, value: { name, model, records, addressField } }
}

function factsOf(model: DatasetModel, records: number, addressField: string | null): DatasetDraftFacts {
  return {
    fields: model.order.map((id) => ({ id, name: model.fields[id]?.name ?? id, type: model.fields[id]?.type ?? 'text' })),
    records,
    addressField,
  }
}

/** Whether content is a dataset this plugin would store, with what it says about it. Pure. */
export function checkDatasetDraftContent(content: Readonly<Record<string, unknown>>): PluginDraftCheck {
  const read = readDatasetDraftContent(content)
  if (read.ok === false) return read
  return {
    ok: true,
    facts: factsOf(read.value.model, read.value.records.length, read.value.addressField) as unknown as Readonly<
      Record<string, unknown>
    >,
  }
}

/** Who the member is in the org, as the writer asks: their role, and whether they may manage data. */
export interface DatasetDraftMember {
  role: string
  canManageData: boolean
  /** The membership itself, for whether their access reaches a site. */
  member: Readonly<Record<string, unknown>>
}

export interface DatasetDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
  /** The org a site belongs to; the platform's lookup otherwise. */
  orgIdForHost?: (hostId: string) => Promise<string | null>
  /** The member, or `null` when they are not one; the platform's otherwise. */
  member?: (uid: string, orgId: string) => Promise<DatasetDraftMember | null>
  /** Whether the data store is released for the org; the platform's flag otherwise. */
  released?: (orgId: string) => Promise<boolean>
  /** Whether dataset bytes may grow; the platform's band otherwise. */
  storageFull?: (org: unknown, orgRef: FirebaseFirestore.DocumentReference) => Promise<boolean>
}

/** Roles allowed to create org data — the datasets route's, mirroring the rules' `canWriteOrgData()`. */
const WRITER_ROLES = new Set(['owner', 'admin', 'editor'])

async function platformMember(uid: string, orgId: string): Promise<DatasetDraftMember | null> {
  const membership = await resolveOrgMembership(uid, orgId)
  const member = membership?.member
  if (!member) return null
  return {
    role: String(member.role ?? ''),
    canManageData: await memberHasOrgPermission(orgId, member, 'data.manage'),
    member: member as unknown as Readonly<Record<string, unknown>>,
  }
}

export function createDatasetDraftWriter(deps: DatasetDraftWriterDeps = {}): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  const orgIdForHost = deps.orgIdForHost ?? ((hostId: string) => resolveOrgIdForHost(hostId))
  const memberOf = deps.member ?? platformMember
  const released = deps.released ?? ((orgId: string) => isServerReleaseFlagOnForOrg('release_data_store', orgId))
  const storageFull =
    deps.storageFull ?? (async (org: unknown, orgRef: FirebaseFirestore.DocumentReference) => Boolean(await dataStorageRefusal(org, orgRef)))

  /** Everything but the room: the site is the org's, the member's role, the flag, the plan, the scope. */
  const early = async (context: PluginDraftContext): Promise<PluginDraftRefusal | null> => {
    if ((await orgIdForHost(context.hostId)) !== context.orgId) return { status: 404, error: 'Unknown site' }
    const member = await memberOf(context.uid, context.orgId)
    if (!member || !WRITER_ROLES.has(member.role)) return { status: 403, error: DATASET_DRAFT_ROLE_REFUSAL }
    if (!member.canManageData) return { status: 403, error: DATASET_DRAFT_PERMISSION_REFUSAL }
    if (!(await released(context.orgId))) return { status: 403, error: DATASET_DRAFT_RELEASE_REFUSAL }
    if (!checkEntitlement(context.org as never, 'dataStore')) return { status: 403, error: DATASET_DRAFT_PLAN_REFUSAL }
    // A member scoped to some sites must be able to see what they create.
    if (!memberCanSee(member.member as never, scopeOf(context))) {
      return { status: 403, error: DATASET_DRAFT_SCOPE_REFUSAL }
    }
    return null
  }

  return {
    refusal: async (context) => {
      const refused = await early(context)
      if (refused) return refused
      const used = (await firestore().collection('orgs').doc(context.orgId).collection('datasets').count().get()).data().count
      const quota = checkDatasetQuota(context.org as never, Number(used) || 0)
      return quota.allowed ? null : { status: 403, error: datasetDraftLimitRefusal(quota) }
    },

    check: (content) => checkDatasetDraftContent(content),

    read: async ({ hostId, id }) => {
      const orgId = await orgIdForHost(hostId)
      if (!orgId) return null
      const dataset = await firestore().collection('orgs').doc(orgId).collection('datasets').doc(id).get()
      return dataset.exists ? recordOf(dataset) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      // The request's name is the one asked for; the content's stands in.
      const asked = line(request.name)
      const read = readDatasetDraftContent(asked ? { ...request.content, name: asked } : request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const refused = await early(request)
      if (refused) return { ok: false, ...refused }
      const db = firestore()
      const orgRef = db.collection('orgs').doc(request.orgId)
      const datasets = orgRef.collection('datasets')
      const datasetRef = datasets.doc(request.id)
      const { name, model, records, addressField } = read.value
      const recordQuota = checkQuota(request.org as never, 'recordsPerDataset', Math.max(0, records.length - 1))
      if (records.length && !recordQuota.allowed) {
        return { ok: false, status: 403, error: datasetDraftRecordLimitRefusal(recordQuota.limit) }
      }
      if (records.length && (await storageFull(request.org, orgRef))) {
        return { ok: false, status: 403, error: DATASET_DRAFT_STORAGE_REFUSAL }
      }
      const visibleTo = scopeOf(request)
      // Minted before the transaction, so a retried attempt writes the same rows.
      const recordIds = records.map(() => createResourceUid())
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const existing = await tx.get(datasetRef)
        // Asked again under the same id: the dataset it already wrote.
        if (existing.exists) return { ok: true, replayed: true, ...recordOf(existing) }
        const live = (await tx.get(datasets.count())).data().count
        const quota = checkDatasetQuota(request.org as never, Number(live) || 0)
        if (!quota.allowed) return { ok: false, status: 403, error: datasetDraftLimitRefusal(quota) }
        tx.create(datasetRef, {
          displayName: name,
          fields: [...model.order],
          model,
          ...newResourceScopeFields(visibleTo),
          createdAt: request.now,
          createdBy: request.uid,
        })
        records.forEach((values, order) => {
          tx.create(datasetRef.collection('records').doc(recordIds[order]), {
            values,
            ...datasetIntegrityFields(model, values),
            order,
            createdAt: request.now,
            updatedAt: request.now,
          })
        })
        return {
          ok: true,
          replayed: false,
          id: request.id,
          name,
          versionId: null,
          facts: factsOf(model, records.length, addressField) as unknown as Readonly<Record<string, unknown>>,
        }
      })
    },
  }
}

/** The scope a dataset made from this site takes: the org's Default sharing for it. */
function scopeOf(context: Pick<PluginDraftContext, 'org' | 'hostId'>) {
  return defaultScopeForNewResource({
    defaultResourceScope: (context.org as { defaultResourceScope?: 'org' | 'host' } | null)?.defaultResourceScope,
    hostId: context.hostId,
  })
}

function recordOf(dataset: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const data = (dataset.data() ?? {}) as { displayName?: unknown; model?: DatasetModel }
  const model: DatasetModel = data.model?.order ? data.model : { fields: {}, order: [] }
  const addressField = model.order.find((id) => model.fields[id]?.customType === RECORD_PAGE_ADDRESS_FIELD_TYPE) ?? null
  return {
    id: dataset.id,
    name: String(data.displayName ?? ''),
    versionId: null,
    // A replay reports the fields; how many records it was seeded with is the first write's to say.
    facts: factsOf(model, 0, addressField) as unknown as Readonly<Record<string, unknown>>,
  }
}

export const datasetDraftWriter = createDatasetDraftWriter()

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerDatasetDraftWriter(): void {
  registerPluginResourceDraftWriter(DATASET_DRAFT_RESOURCE, datasetDraftWriter, { pluginId: BUNDLE_ID })
}
