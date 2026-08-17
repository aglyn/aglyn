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
'use client'

import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect } from 'react'

/**
 * Editor-presence hint cookie for the tenant admin bar (AGL-1829).
 *
 * While a console session exists, a tiny `aglyn_editor=1` cookie is kept on
 * the REGISTRABLE domain (`.aglyn.com` / `.aglyn.io`), so first-party tenant
 * sites served on that same site — the marketing site on `aglyn.com`,
 * `demo.aglyn.com`, … — can cheaply notice "a console editor might be
 * browsing" and start the silent edit-access probe. Signed out, the cookie is
 * cleared.
 *
 * Deliberately a HINT, not a credential: no token, no uid, no PII — the value
 * is the constant `1`. Anything real still comes from the `/edit-access`
 * flow, which re-verifies the session and the host permission server-side.
 * Anonymous visitors never carry it, so the "no new standing cookies on
 * tenant visitors" promise (AGL-1302 follow-on) holds: this cookie only ever
 * exists in browsers that signed in to the console.
 *
 * `SameSite=Lax` on purpose: the cookie's one consumer is a same-site
 * `document.cookie` read; it must never travel cross-site. Off the first-
 * party domains (localhost, white-label console domains — which run
 * ephemeral auth anyway, AGL-1379) no cookie is written at all: a
 * `Domain=.aglyn.com` set would be silently rejected there, and a
 * customer-DNS-controlled origin must not carry even a hint.
 */

export const EDITOR_HINT_COOKIE = 'aglyn_editor'

/** 7 days; refreshed on every console load while signed in. */
const HINT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

/**
 * The registrable domain the hint may live on, or null when this hostname
 * must not carry one (localhost, previews, customer console domains).
 */
export function editorHintCookieDomain(hostname: string): string | null {
  const lower = hostname.toLowerCase()
  if (lower === 'aglyn.com' || lower.endsWith('.aglyn.com')) return '.aglyn.com'
  if (lower === 'aglyn.io' || lower.endsWith('.aglyn.io')) return '.aglyn.io'
  return null
}

export default function EditorHintCookie(): null {
  const { data: user } = useUser()

  useEffect(() => {
    // Auth still resolving — neither set nor clear on an unknown verdict.
    if (user === undefined) return
    const domain = editorHintCookieDomain(window.location.hostname)
    if (!domain) return
    const attributes = `Domain=${domain}; Path=/; SameSite=Lax; Secure`
    document.cookie = user
      ? `${EDITOR_HINT_COOKIE}=1; ${attributes}; Max-Age=${HINT_MAX_AGE_SECONDS}`
      : `${EDITOR_HINT_COOKIE}=; ${attributes}; Max-Age=0`
  }, [user])

  return null
}
