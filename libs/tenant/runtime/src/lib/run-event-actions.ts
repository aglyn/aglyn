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
  checkQuota,
  type HostWebhook,
  WEBHOOK_URL_PATTERN,
  evaluateExpression,
  evaluateStepGuard,
  evaluateTriggerConditions,
  FLOW_TIMED_OUT_FIELD,
  hostPublicOrigin,
  isClientActionStep,
  isFlowSuspendingStep,
  type HostAction,
  type HostActionAlert,
  type HostActionStep,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  buildDatasetRecordValues,
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  describeStepOutcome,
  effectiveDatasetModel,
  normalizeTriggerConditions,
  type PluginJobHostGate,
  resolveOrgEntitlements,
  runWorkflow,
} from '@aglyn/aglyn/server'
import {
  isDeferrableSendResult,
  isEmailConfigured,
  sendEmail,
  sendFailureReason,
} from '@aglyn/shared-util-email'
import {
  dataStorageRefusal,
  enrollListMember,
  firebaseAdmin,
  flowEmailRefusal,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
  notifyHostManagers,
  orgDataCollectionForHost,
  orgDataQueryForHost,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { createHmac } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import {
  advanceFlowEnrollment,
  claimFlowEnrollment,
  deferFlowEnrollment,
  endFlowEnrollment,
  enrollInFlow,
  findFlowEnrollmentsAwaiting,
  type FlowEnrollment,
  type FlowSweepCursor,
  type FlowSweepResult,
  sweepDueFlowEnrollments,
} from './flow-enrollments'
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
  /**
   * The owning org's billing doc, already read by the entitlement gate that
   * admitted this run, and the org's id beside it.
   *
   * Carried rather than re-read: both entry points resolve `getOrgForHost`
   * before they build this, so the dataset caps below cost no extra org read.
   * Null only when the host has no resolvable org, which the gate treats as
   * the free plan.
   */
  org: unknown
  orgId: string | null
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
 * Whether this dataset may take ANOTHER record, on the plan of the org that
 * owns the site — the row band and the byte band, in that order. Null when
 * the append may proceed; a reason string when it may not.
 *
 * ## Why an append needs a gate at all
 *
 * Every other door onto `datasets/{id}/records` already has one: the console
 * route re-checks `recordsPerDataset` inside the creating transaction, the
 * `/v1` record route checks it below its idempotency claim, and the public
 * form-submission leg checks the rows and the bytes. A workflow step wrote
 * with no check of either — and it is the door a visitor drives hardest,
 * because an action fires per event on a published site. A cap enforced at
 * three of four doors is not a cap; it is the shape of the one that is left.
 *
 * ## What it does NOT do
 *
 * It refuses the WRITE, never the dataset. A dataset already holding more
 * rows than the plan includes keeps every row it has and keeps being read —
 * nothing here deletes, truncates, or hides anything, and nothing may be
 * added that does. What is refused is the next row, which is the same
 * boundary the other three doors draw, and the reason a plan change cannot
 * cost a customer data they already have.
 *
 * The update leg of `updateDataset` is deliberately NOT gated: merging fields
 * into a record that already exists adds no row, so refusing it would refuse
 * the state of being over rather than the raise.
 *
 * ## What it costs
 *
 * Nothing on the plans that sell the data store. The row count is read only
 * when `recordsPerDataset` is FINITE, so an uncapped plan pays nothing; and
 * `dataStorageRefusal` answers null with no read at all whenever the plan
 * carries an `extraDataGbMonthlyUsd` rate, which every metered plan does. The
 * reads are paid on the shapes that can actually refuse.
 */
async function datasetAppendRefusal(
  env: ActionRunEnv,
  datasetRef: FirebaseFirestore.DocumentReference,
): Promise<string | null> {
  const limit = resolveOrgEntitlements(env.org as never).recordsPerDataset
  if (Number.isFinite(limit)) {
    const used = (
      await datasetRef.collection('records').count().get()
    ).data().count
    if (!checkQuota(env.org as never, 'recordsPerDataset', used).allowed) {
      return `dataset is full (${limit} records on this plan)`
    }
  }
  if (!env.orgId) return null
  const bytes = await dataStorageRefusal(
    env.org as never,
    firebaseAdmin.app().firestore().collection('orgs').doc(env.orgId),
  )
  if (!bytes) return null
  return `dataset storage is full (${bytes.includedMb} MB on this plan)`
}

/** How a run of an action's step list ended. */
type ActionRunEnding = 'ran' | 'waiting' | 'exited' | 'deferred'

interface ExecuteActionOptions {
  /**
   * The step to start at. Non-zero only on a resume, where it is the
   * enrollment's `nextStepIndex`.
   */
  startIndex?: number
  /**
   * The step list to run.
   *
   * A resume passes the enrollment's SNAPSHOT rather than the action's
   * current steps — see `FlowEnrollment.steps` for why a position in a list
   * is meaningless against a list that has since been edited.
   */
  steps?: readonly HostActionStep[]
  /**
   * The enrollment this run belongs to. Present only on a resume; a first run
   * mints one if it reaches a wait.
   */
  enrollmentRef?: FirebaseFirestore.DocumentReference | null
}

/**
 * Executes one action's SERVER steps in order, collecting per-step errors
 * into the activity summary. Client-side steps (AGL-257) are skipped —
 * the tenant page runtime runs those in the visitor's browser.
 *
 * A `wait` step ENDS this call and hands the rest of the list to the job
 * beat: everything after the wait belongs to a run that has not happened yet,
 * so nothing below the wait may execute in this request.
 */
async function executeAction(
  env: ActionRunEnv,
  actionId: string,
  action: HostAction,
  event: string,
  payload: HostEventPayload,
  options: ExecuteActionOptions = {},
): Promise<ActionRunEnding> {
  const { hostId, hostRef, alerts, depth } = env
  const enrollmentRef = options.enrollmentRef ?? null
  const steps = (options.steps ?? action.steps ?? []).slice(0, ACTION_MAX_STEPS)
  const startIndex = Math.max(0, options.startIndex ?? 0)
  let ending: ActionRunEnding = 'ran'
  const stepErrors: string[] = []
  /**
   * What each step actually DID (AGL-2171). Only failures were recorded,
   * so a run that sent an email, wrote a row and posted a webhook logged
   * the same eight words as a run that did nothing — and
   * `/product/workflows` advertises a `What happened` column reading
   * `Sent email · saved to Leads · webhook 200`.
   */
  const outcomes: string[] = []
  const scope = { event, ...payload }
  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index] as HostActionStep
    const errorsBefore = stepErrors.length
    /** False for a step this run never attempted. */
    let attempted = false
    /**
     * The one fact worth carrying into the summary — the dataset's name,
     * the webhook's status. Set by the branch that knows it.
     */
    let detail: string | undefined
    try {
      /*
       * BRANCHING INSIDE A FLOW: the step's own condition, evaluated against
       * the same scope the trigger's is. An unmet guard skips this step and
       * only this step — the run continues, which is what makes "wait three
       * days, then, only if they have not ordered, send the reminder" a thing
       * an author can write without a second action.
       */
      if (!evaluateStepGuard(step.when, scope)) continue
      if (isClientActionStep(step) && step.type !== 'siteAlert') {
        continue // Runs in the visitor's page (AGL-257).
      }
      if (step.type === 'exitFlow') {
        ending = 'exited'
        outcomes.push(describeStepOutcome(step.type))
        break
      }
      if (isFlowSuspendingStep(step)) {
        const suspended = await suspendFlow(env, actionId, action, {
          step,
          steps,
          nextStepIndex: index + 1,
          event,
          payload,
          enrollmentRef,
        })
        if (suspended.error) {
          stepErrors.push(suspended.error)
          break
        }
        ending = 'waiting'
        outcomes.push(describeStepOutcome(step.type, suspended.detail))
        break
      }
      attempted = true
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
        let lastStatus: number | undefined
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
            lastStatus = response.status
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
        } else {
          // The status the mockup prints — discarded on the line it
          // arrived until AGL-2171. A 200 and a 204 are both `ok`, and
          // knowing which is the whole reason anyone opens a run history
          // after a webhook.
          detail = String(lastStatus ?? '')
        }
      } else if (step.type === 'datasetAppend') {
        // Id-first lookup (AGL-261/556); the name query is the legacy path.
        const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
        const datasetDoc = await resolveDatasetDoc(datasetsRef, step, hostId)
        if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
          stepErrors.push(
            `unknown dataset "${step.datasetName || step.datasetId}"`,
          )
          continue
        }
        // Restrict to the model's field ids (AGL-556) — covers model-only
        // datasets whose flat v1 `fields` mirror is absent.
        const appendDataset = {
          model: datasetDoc.get('model'),
          fields: Array.isArray(datasetDoc.get('fields'))
            ? datasetDoc.get('fields')
            : [],
        }
        const values = buildDatasetRecordValues(appendDataset, payload)
        if (Object.keys(values).length) {
          const refusal = await datasetAppendRefusal(env, datasetDoc.ref)
          if (refusal) {
            stepErrors.push(refusal)
            continue
          }
          await datasetDoc.ref.collection('records').add({
            values,
            // The integrity index the console's delete check queries —
            // carried by every write that sets `values`, or the index
            // describes rows this one never held.
            ...datasetIntegrityFields(
              effectiveDatasetModel(appendDataset),
              values,
            ),
            createdAt: FieldValue.serverTimestamp(),
          })
          // `saved to Leads` beats `saved to dataset` (AGL-2171). Same
          // name precedence `findDatasetByName` resolves in.
          detail = String(
            datasetDoc.get('displayName') ??
              datasetDoc.get('name') ??
              step.datasetName ??
              '',
          ).slice(0, 60)
        }
      } else if (step.type === 'updateDataset') {
        // Update-or-append (AGL-257): matches the record whose `email`
        // field equals the payload's email; appends when nothing matches.
        const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
        const datasetDoc = await resolveDatasetDoc(datasetsRef, step, hostId)
        if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
          stepErrors.push(
            `unknown dataset "${step.datasetName || step.datasetId}"`,
          )
          continue
        }
        const updateDataset = {
          model: datasetDoc.get('model'),
          fields: Array.isArray(datasetDoc.get('fields'))
            ? datasetDoc.get('fields')
            : [],
        }
        const updateModel = effectiveDatasetModel(updateDataset)
        const values = buildDatasetRecordValues(updateDataset, payload)
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
            {
              values: merged,
              // The merging form: an update that clears the last reference
              // has to REMOVE the index rather than omit it, or a stale
              // array refuses a delete nothing is holding.
              ...datasetIntegrityUpdate(
                updateModel,
                merged,
                FieldValue.delete(),
              ),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
        } else {
          // The APPEND leg of update-or-append, and the only one of the two
          // that adds a row — the merge above rewrites a record that already
          // counts against the band.
          const refusal = await datasetAppendRefusal(env, datasetDoc.ref)
          if (refusal) {
            stepErrors.push(refusal)
            continue
          }
          await datasetDoc.ref.collection('records').add({
            values,
            ...datasetIntegrityFields(updateModel, values),
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
        const to = String(
          (payload as any)[step.toField?.trim() || 'email'] ?? '',
        ).trim()
        if (!isEmailConfigured()) {
          stepErrors.push('email is not configured')
          continue
        }
        if (!to || !to.includes('@')) {
          stepErrors.push('no recipient email in the event payload')
          continue
        }
        // The site's own origin, for the unsubscribe link. Read here rather
        // than carried on the run env because most action runs send no email
        // at all, and a document read every workflow pays for is a read on
        // the hot path for a link nine runs in ten never need.
        const siteBase =
          hostPublicOrigin(
            (await hostRef.get().catch(() => null))?.data() as never,
          ) ?? ''
        /*
         * MARKETING. The subject and body are merchant-authored and the
         * recipient comes out of the event payload — which, for the collect
         * route, is a write triggered by an anonymous visitor. So this is a
         * site mailing an address on the merchant's say-so, and it owes what
         * every other such message owes: the unsubscribe header pair and a
         * visible link, both suppression lists, and a share of the ceiling on
         * how much one person receives from this site.
         *
         * Priority stays transactional. An action run is not resumable — the
         * event has already happened and there is no beat that comes back for
         * it — and the rule on `'bulk'` is that only a resumable sweep may
         * refuse in a way the recipient survives.
         *
         * A merchant who wants an internal alert that no suppression can stop
         * uses the `notifyAdmins` step beside this one: it reaches managers
         * in the console rather than the shared sending domain, which is the
         * right instrument for a notification nobody consented to receive.
         */
        /*
         * A STEP THAT RUNS AFTER A WAIT IS A CAMPAIGN, not a reply.
         *
         * The paragraph above is exactly right about an IMMEDIATE step: the
         * event has already happened, the recipient just did something, and
         * the message is the response to it. None of that survives a three-day
         * delay. Everything after a wait goes out on the merchant's schedule,
         * to somebody who did one thing once — which is `marketing-send.ts`'s
         * own definition of marketing mail, and it earns the two gates a
         * campaign passes and an immediate reply does not: the consent split
         * and the topic filter.
         *
         * Refused BEFORE `sendEmail` rather than inside it, because these two
         * are the merchant's own policy over their own audience, where the
         * three the seam asks are platform controls over the shared sending
         * domain. Both refusals are permanent for this message, so the
         * enrollment moves on rather than retrying.
         */
        if (enrollmentRef) {
          const gate = await flowEmailRefusal({
            hostId,
            email: to,
            topicId: step.topicId ?? null,
            org: env.org,
          })
          if (gate) {
            stepErrors.push(
              gate === 'consent-withheld'
                ? 'the recipient has no marketing consent record on this site'
                : 'the recipient has left this email topic',
            )
            continue
          }
        }
        const result = await sendEmail({
          to,
          subject: String(step.subject ?? '').slice(0, 200),
          text: String(step.body ?? '').slice(0, 5000),
          sendingIdentity: await hostSendingIdentity(hostId),
          audience: 'tenant',
          context: enrollmentRef ? 'flow step' : 'event action',
          /*
           * A resumed step may take `'bulk'` where an immediate one may not,
           * and the reason is the same one the abandoned-checkout sweep gives:
           * only a RESUMABLE sender may be refused in a way the recipient
           * survives. The enrollment is the thing that makes it resumable —
           * a deferral below leaves the row waiting and the next beat sends
           * the same step to the same person.
           */
          ...(enrollmentRef ? { priority: 'bulk' as const } : {}),
          marketing: { hostId, siteBase },
        })
        /*
         * DEFERRED IS NOT FAILED, and it is not SENT either.
         *
         * The platform's hourly ceiling and this person's own frequency window
         * are both refusals a later beat can pass. Advancing past this step
         * would turn "not this hour" into an email nobody ever receives, which
         * is the defect the campaign processor and the cart sweep each name.
         * So the enrollment is put back with the SAME `nextStepIndex` and the
         * run ends here.
         */
        if (enrollmentRef && isDeferrableSendResult(result)) {
          ending = 'deferred'
          break
        }
        // Named rather than lumped into "delivery failed": a suppression and
        // a frequency ceiling are the controls working, and a merchant
        // reading the run's alerts has a different thing to do about each.
        const refusal = sendFailureReason(result)
        if (refusal) {
          stepErrors.push(
            refusal === 'suppressed'
              ? 'the recipient is unsubscribed or suppressed'
              : refusal === 'frequency-capped'
                ? 'the recipient has already had today’s limit of email ' +
                  'from this site'
                : 'email delivery failed',
          )
        }
        // Cost meter (AGL-1438). A workflow notification is transactional:
        // counted, never capped. `sent` is false when Resend refused or the
        // environment is unconfigured, and an email that never left is not a
        // cost.
        if (result.sent) await meterHostEmail(hostId)
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
        // `enrollListMember` owns the document id: the commerce newsletter
        // handler enrolls into the same collection, and an id derived here
        // would be a second answer to which document describes which person.
        await enrollListMember({
          listRef: listDoc.ref,
          email,
          source: `action:${actionId}`,
        })
      } else if (step.type === 'assignCampaign') {
        const email = String((payload as any).email ?? '')
          .trim()
          .toLowerCase()
        if (!email || !email.includes('@')) {
          stepErrors.push('no contact email to assign')
          continue
        }
        // Scoped to this host (AGL-1039): a site must not reach a contact
        // it cannot see, even to tag it onto a campaign.
        const { query: contactsQuery } = await orgDataQueryForHost(
          hostId,
          'contacts',
        )
        const contact = (
          await contactsQuery.where('email', '==', email).limit(1).get()
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
    } finally {
      // A step that added no error of its own did what it said. `finally`
      // rather than the end of the try block because every failure branch
      // above reaches its error with `continue`, which would skip a plain
      // trailing statement while still counting as a success.
      if (attempted && stepErrors.length === errorsBefore) {
        outcomes.push(describeStepOutcome(step.type, detail))
      }
    }
  }
  /*
   * A DEFERRED run writes no history line and leaves the enrollment where it
   * was. Nothing happened that a merchant should read as a run: the step is
   * still ahead of this person, and a row per refused beat would bury the
   * runs that did something under a log of the ceiling working.
   */
  if (ending === 'deferred') return ending
  const summary = stepErrors.length
    ? `Action ran on ${event} with errors: ${stepErrors.join('; ')}`.slice(
        0,
        300,
      )
    : ending === 'waiting'
      ? `Action is waiting, on ${event}`
      : `Action ran on ${event}`
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      // The prose line stays exactly as it was: `activityPrimaryText` and
      // three other renderers read it, and the run table is not the only
      // thing this collection feeds.
      action: summary,
      // The structured half (AGL-2171) — the two columns the advertised
      // run-history table could not otherwise fill.
      result: stepErrors.length ? 'failed' : 'succeeded',
      trigger: event,
      summary: (outcomes.length ? outcomes.join(' · ') : 'Ran').slice(0, 300),
      target: { type: 'workflow', id: actionId, name: action.name ?? '' },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
  return ending
}

/**
 * Suspends the run at a `wait` or `waitForEvent` step.
 *
 * One function for both the first suspension and every later one, because the
 * two differ only in whether a row already exists — and writing "create here,
 * update there" twice is how the two drift into disagreeing about which
 * fields a waiting enrollment carries.
 */
async function suspendFlow(
  env: ActionRunEnv,
  actionId: string,
  action: HostAction,
  request: {
    step: HostActionStep
    steps: readonly HostActionStep[]
    nextStepIndex: number
    event: string
    payload: HostEventPayload
    enrollmentRef: FirebaseFirestore.DocumentReference | null
  },
): Promise<{ error?: string; detail?: string }> {
  const { step } = request
  const minutes =
    step.type === 'wait'
      ? Number(step.delayMinutes)
      : step.type === 'waitForEvent'
        ? Number(step.timeoutMinutes)
        : 0
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { error: 'the wait has no duration' }
  }
  const nowMs = Date.now()
  const resumeAtMs = nowMs + minutes * 60_000
  const awaitingEvent =
    step.type === 'waitForEvent' ? step.eventName.trim() : null
  const detail =
    step.type === 'waitForEvent'
      ? `${awaitingEvent} (up to ${minutes}m)`
      : `${minutes}m`

  if (request.enrollmentRef) {
    await advanceFlowEnrollment(
      request.enrollmentRef,
      {
        nextStepIndex: request.nextStepIndex,
        resumeAtMs,
        awaitingEvent,
        payload: request.payload as Record<string, unknown>,
      },
      nowMs,
    )
    return { detail }
  }

  const enrolled = await enrollInFlow({
    hostId: env.hostId,
    actionId,
    // The SNAPSHOT is the list this run is executing, which on a first run is
    // the action's own — so an action edited later cannot move this person's
    // remaining steps out from under them.
    action: { name: action.name ?? '', steps: [...request.steps] },
    email: String((request.payload as any)?.['email'] ?? ''),
    event: request.event,
    payload: (request.payload ?? {}) as Record<string, unknown>,
    nextStepIndex: request.nextStepIndex,
    resumeAtMs,
    awaitingEvent,
    nowMs,
  })
  if (enrolled.enrolled === true) return { detail }
  /*
   * Both refusals are stated rather than swallowed, because both are things
   * an author can act on: a flow that waits needs an address in its trigger
   * payload, and a person already inside this flow is not put through it
   * twice concurrently.
   */
  return {
    error:
      enrolled.reason === 'no-person'
        ? 'a flow that waits needs the person’s email in the event payload'
        : 'this person is already waiting inside this flow',
  }
}

