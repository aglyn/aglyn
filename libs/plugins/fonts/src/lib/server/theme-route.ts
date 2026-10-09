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

import { overrideWriteValue } from '@aglyn/aglyn/app-utils/artifact-overrides'
import { resolveSiteTheme, themeOverridePatch } from '@aglyn/aglyn/app-utils/site-theme'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { HostTheme } from '@aglyn/shared-data-types'
import {
  firebaseAdmin,
  getOrgForHost,
  lockdownRefusal,
  logHostActivity,
} from '@aglyn/tenant-data-admin'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  applyFontOp,
  fontOpWrites,
  listInstalledFonts,
  planOf,
  readFontOp,
} from '../installer/theme-font-ops'

/**
 * `POST /api/fonts/theme?hostId=…` (AGL-3668): the installer's theme half for
 * an app. The console installs a prepared font into its theme draft in the
 * browser; an app sends one named operation (`list`, `plan`, `install`,
 * `remove-face`, `remove-family`, `role`, `category`) and this runs the same
 * pure functions (`theme-font-ops`) against the site's resolved theme, then
 * stores the difference from the picked theme as the site's override, exactly
 * as the theme editor's save does.
 *
 * The file itself goes through `/api/fonts/prepare` and the media library's
 * own routes first; this route never sees a font's bytes.
 *
 *   401  no bearer token, or one the verifier refused
 *   500  the token could not be checked at all
 *   403  unverified address (impersonation exempt), or not a site admin or editor
 *   400  no site named, or an operation that could not be read
 *   404  no such site
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE })

/** Host roles that may change a site's theme. */
const THEME_ROLES = new Set(['admin', 'editor'])

const HOST_ID = /^[A-Za-z0-9_-]{1,128}$/

const WORDS: Record<string, string> = {
  install: 'Installed a font',
  'remove-face': 'Removed a font file',
  'remove-family': 'Removed a font',
  role: 'Set a font’s role',
  category: 'Changed a font’s category',
}

export async function fontsThemeRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return refuse(401, 'Unauthenticated')
  let decoded: Parameters<typeof isEmailVerified>[0] & { uid: string; email?: string | null; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (isRefusedIdToken(error)) return refuse(401, 'Unauthenticated')
    console.error('[fonts] the caller could not be verified', error)
    return refuse(500, 'The sign-in could not be checked. Try again.')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return refuse(403, 'Verify your email address first')
  }
  const hostId = new URL(request.url).searchParams.get('hostId') ?? ''
  if (!HOST_ID.test(hostId)) return refuse(400, 'Missing hostId')
  const op = readFontOp(await request.json().catch(() => null))
  if (typeof op === 'string') return refuse(400, op)

  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  const snapshot = await hostRef.get()
  if (!snapshot.exists) return refuse(404, 'Unknown site')
  const staff = decoded['staff'] === true
  const role = String((snapshot.get('memberRoles') as Record<string, unknown> | undefined)?.[decoded.uid] ?? '')
  if (!staff && !THEME_ROLES.has(role)) {
    return refuse(403, "Only a site admin or editor can change this site's fonts")
  }
  const host = snapshot.data() as Record<string, any>
  const theme = (resolveSiteTheme(host) ?? {}) as HostTheme

  if (op.op === 'plan') return Response.json({ plan: planOf(theme, op, hostId) }, { headers: NO_STORE })
  if (!fontOpWrites(op)) return Response.json({ fonts: listInstalledFonts(theme, hostId) }, { headers: NO_STORE })

  const locked = await lockdownRefusal({
    request,
    staff,
    uid: decoded.uid,
    org: (await getOrgForHost(hostId))?.org,
    host,
  })
  if (locked) return locked
  const edited = applyFontOp(theme, op, hostId)
  const installedSha = host['themeInstalledFrom']?.listingId ? (host['themeInstalledFrom']?.sha256 ?? null) : null
  await hostRef.update({
    themeOverride: overrideWriteValue(themeOverridePatch(host, edited), installedSha),
    updatedAt: firebaseAdmin.firestore.Timestamp.now(),
  })
  await dropPluginSiteCache({ hostIds: [hostId], reason: 'fonts' })
  await logHostActivity(hostId, { uid: decoded.uid, email: decoded.email ?? null }, WORDS[op.op] ?? 'Changed fonts', {
    type: 'theme',
  }).catch(() => undefined)
  return Response.json({ ok: true, fonts: listInstalledFonts(edited, hostId) }, { headers: NO_STORE })
}
