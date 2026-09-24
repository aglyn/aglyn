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

/**
 * TESTING ONE OF A SITE'S ACTIONS FROM THE CONSOLE (AGL-3309).
 *
 * The Actions card's Test button runs an action with an in-page trigger as
 * though the trigger had fired on the site, and says what came back. A
 * published page reaches the same engine path through `events/dispatch`,
 * which is a TENANT route — served on the site's own origin, to anonymous
 * visitors — and the console is another app on another origin whose
 * dispatcher never loads it. This is the console's door to that path, and
 * unlike the page's it knows who is asking.
 *
 * ## Who may
 *
 * A site admin or editor, read off the host's `memberRoles`, or staff. The
 * publish roles rather than the content roles, because a test run is a LIVE
 * run: its emails are sent, its webhooks posted and its rows written, as a
 * visitor's would be. An author edits and makes nothing live, and so does not
 * run automations either.
 *
 * The site's plugin switch is the dispatcher's: the request names its site as
 * a top-level `hostId`, so a site with Automation switched off has no such
 * door.
 *
 * ## What runs
 *
 * The stored action, through `runSingleActionOutcome` — the single-action path
 * a page's dispatch takes — so the switch, the conditions, the plan gate and
 * the month's run allowance are the ones a real run meets, the run is metered
 * on the site's `actionRuns`, and it lands in the action's Runs history like
 * any other. It is marked rather than simulated: see `actionTestRunPayload`.
 * When a gate stops it, the refusal names the gate, because a test that ran
 * nothing must not read as one that ran.
 *
 * Only an in-page trigger: a server event (a form submitted, an order placed)
 * carries fields no sample stands in for, and its runs come from the doors
 * that raise it.
 */

import {
  type HostAction,
  hostRoleCanPublish,
  isSiteEventType,
  type PluginApiHandler,
  planLabelGrantingFeature,
} from '@aglyn/aglyn/server'
/*
 * The MODULES, not the barrel, as for the org automation doors beside this
 * one: `@aglyn/tenant-data-admin`'s index reaches the Next render cache.
 */
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { consumeRateLimit } from '@aglyn/tenant-data-admin/server/rate-limit-store'
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import type {
  SingleActionOutcome,
  SingleActionSkip,
} from '../engine/run-event-actions'
import { actionTestRunPayload } from '../model/action-test-run'

export { ACTION_TEST_RUN_API_ROUTE } from '../model/action-test-run'

/**
 * Test runs one person may start on one site in a minute.
 *
 * Every test is a real run with real sends, so this is the feature's own
 * bucket beneath the console dispatcher's general one: a person iterating on
 * an action tests every few seconds at most, and past this is a script.
 */
export const ACTION_TEST_RUNS_PER_MINUTE = 10

const ACTION_TEST_RUN_WINDOW_MS = 60_000

/** What the door reaches outside this module; specs hand in their own. */
export interface ActionTestRunDeps {
  firestore(): FirebaseFirestore.Firestore
  verifyIdToken(token: string): Promise<{ uid: string; staff?: unknown }>
  consumeRateLimit(
    key: string,
    options: { limit: number; windowMs: number },
  ): Promise<{ allowed: boolean; resetMs: number }>
  runAction(
    hostId: string,
    actionId: string,
    event: string,
    payload: HostEventPayload,
  ): Promise<SingleActionOutcome>
  now(): number
}

function defaultDeps(): ActionTestRunDeps {
  return {
    firestore: () =>
      firebaseAdmin.app().firestore() as unknown as FirebaseFirestore.Firestore,
    verifyIdToken: async (token) => {
      const decoded = await firebaseAdmin.app().auth().verifyIdToken(token)
      return { uid: decoded.uid, staff: decoded['staff'] }
    },
    consumeRateLimit: (key, options) => consumeRateLimit(key, options),
    // Imported by the first test run rather than with the console surface,
    // as the host-event listener imports it.
    runAction: async (hostId, actionId, event, payload) => {
      const { runSingleActionOutcome } = await import('../engine/run-event-actions')
      return await runSingleActionOutcome(hostId, actionId, event, payload)
    },
    now: () => Date.now(),
  }
}

/** The bearer token a request carries, or null. */
function bearerToken(headers: Partial<Record<string, string | string[]>>): string | null {
  const authorization = String(headers['authorization'] ?? '')
  return authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length) || null
    : null
}

