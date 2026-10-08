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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { ApiErrors, apiJson, listResponse } from '@aglyn/tenant-data-admin/server/api-http'
import { configuredUrlRefusal, describeConfiguredUrlRefusal } from '@aglyn/tenant-data-admin/server/configured-url-fetch'
import type { ApiV1Context } from '@aglyn/tenant-data-admin/server/api-v1-kit'
import { ZAPIER_HOOK_HOSTS, ZAPIER_MAX_HOOKS_PER_SITE } from '../constants'
import { readZapierHookEvents, zapierHookEventSpec, type ZapierHookEvent } from '../model/hook-events'
import { type ZapierHook, type ZapierHookStore, zapierHookView } from './store'

/**
 * `/v1/sites/{siteId}/hooks` (AGL-3643): the REST hooks Aglyn's Zapier app
 * subscribes and unsubscribes. The console's `/v1` router owns the pipeline
 * in front — the key, the plan's API access, the request quota, the rate
 * limit — and refuses a site the key's organization does not own before it
 * hands a request here.
 *
 *  - `POST   …/hooks` `{ targetUrl, events: [...] }` (or one `event`) →
 *    `201` with the hook; `200` with the site's existing hook for the same
 *    URL, its events replaced — a Zap re-subscribing.
 *  - `GET    …/hooks` → the site's hooks; `GET …/hooks/{id}` → one.
 *  - `DELETE …/hooks/{id}` → `{ id, object: 'hook', deleted: true }`.
 *
 * A hook is a standing read, so it asks what reading its events asks: the
 * scope and plan feature of every event it takes (`model/hook-events.ts`),
 * and the same of a key that removes one. The URL must be Zapier's: the
 * platform posts a site's orders nowhere else, whoever holds the key.
 *
 * Undocumented on purpose until the Zapier app is published: no OpenAPI
 * description is registered for it.
 */

export interface ZapierHooksApiDeps {
  store: () => ZapierHookStore
  now: () => number
}

function refuseFor(ctx: ApiV1Context, events: readonly ZapierHookEvent[]): Response | null {
  for (const event of events) {
    const spec = zapierHookEventSpec(event)
    if (!spec) continue
    if (!ctx.scopes.includes(spec.scope)) return ApiErrors.insufficientScope(spec.scope, ctx.headers)
  }
  for (const event of events) {
    const spec = zapierHookEventSpec(event)
    if (spec?.feature && !checkEntitlement(ctx.org as never, spec.feature)) {
      return ApiErrors.planRequired({
        message: `${spec.label} hooks need ${spec.feature === 'crm' ? 'the CRM' : spec.feature} on this organization’s plan`,
        code: spec.feature,
        headers: ctx.headers,
      })
    }
  }
  return null
}

/** Why a target URL cannot take hooks, or null. */
export function zapierTargetRefusal(raw: unknown): string | null {
  const url = String(raw ?? '').trim()
  if (!url) return 'Send the URL to post events to as `targetUrl`'
  if (url.length > 2048) return 'That URL is too long'
  const refusal = configuredUrlRefusal(url)
  if (refusal) return `This URL cannot take hooks: ${describeConfiguredUrlRefusal(refusal)}`
  const host = new URL(url).hostname.toLowerCase()
  if (!ZAPIER_HOOK_HOSTS.includes(host)) return `Hooks post only to ${ZAPIER_HOOK_HOSTS.join(', ')}`
  return null
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The hook, when it is this organization's and this site's. */
async function ownHook(
  deps: ZapierHooksApiDeps,
  ctx: ApiV1Context,
  hostId: string,
  hookId: string,
): Promise<ZapierHook | null> {
  const hook = await deps.store().getHook(hookId)
  return hook && hook.orgId === ctx.orgId && hook.hostId === hostId ? hook : null
}

export function createZapierHooksHandler(deps: ZapierHooksApiDeps) {
  return async function handleZapierHooks(
    request: Request,
    ctx: ApiV1Context,
    segments: string[],
  ): Promise<Response> {
    const [, hostId, , hookId, extra] = segments
    if (extra !== undefined) return ApiErrors.notFound({ message: 'Unknown endpoint', headers: ctx.headers })
    const store = deps.store()

    if (!hookId) {
      if (request.method === 'GET') {
        const hooks = (await store.listHooks(hostId)).filter((hook) => hook.orgId === ctx.orgId)
        return listResponse(hooks.map(zapierHookView), null, ctx.headers)
      }
      if (request.method !== 'POST') {
        return ApiErrors.methodNotAllowed({ headers: { ...ctx.headers, Allow: 'GET, POST' } })
      }
      const body = await readBody(request)
      if (!body) {
        return ApiErrors.badRequest({ message: 'Send a JSON object', code: 'validation_failed', headers: ctx.headers })
      }
      const { events, unknown } = readZapierHookEvents(body)
      if (unknown.length > 0 || events.length === 0) {
        return ApiErrors.badRequest({
          message: unknown.length > 0 ? `Unknown event: ${unknown.join(', ')}` : 'Name at least one event',
          code: 'validation_failed',
          fields: { events: unknown.length > 0 ? `Unknown: ${unknown.join(', ')}` : 'Required' },
          headers: ctx.headers,
        })
      }
      const refused = refuseFor(ctx, events)
      if (refused) return refused
      const targetRefusal = zapierTargetRefusal(body['targetUrl'])
      if (targetRefusal) {
        return ApiErrors.badRequest({
          message: targetRefusal,
          code: 'validation_failed',
          fields: { targetUrl: targetRefusal },
          headers: ctx.headers,
        })
      }
      const now = deps.now()
      const result = await store.upsertHook(
        {
          orgId: ctx.orgId,
          hostId,
          events,
          targetUrl: String(body['targetUrl']).trim(),
          keyId: ctx.keyId,
          keyName: ctx.keyName,
          createdAtMs: now,
          updatedAtMs: now,
          consecutiveFailures: 0,
          lastDeliveryAtMs: null,
          lastDeliveryStatus: null,
        },
        ZAPIER_MAX_HOOKS_PER_SITE,
      )
      if ('limit' in result) {
        return ApiErrors.conflict({
          message: `A site can hold ${ZAPIER_MAX_HOOKS_PER_SITE} hooks. Turn off a Zap you no longer use.`,
          code: 'hook_limit',
          headers: ctx.headers,
        })
      }
      return apiJson(zapierHookView(result.hook), { status: result.created ? 201 : 200, headers: ctx.headers })
    }

    const hook = await ownHook(deps, ctx, hostId, hookId)
    if (!hook) return ApiErrors.notFound({ message: 'No such hook', headers: ctx.headers })
    if (request.method === 'GET') return apiJson(zapierHookView(hook), { headers: ctx.headers })
    if (request.method !== 'DELETE') {
      return ApiErrors.methodNotAllowed({ headers: { ...ctx.headers, Allow: 'GET, DELETE' } })
    }
    // Removing a hook stops a feed of the site's records: asked of a key that
    // could have made it, never of one that merely reaches the site.
    const missingScope = hook.events
      .map((event) => zapierHookEventSpec(event)?.scope)
      .find((scope) => scope && !ctx.scopes.includes(scope))
    if (missingScope) return ApiErrors.insufficientScope(missingScope, ctx.headers)
    await store.deleteHook(hook.id)
    return apiJson({ id: hook.id, object: 'hook', deleted: true }, { headers: ctx.headers })
  }
}
