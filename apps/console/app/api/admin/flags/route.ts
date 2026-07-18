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
import {
  isReleaseFlagKey,
  parseReleaseFlagValue,
  RELEASE_FLAGS,
  type ReleaseFlagValue,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/**
 * Release-flag management (AGL-230). GET returns every registered flag
 * merged with the live Remote Config template (any staff); PUT publishes
 * a single flag's new value (super staff only, like user management),
 * with etag concurrency so two admins can't silently clobber each other,
 * and an adminAudit entry per change (AGL-42).
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'PUT') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const actorRole = String(decoded['staffRole'] ?? 'support')
    const remoteConfig = firebaseAdmin.app().remoteConfig()

    if (method === 'GET') {
      const template = await remoteConfig.getTemplate()
      return Response.json({
        etag: template.etag,
        role: actorRole,
        flags: RELEASE_FLAGS.map((definition) => {
          const parameter = template.parameters[definition.key]
          const defaultValue = parameter?.defaultValue
          const raw =
            defaultValue && 'value' in defaultValue
              ? defaultValue.value
              : undefined
          return {
            ...definition,
            value: parseReleaseFlagValue(raw, definition.defaultEnabled),
            published: Boolean(parameter),
          }
        }),
      }, { status: 200 })
    }

    // PUT: publish one flag. Super-only — flipping a flag changes what
    // every customer sees, the same blast radius as user management.
    if (actorRole !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }
    const key = String(body?.key ?? '')
    if (!isReleaseFlagKey(key)) {
      return Response.json({ error: 'Unknown flag' }, { status: 400 })
    }
    const definition = RELEASE_FLAGS.find((entry) => entry.key === key)
    const rolloutPercent = Math.min(
      100,
      Math.max(0, Math.round(Number(body?.rolloutPercent ?? 0)) || 0),
    )
    const note = String(body?.note ?? '').slice(0, 500)
    const nextValue: ReleaseFlagValue = {
      enabled: body?.enabled === true,
      rolloutPercent,
      ...(note ? { note } : {}),
    }

    const template = await remoteConfig.getTemplate()
    const expectedEtag = body?.etag
    if (typeof expectedEtag === 'string' && expectedEtag !== template.etag) {
      return Response.json({
        error: 'The template changed since you loaded it — reload and retry',
      }, { status: 409 })
    }
    const parameter = template.parameters[key]
    const previousRaw =
      parameter?.defaultValue && 'value' in parameter.defaultValue
        ? parameter.defaultValue.value
        : undefined
    const before = parseReleaseFlagValue(
      previousRaw,
      definition?.defaultEnabled ?? false,
    )

    template.parameters[key] = {
      defaultValue: { value: JSON.stringify(nextValue) },
      description: definition?.description,
      valueType: 'JSON',
    }
    const published = await remoteConfig.publishTemplate(template)

    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'flags.update',
        target: `remoteConfig/${key}`,
        before,
        after: nextValue,
        at: FieldValue.serverTimestamp(),
      })

    return Response.json({ ok: true, etag: published.etag, value: nextValue }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Flag operation failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT }
