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
  ACTION_MAX_EVENT_DEPTH,
  ACTION_MAX_STEPS,
  checkEntitlement,
  type HostWebhook,
  WEBHOOK_URL_PATTERN,
  evaluateExpression,
  evaluateTriggerConditions,
  isClientActionStep,
  type HostAction,
  type HostActionAlert,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  buildDatasetRecordValues,
  resolveOrgEntitlements,
  runWorkflow,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  notifyHostManagers,
  orgDataCollectionForHost,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { createHmac } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { resolveDatasetDoc } from './resolve-dataset'
import type { HostEventPayload } from './run-event-workflows'

/** Bounded fan-out per event, mirroring the workflow runner. */
const MAX_TRIGGERED_ACTIONS = 10

interface ActionRunEnv {
  hostId: string
  hostRef: FirebaseFirestore.DocumentReference
  alerts: HostActionAlert[]
  webhooksAllowed: boolean
  depth: number
  loadWorkflowContext: () => Promise<{
    functions: Record<string, HostFunction>
    variables: Record<string, HostVariable>
    workflows: Record<string, HostWorkflow>
  }>
}

function makeWorkflowContextLoader(
  hostRef: FirebaseFirestore.DocumentReference,
) {
  let workflowContext: Awaited<
    ReturnType<ActionRunEnv['loadWorkflowContext']>
  > | null = null
  return async () => {
    if (workflowContext) return workflowContext
    const [functionDocs, variableDocs, workflowDocs] = await Promise.all([
      hostRef.collection('functions').limit(100).get(),
      hostRef.collection('variables').limit(100).get(),
      hostRef.collection('workflows').limit(100).get(),
    ])
    // Double-keyed by doc id AND name (AGL-261): id references are
    // rename-safe; legacy name references keep resolving.
    const byName = <T extends { name?: string; deletedAt?: unknown }>(
      docs: FirebaseFirestore.QueryDocumentSnapshot[],
    ) => {
      const map: Record<string, T> = {}
      for (const doc of docs) {
        const data = doc.data() as T
        if (data.deletedAt) continue
        map[doc.id] = data
        if (data?.name) map[data.name] = data
      }
      return map
    }
    workflowContext = {
      functions: byName<HostFunction>(functionDocs.docs),
      variables: byName<HostVariable>(variableDocs.docs),
      workflows: byName<HostWorkflow>(workflowDocs.docs),
    }
    return workflowContext
  }
}

/**
 * Executes one action's SERVER steps in order, collecting per-step errors
 * into the activity summary. Client-side steps (AGL-257) are skipped —
 * the tenant page runtime runs those in the visitor's browser.
 */
