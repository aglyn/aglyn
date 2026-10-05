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

import {
  registerPluginRecordFactsReader,
  type PluginRecordFactsRead,
  type PluginRecordFactsReader,
  type PluginRecordFactsRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-record-facts'
import {
  CRM_COLLECTIONS,
  CRM_LEAD_STATUS_PICKLIST,
  contactDisplayName,
  crmReadTokens,
  readContactFacet,
  isOrgWideMember,
  type ConsentGroup,
  type ContactFieldDefinition,
  type CrmActivity,
  type CrmCompany,
  type CrmDeal,
  type CrmPipeline,
  type CrmTask,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgDoc,
  listOrgMembers,
  memberHasOrgPermission,
  readLeadForHost,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { readContainerIds } from '@aglyn/aglyn/app-utils/container-membership'
import { readOrgContainers } from '@aglyn/tenant-data-admin/server/org-containers'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  CRM_IMPORT_FACTS_RESOURCE,
  CRM_RECORD_FACTS_RESOURCES,
  companyFacts,
  contactFacts,
  dealFacts,
  importFacts,
  isCrmImportFactsCollection,
  leadFacts,
  type CrmFactsNames,
  type CrmRecordFactsKind,
} from '../model/record-facts'
import { readCrmPicklist } from './read-picklist'
import { crmSuiteRefusal } from './suite-gate'
import { contactPrimaryGroup } from '../model/contact-holder'

/**
 * THE CRM'S READERS ON THE CORE'S RECORD-FACTS SEAM (AGL-2917).
 *
 * Another plugin asks for a contact, a company, a deal, a lead or an import's
 * field catalog by resource name, and gets the facts `model/record-facts.ts`
 * reports — read here with the rules every other CRM door applies, for the
 * member the caller names:
 *
 *  1. the site belongs to the organization;
 *  2. the member reaches it — an org-wide member at the organization level, a
 *     member of that site under it — and holds `data.manage`, the key the
 *     whole CRM is gated on. A verified staff caller passes, as at every CRM
 *     route;
 *  3. the organization's plan carries the CRM, asked after the caller is
 *     known, the order `suite-gate.ts` gives;
 *  4. the record exists and is visible where it is read: under a site, its
 *     `visibleTo` meets the site's read tokens, as the console's listeners
 *     filter; at the organization level every row is the member's;
 *  5. what hangs off it — its logged activity, its tasks, its deals — is held
 *     to the same visibility, row by row;
 *  6. a record it names — the person someone reports to, a parent company —
 *     is named only when it is visible here too, and a campaign only when it
 *     is the org's live one (AGL-3520).
 *
 * Every read answers the WHOLE record (AGL-3520): beside the documents, the
 * org's custom field definitions, for their labels, and its roster, for the
 * display names of the team members a record names.
 *
 * A caller in the same process skips the plugin API dispatcher, and with it
 * the dispatcher's per-site enablement, release flag, lockdown and rate
 * limit; those are the caller's to establish before it asks (the AI plugin's
 * CRM admission does). Nothing here writes.
 */

type Firestore = FirebaseFirestore.Firestore
type Data = Record<string, unknown>
type Refusal = { ok: false; status: 400 | 403 | 404; error: string }

/** The org collection a contact lives in, beside the CRM's own. */
const CONTACTS_COLLECTION = 'contacts'

/** Logged activities read per record before visibility and the timeline cut. */
export const CRM_FACTS_ACTIVITIES_READ = 40
/** Tasks read per record, the record page's own window. */
export const CRM_FACTS_TASKS_READ = 50
/** Deals read per contact or company. */
export const CRM_FACTS_DEALS_READ = 20
/** Custom field definitions an import catalog reads. */
export const CRM_FACTS_FIELD_DEFINITIONS_READ = 100

export const CRM_FACTS_UNKNOWN_SITE = 'Unknown site'
export const CRM_FACTS_NOT_A_MEMBER = 'You are not a member of that organization'
export const CRM_FACTS_SITE_REFUSAL = 'Reading CRM records requires the data.manage permission on this site'
export const CRM_FACTS_ORG_REFUSAL =
  'Reading CRM records across the organization requires the data.manage permission for the whole organization'
export const CRM_FACTS_LEAD_NEEDS_SITE = 'A lead is read on the site that captured it'

const NOT_FOUND: Record<CrmRecordFactsKind | 'import', string> = {
  contact: 'This contact could not be found. It may have been deleted.',
  company: 'This company could not be found. It may have been deleted.',
  deal: 'This deal could not be found. It may have been deleted.',
  lead: 'This lead could not be found. It may have been removed.',
  import: 'There is no such import.',
}

/** Where a read runs, once the caller has been admitted. */
interface CrmFactsScope {
  orgId: string
  hostId: string | null
  org: Data
  /** The site's consent group under a site; `null` at the organization level. */
  group: ConsentGroup | null
  /** Whether a row's `visibleTo` is readable here. */
  visible: (visibleTo: unknown) => boolean
}

function firestore(): Firestore {
  return firebaseAdmin.app().firestore()
}

/**
 * Rules 1 to 3: the site, the member and the plan. A refusal names what the
 * member lacks in the words the console's own CRM doors use.
 */
export async function crmFactsScope(request: PluginRecordFactsRequest): Promise<CrmFactsScope | Refusal> {
  const orgId = String(request.orgId ?? '').trim()
  const hostId = request.hostId ? String(request.hostId).trim() : null
  if (!orgId) return { ok: false, status: 400, error: 'Open a workspace first' }
  if (hostId && (await resolveOrgIdForHost(hostId)) !== orgId) {
    return { ok: false, status: 404, error: CRM_FACTS_UNKNOWN_SITE }
  }
  if (!request.staff) {
    const membership = await resolveOrgMembership(request.uid, orgId).catch(() => null)
    const member = membership?.orgId === orgId ? membership.member : null
    if (!member) return { ok: false, status: 403, error: CRM_FACTS_NOT_A_MEMBER }
    const reaches = hostId
      ? isOrgWideMember(member) || Boolean(member.hostAccess?.[hostId])
      : isOrgWideMember(member)
    const allowed = reaches && (await memberHasOrgPermission(orgId, member, 'data.manage'))
    if (!allowed) {
      return { ok: false, status: 403, error: hostId ? CRM_FACTS_SITE_REFUSAL : CRM_FACTS_ORG_REFUSAL }
    }
  }
  const org = ((request.org as Data | null) ?? ((await getOrgDoc(orgId)) as Data | null)) || null
  if (!org) return { ok: false, status: 404, error: 'Unknown organization' }
  const suite = crmSuiteRefusal(org, 'Reading a CRM record')
  if (suite) return { ok: false, status: 403, error: suite.body.error }
  if (!hostId) return { orgId, hostId: null, org, group: null, visible: () => true }
  const group = await consentGroupForSite(hostId, org)
  const readable = new Set<string>(crmReadTokens(group))
  return {
    orgId,
    hostId,
    org,
    group,
    visible: (visibleTo) =>
      Array.isArray(visibleTo) && visibleTo.some((token) => readable.has(String(token))),
  }
}

const orgCollection = (orgId: string, name: string) =>
  firestore().collection('orgs').doc(orgId).collection(name)

/** Rows of an org collection naming one record, held to the scope's visibility. */
async function rowsNaming<T>(
  scope: CrmFactsScope,
  input: { collection: string; field: string; id: string; orderBy: string; direction: 'asc' | 'desc'; limit: number },
): Promise<T[]> {
  const snapshot = await orgCollection(scope.orgId, input.collection)
    .where(input.field, '==', input.id)
    .orderBy(input.orderBy, input.direction)
    .limit(input.limit)
    .get()
  return snapshot.docs
    .map((doc) => (doc.data() ?? {}) as Data)
    .filter((row) => scope.visible(row['visibleTo'])) as T[]
}

/** The pipelines some deals name, by id, read once each. */
async function pipelinesFor(scope: CrmFactsScope, deals: ReadonlyArray<Partial<CrmDeal>>): Promise<Map<string, CrmPipeline>> {
  const ids = [...new Set(deals.map((deal) => String(deal.pipelineId ?? '')).filter(Boolean))]
  const snapshots = await Promise.all(ids.map((id) => orgCollection(scope.orgId, CRM_COLLECTIONS.pipelines).doc(id).get()))
  return new Map(
    snapshots
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, (snapshot.data() ?? {}) as CrmPipeline]),
  )
}

