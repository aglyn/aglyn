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
  ACTIONS_MAX_PER_HOST,
  hostActionDocument,
  type HostAction,
  type HostActionStep,
  type HostActionStepType,
  type HostActionTriggerCondition,
  validateHostAction,
} from '@aglyn/aglyn/app-utils/actions'
import { automationPlaceholders } from '@aglyn/aglyn/app-utils/automation-placeholders'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import {
  registerPluginResourceDraftWriter,
  type PluginDraftCheck,
  type PluginDraftRecord,
  type PluginDraftRefusal,
  type PluginDraftWrite,
  type PluginResourceDraftWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-resource-drafts'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * AN AUTOMATION ANOTHER PLUGIN ASKS FOR (AGL-2919).
 *
 * The draft writer this plugin registers for the `automation` resource on the
 * core's resource-drafts seam. A plugin that produces an automation — a
 * generator working from a description, an importer bringing flows over from
 * another tool — asks for the writer by name and gets this plugin's rules,
 * never a copy of them:
 *
 *  - THE DOCUMENT is `hosts/{hostId}/actions/{id}` in the stored shape the
 *    Actions editor saves (`hostActionDocument`), with only the fields each
 *    step type holds. It is listed on the Automation page's Actions, opens in
 *    that editor, and runs through the same executor as one a person made.
 *  - IT IS OFF. A draft is written `enabled: false` whatever the caller sent,
 *    so nothing it describes runs until a person switches it on.
 *  - THE SCHEMA is the editor's own validator, `validateHostAction`, which the
 *    executor's writers share. A placeholder the draft could not fill — a
 *    bracketed list name, a bracketed condition value — passes it, because it
 *    is a value a person replaces, and the facts name every one.
 *  - THE ROOM is the flat platform cap on live actions, counted inside the
 *    transaction with the arithmetic `/api/hosts/resources` uses.
 *  - THE ROLE is the resources route's: a member who may write the site's
 *    content. THE PLAN is the Actions editor's: the `actions` entitlement.
 *
 * Nothing is enabled, sent or run, and the writer touches the one new document.
 */

type Firestore = FirebaseFirestore.Firestore

/** The resource name this writer is registered under. */
export const AUTOMATION_DRAFT_RESOURCE = 'automation'

/** The longest name the Actions editor stores. */
export const AUTOMATION_DRAFT_NAME_MAX_CHARS = 60

/** A draft's name when the caller asks for none. */
export const AUTOMATION_DRAFT_DEFAULT_NAME = 'New automation'

/** The resources route's refusal for a member who may not write the site. */
export const AUTOMATION_DRAFT_ROLE_REFUSAL = 'Editing requires the editor role'

/** What a person is told when their plan has no actions builder. It names the page that sells one. */
export const AUTOMATION_DRAFT_PLAN_REFUSAL =
  'Automations are not included on this workspace’s plan. Upgrade in Billing to build them.'

/** The resources route's refusal at the cap. */
export const AUTOMATION_DRAFT_LIMIT_REFUSAL =
  `interactions and actions are capped at ${ACTIONS_MAX_PER_HOST} per site — ` +
  'delete some to make room'

/** A trigger bound to one element, which makes an action an interaction of its page. */
const LEAF_SELECTOR = /^\[data-aglyn="leaf:.+"\]$/

/**
 * The fields each step type holds, besides `type` and the step's own `when`.
 * Total over the step types, so a type the model gains is a compile error here
 * until its fields are named, rather than a draft that silently drops them.
 */
export const AUTOMATION_STEP_FIELDS: Readonly<Record<HostActionStepType, readonly string[]>> = {
  runWorkflow: ['workflowId', 'workflowName'],
  siteAlert: ['message', 'severity'],
  customEvent: ['eventName'],
  datasetAppend: ['datasetId', 'datasetName'],
  webhookPost: ['webhookId', 'webhookName'],
  showOverlay: ['overlayId', 'overlayName'],
  stickyNav: ['selector'],
  addClass: ['selector', 'className'],
  removeClass: ['selector', 'className'],
  toggleClass: ['selector', 'className'],
  showElement: ['selector', 'delayMs', 'dismissOn'],
  hideElement: ['selector', 'delayMs'],
  toggleElement: ['selector', 'delayMs', 'dismissOn'],
  setAttribute: ['selector', 'name', 'value'],
  removeAttribute: ['selector', 'name'],
  scrollTo: ['selector', 'behavior', 'offsetPx'],
  playVideo: ['selector'],
  openDrawer: ['drawerNodeId'],
  closeDrawer: ['drawerNodeId'],
  toggleDrawer: ['drawerNodeId'],
  openMenu: ['menuNodeId'],
  closeMenu: ['menuNodeId'],
  toggleMenu: ['menuNodeId'],
  showHtml: ['html'],
  runJs: ['code'],
  redirect: ['url', 'screenId'],
  trackGaEvent: ['eventName', 'params'],
  sendEmail: ['subject', 'body', 'toField', 'topicId'],
  notifyAdmins: ['title', 'body'],
  enrollList: ['listId', 'listName'],
  updateDataset: ['datasetId', 'datasetName'],
  assignCampaign: ['campaignId', 'campaignName'],
  wait: ['delayMinutes'],
  waitForEvent: ['eventName', 'timeoutMinutes'],
  exitFlow: [],
  setContactStage: ['lifecycleStage'],
  addContactTag: ['tag'],
  assignContactOwner: ['ownerUid', 'ownerEmail', 'roundRobin'],
  createCrmTask: ['title', 'kind', 'dueInDays', 'assigneeUid', 'assigneeEmail'],
  logCrmActivity: ['kind', 'body'],
}

/** The trigger keys an automation stores. */
const TRIGGER_FIELDS = [
  'event',
  'filter',
  'conditions',
  'combinator',
  'selector',
  'threshold',
  'pathPattern',
  'oncePerVisitor',
  'oncePerSession',
  'cooldownMinutes',
  'everyTime',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The keys of `source` that `keys` names and that hold something. */
function picked(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key]
  }
  return out
}

