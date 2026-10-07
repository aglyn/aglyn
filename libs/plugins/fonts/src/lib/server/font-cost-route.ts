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

import type {
  PluginApiHandler,
  PluginApiRequest,
} from '@aglyn/aglyn/app-utils/api-plugins'
import type {
  HostTheme,
  HostThemeFont,
  HostThemeFontCategory,
  HostThemeTypographyVariant,
} from '@aglyn/shared-data-types'
import { siteBaseFonts, siteBaseTypography } from '@aglyn/shared-ui-theme/site-base-fonts'
import {
  EmailNotVerifiedError,
  firebaseAdmin,
  verifyConsoleIdToken,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { themeFontDeliveryCost } from '@aglyn/tenant-runtime/self-hosted-fonts'

/**
 * `POST /api/fonts/cost` on the console (AGL-3656): what a theme's fonts
 * cost a visitor of the site, as its published pages will load them — the
 * font picker's cost badge. Body: `{ hostId, siteKey?, theme: { fonts,
 * typography } }`, the editor's draft with the candidate font on it.
 *
 * A signed-in member of the site, because the answer is worked out by asking
 * Google from the platform's servers. Reads nothing of the site but its
 * membership, and writes nothing.
 */
export const fontCostHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const hostId = String(req.body?.hostId ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) return res.status(400).json({ error: 'Missing site' })
  const token = bearer(req)
  if (!token) return res.status(401).json({ error: 'Unauthenticated' })
  let decoded: { uid: string; [claim: string]: unknown }
  try {
    decoded = await verifyConsoleIdToken(token)
  } catch (error) {
    if (error instanceof EmailNotVerifiedError) {
      return res.status(403).json({ error: 'Verify your email to continue', reason: 'email-unverified' })
    }
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  const host = await firebaseAdmin.app().firestore().collection('hosts').doc(hostId).get()
  if (!host.exists) return res.status(404).json({ error: 'Unknown site' })
  const roles = (host.data()?.['memberRoles'] ?? {}) as Record<string, unknown>
  if (decoded['staff'] !== true && !roles[decoded.uid]) {
    return res.status(403).json({ error: 'You are not a member of this site' })
  }
  const theme = readCostTheme(req.body?.theme)
  const siteKey = typeof req.body?.siteKey === 'string' ? req.body.siteKey.slice(0, 253) : undefined
  const cost = await themeFontDeliveryCost(theme, {
    hostId,
    baseTypography: siteBaseTypography(siteKey),
    baseFonts: siteBaseFonts(siteKey, theme),
  })
  res.setHeader('Cache-Control', 'private, max-age=300')
  return res.status(200).json(cost)
}

function bearer(req: PluginApiRequest): string | null {
  const header = req.headers['authorization']
  const value = Array.isArray(header) ? header[0] : header
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '')
  return match ? match[1] : null
}

const CATEGORIES: readonly HostThemeFontCategory[] = [
  'sans-serif',
  'serif',
  'monospace',
  'display',
  'handwriting',
]

/** The most fonts, weights and faces one question may name. */
const MAX_FONTS = 6
const MAX_WEIGHTS = 18
const MAX_FACES = 36

function weightsOf(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const weights = value
    .map((entry) => Math.round(Number(entry)))
    .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 1000)
    .slice(0, MAX_WEIGHTS)
  return weights.length ? weights : undefined
}

function stackOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 400 ? value : undefined
}

function fontOf(value: unknown): HostThemeFont | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  const source = entry['source'] === 'custom' || entry['source'] === 'system' ? entry['source'] : 'google'
  const family = typeof entry['family'] === 'string' ? entry['family'].trim() : ''
  // A Google family is asked for by name, so it is held to the names Google
  // uses; an uploaded one is never sent anywhere.
  const valid = source === 'google' ? /^[A-Za-z0-9 ]{1,80}$/.test(family) : family.length > 0 && family.length <= 80
  if (!valid) return null
  const category = CATEGORIES.find((candidate) => candidate === entry['category'])
  const weights = weightsOf(entry['weights'])
  const italics = weightsOf(entry['italics'])
  const faces =
    source === 'custom' && Array.isArray(entry['faces'])
      ? entry['faces'].slice(0, MAX_FACES).flatMap((face) => {
          const raw = (face ?? {}) as Record<string, unknown>
          const style = raw['style'] === 'italic' ? 'italic' : raw['style'] === 'normal' ? 'normal' : null
          if (!style) return []
          const bytes = Number(raw['bytes'])
          return [
            {
              weight: Math.round(Number(raw['weight']) || 400),
              style,
              src: '',
              ...(typeof raw['unicodeRange'] === 'string' ? { unicodeRange: raw['unicodeRange'].slice(0, 400) } : {}),
              ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
            },
          ]
        })
      : undefined
  return {
    family,
    source,
    ...(category ? { category } : {}),
    ...(weights ? { weights } : {}),
    ...(italics ? { italics } : {}),
    ...(faces ? { faces: faces as HostThemeFont['faces'] } : {}),
  }
}

/** The parts of a theme its fonts' cost depends on, read defensively. */
export function readCostTheme(value: unknown): Pick<HostTheme, 'fonts' | 'typography'> {
  const theme = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const fonts = Array.isArray(theme['fonts'])
    ? theme['fonts'].slice(0, MAX_FONTS).map(fontOf).filter((font): font is HostThemeFont => !!font)
    : []
  const rawTypography = (theme['typography'] ?? {}) as Record<string, unknown>
  const rawVariants = (rawTypography['variants'] ?? {}) as Record<string, unknown>
  const variants: Record<string, HostThemeTypographyVariant> = {}
  for (const [key, raw] of Object.entries(rawVariants).slice(0, 24)) {
    if (!/^[A-Za-z0-9]{1,24}$/.test(key) || !raw || typeof raw !== 'object') continue
    const variant = raw as Record<string, unknown>
    const fontFamily = stackOf(variant['fontFamily'])
    const fontWeight = Math.round(Number(variant['fontWeight']))
    const kept: HostThemeTypographyVariant = {
      ...(fontFamily ? { fontFamily } : {}),
      ...(Number.isFinite(fontWeight) && fontWeight >= 1 && fontWeight <= 1000 ? { fontWeight } : {}),
    }
    if (Object.keys(kept).length) variants[key] = kept
  }
  const fontFamily = stackOf(rawTypography['fontFamily'])
  return {
    ...(fonts.length ? { fonts } : {}),
    typography: {
      ...(fontFamily ? { fontFamily } : {}),
      ...(Object.keys(variants).length ? { variants } : {}),
    },
  }
}