/** A record document the scope may read, or `null`. */
async function visibleDoc(scope: CrmFactsScope, collection: string, id: string): Promise<Data | null> {
  if (!id) return null
  const snapshot = await orgCollection(scope.orgId, collection).doc(id).get()
  const data = snapshot.exists ? ((snapshot.data() ?? {}) as Data) : null
  return data && scope.visible(data['visibleTo']) ? data : null
}

const refused = (kind: CrmRecordFactsKind | 'import', status: 400 | 404 = 404): Refusal => ({
  ok: false,
  status,
  error: NOT_FOUND[kind],
})

/**
 * The names a builder reports a record's references by (AGL-3520): the
 * team's display names — never an address or a uid — and the org's custom
 * field definitions visible here, for their labels. Read once per record.
 */
async function factsNames(scope: CrmFactsScope): Promise<CrmFactsNames> {
  const [members, fields] = await Promise.all([
    listOrgMembers(scope.orgId).catch(() => []),
    orgCollection(scope.orgId, CRM_COLLECTIONS.contactFields).limit(CRM_FACTS_FIELD_DEFINITIONS_READ).get(),
  ])
  const byUid = new Map(
    members.map((member) => {
      const row = member as unknown as Data
      return [String(row['$id'] ?? ''), String(row['displayName'] ?? '').trim()] as const
    }),
  )
  return {
    member: (uid) => byUid.get(uid) ?? '',
    customFields: fields.docs
      .map((doc) => (doc.data() ?? {}) as Partial<ContactFieldDefinition> & Data)
      .filter((definition) => scope.visible(definition['visibleTo'])),
  }
}

