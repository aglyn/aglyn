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

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  aiPermissionRefusal,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  memberHasAiPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { aiUsageMonthKeys } from '../model/ai-usage-by-user'
import { AI_STEP_TIERS, type AiStepKind } from '../providers/catalog'
import { aiModelOptions } from '../providers/model-choice'
import { aiProviderReady } from '../runtime/ai-runtime'
import { readAiAllotmentGate } from '../usage/ai-allotments'
import { readMeasuredStepUsage } from '../usage/ai-model-sample'

// lockdown-423: exempt — a READ-ONLY listing of what the model switch
// offers; it spends nothing and writes nothing, and every door the pick is
// then sent to carries its own lockdown rung.

/**
 * THE MODEL SWITCH'S OPTIONS (AGL-2942): `GET ?orgId=&hostId=&kind=`.
 *
 * What the selector in the panel and the generation dialogs lists for one
 * step kind: Auto — labeled with the model the routing table sends that kind
 * to under the caller's bounds — and the models a manual pick may name, each
 * with its credits per typical request and its multiple of Auto.
 *
 * Read when the switch is OPENED, never on a panel's mount, and bounded to
 * the reads the answer needs: the org's plan (the membership read already
 * returns the org), the allotment allowlists that apply to the caller on the
 * site, and a bounded page of the workspace's own signals for the measured
 * median. The door the pick is sent to decides again, inside its own
 * reservation, so this list is a courtesy the server does not trust.
 *
 * Gated on `ai.use` on the caller's axis — the switch is part of using AI.
 */

const json = (body: unknown, status: number) => Response.json(body, { status })

const STEP_KINDS = Object.keys(AI_STEP_TIERS) as AiStepKind[]

async function handler(request: Request): Promise<Response> {
  const { method, query, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)
  const params = (query ?? {}) as Record<string, unknown>
  const orgId = String(params['orgId'] ?? '').trim()
  const hostId = String(params['hostId'] ?? '').trim()
  const kind = String(params['kind'] ?? '') as AiStepKind
  if (!orgId) return json({ error: 'Missing orgId' }, 400)
  if (!STEP_KINDS.includes(kind)) {
    return json({ error: `kind must be one of ${STEP_KINDS.join(', ')}` }, 400)
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const staff = decoded['staff'] === true
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    if (!membership && !staff) return json({ error: 'Not found' }, 404)
    if (
      !staff &&
      !(await memberHasAiPermission(orgId, hostId, membership?.member, 'ai.use'))
    ) {
      return aiPermissionRefusal('ai.use')
    }
    if (!aiProviderReady()) {
      return json({ kind, auto: null, options: [], measured: false }, 200)
    }

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const month = aiUsageMonthKeys()[0]
    const [orgSnapshot, gate, measured] = await Promise.all([
      orgRef.get(),
      readAiAllotmentGate((ref) => ref.get(), orgRef, { uid: decoded.uid, hostId }, month),
      readMeasuredStepUsage(firestore, orgId, kind).catch(() => null),
    ])
    const org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
    const listed = aiModelOptions(
      kind,
      {
        plan: resolveEffectivePlan(org as never),
        allotmentModels: gate?.models ?? null,
        orgModels: gate?.orgModels ?? null,
      },
      measured,
    )
    return Response.json(
      {
        kind,
        auto: listed?.auto ?? null,
        options: listed?.options ?? [],
        measured: listed?.measured ?? false,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store, private' } },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/models] failed', orgId, error)
    return json({ error: 'AI models unavailable' }, 500)
  }
}

export { handler as GET }