function conditionOf(value: unknown): HostActionTriggerCondition | null {
  if (!isRecord(value)) return null
  return picked(value, ['field', 'op', 'value']) as unknown as HostActionTriggerCondition
}

export type AutomationDraftContentRead =
  | { ok: true; action: HostAction }
  | { ok: false; problems: string[] }

/**
 * What a caller sends as `content` — `{ action }` — read into the action this
 * writer would store: the trigger's and each step's own fields and nothing
 * else, named, OFF, and held to the editor's validator.
 */
export function readAutomationDraftContent(
  content: Readonly<Record<string, unknown>>,
): AutomationDraftContentRead {
  const raw = content['action']
  if (!isRecord(raw)) return { ok: false, problems: ['The draft holds no automation'] }
  const trigger = raw['trigger']
  const steps = raw['steps']
  if (!isRecord(trigger)) return { ok: false, problems: ['Pick a trigger event'] }
  if (!Array.isArray(steps)) return { ok: false, problems: ['Add at least one step'] }
  const problems: string[] = []
  const knownTypes = new Set(Object.keys(AUTOMATION_STEP_FIELDS))
  const cleanSteps: HostActionStep[] = []
  steps.forEach((step, index) => {
    const type = isRecord(step) ? step['type'] : undefined
    if (typeof type !== 'string' || !knownTypes.has(type)) {
      problems.push(`Step ${index + 1}: not a step the Actions editor offers`)
      return
    }
    const source = step as Record<string, unknown>
    const when = isRecord(source['when'])
      ? {
          conditions: (Array.isArray(source['when']['conditions']) ? source['when']['conditions'] : [])
            .map(conditionOf)
            .filter((clause): clause is HostActionTriggerCondition => clause !== null),
          ...(typeof source['when']['combinator'] === 'string'
            ? { combinator: source['when']['combinator'] }
            : {}),
        }
      : null
    cleanSteps.push({
      type,
      ...picked(source, AUTOMATION_STEP_FIELDS[type as HostActionStepType]),
      ...(when && when.conditions.length ? { when } : {}),
    } as HostActionStep)
  })
  const cleanTrigger = picked(trigger, TRIGGER_FIELDS)
  if (Array.isArray(cleanTrigger['conditions'])) {
    cleanTrigger['conditions'] = (cleanTrigger['conditions'] as unknown[])
      .map(conditionOf)
      .filter((clause): clause is HostActionTriggerCondition => clause !== null)
  }
  // An element's own interaction belongs to the page that holds the element,
  // and is authored there; the Actions list does not show one.
  if (typeof cleanTrigger['selector'] === 'string' && LEAF_SELECTOR.test(cleanTrigger['selector'])) {
    problems.push('An interaction on one element is set up on that element, not as an automation')
  }
  const name = String(raw['name'] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AUTOMATION_DRAFT_NAME_MAX_CHARS)
  const action: HostAction = {
    name: name || AUTOMATION_DRAFT_DEFAULT_NAME,
    trigger: cleanTrigger as unknown as HostAction['trigger'],
    steps: cleanSteps,
    enabled: false,
  }
  const invalid = validateHostAction(action)
  if (invalid) problems.push(invalid)
  return problems.length ? { ok: false, problems } : { ok: true, action }
}

/** What the writer reports about an automation beyond its identity. */
function factsOf(action: Pick<HostAction, 'trigger' | 'steps' | 'enabled'>): Record<string, unknown> {
  return {
    event: action.trigger?.event ?? '',
    steps: (action.steps ?? []).length,
    enabled: action.enabled === true,
    placeholders: automationPlaceholders(action).length,
  }
}