/** The names of the org's live campaigns among `ids`, in their order. */
async function campaignNames(scope: CrmFactsScope, ids: readonly string[]): Promise<string[]> {
  if (!ids.length) return []
  const found = await readOrgContainers(firestore(), 'campaign', scope.orgId, [...ids]).catch(() => [])
  return found.filter((container) => container.live).map((container) => container.name).filter(Boolean)
}

/** A reader that admits the caller, then reads the record. */
function reader(read: (scope: CrmFactsScope, request: PluginRecordFactsRequest) => Promise<PluginRecordFactsRead>): PluginRecordFactsReader {
  return {
    read: async (request) => {
      const scope = await crmFactsScope(request)
      if ('ok' in scope) return scope
      return read(scope, request)
    },
  }
}

export const crmContactFactsReader = reader(async (scope, request) => {
  const id = String(request.id ?? '').trim()
  const row = await visibleDoc(scope, CONTACTS_COLLECTION, id)
  if (!row) return refused('contact')
  const group = scope.group ?? contactPrimaryGroup(row, scope.org)
  const naming = { field: 'contactId', id }
  const [activities, tasks, deals] = await Promise.all([
    rowsNaming<CrmActivity>(scope, { ...naming, collection: CRM_COLLECTIONS.activities, orderBy: 'atMs', direction: 'desc', limit: CRM_FACTS_ACTIVITIES_READ }),
    rowsNaming<CrmTask>(scope, { ...naming, collection: CRM_COLLECTIONS.tasks, orderBy: 'dueAtMs', direction: 'asc', limit: CRM_FACTS_TASKS_READ }),
    rowsNaming<CrmDeal>(scope, { ...naming, collection: CRM_COLLECTIONS.deals, orderBy: 'updatedAt', direction: 'desc', limit: CRM_FACTS_DEALS_READ }),
  ])
  const reportsToId = readContactFacet(row, group.groupId).reportsToContactId
  const [pipelines, names, reportsTo] = await Promise.all([
    pipelinesFor(scope, deals),
    factsNames(scope),
    reportsToId ? visibleDoc(scope, CONTACTS_COLLECTION, reportsToId) : Promise.resolve(null),
  ])
  return {
    ok: true,
    facts: {
      ...contactFacts({
        row,
        group,
        activities,
        tasks,
        deals,
        pipelines,
        nowMs: request.now.getTime(),
        names,
        ...(reportsTo ? { reportsToName: contactDisplayName(reportsTo, group.groupId) } : {}),
      }),
    },
  }
})

export const crmCompanyFactsReader = reader(async (scope, request) => {
  const id = String(request.id ?? '').trim()
  const company = await visibleDoc(scope, CRM_COLLECTIONS.companies, id)
  if (!company) return refused('company')
  const naming = { field: 'companyId', id }
  const [activities, tasks, deals] = await Promise.all([
    rowsNaming<CrmActivity>(scope, { ...naming, collection: CRM_COLLECTIONS.activities, orderBy: 'atMs', direction: 'desc', limit: CRM_FACTS_ACTIVITIES_READ }),
    rowsNaming<CrmTask>(scope, { ...naming, collection: CRM_COLLECTIONS.tasks, orderBy: 'dueAtMs', direction: 'asc', limit: CRM_FACTS_TASKS_READ }),
    rowsNaming<CrmDeal>(scope, { ...naming, collection: CRM_COLLECTIONS.deals, orderBy: 'updatedAt', direction: 'desc', limit: CRM_FACTS_DEALS_READ }),
  ])
  const parentId = typeof company['parentCompanyId'] === 'string' ? company['parentCompanyId'] : ''
  const [pipelines, names, parent] = await Promise.all([
    pipelinesFor(scope, deals),
    factsNames(scope),
    parentId ? visibleDoc(scope, CRM_COLLECTIONS.companies, parentId) : Promise.resolve(null),
  ])
  return {
    ok: true,
    facts: {
      ...companyFacts({
        company: company as Partial<CrmCompany>,
        activities,
        tasks,
        deals,
        pipelines,
        nowMs: request.now.getTime(),
        names,
        ...(parent ? { parentCompanyName: String(parent['name'] ?? '') } : {}),
      }),
    },
  }
})

export const crmDealFactsReader = reader(async (scope, request) => {
  const id = String(request.id ?? '').trim()
  const deal = (await visibleDoc(scope, CRM_COLLECTIONS.deals, id)) as (Partial<CrmDeal> & Data) | null
  if (!deal) return refused('deal')
  const naming = { field: 'dealId', id }
  const [activities, tasks, pipelines, names, campaign] = await Promise.all([
    rowsNaming<CrmActivity>(scope, { ...naming, collection: CRM_COLLECTIONS.activities, orderBy: 'atMs', direction: 'desc', limit: CRM_FACTS_ACTIVITIES_READ }),
    rowsNaming<CrmTask>(scope, { ...naming, collection: CRM_COLLECTIONS.tasks, orderBy: 'dueAtMs', direction: 'asc', limit: CRM_FACTS_TASKS_READ }),
    pipelinesFor(scope, [deal]),
    factsNames(scope),
    campaignNames(scope, typeof deal.campaignId === 'string' && deal.campaignId ? [deal.campaignId] : []),
  ])
  return {
    ok: true,
    facts: {
      ...dealFacts({
        deal,
        pipeline: pipelines.get(String(deal.pipelineId ?? '')) ?? null,
        activities,
        tasks,
        nowMs: request.now.getTime(),
        names,
        ...(campaign[0] ? { campaignName: campaign[0] } : {}),
      }),
    },
  }
})

export const crmLeadFactsReader = reader(async (scope, request) => {
  if (!scope.hostId) return { ok: false, status: 400, error: CRM_FACTS_LEAD_NEEDS_SITE }
  const id = String(request.id ?? '').trim()
  if (!id) return refused('lead')
  const snapshot = await readLeadForHost(scope.hostId, id)
  if (!snapshot) return refused('lead')
  const lead = (snapshot.data() ?? {}) as Data
  const naming = { field: 'leadId', id }
  const [activities, tasks, leadStatuses, names, campaigns] = await Promise.all([
    rowsNaming<CrmActivity>(scope, { ...naming, collection: CRM_COLLECTIONS.activities, orderBy: 'atMs', direction: 'desc', limit: CRM_FACTS_ACTIVITIES_READ }),
    // The lead's own tasks (AGL-3520), as a contact's are read.
    rowsNaming<CrmTask>(scope, { ...naming, collection: CRM_COLLECTIONS.tasks, orderBy: 'dueAtMs', direction: 'asc', limit: CRM_FACTS_TASKS_READ }),
    // The status fact reads as the org names it (AGL-3512).
    readCrmPicklist(firestore(), scope.orgId, CRM_LEAD_STATUS_PICKLIST),
    factsNames(scope),
    campaignNames(scope, readContainerIds(lead, 'campaign')),
  ])
  return {
    ok: true,
    facts: {
      ...leadFacts({
        lead,
        activities,
        tasks,
        nowMs: request.now.getTime(),
        leadStatuses,
        group: scope.group,
        names,
        campaignNames: campaigns,
      }),
    },
  }
})

export const crmImportFactsReader = reader(async (scope, request) => {
  const collection = String(request.id ?? '').trim()
  if (!isCrmImportFactsCollection(collection)) return refused('import', 400)
  const snapshot = await orgCollection(scope.orgId, CRM_COLLECTIONS.contactFields)
    .limit(CRM_FACTS_FIELD_DEFINITIONS_READ)
    .get()
  const definitions = snapshot.docs
    .map((doc) => (doc.data() ?? {}) as Partial<ContactFieldDefinition> & Data)
    .filter((definition) => scope.visible(definition['visibleTo']))
  return { ok: true, facts: { ...importFacts(collection, definitions) } }
})

/** Every reader this plugin registers, by resource name. */
export const CRM_FACTS_READERS: Readonly<Record<string, PluginRecordFactsReader>> = {
  [CRM_RECORD_FACTS_RESOURCES.contact]: crmContactFactsReader,
  [CRM_RECORD_FACTS_RESOURCES.company]: crmCompanyFactsReader,
  [CRM_RECORD_FACTS_RESOURCES.deal]: crmDealFactsReader,
  [CRM_RECORD_FACTS_RESOURCES.lead]: crmLeadFactsReader,
  [CRM_IMPORT_FACTS_RESOURCE]: crmImportFactsReader,
}

/**
 * Registers the readers; the console surface calls it, the one process that
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerCrmRecordFactsReaders(): void {
  for (const [resource, factsReader] of Object.entries(CRM_FACTS_READERS)) {
    registerPluginRecordFactsReader(resource, factsReader, { pluginId: BUNDLE_ID })
  }
}