/** The status and words for each gate that can stop a test run. */
function refusalFor(
  skipped: SingleActionSkip,
  outcome: SingleActionOutcome,
  payload: HostEventPayload,
): { status: number; error: string } {
  switch (skipped) {
    case 'missing':
      return { status: 404, error: 'That action no longer exists' }
    case 'disabled':
      return { status: 409, error: 'Switch the action on to test it' }
    case 'event':
      return {
        status: 409,
        error: 'The action changed while it was being tested — try again',
      }
    case 'conditions':
      return {
        status: 422,
        error:
          `Nothing ran: a test run on ${String(payload['path'])} does not ` +
          'meet this action’s conditions',
      }
    case 'plan':
      return {
        status: 403,
        error:
          `Actions need the ${planLabelGrantingFeature('actions') ?? 'Pro'} ` +
          'plan — see Billing to upgrade',
      }
    case 'allowance':
      return {
        status: 402,
        error: `This site has used its ${outcome.limit} action runs for the month`,
      }
    default:
      return { status: 500, error: 'The test run could not be completed. Try again.' }
  }
}

/**
 * `automations/actions/test-run`: run one of a site's actions now.
 *
 * Body `{ hostId, actionId, payload? }`. Answers `{ ok: true, alerts }` when
 * the action's steps ran — the site alerts they produced, for the card to show
 * — and otherwise an `error` saying what stopped it.
 */
export function createActionTestRunHandler(
  overrides: Partial<ActionTestRunDeps> = {},
): PluginApiHandler {
  return async (req, res) => {
    const deps = { ...defaultDeps(), ...overrides }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const hostId = String(req.body?.hostId ?? '')
    const actionId = String(req.body?.actionId ?? '')
    if (!isDocumentId(hostId)) {
      return res.status(400).json({ error: 'Invalid hostId' })
    }
    if (!isDocumentId(actionId)) {
      return res.status(400).json({ error: 'Invalid actionId' })
    }
    const token = bearerToken(req.headers)
    if (!token) return res.status(401).json({ error: 'Unauthenticated' })

    let caller: { uid: string; staff?: unknown }
    try {
      caller = await deps.verifyIdToken(token)
    } catch (error) {
      // A refused credential is the caller's 401; a failure to check one is
      // ours and keeps a 5xx (AGL-2852).
      if (isRefusedIdToken(error)) {
        return res.status(401).json({ error: 'Unauthenticated' })
      }
      console.error('[workflows] test run could not verify the caller', error)
      return res
        .status(500)
        .json({ error: 'The sign-in could not be checked. Try again.' })
    }

    try {
      const firestore = deps.firestore()
      const hostRef = firestore.collection('hosts').doc(hostId)
      const host = await hostRef.get()
      if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
      const role = (host.get('memberRoles') ?? {})[caller.uid]
      if (caller.staff !== true && !hostRoleCanPublish(role)) {
        return res
          .status(403)
          .json({ error: 'Only a site admin or editor can test an action' })
      }

      const rate = await deps.consumeRateLimit(
        `workflows-test-run:${hostId}:${caller.uid}`,
        { limit: ACTION_TEST_RUNS_PER_MINUTE, windowMs: ACTION_TEST_RUN_WINDOW_MS },
      )
      if (!rate.allowed) {
        res.setHeader(
          'Retry-After',
          String(Math.max(1, Math.ceil((rate.resetMs - deps.now()) / 1000))),
        )
        return res
          .status(429)
          .json({ error: 'Too many test runs — wait a minute and try again' })
      }

      const stored = await hostRef.collection('actions').doc(actionId).get()
      if (!stored.exists || stored.get('deletedAt')) {
        return res.status(404).json({ error: 'That action no longer exists' })
      }
      const event = String(
        (stored.data() as HostAction | undefined)?.trigger?.event ?? '',
      )
      if (!isSiteEventType(event)) {
        return res.status(400).json({
          error: 'Only an action with an in-page trigger can be tested here',
        })
      }

      const payload = actionTestRunPayload(req.body?.payload)
      const outcome = await deps.runAction(hostId, actionId, event, payload)
      if (outcome.ran) {
        return res.status(200).json({ ok: true, alerts: outcome.alerts })
      }
      const refusal = refusalFor(outcome.skipped ?? 'failed', outcome, payload)
      return res.status(refusal.status).json({ error: refusal.error })
    } catch (error) {
      console.error('[workflows] test run failed', hostId, actionId, error)
      return res
        .status(500)
        .json({ error: 'The test run could not be completed. Try again.' })
    }
  }
}

export const actionTestRunHandler = createActionTestRunHandler()