async function executeAction(
  env: ActionRunEnv,
  actionId: string,
  action: HostAction,
  event: string,
  payload: HostEventPayload,
): Promise<void> {
  const { hostId, hostRef, alerts, depth } = env
  const stepErrors: string[] = []
  for (const step of (action.steps ?? []).slice(0, ACTION_MAX_STEPS)) {
    try {
      if (isClientActionStep(step) && step.type !== 'siteAlert') {
        continue // Runs in the visitor's page (AGL-257).
      }
      if (step.type === 'siteAlert') {
        alerts.push({
          message: String(step.message ?? '').slice(0, 300),
          severity: step.severity ?? 'info',
        })
      } else if (step.type === 'runWorkflow') {
        const context = await env.loadWorkflowContext()
        const workflow =
          context.workflows[step.workflowId?.trim() ?? ''] ??
          context.workflows[step.workflowName?.trim() ?? '']
        if (!workflow) {
          stepErrors.push(
            `unknown workflow "${step.workflowName || step.workflowId}"`,
          )
          continue
        }
        const run = runWorkflow(
          workflow,
          context.functions,
          context.variables,
          { event, ...payload },
          { workflows: context.workflows },
        )
        if (run.ok === false) stepErrors.push(run.error)
      } else if (step.type === 'customEvent') {
        const nested = await runEventActions(
          hostId,
          step.eventName.trim(),
          payload,
          depth + 1,
        )
        alerts.push(...nested)
      } else if (step.type === 'webhookPost') {
        if (!env.webhooksAllowed) {
          stepErrors.push('webhooks require a Business plan')
          continue
        }
        // Id-first lookup (AGL-261); the name query is the legacy path.
        const hookDoc = step.webhookId?.trim()
          ? await hostRef
              .collection('webhooks')
              .doc(step.webhookId.trim())
              .get()
          : (
              await hostRef
                .collection('webhooks')
                .where('name', '==', step.webhookName?.trim() ?? '')
                .limit(1)
                .get()
            ).docs[0]
        const hook = hookDoc?.exists
          ? (hookDoc.data() as HostWebhook)
          : undefined
        if (
          !hook ||
          hookDoc.get('deletedAt') ||
          hook.enabled === false ||
          hook.direction !== 'outbound' ||
          !hook.url ||
          !WEBHOOK_URL_PATTERN.test(hook.url)
        ) {
          stepErrors.push(
            `unknown webhook "${step.webhookName || step.webhookId}"`,
          )
          continue
        }
        const body = JSON.stringify({
          event,
          payload,
          sentAt: new Date().toISOString(),
        })
        const signature = hook.secret
          ? createHmac('sha256', hook.secret).update(body).digest('hex')
          : ''
        // Two quick retries — serverless-friendly; longer retry queues
        // are a follow-up.
        let delivered = false
        for (let attempt = 0; attempt < 3 && !delivered; attempt += 1) {
          try {
            const response = await fetch(hook.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(signature && { 'X-Aglyn-Signature': signature }),
              },
              body,
              signal: AbortSignal.timeout(5000),
            })
            delivered = response.ok
          } catch {
            // Retry below.
          }
          if (!delivered && attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, 500 * (attempt + 1)),
            )
          }
        }
        if (!delivered) {
          stepErrors.push(
            `webhook "${step.webhookName || step.webhookId}" delivery failed`,
          )
        }
      } else if (step.type === 'datasetAppend') {
        // Id-first lookup (AGL-261/556); the name query is the legacy path.
        const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
        const datasetDoc = await resolveDatasetDoc(datasetsRef, step)
        if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
          stepErrors.push(
            `unknown dataset "${step.datasetName || step.datasetId}"`,
          )
          continue
        }
        // Restrict to the model's field ids (AGL-556) — covers model-only
        // datasets whose flat v1 `fields` mirror is absent.
        const values = buildDatasetRecordValues(
          {
            model: datasetDoc.get('model'),
            fields: Array.isArray(datasetDoc.get('fields'))
              ? datasetDoc.get('fields')
              : [],
          },
          payload,
        )
        if (Object.keys(values).length) {
          await datasetDoc.ref.collection('records').add({
            values,
            createdAt: FieldValue.serverTimestamp(),
          })
        }
      } else if (step.type === 'updateDataset') {
        // Update-or-append (AGL-257): matches the record whose `email`
        // field equals the payload's email; appends when nothing matches.
        const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
        const datasetDoc = await resolveDatasetDoc(datasetsRef, step)
        if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
          stepErrors.push(
            `unknown dataset "${step.datasetName || step.datasetId}"`,
          )
          continue
        }
        const values = buildDatasetRecordValues(
          {
            model: datasetDoc.get('model'),
            fields: Array.isArray(datasetDoc.get('fields'))
              ? datasetDoc.get('fields')
              : [],
          },
          payload,
        )
        if (!Object.keys(values).length) continue
        const email = String((payload as any).email ?? '').trim()
        const existing = email
          ? await datasetDoc.ref
              .collection('records')
              .where('values.email', '==', email)
              .limit(1)
              .get()
          : null
        if (existing && !existing.empty) {
          const merged = {
            ...(existing.docs[0].get('values') ?? {}),
            ...values,
          }
          await existing.docs[0].ref.set(
            { values: merged, updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          )
        } else {
          await datasetDoc.ref.collection('records').add({
            values,
            createdAt: FieldValue.serverTimestamp(),
          })
        }
      } else if (step.type === 'notifyAdmins') {
        await notifyHostManagers(hostId, {
          type: 'system.announcement',
          title: String(step.title ?? '').slice(0, 200),
          ...(step.body ? { body: String(step.body).slice(0, 500) } : {}),
          link: `/${hostId}`,
        })
      } else if (step.type === 'sendEmail') {
        const resendKey = process.env.RESEND_API_KEY
        const from = process.env.USAGE_EMAIL_FROM
        const to = String(
          (payload as any)[step.toField?.trim() || 'email'] ?? '',
        ).trim()
        if (!resendKey || !from) {
          stepErrors.push('email is not configured')
          continue
        }
        if (!to || !to.includes('@')) {
          stepErrors.push('no recipient email in the event payload')
          continue
        }
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject: String(step.subject ?? '').slice(0, 200),
            text: String(step.body ?? '').slice(0, 5000),
          }),
        })
        if (!response.ok) stepErrors.push('email delivery failed')
      } else if (step.type === 'enrollList') {
        const orgId = await resolveOrgIdForHost(hostId)
        const email = String((payload as any).email ?? '')
          .trim()
          .toLowerCase()
        if (!orgId || !email || !email.includes('@')) {
          stepErrors.push('no email to enroll')
          continue
        }
        const listsRef = firebaseAdmin
          .app()
          .firestore()
          .collection('orgs')
          .doc(orgId)
          .collection('lists')
        const listDoc = step.listId?.trim()
          ? await listsRef.doc(step.listId.trim()).get()
          : (
              await listsRef
                .where('name', '==', step.listName?.trim() ?? '')
                .limit(1)
                .get()
            ).docs[0]
        if (!listDoc?.exists) {
          stepErrors.push(`unknown list "${step.listName || step.listId}"`)
          continue
        }
        const memberId = createHmac('sha256', 'aglyn-list-member')
          .update(email)
          .digest('hex')
          .slice(0, 20)
        await listDoc.ref.collection('members').doc(memberId).set(
          {
            email,
            addedAt: FieldValue.serverTimestamp(),
            source: `action:${actionId}`,
          },
          { merge: true },
        )
      } else if (step.type === 'assignCampaign') {
        const email = String((payload as any).email ?? '')
          .trim()
          .toLowerCase()
        if (!email || !email.includes('@')) {
          stepErrors.push('no contact email to assign')
          continue
        }
        const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
        const contact = (
          await contactsRef.where('email', '==', email).limit(1).get()
        ).docs[0]
        if (!contact) {
          stepErrors.push(`no contact for ${email}`)
          continue
        }
        await contact.ref.set(
          {
            campaigns: FieldValue.arrayUnion(
              step.campaignId?.trim() || step.campaignName?.trim() || '',
            ),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      }
    } catch (error) {
      stepErrors.push((error as Error).message)
    }
  }
  const summary = stepErrors.length
    ? `Action ran on ${event} with errors: ${stepErrors.join('; ')}`.slice(
        0,
        300,
      )
    : `Action ran on ${event}`
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      action: summary,
      target: { type: 'workflow', id: actionId, name: action.name ?? '' },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
}

/**
 * Event-triggered action runner (AGL-148): loads enabled actions whose
 * `trigger.event` matches (built-in, site event, or custom), evaluates
 * optional filters over the payload, and executes each step list in
 * order. Never throws into the emitting request. Paid feature: the
 * `actions` flag gates and `actionRunsPerMonth` meters runs.
 */
export async function runEventActions(
  hostId: string,
  event: string,
  payload: HostEventPayload = {},
  depth = 0,
): Promise<HostActionAlert[]> {
  const alerts: HostActionAlert[] = []
  if (depth > ACTION_MAX_EVENT_DEPTH) return alerts
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const triggered = await hostRef
      .collection('actions')
      .where('trigger.event', '==', event)
      .limit(MAX_TRIGGERED_ACTIONS)
      .get()
    const actions = triggered.docs.filter(
      (doc) => !doc.get('deletedAt') && doc.get('enabled') !== false,
    )
    if (!actions.length) return alerts

    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('actionRuns')
    // Webhook steps take the higher `webhooks` gate (AGL-149); plan gates
    // ride the owning org's doc (AGL-238).
    let webhooksAllowed = true
    {
      // Plan-less orgs resolve as free (AGL-247) — gates always run.
      const org = (await getOrgForHost(hostId))?.org
      if (!checkEntitlement(org as any, 'actions')) return alerts
      webhooksAllowed = checkEntitlement(org as any, 'webhooks')
      const limit = resolveOrgEntitlements(
        org as any,
      ).actionRunsPerMonth
      const counterSnapshot = await runCounterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      if (used + actions.length > limit) return alerts
    }

    const env: ActionRunEnv = {
      hostId,
      hostRef,
      alerts,
      webhooksAllowed,
      depth,
      loadWorkflowContext: makeWorkflowContextLoader(hostRef),
    }

    let executed = 0
    for (const doc of actions) {
      const action = doc.data() as HostAction
      const filter = action.trigger?.filter?.trim()
      if (filter) {
        try {
          if (!evaluateExpression(filter, { event, ...payload })) continue
        } catch {
          continue // A broken filter never fires.
        }
      }
      // Structured payload conditions (AGL-557; AND/OR chaining AGL-565):
      // same scope as the filter; unmet conditions skip the action (and
      // never count as a run).
      if (!evaluateTriggerConditions(action.trigger, { event, ...payload })) {
        continue
      }
      executed += 1
      await executeAction(env, doc.id, action, event, payload)
    }
    if (executed > 0) {
      await runCounterRef
        .set({ [monthKey]: FieldValue.increment(executed) }, { merge: true })
        .catch(() => undefined)
    }
  } catch (error) {
    console.error('runEventActions failed', hostId, event, error)
  }
  return alerts
}