/** Whether content is an automation this site could store: well-formed, off, and valid. */
export function checkAutomationDraftContent(
  content: Readonly<Record<string, unknown>>,
): PluginDraftCheck {
  const read = readAutomationDraftContent(content)
  return read.ok === false ? read : { ok: true, facts: factsOf(read.action) }
}

function recordOf(snapshot: FirebaseFirestore.DocumentSnapshot): PluginDraftRecord {
  const data = (snapshot.data() ?? {}) as HostAction
  return {
    id: snapshot.id,
    name: String(data.name ?? ''),
    versionId: null,
    facts: factsOf(data),
  }
}

function roleRefusal(host: FirebaseFirestore.DocumentSnapshot, uid: string): PluginDraftRefusal | null {
  const role = (host.get('memberRoles') ?? {})[uid]
  return hostRoleCanWrite(role) ? null : { status: 403, error: AUTOMATION_DRAFT_ROLE_REFUSAL }
}

function planRefusal(org: Readonly<Record<string, unknown>> | null): PluginDraftRefusal | null {
  return checkEntitlement(org as Partial<AglynOrgBilling> | null, 'actions')
    ? null
    : { status: 403, error: AUTOMATION_DRAFT_PLAN_REFUSAL }
}

/** The live actions the site holds: a soft-deleted one frees its slot. */
function liveCount(rows: FirebaseFirestore.QuerySnapshot): number {
  return rows.docs.filter((row) => row.get('deletedAt') == null).length
}

function roomRefusal(live: number): PluginDraftRefusal | null {
  return live >= ACTIONS_MAX_PER_HOST ? { status: 403, error: AUTOMATION_DRAFT_LIMIT_REFUSAL } : null
}

export interface AutomationDraftWriterDeps {
  /** The Admin SDK handle; specs hand in a double. */
  firestore?: () => Firestore
}

export function createAutomationDraftWriter(
  deps: AutomationDraftWriterDeps = {},
): PluginResourceDraftWriter {
  const firestore = deps.firestore ?? (() => firebaseAdmin.app().firestore() as unknown as Firestore)
  return {
    refusal: async (context) => {
      const hostRef = firestore().collection('hosts').doc(context.hostId)
      const host = await hostRef.get()
      if (!host.exists) return { status: 404, error: 'Unknown site' }
      return (
        roleRefusal(host, context.uid) ??
        planRefusal(context.org) ??
        roomRefusal(liveCount(await hostRef.collection('actions').select('deletedAt').get()))
      )
    },

    check: (content) => checkAutomationDraftContent(content),

    read: async ({ hostId, id }) => {
      const snapshot = await firestore().collection('hosts').doc(hostId).collection('actions').doc(id).get()
      return snapshot.exists ? recordOf(snapshot) : null
    },

    write: async (request): Promise<PluginDraftWrite> => {
      const read = readAutomationDraftContent(request.content)
      if (read.ok === false) return { ok: false, status: 400, error: read.problems[0] }
      const db = firestore()
      const hostRef = db.collection('hosts').doc(request.hostId)
      const actionRef = hostRef.collection('actions').doc(request.id)
      const name =
        String(request.name ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, AUTOMATION_DRAFT_NAME_MAX_CHARS) || read.action.name
      const action: HostAction = { ...read.action, name, enabled: false, recipe: null }
      return db.runTransaction(async (tx): Promise<PluginDraftWrite> => {
        // Every read before any write, which Firestore requires.
        const [host, existing, rows] = await Promise.all([
          tx.get(hostRef),
          tx.get(actionRef),
          tx.get(hostRef.collection('actions').select('deletedAt')),
        ])
        if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
        if (existing.exists) return { ok: true, replayed: true, ...recordOf(existing) }
        const refusal =
          roleRefusal(host, request.uid) ?? planRefusal(request.org) ?? roomRefusal(liveCount(rows))
        if (refusal) return { ok: false, ...refusal }
        tx.create(actionRef, {
          ...hostActionDocument(action),
          createdAt: request.now,
          updatedAt: request.now,
          createdBy: request.uid,
        })
        return { ok: true, replayed: false, id: request.id, name, versionId: null, facts: factsOf(action) }
      })
    },
  }
}

export const automationDraftWriter = createAutomationDraftWriter()

/**
 * Registers the writer; the console surface calls it, since only the console
 * runs AI jobs (AGL-3026). Idempotent: a second call replaces the first.
 */
export function registerAutomationDraftWriter(): void {
  registerPluginResourceDraftWriter(AUTOMATION_DRAFT_RESOURCE, automationDraftWriter, {
    pluginId: BUNDLE_ID,
  })
}
