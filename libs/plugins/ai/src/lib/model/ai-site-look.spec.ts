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
  AI_SITE_DISPLAY_BOOST,
  AI_SITE_LOOK_DIMENSIONS,
  aiReadSiteLook,
  aiSiteLookSignature,
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

  it('favors what the model chose for the business, within what suits the kind', () => {
    const answer: AiSiteLookAnswer = { base: 'carbon', fonts: 'baskerville', cards: 'rule' }
    const styles = Array.from({ length: 60 }, (_, n) =>
      aiSiteStyleFor({ kind: kind('professional'), answer, seed: aiSiteSeed(`law-${n}`) }),
    )
    const share = (pickOne: (style: (typeof styles)[number]) => string, value: string) =>
      styles.filter((style) => pickOne(style) === value).length / styles.length
    // Kept often, never always: the seed still moves a third of them or more.
    expect(share((style) => style.base, 'carbon')).toBeGreaterThan(0.25)
    expect(share((style) => style.base, 'carbon')).toBeLessThan(0.7)
    expect(share((style) => style.fonts, 'baskerville')).toBeGreaterThan(0.25)
    for (const style of styles) {
      expect([...kind('professional').look.corners]).toContain(style.corners)
      expect(['carbon', ...kind('professional').look.bases]).toContain(style.base)
    }
  })

  /*
   * Zach's bar (AGL-3660): no two sites alike, even one kind and one brief.
   * Ten sites of one workspace whose model answered exactly alike: no two
   * share their base, hue family, heading font and button style, and every
   * two differ in at least three of the look's tracked dimensions — each
   * look drawn knowing the workspace's others.
   */
  const SAME: AiSiteLookAnswer = { base: 'carbon', hue: 210, accent: 30, fonts: 'oswald', buttons: 'caps', cards: 'outlined', corners: 'sharp', ground: 'white', eyebrow: 'caps', header: 'line', fields: 'outlined' }
  it('makes ten sites of one kind and one brief ten looks', () => {
    const styles: ReturnType<typeof aiSiteStyleFor>[] = []
    for (let n = 0; n < 10; n += 1) {
      styles.push(aiSiteStyleFor({ kind: kind('trades'), answer: SAME, seed: aiSiteSeed(`roofer-job-${n}`), avoid: styles }))
    }
    const signatures = styles.map(aiSiteLookSignature)
    const tuples = signatures.map((signature) => [signature.base, signature.hueFamily, signature.fonts, signature.buttons].join('|'))
    expect(new Set(tuples).size).toBe(10)
    for (let a = 0; a < signatures.length; a += 1) {
      for (let b = a + 1; b < signatures.length; b += 1) {
        const differ = AI_SITE_LOOK_DIMENSIONS.filter((dimension) => signatures[a][dimension] !== signatures[b][dimension])
        expect([a, b, differ.length >= 3]).toEqual([a, b, true])
      }
    }
  })

  it('rarely gives two independent jobs of one brief the same base, hue family, font and buttons', () => {
    for (const entry of AI_SITE_KINDS) {
      const signatures = Array.from({ length: 80 }, (_, n) =>
        aiSiteLookSignature(aiSiteStyleFor({ kind: entry, answer: SAME, seed: aiSiteSeed(`${entry.id}-${n}`) })),
      )
      let same = 0
      let pairs = 0
      for (let a = 0; a < signatures.length; a += 1) {
        for (let b = a + 1; b < signatures.length; b += 1) {
          pairs += 1
          if (['base', 'hueFamily', 'fonts', 'buttons'].every((key) => signatures[a][key as 'base'] === signatures[b][key as 'base'])) same += 1
        }
      }
      // Measured 0.2–1.1% of pairs on 2026-10-07; a workspace's own sites never.
      expect([entry.id, same / pairs < 0.02]).toEqual([entry.id, true])
    }
  })

  it('uses a brand color the brief gives', () => {
    const style = aiSiteStyleFor({ kind: kind('business'), answer: {}, seed: 1, brand: 'our color is #0B5FFF' })
    expect(style.brand).toBe('#0b5fff')
    expect(aiSiteTheme(style, DEFAULT_SITE_THEME).colorSchemes?.light?.primary?.main).toBe('#0b5fff')
    expect(aiSiteBrandHex('no color')).toBeNull()
  })

  it('puts every building block in the theme, so a component dropped in later matches', () => {
    const style = {
      ...aiSiteStyleFor({ kind: kind('wellness'), answer: {}, seed: 3 }),
      cards: 'tinted' as const,
      buttons: 'pill' as const,
      fields: 'filled' as const,
      header: 'flat' as const,
    }
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

  it('sets a designer kind’s display line and title larger, and a business site’s as before (AGL-3660)', () => {
    const size = (id: string, variant: 'displayXl' | 'h1' | 'h2') => {
      // One style but its kind, so only the kind's boost differs.
      const style = { ...aiSiteStyleFor({ kind: kind('business'), answer: {}, seed: 5 }), kind: id, fonts: 'inter', headingScale: 1.2 }
      return parseFloat(String(aiSiteTheme(style, DEFAULT_SITE_THEME).typography?.variants?.[variant]?.fontSize))
    }
    expect(Object.keys(AI_SITE_DISPLAY_BOOST).sort()).toEqual(['blog', 'photography', 'portfolio', 'studio'])
    // 4rem at a 1.2 heading scale with the display share of 1.2: 4.96rem.
    expect(size('business', 'displayXl')).toBeCloseTo(4.96, 2)
    expect(size('portfolio', 'displayXl')).toBeCloseTo(4.96 * 1.25, 2)
    expect(size('studio', 'displayXl')).toBeCloseTo(4.96 * 1.3, 2)
    expect(size('portfolio', 'h1')).toBeCloseTo(size('business', 'h1') * 1.1, 2)
    // Nothing under the page title moves.
    expect(size('portfolio', 'h2')).toBe(size('business', 'h2'))
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
    // "Personal" is an adjective here, not a resume (the live paid blog start of 2026-10-08).
    expect(aiSiteKindFor('Slow Roads, a personal travel blog about long train journeys through Europe, written by one person').id).toBe('blog')
    expect(aiSiteKindFor('my personal website').id).toBe('personal')
    expect(aiSiteKindFor('my resume').id).toBe('personal')
    expect(aiSiteKindFor('An independent illustrator and designer: a portfolio of editorial illustrations and brand work').id).toBe('portfolio')
    expect(aiSiteKindFor('something else entirely').id).toBe('business')
    // The briefs the live eval runs (AGL-3660).
    expect(aiSiteKindFor('a yoga studio with drop-in classes').id).toBe('yoga')
    expect(aiSiteKindFor('a family dental practice').id).toBe('wellness')
    expect(aiSiteKindFor('a neighborhood café with breakfast and pastries').id).toBe('restaurant')
    expect(aiSiteKindFor('a 24-hour towing and roadside assistance company').id).toBe('trades')
    expect(aiSiteKindFor('an online store for hand-poured soy candles').id).toBe('store')
    expect(aiSiteKindFor('an illustrator portfolio for picture books and editorial work').id).toBe('portfolio')
  })
})
