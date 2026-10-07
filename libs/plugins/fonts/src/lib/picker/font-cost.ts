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

import type { HostTheme } from '@aglyn/shared-data-types'
import { useHostSiteKey } from '@aglyn/shared-ui-theme'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useMemo, useState } from 'react'

/**
 * The font picker's cost badges (AGL-3656): what a theme's fonts cost a
 * visitor, asked of the plugin's `/api/fonts/cost` door, which works it out
 * the way the published page loads them.
 */

/** One file, as the door answers it. */
export interface FontCostFile {
  style: 'normal' | 'italic'
  weight: string
  bytes: number | null
}

export interface FontFamilyCost {
  family: string
  source: 'google' | 'custom'
  files: FontCostFile[]
  bytes: number
  complete: boolean
}

export interface FontCost {
  families: FontFamilyCost[]
  bytes: number
  files: number
  complete: boolean
}

/** What a theme with no web font costs: nothing, and nothing to ask. */
export const NO_FONT_COST: FontCost = { families: [], bytes: 0, files: 0, complete: true }

/** How long the badge waits after the last change before asking. */
const SETTLE_MS = 250

/** The parts of a theme its fonts' cost depends on, as a stable key. */
export function fontCostKey(theme: Pick<HostTheme, 'fonts' | 'typography'> | null | undefined): string {
  if (!theme) return ''
  const variants = theme.typography?.variants ?? {}
  return JSON.stringify({
    fonts: (theme.fonts ?? []).map((font) => ({
      family: font.family,
      weights: font.weights,
      italics: font.italics,
      source: font.source,
      category: font.category,
      faces: font.source === 'custom' ? font.faces?.map(({ weight, style, unicodeRange }) => ({ weight, style, unicodeRange })) : undefined,
    })),
    typography: {
      fontFamily: theme.typography?.fontFamily,
      variants: Object.fromEntries(
        Object.entries(variants)
          .filter(([, variant]) => variant?.fontFamily || variant?.fontWeight)
          .map(([key, variant]) => [key, { fontFamily: variant?.fontFamily, fontWeight: variant?.fontWeight }]),
      ),
    },
  })
}

const answers = new Map<string, Promise<FontCost>>()

async function askCost(
  user: Parameters<typeof authorizedFetch>[0],
  hostId: string,
  siteKey: string | undefined,
  key: string,
): Promise<FontCost> {
  const response = await authorizedFetch(user, '/api/fonts/cost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostId, siteKey, theme: JSON.parse(key) }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload || typeof payload.bytes !== 'number') {
    throw new Error(String(payload?.error ?? 'The size could not be measured.'))
  }
  return payload as FontCost
}

export interface FontCostState {
  cost: FontCost | null
  loading: boolean
  error: string | null
}

/**
 * What `theme`'s fonts cost a visitor of `hostId`, kept per theme for the
 * session so going back to an earlier choice answers at once. A theme with
 * no web font is `0 KB` without asking.
 */
export function useFontCost(
  hostId: string | null,
  theme: Pick<HostTheme, 'fonts' | 'typography'> | null | undefined,
): FontCostState {
  const { data: user } = useUser()
  const siteKey = useHostSiteKey() ?? undefined
  const key = useMemo(() => fontCostKey(theme), [theme])
  const loadsNothing = !(theme?.fonts ?? []).some((font) => (font.source ?? 'google') !== 'system')
  const [state, setState] = useState<FontCostState>({ cost: null, loading: true, error: null })

  useEffect(() => {
    if (!theme) return undefined
    if (loadsNothing) {
      setState({ cost: NO_FONT_COST, loading: false, error: null })
      return undefined
    }
    if (!hostId || !user) return undefined
    const cacheKey = `${hostId}|${siteKey ?? ''}|${key}`
    let active = true
    const known = answers.get(cacheKey)
    const settle = (request: Promise<FontCost>) =>
      request.then(
        (cost) => active && setState({ cost, loading: false, error: null }),
        (error: unknown) =>
          active &&
          setState({
            cost: null,
            loading: false,
            error: error instanceof Error ? error.message : 'The size could not be measured.',
          }),
      )
    if (known) {
      void settle(known)
      return () => {
        active = false
      }
    }
    setState((previous) => ({ ...previous, loading: true, error: null }))
    const timer = setTimeout(() => {
      const request = askCost(user, hostId, siteKey, key)
      answers.set(cacheKey, request)
      // A failed answer is not kept: the next look asks again.
      request.catch(() => answers.delete(cacheKey))
      void settle(request)
    }, SETTLE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
    // `theme` is carried by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, user, siteKey, key, loadsNothing])

  return state
}

/** One family's share of a cost, by name. */
export function familyCost(cost: FontCost | null, family: string): FontFamilyCost | undefined {
  const wanted = family.trim().toLowerCase()
  return cost?.families.find((entry) => entry.family.trim().toLowerCase() === wanted)
}
