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
  DUPLICABLE_HOST_RESOURCE_KINDS,
  DUPLICATE_NAME_MAX,
  isDuplicableHostResourceKind,
  type DuplicableHostResourceKind,
} from '@aglyn/aglyn/app-utils/duplicate-resource'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { orgPermissionLabel } from '@aglyn/aglyn/app-utils/org-permissions'
import { duplicateResource } from '@aglyn/tenant-data-admin/server/duplicate-resource'
import {
  getOrgForUser,
  memberHasPermissionOnHost,
} from '@aglyn/tenant-data-admin/server/organizations'
import type { AiTool } from '../providers/contract'
import type { AiGateContext } from '../runtime/ai-gate'

/**
 * The `duplicate_resource` tool (AGL-2936, AGL-2984): a model that would
 * rebuild something the site already has copies it instead, through core's
 * `duplicateResource` — the same copy the row menus and the console door
 * make, with the same uniqueness rules, the same band arithmetic and the same
 * activity rows.
 *
 * It spends no tokens of its own, so it calls no provider: it runs inside a
 * door or a job step that has already climbed `aiGateLadder`, and takes that
 * ladder's context as its proof — the caller is signed in and verified, the
 * release flag, entitlement and lockdown rungs admitted the request, and the
 * workspace's band and caps admitted a reservation. On top of that it asks
 * what a copy needs whichever door called it: `ai.generate`, because a copy
 * is a generation's output, and a host role that may write the site, because
 * the copy lands there.
 *
 * DRAFTS ONLY, by construction of the copy: a screen copy has no route, a
 * workflow copy no trigger, and nothing places a component, layout or form
 * copy until a person does.
 */

export const AI_DUPLICATE_RESOURCE_TOOL_NAME = 'duplicate_resource'

/** The structured-output tool a generation offers the model. */
export const AI_DUPLICATE_RESOURCE_TOOL: AiTool = {
  name: AI_DUPLICATE_RESOURCE_TOOL_NAME,
  description:
    'Copy a resource this site already has — a screen, an email design, a component, a layout, ' +
    'a template, a form or a workflow — as a new draft to build from, instead of creating it again. ' +
    'The copy is unpublished: it has no address, runs nothing and is placed nowhere until a person does.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [...DUPLICABLE_HOST_RESOURCE_KINDS],
        description: 'The kind of resource to copy.',
      },
      sourceId: {
        type: 'string',
        description: 'The id of the resource to copy, as the site inventory lists it.',
      },
      name: {
        type: ['string', 'null'],
        description: `The copy's name, at most ${DUPLICATE_NAME_MAX} characters, or null for "Copy of" the source's name.`,
      },
    },
    required: ['kind', 'sourceId', 'name'],
    additionalProperties: false,
  },
  strict: true,
}

/** A tool call's input, read. */
export type AiDuplicateResourceInput = {
  kind: DuplicableHostResourceKind
  sourceId: string
  name: string | null
}

/** What the tool answers: the copy, or a refusal the caller can relay. */
export type AiDuplicateResourceOutcome =
  | { ok: true; kind: DuplicableHostResourceKind; id: string; versionId: string | null; name: string }
  | { ok: false; status: number; error: string }

/** Reads a tool call's input; `null` when it is not one this tool accepts. */
export function parseAiDuplicateResourceInput(
  input: Record<string, unknown>,
): AiDuplicateResourceInput | null {
  const kind = input['kind']
  const sourceId = typeof input['sourceId'] === 'string' ? input['sourceId'].trim() : ''
  const name = input['name']
  if (!isDuplicableHostResourceKind(kind)) return null
  if (!sourceId || sourceId.length > 64 || sourceId.includes('/')) return null
  if (name !== null && typeof name !== 'string') return null
  const trimmed = typeof name === 'string' ? name.trim().slice(0, DUPLICATE_NAME_MAX) : ''
  return { kind, sourceId, name: trimmed || null }
}

/**
 * Makes the copy on `hostId` for the person the gate admitted. Refusals are
 * outcomes, never throws: a model's call that names a missing source or a
 * full band is an answer to relay, not a fault.
 */
export async function runAiDuplicateResourceTool(
  context: { gate: AiGateContext; hostId: string },
  input: Record<string, unknown>,
): Promise<AiDuplicateResourceOutcome> {
  const { gate } = context
  const hostId = String(context.hostId ?? '').trim()
  const parsed = parseAiDuplicateResourceInput(input)
  if (!parsed) return { ok: false, status: 400, error: 'That is not a resource this site can copy' }
  if (!gate.reservation?.allowed) {
    return { ok: false, status: 429, error: 'This workspace cannot run AI requests right now' }
  }
  if (!hostId) return { ok: false, status: 400, error: 'Name the site to copy on' }

  const host = await gate.firestore.collection('hosts').doc(hostId).get()
  // A site of another workspace is a site this request cannot see.
  if (!host.exists || host.get('orgId') !== gate.orgId) {
    return { ok: false, status: 404, error: 'Unknown site' }
  }
  if (!gate.staff) {
    const membership = await getOrgForUser(gate.uid, gate.orgId)
    const permitted =
      membership?.orgId === gate.orgId &&
      (await memberHasPermissionOnHost(gate.orgId, hostId, membership.member, 'ai.generate'))
    if (!permitted) {
      return {
        ok: false,
        status: 403,
        error: `Your role does not include "${orgPermissionLabel('ai.generate')}" — ask an organization admin`,
      }
    }
  }
  const memberRole = ((host.get('memberRoles') ?? {}) as Record<string, unknown>)[gate.uid]
  if (!hostRoleCanWrite(memberRole)) {
    return { ok: false, status: 403, error: 'Editing requires the editor role' }
  }

  const result = await duplicateResource(parsed.kind, {
    orgId: gate.orgId,
    hostId,
    sourceId: parsed.sourceId,
    name: parsed.name,
    uid: gate.uid,
    email: gate.decoded.email ? String(gate.decoded.email) : null,
    org: gate.org as Record<string, unknown>,
    attemptKey: null,
  })
  if (result.ok === false) return result
  return {
    ok: true,
    kind: parsed.kind,
    id: result.id,
    versionId: result.versionId,
    name: result.name,
  }
}