/**
 * Events too frequent to log a skip for.
 *
 * `runEventActions` fires on EVERY page view of every published site. A
 * Firestore write per visitor per non-matching action is not a run
 * history, it is an outage — and a page-view condition is one an author
 * tunes by watching the site, not by reading a log. The events people
 * actually debug are the server-emitted ones (a form submission, a
 * booking, a sign-up), and those are low-volume by construction.
 */
const SKIP_LOG_EXCLUDED_EVENTS = new Set(['pageView'])

/**
 * Writes the `Skipped` row (AGL-2171): which condition stopped the run,
 * so the answer to "why didn't it fire?" is in the same place as every
 * run that did.
 *
 * Never counts against `actionRunsPerMonth` — nothing executed, and
 * charging for a condition that said no would be its own bug.
 */
async function recordSkippedRun(
  hostRef: FirebaseFirestore.DocumentReference,
  actionId: string,
  action: HostAction,
  event: string,
): Promise<void> {
  if (SKIP_LOG_EXCLUDED_EVENTS.has(event)) return
  // `normalizeTriggerConditions`, not `trigger.conditions` — a pre-AGL-565
  // action carries a single `condition` and reading only the array would
  // give every one of them the nameless fallback.
  const named = normalizeTriggerConditions(action.trigger)
    .map((condition) => String(condition?.field ?? '').trim())
    .filter(Boolean)
  const reason = named.length
    ? `Condition on ${named.slice(0, 3).join(', ')} not met`
    : 'Trigger condition not met'
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      action: `Action skipped on ${event}`,
      result: 'skipped',
      trigger: event,
      summary: reason.slice(0, 300),
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
  /*
   * A flow waiting for THIS event, for THIS person, resumes here.
   *
   * Above the action lookup and outside its try, because the two are
   * unrelated: an event that matches no action can still be the one a flow
   * has been waiting a week for, and a site with no actions at all can hold
   * enrollments from an action that has since been rewritten.
   */
  await wakeFlowsAwaitingEvent(hostId, event, payload).catch(() => undefined)
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
    // Plan-less orgs resolve as free (AGL-247) — gates always run. Held for
    // the rest of the run so the dataset caps below cost no second read.
    const owner = await getOrgForHost(hostId)
    {
      const org = owner?.org
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
      org: owner?.org ?? null,
      orgId: owner?.orgId ?? null,
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
      // same scope as the filter; unmet conditions skip the action and
      // never count as a run against the quota.
      if (!evaluateTriggerConditions(action.trigger, { event, ...payload })) {
        // …but they are RECORDED now (AGL-2171). This was a bare
        // `continue`, so "why didn't my automation fire?" — the most
        // common support question about automations — had no answer
        // anywhere in the product, while `/product/workflows` advertises
        // an amber `Skipped` row that answers it.
        await recordSkippedRun(hostRef, doc.id, action, event)
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
    // Held for the rest of the run, as in `runEventActions` above.
    const owner = await getOrgForHost(hostId)
    {
      const org = owner?.org
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
      org: owner?.org ?? null,
      orgId: owner?.orgId ?? null,
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

/**
 * Continues one enrollment from where its wait ended.
 *
 * The enrollment carries everything the run needs except the gates: the step
 * list it entered with, the position inside it, the payload the trigger
 * produced, and who it is about. What it deliberately does NOT carry is
 * permission — the `actions` entitlement, the site's lockdown and the
 * action's own enabled flag are all re-asked here, because a flow that waits
 * three days is a flow that can outlive the plan, the site and the merchant's
 * decision to run it.
 */
export async function resumeFlowEnrollment(
  enrollment: FlowEnrollment,
  ref: FirebaseFirestore.DocumentReference,
  options?: { timedOut?: boolean; nowMs?: number },
): Promise<'ran' | 'waiting' | 'exited' | 'deferred' | 'stopped'> {
  const nowMs = options?.nowMs ?? Date.now()
  const hostId = enrollment.hostId
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)

  const stop = async (reason: string) => {
    await endFlowEnrollment(ref)
    await hostRef
      .collection('activity')
      .add({
        actorId: null,
        actorEmail: null,
        action: `Flow stopped mid-wait: ${reason}`.slice(0, 300),
        result: 'skipped',
        trigger: enrollment.event,
        summary: reason.slice(0, 300),
        target: {
          type: 'workflow',
          id: enrollment.actionId,
          name: enrollment.actionName ?? '',
        },
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)
    return 'stopped' as const
  }

  const doc = await hostRef
    .collection('actions')
    .doc(enrollment.actionId)
    .get()
    .catch(() => null)
  /*
   * A KILL SWITCH HAS TO KILL, including for the people already inside.
   *
   * Editing a flow leaves an enrollment alone — it runs the snapshot it
   * entered with. DELETING or DISABLING one does not: "off" that keeps mailing
   * the queue for the next three days is not off, and it is the control a
   * merchant reaches for when a flow is doing something wrong. So the two
   * cases are deliberately different, and this is the one that stops.
   */
  if (!doc?.exists || doc.get('deletedAt') || doc.get('enabled') === false) {
    return await stop('the automation was turned off or deleted')
  }
  const action = doc.data() as HostAction
  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!checkEntitlement(owner?.org as any, 'actions')) {
    return await stop('this site’s plan no longer includes automations')
  }

  const env: ActionRunEnv = {
    hostId,
    hostRef,
    alerts: [],
    webhooksAllowed: checkEntitlement(owner?.org as any, 'webhooks'),
    depth: 0,
    org: owner?.org ?? null,
    orgId: owner?.orgId ?? null,
    loadWorkflowContext: makeWorkflowContextLoader(hostRef),
  }

  const payload: HostEventPayload = {
    ...(enrollment.payload ?? {}),
    // The timeout BRANCH. A `waitForEvent` resumes either way, and this is
    // the one field that says which — so the step after it carries a `when`
    // naming it, and the author gets a timeout path with no nested step list.
    ...(options?.timedOut ? { [FLOW_TIMED_OUT_FIELD]: true } : {}),
  }

  const ending = await executeAction(
    env,
    enrollment.actionId,
    action,
    enrollment.event,
    payload,
    {
      startIndex: enrollment.nextStepIndex,
      steps: enrollment.steps,
      enrollmentRef: ref,
    },
  )

  if (ending === 'deferred') {
    /*
     * Pushed a beat down the queue rather than retried immediately: the two
     * refusals that reach here are an hour-long platform ceiling and a
     * day-long per-person window, so retrying in sixty seconds would spend a
     * read to be told the same thing sixty more times.
     */
    await deferFlowEnrollment(ref, nowMs + FLOW_CLAIM_RETRY_MS, nowMs)
    return ending
  }
  if (ending !== 'waiting') await endFlowEnrollment(ref)

  /*
   * COUNTED, NEVER REFUSED.
   *
   * A resume is real work and belongs on the run meter, so the usage card and
   * the COGS rollup see it. It is not GATED on `actionRunsPerMonth` the way a
   * new run is, because the person is already inside the flow: refusing here
   * would abandon somebody half-way through a sequence, which is a capacity
   * limit enforced against a person rather than against the decision that
   * added them. The gate belongs at enrollment, and that is where it is.
   */
  const monthKey = new Date(nowMs).toISOString().slice(0, 7)
  await hostRef
    .collection('counters')
    .doc('actionRuns')
    .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
    .catch(() => undefined)
  return ending
}

/** How long a deferred enrollment waits before the next attempt. */
const FLOW_CLAIM_RETRY_MS = 15 * 60_000

/**
 * The job beat's entry point: resume every flow whose wait has ended.
 *
 * Thin on purpose. The scheduling contract — due-ness, the transactional
 * claim, the scan budget, the lockdown skip — is `sweepDueFlowEnrollments`,
 * and the work is `resumeFlowEnrollment`; this is the wire between them, so
 * neither has to import the other's dependencies to be tested.
 */
export async function runDueFlowEnrollments(
  gate: PluginJobHostGate,
  options?: {
    nowMs?: number
    scanBudget?: number
    cursor?: FlowSweepCursor | null
  },
): Promise<FlowSweepResult> {
  return await sweepDueFlowEnrollments(gate, {
    ...(options?.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    ...(options?.scanBudget !== undefined
      ? { scanBudget: options.scanBudget }
      : {}),
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    resume: async (enrollment, ref) => {
      await resumeFlowEnrollment(enrollment, ref, {
        // Reaching the sweep IS the timeout for a `waitForEvent`: the event
        // it was watching for never arrived before `resumeAtMs`. A plain
        // `wait` has no timeout to report, so the flag rides the presence of
        // an awaited event rather than the fact of being swept.
        timedOut: Boolean(enrollment.awaitingEvent),
        ...(options?.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      })
    },
  })
}

/**
 * Wakes the flows this person's event was being waited for.
 *
 * NOT A POLL. Nothing here scans the enrolled population asking whose turn it
 * is — the event arrives already naming a person, and the lookup is three
 * equality filters against that person's key. A site with ten thousand people
 * waiting costs the same as one with ten.
 *
 * The COST GUARD is the caller's, and it is why this takes an email rather
 * than reading one: `runEventActions` fires on every page view of every
 * published site, so it asks only for events that name a person. A page view
 * does not, and pays nothing.
 */
async function wakeFlowsAwaitingEvent(
  hostId: string,
  event: string,
  payload: HostEventPayload,
): Promise<void> {
  const email = String((payload as any)?.['email'] ?? '').trim()
  if (!email || !email.includes('@')) return
  const waiting = await findFlowEnrollmentsAwaiting({ hostId, event, email })
  for (const doc of waiting) {
    const claimed = await claimFlowEnrollment(doc.ref).catch(() => null)
    if (!claimed) continue
    try {
      /*
       * The awaited event ARRIVED, so this is not the timeout branch — and
       * the arriving payload joins the carried one, so a step after the wait
       * can read the order total the flow was waiting for.
       */
      await resumeFlowEnrollment(
        {
          ...claimed,
          payload: { ...(claimed.payload ?? {}), ...(payload ?? {}) },
        },
        doc.ref,
        { timedOut: false },
      )
    } catch (error) {
      console.error('[flow] event wake failed', doc.ref.path, error)
      await deferFlowEnrollment(doc.ref, Date.now() + FLOW_CLAIM_RETRY_MS)
    }
  }
}

export default runEventActions
