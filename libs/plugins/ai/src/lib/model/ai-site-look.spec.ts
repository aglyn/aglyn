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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrastRatio, validateThemeForPublish } from '@aglyn/aglyn/app-utils/site-theme'
import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { AI_SITE_FONT_PAIRINGS, AI_SITE_KINDS, aiSiteKind, aiSiteKindFor } from './ai-site-kinds'
import {
  aiReadSiteLook,
  aiSiteBrandHex,
  aiSiteSeed,
  aiSiteStyleFor,
  aiSiteTheme,
  type AiSiteLookAnswer,
} from './ai-site-look'

const kind = (id: string) => aiSiteKind(id) as NonNullable<ReturnType<typeof aiSiteKind>>

/** The fonts plugin's catalog, read by path: one plugin's spec never imports another plugin. */
const catalog = JSON.parse(
  readFileSync(join(__dirname, '../../../../fonts/src/lib/catalog/google-fonts.catalog.json'), 'utf8'),
) as { families: Array<{ f: string; w: number[] }> }

describe('site looks (AGL-3660)', () => {
  it('pairs only fonts the platform serves, in weights each family has', () => {
    for (const pairing of AI_SITE_FONT_PAIRINGS) {
      for (const [family, weights] of [
        [pairing.heading.family, [pairing.heading.weight, pairing.heading.sub]],
        [pairing.body.family, pairing.body.weights],
      ] as const) {
        const entry = catalog.families.find((row) => row.f === family)
        expect(entry).toBeTruthy()
        for (const weight of weights) expect(entry?.w).toContain(weight)
      }
    }
  })

  it('names only pairings and bases that exist, in every kind', () => {
    const ids = new Set(AI_SITE_FONT_PAIRINGS.map((pairing) => pairing.id))
    for (const entry of AI_SITE_KINDS) {
      expect(entry.look.fonts.every((id) => ids.has(id))).toBe(true)
      expect(entry.look.bases.length).toBeGreaterThan(0)
    }
    expect(new Set(AI_SITE_KINDS.map((entry) => entry.id)).size).toBe(AI_SITE_KINDS.length)
  })

  it('builds a readable theme for every kind on every seed', () => {
    for (const entry of AI_SITE_KINDS) {
      for (let n = 0; n < 12; n += 1) {
        const style = aiSiteStyleFor({ kind: entry, answer: {}, seed: aiSiteSeed(`${entry.id}-${n}`) })
        const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
        expect(validateThemeForPublish(theme).ok).toBe(true)
        for (const scheme of ['light', 'dark'] as const) {
          const colors = theme.colorSchemes?.[scheme]
          expect(contrastRatio(colors?.text?.primary, colors?.background?.default)).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(colors?.primary?.main, colors?.background?.default)).toBeGreaterThanOrEqual(3)
          expect(contrastRatio(colors?.primary?.contrastText, colors?.primary?.main)).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(colors?.secondary?.contrastText, colors?.secondary?.main)).toBeGreaterThanOrEqual(4.5)
        }
        // Not the starter's colors: the fallback is only for a theme that would not read.
        expect(theme.colorSchemes?.light?.primary?.main).not.toBe(DEFAULT_SITE_THEME.colorSchemes?.light?.primary?.main)
      }
    }
  })

  it('gives two jobs with the same brief and the same answers different tokens and themes', () => {
    const answer: AiSiteLookAnswer = { base: 'minimal', hue: 210, accent: 30, fonts: 'inter', cards: 'outlined' }
    const one = aiSiteStyleFor({ kind: kind('portfolio'), answer, seed: aiSiteSeed('job-a') })
    const two = aiSiteStyleFor({ kind: kind('portfolio'), answer, seed: aiSiteSeed('job-b') })
    expect(one).not.toEqual(two)
    // Same base theme, still two looks.
    expect(one.base).toBe(two.base)
    expect(aiSiteTheme(one, DEFAULT_SITE_THEME).colorSchemes).not.toEqual(aiSiteTheme(two, DEFAULT_SITE_THEME).colorSchemes)
  })

  it('never repeats a token set across 20 seeds of one kind and one brief', () => {
    const seen = new Set<string>()
    for (let n = 0; n < 20; n += 1) {
      const style = aiSiteStyleFor({ kind: kind('trades'), answer: {}, seed: aiSiteSeed(`same-brief-${n}`) })
      seen.add(JSON.stringify({ ...style, seed: 0 }))
    }
    expect(seen.size).toBe(20)
  })

  it('keeps what the model chose, and fills the rest from the kind', () => {
    const style = aiSiteStyleFor({
      kind: kind('professional'),
      answer: { base: 'carbon', fonts: 'baskerville', cards: 'rule', fields: 'standard', eyebrow: 'rule', header: 'line' },
      seed: 7,
    })
    expect(style).toMatchObject({ base: 'carbon', fonts: 'baskerville', cards: 'rule', fields: 'standard', eyebrow: 'rule', header: 'line' })
    expect(kind('professional').look.corners).toContain(style.corners)
  })

  it('uses a brand color the brief gives', () => {
    const style = aiSiteStyleFor({ kind: kind('business'), answer: {}, seed: 1, brand: 'our color is #0B5FFF' })
    expect(style.brand).toBe('#0b5fff')
    expect(aiSiteTheme(style, DEFAULT_SITE_THEME).colorSchemes?.light?.primary?.main).toBe('#0b5fff')
    expect(aiSiteBrandHex('no color')).toBeNull()
  })

  it('puts every building block in the theme, so a component dropped in later matches', () => {
    const style = aiSiteStyleFor({
      kind: kind('wellness'),
      answer: { cards: 'tinted', buttons: 'pill', fields: 'filled', header: 'flat' },
      seed: 3,
    })
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    expect(theme.components?.['MuiCard']).toMatchObject({
      defaultProps: { variant: 'elevation', elevation: 0 },
      sx: { root: { bgcolor: 'tint.primary' } },
    })
    expect(theme.components?.['MuiButton']?.styleOverrides).toMatchObject({ root: { borderRadius: 999, minHeight: 44 } })
    expect(theme.components?.['MuiTextField']?.defaultProps).toEqual({ variant: 'filled' })
    // Theme terms only: no literal color in a component style.
    expect(JSON.stringify(theme.components)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })

  it('keeps what a base theme sets beyond the look', () => {
    const base = {
      ...DEFAULT_SITE_THEME,
      components: { MuiMenu: { styleOverrides: { paper: { borderRadius: 6 } } } },
    }
    const theme = aiSiteTheme(aiSiteStyleFor({ kind: kind('store'), answer: {}, seed: 11 }), base)
    expect(theme.components?.['MuiMenu']).toEqual(base.components.MuiMenu)
  })

  it('reads an answer leniently', () => {
    expect(aiReadSiteLook({ base: 'nope', hue: 400.4, cards: 'rule', fonts: 'missing', brand: '#abc' })).toEqual({
      hue: 40,
      cards: 'rule',
      brand: '#aabbcc',
    })
  })

  it('suggests a kind from what the site is for', () => {
    expect(aiSiteKindFor('a roofing company in Tulsa').id).toBe('trades')
    expect(aiSiteKindFor('a wedding photographer').id).toBe('photography')
    expect(aiSiteKindFor('a family law firm').id).toBe('professional')
    expect(aiSiteKindFor('a counselor for teens').id).toBe('wellness')
    expect(aiSiteKindFor('my food blog').id).toBe('blog')
    expect(aiSiteKindFor('something else entirely').id).toBe('business')
  })
})
