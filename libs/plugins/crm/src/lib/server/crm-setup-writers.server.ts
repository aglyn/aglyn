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

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { CONTACT_FIELDS_MAX_PER_ORG } from '@aglyn/aglyn/app-utils/contact-custom-fields'
import {
  CRM_COLLECTIONS,
  type CrmPicklist,
  type CrmPicklistDefinition,
  type CrmPicklistId,
  type CrmPicklistObject,
  type CrmPicklistTarget,
  crmPicklistDefinition,
  crmReadTokens,
  crmScopeTokens,
  effectiveCrmPicklist,
  normalizeCrmPicklist,
} from '@aglyn/aglyn/app-utils/crm'
import { memberCanSee } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { newResourceScopeFields, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import type {
  PluginDraftContext,
  PluginDraftRecord,
  PluginDraftRefusal,
  PluginDraftWrite,
  PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  memberHasOrgPermission,
  resolveOrgIdForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin/server/organizations'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import {
  checkCrmPicklistValuesSetup,
  CRM_CUSTOM_CHOICE_LIST,
  type CrmPicklistValuesOutcome,
  crmPicklistValuesName,
  planCrmCustomChoiceValues,
  planCrmPicklistValues,
  readCrmPicklistValuesSetup,
} from '../model/crm-picklist-setup-content'
import {
  checkCrmFieldSetup,
  checkCrmPipelineSetup,
  type CrmFieldDefinitionDoc,
  crmPipelineSetupFacts,
  planCrmFieldSetup,
  planCrmPipelineSetup,
  readCrmFieldSetup,
  readCrmPipelineSetup,
} from '../model/crm-setup-content'
import type { PipelineDoc } from '../model/deal-board-model'
import { picklistKeepsGroups } from '../model/picklist-values'
import { picklistGroupOf, regroupEverywhere } from './picklist-regroup'
import { crmSuiteRefusalMessage } from './suite-gate'

/**
 * THE CRM'S SETUP WRITERS (AGL-3746): a deal pipeline and a custom field,
 * saved for another plugin — Aglyn AI's build — under the CRM's rules.
 *
 * Registered on the core's resource-drafts seam as `crm-pipeline` and
 * `crm-field`. Neither is a draft: a pipeline and a field have no draft
 * state, and the console saves both live, so these do too, and their AI
 * capabilities say so (`live`). What they write is exactly what the
 * console's Pipelines dialog and Fields section write
 * (`model/crm-setup-content.ts`), and they admit exactly whom the Firestore
 * rules admit for those writes, since the Admin SDK passes the rules by:
 *
 *  - THE SITE is the org's, and THE PLAN carries the CRM (`crm`, Starter and
 *    up — `orgCarriesCrmSuite`), refused in the suite gate's words;
 *  - THE MEMBER is an owner, admin or editor (`canWriteOrgData`) whose org
 *    access is not suspended, holding `data.manage`, the key the whole CRM
 *    is gated on;
 *  - THE SCOPE is one the member can create in (`canCreateScoped`): a
 *    pipeline is stamped as the board's seed stamps it from this site
 *    (`crmScopeTokens`), a field org-wide, which only an org-wide member
 *    reaches.
 *
 * Idempotent: the job's attempt key is a new pipeline's or field's id, and
 * an existing pipeline, stage or field is matched by name (see the model),
 * so asking again changes nothing.
 */

type Firestore = FirebaseFirestore.Firestore

/** The refusals, in the console's and the routes' words. */
export const CRM_SETUP_ROLE_REFUSAL = 'Editing the CRM requires the editor role'
export const CRM_SETUP_PERMISSION_REFUSAL = 'Your organization role does not allow editing organization data'
export const CRM_SETUP_SCOPE_REFUSAL = 'Your access to this organization does not reach that site'
export const CRM_SETUP_FIELD_SCOPE_REFUSAL = 'Custom fields are organization-wide, and your access reaches only some sites'
export const CRM_SETUP_PICKLIST_SCOPE_REFUSAL = 'Picklists are organization-wide, and your access reaches only some sites'

/** Roles allowed to write the CRM's setup — the rules' `canWriteOrgData()`. */
const WRITER_ROLES = new Set(['owner', 'admin', 'editor'])

/** The most pipelines one site's read returns, as the board reads them. */
const PIPELINE_READ_LIMIT = 50

/** Who the member is in the org, as the writers ask. */
export interface CrmSetupMember {
  role: string
  canManageData: boolean
  /** The membership itself, for its reach and whether it is suspended. */
  member: Readonly<Record<string, unknown>>
}

/** The reads and writes the writers make, over the Admin SDK unless a spec hands in its own. */
export interface CrmSetupStore {
  /** The pipelines readable under these scope tokens. */
  pipelines(orgId: string, readTokens: readonly string[]): Promise<PipelineDoc[]>
  pipeline(orgId: string, id: string): Promise<PipelineDoc | null>
  /** One batch: the new or changed pipeline, and the default flag off the others. */
  savePipeline(
    orgId: string,
    write: { id: string; create?: Record<string, unknown>; update?: Record<string, unknown>; defaultsOff: string[] },
    now: Date,
  ): Promise<void>
  /** Every definition the org holds, retired ones included, to the ceiling and one past it. */
  fields(orgId: string): Promise<CrmFieldDefinitionDoc[]>
  field(orgId: string, id: string): Promise<CrmFieldDefinitionDoc | null>
  createField(orgId: string, id: string, document: Record<string, unknown>): Promise<void>
  setFieldOptions(orgId: string, id: string, options: string[], now: Date): Promise<void>
  /** A picklist's stored document, or `null` for an org that never stored one (AGL-3756). */
  picklist(orgId: string, id: CrmPicklistId): Promise<Readonly<Record<string, unknown>> | null>
  /**
   * Read a picklist and write it back in one transaction, as the console's
   * route does, so a person editing the list at the same moment is not
   * overwritten. `change` answers the list to write, or `null` for none.
   */
  changePicklist<T>(
    orgId: string,
    id: CrmPicklistId,
    change: (stored: Readonly<Record<string, unknown>> | null) => { write: CrmPicklist | null; result: T },
    stamp: { hostId: string },
  ): Promise<T>
  /** A value's group onto every record of `object` holding `label` (a lead's `leadSourceDirection`). */
  regroup(orgId: string, object: CrmPicklistObject, target: CrmPicklistTarget, label: string, group: string | null): Promise<number>
}

/** The org subcollection each picklist target's records live in. */
const TARGET_COLLECTIONS: Record<CrmPicklistObject, string> = {
  contact: 'contacts',
  lead: 'leads',
  company: CRM_COLLECTIONS.companies,
  deal: CRM_COLLECTIONS.deals,
  task: CRM_COLLECTIONS.tasks,
}

export interface CrmSetupWriterDeps {
  store?: CrmSetupStore
  /** The org a site belongs to; the platform's lookup otherwise. */
  orgIdForHost?: (hostId: string) => Promise<string | null>
  /** The member, or `null` when they are not one; the platform's otherwise. */
  member?: (uid: string, orgId: string) => Promise<CrmSetupMember | null>
}

async function platformMember(uid: string, orgId: string): Promise<CrmSetupMember | null> {
  const membership = await resolveOrgMembership(uid, orgId)
  const member = membership?.member
  if (!member) return null
  return {
    role: String(member.role ?? ''),
    canManageData: await memberHasOrgPermission(orgId, member, 'data.manage'),
    member: member as unknown as Readonly<Record<string, unknown>>,
  }
}

/** The CRM's collections over the Admin SDK. */
export function adminCrmSetupStore(firestore: () => Firestore = () => firebaseAdmin.app().firestore() as unknown as Firestore): CrmSetupStore {
  const org = (orgId: string) => firestore().collection('orgs').doc(orgId)
  const pipelinesOf = (orgId: string) => org(orgId).collection(CRM_COLLECTIONS.pipelines)
  const fieldsOf = (orgId: string) => org(orgId).collection(CRM_COLLECTIONS.contactFields)
  const withId = <T>(snap: FirebaseFirestore.DocumentSnapshot): T => ({ ...(snap.data() as object), $id: snap.id }) as T
  return {
    pipelines: async (orgId, readTokens) => {
      const snap = await pipelinesOf(orgId)
        .where('visibleTo', 'array-contains-any', [...readTokens])
        .orderBy(FieldPath.documentId())
        .limit(PIPELINE_READ_LIMIT)
        .get()
      return snap.docs.map((one) => withId<PipelineDoc>(one))
    },
    pipeline: async (orgId, id) => {
      const snap = await pipelinesOf(orgId).doc(id).get()
      return snap.exists ? withId<PipelineDoc>(snap) : null
    },
    savePipeline: async (orgId, write, now) => {
      const batch = firestore().batch()
      const ref = pipelinesOf(orgId).doc(write.id)
      if (write.create) batch.create(ref, write.create)
      else if (write.update) batch.update(ref, { ...write.update, updatedAt: now })
      for (const id of write.defaultsOff) {
        batch.update(pipelinesOf(orgId).doc(id), { isDefault: false, updatedAt: now })
      }
      await batch.commit()
    },
    fields: async (orgId) => {
      const snap = await fieldsOf(orgId).limit(CONTACT_FIELDS_MAX_PER_ORG + 1).get()
      return snap.docs.map((one) => withId<CrmFieldDefinitionDoc>(one))
    },
    field: async (orgId, id) => {
      const snap = await fieldsOf(orgId).doc(id).get()
      return snap.exists ? withId<CrmFieldDefinitionDoc>(snap) : null
    },
    createField: async (orgId, id, document) => {
      await fieldsOf(orgId).doc(id).create(document)
    },
    setFieldOptions: async (orgId, id, options, now) => {
      await fieldsOf(orgId).doc(id).update({ options, updatedAt: now })
    },
    picklist: async (orgId, id) => {
      const snap = await org(orgId).collection(CRM_COLLECTIONS.picklists).doc(id).get()
      return snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null
    },
    changePicklist: async (orgId, id, change, stamp) => {
      const ref = org(orgId).collection(CRM_COLLECTIONS.picklists).doc(id)
      return firestore().runTransaction(async (transaction) => {
        const snap = await transaction.get(ref)
        const stored = snap.exists ? ((snap.data() ?? {}) as Record<string, unknown>) : null
        const { write, result } = change(stored)
        if (write) {
          // The stamp the console's first write gives an org-wide CRM document.
          const created = normalizeCrmPicklist(stored) === null
          transaction.set(
            ref,
            {
              values: write.values,
              defaultValueId: write.defaultValueId,
              updatedAt: FieldValue.serverTimestamp(),
              ...(created
                ? { hostId: stamp.hostId, createdAt: FieldValue.serverTimestamp(), ...newResourceScopeFields([ORG_SCOPE_TOKEN]) }
                : {}),
            },
            { merge: true },
          )
        }
        return result
      })
    },
    regroup: (orgId, object, target, label, group) =>
      regroupEverywhere(firestore(), org(orgId).collection(TARGET_COLLECTIONS[object]), target, label, group),
  }
}

/** The scope a pipeline made from this site is stamped with: the board seed's. */
function pipelineScope(context: Pick<PluginDraftContext, 'org' | 'hostId'>): string[] {
  const org = (context.org ?? null) as Record<string, unknown> | null
  return crmScopeTokens(org, consentGroupForHost(org, context.hostId))
}

/** What a pipeline's board at this site reads: the org's rows and the site group's. */
function pipelineReadTokens(context: Pick<PluginDraftContext, 'org' | 'hostId'>): string[] {
  const org = (context.org ?? null) as Record<string, unknown> | null
  return crmReadTokens(consentGroupForHost(org, context.hostId))
}

function pipelineRecord(pipeline: PipelineDoc): PluginDraftRecord {
  return { id: pipeline.$id, name: String(pipeline.name ?? ''), versionId: null, facts: crmPipelineSetupFacts(pipeline.stages ?? []) }
}

function fieldRecord(field: CrmFieldDefinitionDoc): PluginDraftRecord {
  return {
    id: field.$id,
    name: String(field.label ?? ''),
    versionId: null,
    facts: {
      object: field.object ?? 'contact',
      key: field.key,
      type: field.type,
      ...(field.options ? { options: field.options } : {}),
      ...(field.currency ? { currency: field.currency } : {}),
    },
  }
}

function createCrmSetupGate(deps: CrmSetupWriterDeps) {
  const orgIdForHost = deps.orgIdForHost ?? ((hostId: string) => resolveOrgIdForHost(hostId))
  const memberOf = deps.member ?? platformMember
  /** Everything but the scope: the site is the org's, the plan, the member's role and permission. */
  return async (context: PluginDraftContext, scope: readonly string[], scopeRefusal: string): Promise<PluginDraftRefusal | null> => {
    if ((await orgIdForHost(context.hostId)) !== context.orgId) return { status: 404, error: 'Unknown site' }
    if (!checkEntitlement(context.org as never, 'crm')) {
      return { status: 403, error: crmSuiteRefusalMessage('Setting up the CRM') }
    }
    const member = await memberOf(context.uid, context.orgId)
    if (!member || !WRITER_ROLES.has(member.role) || member.member['orgSuspended'] === true) {
      return { status: 403, error: CRM_SETUP_ROLE_REFUSAL }
    }
    if (!member.canManageData) return { status: 403, error: CRM_SETUP_PERMISSION_REFUSAL }
    if (!memberCanSee(member.member as never, scope)) return { status: 403, error: scopeRefusal }
    return null
  }
}

/** The `crm-pipeline` writer: creates or brings a pipeline to the ask. */
export function createCrmPipelineSetupWriter(deps: CrmSetupWriterDeps = {}): PluginResourceDraftWriter {
  const store = deps.store ?? adminCrmSetupStore()
  const orgIdForHost = deps.orgIdForHost ?? ((hostId: string) => resolveOrgIdForHost(hostId))
  const gate = createCrmSetupGate(deps)
  return {
    refusal: (context) => gate(context, pipelineScope(context), CRM_SETUP_SCOPE_REFUSAL),
    check: (content) => checkCrmPipelineSetup(content),
    read: async ({ hostId, id }) => {
      const orgId = await orgIdForHost(hostId)
      const pipeline = orgId ? await store.pipeline(orgId, id) : null
      return pipeline ? pipelineRecord(pipeline) : null
    },
    write: async (request): Promise<PluginDraftWrite> => {
      const read = readCrmPipelineSetup(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const visibleTo = pipelineScope(request)
      const refused = await gate(request, visibleTo, CRM_SETUP_SCOPE_REFUSAL)
      if (refused) return { ok: false, ...refused }
      // Asked again under the same id: the pipeline it already made.
      const made = await store.pipeline(request.orgId, request.id)
      if (made) return { ok: true, replayed: true, ...pipelineRecord(made) }
      const pipelines = await store.pipelines(request.orgId, pipelineReadTokens(request))
      const plan = planCrmPipelineSetup(read.value, pipelines, {
        visibleTo,
        hostId: request.hostId,
        uid: request.uid,
        nowMs: request.now.getTime(),
      })
      if (plan.kind === 'refuse') return { ok: false, status: 409, error: plan.error }
      if (plan.kind === 'create') {
        await store.savePipeline(request.orgId, { id: request.id, create: plan.document, defaultsOff: plan.defaultsOff }, request.now)
        return {
          ok: true,
          replayed: false,
          ...pipelineRecord({ ...(plan.document as unknown as PipelineDoc), $id: request.id }),
        }
      }
      const existing = pipelines.find((one) => one.$id === plan.id) as PipelineDoc
      const changed = Object.keys(plan.patch).length > 0 || plan.defaultsOff.length > 0
      if (changed) {
        await store.savePipeline(request.orgId, { id: plan.id, update: plan.patch, defaultsOff: plan.defaultsOff }, request.now)
      }
      return { ok: true, replayed: !changed, ...pipelineRecord({ ...existing, ...plan.patch }) }
    },
  }
}

/** The `crm-field` writer: creates a custom field, or finds the one asked for. */
export function createCrmFieldSetupWriter(deps: CrmSetupWriterDeps = {}): PluginResourceDraftWriter {
  const store = deps.store ?? adminCrmSetupStore()
  const orgIdForHost = deps.orgIdForHost ?? ((hostId: string) => resolveOrgIdForHost(hostId))
  const gate = createCrmSetupGate(deps)
  const scope = [ORG_SCOPE_TOKEN]
  return {
    refusal: (context) => gate(context, scope, CRM_SETUP_FIELD_SCOPE_REFUSAL),
    check: (content) => checkCrmFieldSetup(content),
    read: async ({ hostId, id }) => {
      const orgId = await orgIdForHost(hostId)
      const field = orgId ? await store.field(orgId, id) : null
      return field ? fieldRecord(field) : null
    },
    write: async (request): Promise<PluginDraftWrite> => {
      const read = readCrmFieldSetup(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const refused = await gate(request, scope, CRM_SETUP_FIELD_SCOPE_REFUSAL)
      if (refused) return { ok: false, ...refused }
      const made = await store.field(request.orgId, request.id)
      if (made) return { ok: true, replayed: true, ...fieldRecord(made) }
      const definitions = await store.fields(request.orgId)
      const plan = planCrmFieldSetup(read.value, definitions, { hostId: request.hostId, now: request.now, visibleTo: scope })
      if (plan.kind === 'refuse') return { ok: false, status: plan.status, error: plan.error }
      if (plan.kind === 'create') {
        await store.createField(request.orgId, request.id, plan.document)
        return {
          ok: true,
          replayed: false,
          ...fieldRecord({ ...(plan.document as unknown as CrmFieldDefinitionDoc), $id: request.id }),
        }
      }
      const existing = definitions.find((one) => one.$id === plan.id) as CrmFieldDefinitionDoc
      if (!plan.options.length) return { ok: true, replayed: true, ...fieldRecord(existing) }
      const options = [...(existing.options ?? []), ...plan.options]
      await store.setFieldOptions(request.orgId, plan.id, options, request.now)
      return { ok: true, replayed: false, ...fieldRecord({ ...existing, options }) }
    },
  }
}

export const crmPipelineSetupWriter = createCrmPipelineSetupWriter()
export const crmFieldSetupWriter = createCrmFieldSetupWriter()

/*==========================================
 * PICKLIST VALUES (AGL-3756)
 *=========================================*/

/** The record id a custom Choice field's values are reported under, beside a picklist's own id. */
const CUSTOM_RECORD_PREFIX = `${CRM_CUSTOM_CHOICE_LIST}:`

function picklistRecord(definition: CrmPicklistDefinition, picklist: CrmPicklist, outcome?: CrmPicklistValuesOutcome): PluginDraftRecord {
  return {
    id: definition.id,
    name: crmPicklistValuesName(definition),
    versionId: null,
    facts: {
      list: definition.id,
      values: picklist.values.filter((value) => value.active).map((value) => value.label),
      ...(outcome ?? {}),
    },
  }
}

function choiceRecord(field: CrmFieldDefinitionDoc, outcome?: CrmPicklistValuesOutcome): PluginDraftRecord {
  return {
    id: `${CUSTOM_RECORD_PREFIX}${field.$id}`,
    name: String(field.label ?? ''),
    versionId: null,
    facts: { list: CRM_CUSTOM_CHOICE_LIST, object: field.object ?? 'contact', values: field.options ?? [], ...(outcome ?? {}) },
  }
}

/**
 * The `crm-picklist-values` writer: adds values to a standard CRM picklist
 * or a custom Choice field's choices, never removing, renaming, reordering
 * or reactivating one. Gated as the Fields page is — the `crm` feature, an
 * owner, admin or editor with `data.manage` — and org-wide, as every
 * picklist and field document is. A lead source added where records
 * already hold its label files them under its group (`leadSourceDirection`),
 * as the console's route does (AGL-3577).
 */
export function createCrmPicklistValuesSetupWriter(deps: CrmSetupWriterDeps = {}): PluginResourceDraftWriter {
  const store = deps.store ?? adminCrmSetupStore()
  const orgIdForHost = deps.orgIdForHost ?? ((hostId: string) => resolveOrgIdForHost(hostId))
  const gate = createCrmSetupGate(deps)
  const scope = [ORG_SCOPE_TOKEN]
  return {
    refusal: (context) => gate(context, scope, CRM_SETUP_PICKLIST_SCOPE_REFUSAL),
    check: (content) => checkCrmPicklistValuesSetup(content),
    read: async ({ hostId, id }) => {
      const orgId = await orgIdForHost(hostId)
      if (!orgId) return null
      if (id.startsWith(CUSTOM_RECORD_PREFIX)) {
        const field = await store.field(orgId, id.slice(CUSTOM_RECORD_PREFIX.length))
        return field ? choiceRecord(field) : null
      }
      const definition = crmPicklistDefinition(id)
      if (!definition) return null
      const listId = definition.id as CrmPicklistId
      return picklistRecord(definition, effectiveCrmPicklist(listId, await store.picklist(orgId, listId)))
    },
    write: async (request): Promise<PluginDraftWrite> => {
      const read = readCrmPicklistValuesSetup(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const refused = await gate(request, scope, CRM_SETUP_PICKLIST_SCOPE_REFUSAL)
      if (refused) return { ok: false, ...refused }
      const setup = read.value

      if (setup.target.kind === 'custom') {
        const definitions = await store.fields(request.orgId)
        const plan = planCrmCustomChoiceValues({ ...setup, target: setup.target }, definitions)
        if (plan.ok === false) return { ok: false, status: plan.status, error: plan.error }
        const field = definitions.find((one) => one.$id === plan.id) as CrmFieldDefinitionDoc
        const { added, existing, inactive } = plan
        if (added.length) await store.setFieldOptions(request.orgId, plan.id, plan.options, request.now)
        return {
          ok: true,
          replayed: added.length === 0,
          ...choiceRecord({ ...field, options: plan.options }, { added, existing, inactive }),
        }
      }

      const id = setup.target.id
      const definition = crmPicklistDefinition(id) as CrmPicklistDefinition
      const planned = await store.changePicklist(
        request.orgId,
        id,
        (stored) => {
          const plan = planCrmPicklistValues(definition, effectiveCrmPicklist(id, stored), setup)
          return { write: plan.ok && plan.added.length ? plan.picklist : null, result: plan }
        },
        { hostId: request.hostId },
      )
      if (planned.ok === false) return { ok: false, status: 409, error: planned.error }
      // Records that already hold an added label take its group (AGL-3577).
      if (planned.added.length && picklistKeepsGroups(definition)) {
        for (const target of definition.targets) {
          if (!target.groupField || target.facet || target.arrayKey) continue
          for (const label of planned.added) {
            await store.regroup(request.orgId, target.object, target, label, picklistGroupOf(planned.picklist, label))
          }
        }
      }
      const { added, existing, inactive } = planned
      return { ok: true, replayed: added.length === 0, ...picklistRecord(definition, planned.picklist, { added, existing, inactive }) }
    },
  }
}

export const crmPicklistValuesSetupWriter = createCrmPicklistValuesSetupWriter()
