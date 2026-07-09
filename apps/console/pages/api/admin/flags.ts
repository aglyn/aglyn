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
  isReleaseFlagKey,
  parseReleaseFlagValue,
  RELEASE_FLAGS,
  type ReleaseFlagValue,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import type { NextApiRequest, NextApiResponse } from 'next'

/**
 * Release-flag management (AGL-230). GET returns every registered flag
 * merged with the live Remote Config template (any staff); PUT publishes
 * a single flag's new value (super staff only, like user management),
 * with etag concurrency so two admins can't silently clobber each other,
 * and an adminAudit entry per change (AGL-42).
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = req.headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded['staff']) {
      return res.status(403).json({ error: 'Staff only' })
    }
    const actorRole = String(decoded['staffRole'] ?? 'super')
    const remoteConfig = firebaseAdmin.app().remoteConfig()

    if (req.method === 'GET') {
      const template = await remoteConfig.getTemplate()
      return res.status(200).json({
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
      })
    }

    // PUT: publish one flag. Super-only — flipping a flag changes what
    // every customer sees, the same blast radius as user management.
    if (actorRole !== 'super') {
      return res.status(403).json({ error: 'Requires the super staff role' })
    }
    const key = String(req.body?.key ?? '')
    if (!isReleaseFlagKey(key)) {
      return res.status(400).json({ error: 'Unknown flag' })
    }
    const definition = RELEASE_FLAGS.find((entry) => entry.key === key)
    const rolloutPercent = Math.min(
      100,
      Math.max(0, Math.round(Number(req.body?.rolloutPercent ?? 0)) || 0),
    )
    const note = String(req.body?.note ?? '').slice(0, 500)
    const nextValue: ReleaseFlagValue = {
      enabled: req.body?.enabled === true,
      rolloutPercent,
      ...(note ? { note } : {}),
    }

    const template = await remoteConfig.getTemplate()
    const expectedEtag = req.body?.etag
    if (typeof expectedEtag === 'string' && expectedEtag !== template.etag) {
      return res.status(409).json({
        error: 'The template changed since you loaded it — reload and retry',
      })
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

    return res
      .status(200)
      .json({ ok: true, etag: published.etag, value: nextValue })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Flag operation failed' })
  }
}
