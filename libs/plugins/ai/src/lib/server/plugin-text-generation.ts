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

import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  normalizePluginTextGenerationPurpose,
  registerPluginTextGenerator,
  type PluginTextGenerationRefusal,
  type PluginTextGenerationRequest,
  type PluginTextGenerationResult,
  type PluginTextGenerator,
} from '@aglyn/aglyn/plugin-manager/plugin-text-generation'
import { checkEntitlement } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { featureLockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import {
  getOrgForUser,
  memberHasPermissionOnHost,
} from '@aglyn/tenant-data-admin/server/organizations'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { AI_PLUGIN_ID } from '../constants'
import { AI_JOB_TEXT_STEP_BUDGET } from '../jobs/ai-job-text-step'
import { aiJobRefusalText } from '../jobs/ai-jobs'
import { AI_OFF_FOR_SITE_COPY, isAiOffForSite } from '../model/ai-site-switch'
import { resolveAiModelChoice } from '../providers/model-choice'
import { AI_ROUTING_TABLE } from '../providers/routing'
import { aiProviderReady, runAiRequest, type AiSystemBlock } from '../runtime/ai-runtime'
import type { PluginAiUsageKind } from '../model/ai-usage-by-user'
import { recordUserAiRefusal } from '../usage/ai-usage-by-user'
import {
  recordAssistCost,
  releaseAssistMessage,
  reserveAssistMessage,
  type AssistReservation,
} from '../usage/assist-usage'

/**
 * THIS PLUGIN AS THE WORKSPACE'S TEXT GENERATOR (AGL-3324), on the core's
 * text-generation seam.
 *
 * Another plugin in the process — Sequences drafting one person's email —
 * asks for text without importing this plugin, and gets it under the rules
 * the generation doors apply, in the order the gate ladder applies them:
 *
 *   404  the generative release flag is off for the org (staff preview through it)
 *   403  the member's role lacks `ai.generate`, on the site named
 *   403  the plan does not include generation
 *   423  the feature is paused — the platform's kill switch, or the workspace's
 *   4xx  the site named has AI switched off
 *   ---  the reservation, which fails CLOSED and refuses with the sentence
 *        every door gives — a spent allotment names who can raise it
 *
 * A request that got through is one provider call at the `job.text` route's
 * model — the member's own pick never applies here, since the caller's UI
 * has no model switch — metered on the org's month, the person's month and
 * the purpose the caller named, exactly as a text job is. The provider is
 * never reached without a reservation, and a call that never reached it
 * hands the reservation back.
 *
 * The seam authenticates nobody: the caller has already verified who is
 * asking and that the org is theirs, which is why the token verifier and the
 * rate window are the caller's rungs, not these.
 */

/** The rate the ledger files a seam call under, beside the doors' routes. */
export const AI_TEXT_GENERATION_ROUTE = 'ai/text-generation'

/** The route's own answer ceiling, the same table row the text job reads. */
const TEXT_ROUTE = AI_ROUTING_TABLE['job.text']

const refusal = (
  status: number,
  reason: PluginTextGenerationRefusal['reason'],
  error: string,
): PluginTextGenerationRefusal => ({ ok: false, status, reason, error })

/** A `Response` a platform helper refused with, read into the seam's shape. */
async function refusedResponse(
  response: Response,
  reason: PluginTextGenerationRefusal['reason'],
  fallback: string,
): Promise<PluginTextGenerationRefusal> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null
  const error = typeof body?.error === 'string' && body.error ? body.error : fallback
  return refusal(response.status, reason, error)
}

/** The system block the seam sends: the caller's instructions, cached as a prefix. */
export function aiTextGenerationSystem(system: string): AiSystemBlock[] {
  return [{ text: system, cacheBreakpoint: true }]
}

/** The generator, with its reads named so a spec can hand in fakes. */
export function createAiTextGenerator(deps: {
  firestore(): FirebaseFirestore.Firestore
  now(): Date
} = { firestore: () => firebaseAdmin.app().firestore(), now: () => new Date() }): PluginTextGenerator {
  return {
    async generate(request: PluginTextGenerationRequest): Promise<PluginTextGenerationResult> {
      const orgId = request.orgId.trim()
      const uid = request.uid.trim()
      if (!orgId || !uid) return refusal(400, 'failed', 'Name the workspace and the member the text is for.')
      const staff = request.staff === true
      const now = request.now ?? deps.now()

      // The flag closes the door, not just the UI: a released-off feature
      // does not exist, and nothing below is disclosed while it is off.
      if (!staff && !(await isServerReleaseFlagOnForOrg('release_ai_generative', orgId))) {
        return refusal(404, 'unavailable', 'AI drafting is not available to this workspace yet.')
      }
      if (!aiProviderReady()) {
        return refusal(503, 'unavailable', 'AI drafting is temporarily unavailable.')
      }

      const resolved = await getOrgForUser(uid, orgId)
      if (!resolved || resolved.orgId !== orgId) {
        return refusal(403, 'permission', 'You are not a member of that organization.')
      }
      const org = (request.org ?? resolved.org ?? {}) as Record<string, unknown>
      if (!staff && !(await memberHasPermissionOnHost(orgId, request.hostId, resolved.member, 'ai.generate'))) {
        return refusal(403, 'permission', 'Your role does not include Generate with AI — ask an organization admin.')
      }
      if (!checkEntitlement(org, 'aiGenerative')) {
        return refusal(403, 'entitlement', "This workspace's plan does not include AI drafting.")
      }
      const paused = await featureLockdownRefusal({ feature: 'ai-generate', staff, orgId, nowMs: now.getTime() })
      if (paused) return refusedResponse(paused, 'off', 'AI drafting is paused.')
      const firestore = deps.firestore()
      if (await isAiOffForSite(firestore, org, request.hostId)) {
        return refusal(403, 'off', AI_OFF_FOR_SITE_COPY)
      }

      // RESERVED before a token is spent, on the member's allotments for the
      // site named, so N concurrent asks cannot all read "under the cap".
      let reservation: AssistReservation
      try {
        reservation = await reserveAssistMessage(firestore, orgId, true, now, org, {
          uid,
          hostId: request.hostId ?? null,
        })
      } catch (error) {
        console.error('ai text-generation reservation failed', { orgId, error })
        return refusal(503, 'failed', 'AI drafting is temporarily unavailable.')
      }
      recordUserAiRefusal(firestore, orgId, uid, reservation)
      if (!reservation.allowed) {
        return refusal(
          reservation.refusedBy === 'cap' ? 402 : 429,
          'quota',
          aiJobRefusalText(org, reservation),
        )
      }

      const choice = resolveAiModelChoice('job.text', null, {
        plan: resolveEffectivePlan(org),
        allotmentModels: reservation.allotment?.models ?? null,
        orgModels: reservation.allotment?.orgModels ?? null,
      })
      if (!choice) {
        await releaseAssistMessage(firestore, orgId, reservation).catch(() => undefined)
        return refusal(503, 'unavailable', 'AI drafting is temporarily unavailable.')
      }
      const model = choice.model
      const ceiling = AI_JOB_TEXT_STEP_BUDGET.maxTokens(model)
      const maxTokens =
        typeof request.maxTokens === 'number' && request.maxTokens > 0
          ? Math.min(Math.floor(request.maxTokens), ceiling)
          : ceiling
      const purpose = normalizePluginTextGenerationPurpose(request.purpose)
      // The ledger's kind for a plugin's purpose: hyphenated, so it never
      // collides with a job kind or an assist mode.
      const kind: PluginAiUsageKind = purpose.includes('-') ? (purpose as PluginAiUsageKind) : `plugin-${purpose}`

      let result: Awaited<ReturnType<typeof runAiRequest>>
      try {
        result = await runAiRequest({
          model,
          system: aiTextGenerationSystem(request.system),
          messages: [{ role: 'user', content: request.prompt }],
          maxTokens,
          ...(TEXT_ROUTE.thinking ? { thinking: TEXT_ROUTE.thinking } : {}),
          ...(TEXT_ROUTE.effort ? { effort: TEXT_ROUTE.effort } : {}),
          stream: false,
          ...(request.signal ? { signal: request.signal } : {}),
        })
      } catch (error) {
        // The provider was never reached, or answered nothing: no usage came
        // back, so nothing is metered and the message goes back to the org.
        await releaseAssistMessage(firestore, orgId, reservation).catch((releaseError) =>
          console.error('ai text-generation release failed', { orgId, releaseError }),
        )
        console.error('ai text-generation failed', { orgId, purpose, error })
        return refusal(503, 'failed', 'The draft could not be written just now. Try again.')
      }

      // Tokens were spent, so the bill is written first and its failure is a
      // log line, never a refusal — the rule every door keeps.
      try {
        await recordAssistCost(
          firestore,
          orgId,
          {
            route: AI_TEXT_GENERATION_ROUTE,
            hostId: request.hostId ?? null,
            model,
            tier: 'entitled',
            usage: result.usage,
            docsPaths: [],
            stopReason: result.stopReason,
            deflected: false,
            free: reservation.free ?? null,
            uid,
            kind,
          },
          now,
        )
      } catch (error) {
        console.error('ai text-generation cost record failed', { orgId, purpose, error })
      }
      if (result.kind === 'refusal') {
        return refusal(422, 'refused', 'The model declined to write this draft.')
      }
      return {
        ok: true,
        text: result.text.trim(),
        model,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
      }
    },
  }
}

/** Registers this plugin as the workspace's text generator; idempotent for this plugin. */
export function registerAiTextGenerator(generator: PluginTextGenerator = createAiTextGenerator()): void {
  registerPluginTextGenerator(generator, { pluginId: AI_PLUGIN_ID })
}
