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
import { CRM_COLLECTIONS, crmReadTokens, crmScopeTokens } from '@aglyn/aglyn/app-utils/crm'
import { memberCanSee } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
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
import { FieldPath } from 'firebase-admin/firestore'
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
    facts: { object: field.object ?? 'contact', key: field.key, type: field.type, ...(field.options ? { options: field.options } : {}) },
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
