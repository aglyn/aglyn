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

import type { ThemeLibraryAction } from '@aglyn/aglyn/app-utils/theme-library'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import type { HostTheme } from '@aglyn/shared-data-types'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getOrgForHost,
  isImpersonationSession,
  lockdownRefusal,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import { runThemeLibraryAction } from '@aglyn/tenant-data-admin/server/theme-library-write'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * A built-in theme arrives in the request, because the plugin contributing it
 * is console code the server does not load. It is data an editor could write
 * to the host directly, so the bound is size, not trust: the renderer drops
 * any component outside the whitelist whoever wrote it.
 */
const PRESET_MAX_BYTES = 256 * 1024

const ACTION_WORDS: Record<ThemeLibraryAction['action'], string> = {
  select: 'Switched theme',
  'save-as': 'Saved theme as custom theme',
  update: 'Updated custom theme',
  restore: 'Restored theme',
  rename: 'Renamed custom theme',
  delete: 'Deleted custom theme',
  install: 'Installed theme',
}

/** The request body as a library action, or an error for the caller. */
function readAction(body: Record<string, unknown>): ThemeLibraryAction | string {
  const str = (value: unknown) => (typeof value === 'string' ? value : '')
  switch (body['action']) {
    case 'select': {
      const target = body['target'] as Record<string, unknown> | undefined
      const kind = target?.['kind']
      if (kind === 'default') return { action: 'select', target: { kind } }
      if (kind === 'custom' || kind === 'installed') {
        return { action: 'select', target: { kind, id: str(target?.['id']) } }
      }
      if (kind === 'preset') {
        const theme = target?.['theme']
        if (!theme || typeof theme !== 'object' || Array.isArray(theme)) {
          return 'That theme could not be read.'
        }
        if (JSON.stringify(theme).length > PRESET_MAX_BYTES) {
          return 'That theme is too large.'
        }
        return {
          action: 'select',
          target: {
            kind,
            id: str(target?.['id']),
            name: str(target?.['name']),
            theme: theme as HostTheme,
          },
        }
      }
      return 'Pick a theme.'
    }
    case 'save-as':
      return { action: 'save-as', name: str(body['name']) }
    case 'update':
    case 'restore':
      return { action: body['action'] }
    case 'rename':
      return { action: 'rename', id: str(body['id']), name: str(body['name']) }
    case 'delete':
      return { action: 'delete', id: str(body['id']) }
    default:
      return 'Unknown action.'
  }
}

/**
 * The site's theme library (AGL-3404): pick a theme, save the current one as
 * a custom theme, fold edits into a custom theme, restore, rename and delete.
 * Every rule lives in `planThemeLibraryAction`; this is the auth, the
 * transaction and the repaint.
 *
 * Site editors, the same gate the theme editor's own save has in the rules —
 * picking a theme is editing the theme.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const hostId = String(body?.hostId ?? '')
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  const action = readAction((body ?? {}) as Record<string, unknown>)
  if (typeof action === 'string') {
    return Response.json({ error: action }, { status: 400 })
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
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hostSnapshot = await hostRef.get()
    if (!hostSnapshot.exists) {
      return Response.json({ error: 'Unknown site' }, { status: 404 })
    }
    const staff = decoded['staff'] === true
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (!staff && memberRole !== 'admin' && memberRole !== 'editor') {
      return Response.json({ error: 'Not a site admin or editor' }, { status: 403 })
    }
    const locked = await lockdownRefusal({
      request,
      staff,
      uid: decoded.uid,
      org: (await getOrgForHost(hostId))?.org,
      host: hostSnapshot.data(),
    })
    if (locked) return locked

    const plan = await firestore.runTransaction((tx) =>
      runThemeLibraryAction(tx, hostRef, action),
    )
    if (plan.ok === false) {
      return Response.json({ error: plan.error }, { status: plan.status })
    }

    // The theme is live the moment it is written and nothing publishes it,
    // so cached pages go now rather than within the hour (AGL-3386). Never
    // throws: a failed drop leaves the switch applied.
    if (action.action !== 'rename' && action.action !== 'delete') {
      await dropPluginSiteCache({
        hostIds: [hostId],
        reason: `theme library ${action.action}`,
      })
    }
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ?? null },
      ACTION_WORDS[action.action],
      { type: 'theme', id: plan.selection.id, name: plan.selection.name },
    ).catch(() => undefined)

    return Response.json({ ok: true, selection: plan.selection }, { status: 200 })
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The theme could not be changed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
