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
  type HostAction,
  type HostActionAlert,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  resolveTenantEntitlements,
  runWorkflow,
  sanitizeRecordValues,
} from '@aglyn/aglyn'
import {
  orgDataCollectionForHost, firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { createHmac } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { HostEventPayload } from './run-event-workflows'

/** Bounded fan-out per event, mirroring the workflow runner. */
const MAX_TRIGGERED_ACTIONS = 10

/**
 * Event-triggered action runner (AGL-148): loads enabled actions whose
 * `trigger.event` matches (built-in or custom), evaluates optional
 * filters over the payload, and executes each step list in order —
 * workflows, dataset appends, custom-event chaining (depth-capped), and
 * site alerts (returned so the emitting API can surface them in its
 * response; fire-and-forget emitters like the pageview beacon drop them).
 * Never throws into the emitting request. Paid feature: the `actions`
 * flag gates plan-holding tenants and `actionRunsPerMonth` meters runs.
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

    // Paid gate + monthly run cap (dark-launch rule: plan-less tenants
    // pass, like every other gate).
    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('actionRuns')
    const hostSnapshot = await hostRef.get()
    // Webhook steps take the higher `webhooks` gate (AGL-149); plan gates
    // ride the owning org's doc (AGL-238).
    let webhooksAllowed = true
    {
      const tenant = (await getOrgForHost(hostId))?.org
      if (tenant?.['plan']) {
        if (!checkEntitlement(tenant as any, 'actions')) return alerts
        webhooksAllowed = checkEntitlement(tenant as any, 'webhooks')
        const limit = resolveTenantEntitlements(
          tenant as any,
        ).actionRunsPerMonth
        const counterSnapshot = await runCounterRef.get()
        const used = Number(counterSnapshot.get(monthKey) ?? 0)
        if (used + actions.length > limit) return alerts
      }
    }

    // Workflow context loads lazily — most steps are alerts/appends.
    let workflowContext: {
      functions: Record<string, HostFunction>
      variables: Record<string, HostVariable>
      workflows: Record<string, HostWorkflow>
    } | null = null
    const loadWorkflowContext = async () => {
      if (workflowContext) return workflowContext
      const [functionDocs, variableDocs, workflowDocs] = await Promise.all([
        hostRef.collection('functions').limit(100).get(),
        hostRef.collection('variables').limit(100).get(),
        hostRef.collection('workflows').limit(100).get(),
      ])
      const byName = <T extends { name?: string; deletedAt?: unknown }>(
        docs: FirebaseFirestore.QueryDocumentSnapshot[],
      ) => {
        const map: Record<string, T> = {}
        for (const doc of docs) {
          const data = doc.data() as T
          if (data?.name && !data.deletedAt) map[data.name] = data
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
      executed += 1
      const stepErrors: string[] = []
      for (const step of (action.steps ?? []).slice(0, ACTION_MAX_STEPS)) {
        try {
          if (step.type === 'siteAlert') {
            alerts.push({
              message: String(step.message ?? '').slice(0, 300),
              severity: step.severity ?? 'info',
            })
          } else if (step.type === 'runWorkflow') {
            const context = await loadWorkflowContext()
            const workflow = context.workflows[step.workflowName?.trim()]
            if (!workflow) {
              stepErrors.push(`unknown workflow "${step.workflowName}"`)
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
            if (!webhooksAllowed) {
              stepErrors.push('webhooks require a Business plan')
              continue
            }
            const hooks = await hostRef
              .collection('webhooks')
              .where('name', '==', step.webhookName.trim())
              .limit(1)
              .get()
            const hook = hooks.docs[0]?.data() as HostWebhook | undefined
            if (
              !hook ||
              hooks.docs[0].get('deletedAt') ||
              hook.enabled === false ||
              hook.direction !== 'outbound' ||
              !hook.url ||
              !WEBHOOK_URL_PATTERN.test(hook.url)
            ) {
              stepErrors.push(`unknown webhook "${step.webhookName}"`)
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
              stepErrors.push(`webhook "${step.webhookName}" delivery failed`)
            }
          } else if (step.type === 'datasetAppend') {
            const datasets = await (
              await orgDataCollectionForHost(hostId, 'datasets')
            )
              .where('name', '==', step.datasetName.trim())
              .limit(1)
              .get()
            const datasetDoc = datasets.docs[0]
            if (!datasetDoc || datasetDoc.get('deletedAt')) {
              stepErrors.push(`unknown dataset "${step.datasetName}"`)
              continue
            }
            const declaredFields: string[] = Array.isArray(
              datasetDoc.get('fields'),
            )
              ? datasetDoc.get('fields')
              : []
            const values = sanitizeRecordValues(declaredFields, payload)
            if (Object.keys(values).length) {
              await datasetDoc.ref.collection('records').add({
                values,
                createdAt: FieldValue.serverTimestamp(),
              })
            }
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
          target: { type: 'workflow', id: doc.id, name: action.name ?? '' },
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
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

export default runEventActions