/**
 * Runs ONE action's server steps (AGL-256): the tenant page runtime
 * evaluates site-event trigger conditions (scroll thresholds, selectors)
 * client-side and dispatches the specific action here — re-matching by
 * event name would wrongly fire sibling actions with different
 * thresholds. Same gates and metering as the event runner.
 */
export async function runSingleAction(
  hostId: string,
  actionId: string,
  event: string,
  payload: HostEventPayload = {},
): Promise<HostActionAlert[]> {
  const alerts: HostActionAlert[] = []
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const doc = await hostRef.collection('actions').doc(actionId).get()
    if (!doc.exists || doc.get('deletedAt') || doc.get('enabled') === false) {
      return alerts
    }
    const action = doc.data() as HostAction
    // Only site-event actions may be dispatched externally — server
    // events flow through their own emitters.
    if (String(action.trigger?.event ?? '') !== String(event)) return alerts
    // Structured payload conditions (AGL-557; AND/OR chaining AGL-565):
    // the single-action dispatch path honors them too, so
    // client-evaluated triggers can't bypass them.
    if (!evaluateTriggerConditions(action.trigger, { event, ...payload })) {
      return alerts
    }

    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('actionRuns')
    let webhooksAllowed = true
    {
      const org = (await getOrgForHost(hostId))?.org
      if (!checkEntitlement(org as any, 'actions')) return alerts
      webhooksAllowed = checkEntitlement(org as any, 'webhooks')
      const limit = resolveOrgEntitlements(
        org as any,
      ).actionRunsPerMonth
      const counterSnapshot = await runCounterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      if (used + 1 > limit) return alerts
    }

    const env: ActionRunEnv = {
      hostId,
      hostRef,
      alerts,
      webhooksAllowed,
      depth: 0,
      loadWorkflowContext: makeWorkflowContextLoader(hostRef),
    }
    await executeAction(env, doc.id, action, event, payload)
    await runCounterRef
      .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
      .catch(() => undefined)
  } catch (error) {
    console.error('runSingleAction failed', hostId, actionId, error)
  }
  return alerts
}

export default runEventActions
