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

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrastRatio, validateThemeForPublish } from '@aglyn/aglyn/app-utils/site-theme'
import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { AI_SITE_MOTION_STYLES, aiSiteMotionStylesFor } from '../layout-language/ai-layout-motion'
import { AI_SITE_FONT_PAIRINGS, AI_SITE_KINDS, aiSiteKind, aiSiteKindFor } from './ai-site-kinds'
import {
  AI_SITE_DISPLAY_BOOST,
  AI_SITE_LOOK_DIMENSIONS,
  AI_SITE_LOOK_TOOL,
  AI_SITE_MOTION_KEEP,
  aiReadSiteLook,
  aiSiteLookSignature,
  aiSiteBrandHex,
  aiSiteSeed,
  aiSiteStyleFor,
  aiSiteTheme,
  AI_SITE_ACCENT_CLASH_DEGREES,
  aiHexOklch,
  aiHueGap,
  aiSiteColors,
  AI_SITE_BUTTONS,
  aiOklabDistance,
  aiSiteOwnButton,
  type AiSiteLookAnswer,
  type AiSiteStyle,
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

  it('fills every base’s buttons from the brand hue, never an accent that clashes with it (AGL-3660)', () => {
    // The live Juniper Clay look: green brand, magenta accent, neutral chroma, on Cupertino.
    const juniper = {
      v: 1, kind: 'portfolio', base: 'cupertino', seed: 2047654009, hue: 131, accent: 323, chroma: 'neutral', ground: 'white',
      fonts: 'inter', corners: 'sharp', buttons: 'square', cards: 'outlined', fields: 'outlined', eyebrow: 'caps', header: 'flat',
      headerAlign: 'center', rhythm: 'bold', headingScale: 1.26, density: 'airy', brand: null,
    } as unknown as AiSiteStyle
    const styles: AiSiteStyle[] = [juniper]
    for (const entry of AI_SITE_KINDS) {
      for (let n = 0; n < 8; n += 1) styles.push(aiSiteStyleFor({ kind: entry, answer: {}, seed: aiSiteSeed(`${entry.id}-buttons-${n}`) }))
    }
    const near = (hex: string | undefined, h: number) => {
      const color = aiHexOklch(String(hex))
      return color.C < 0.02 || aiHueGap(color.h, h) <= AI_SITE_ACCENT_CLASH_DEGREES
    }
    for (const style of styles) {
      const h = style.brand ? aiHexOklch(style.brand).h : style.hue
      const colors = aiSiteColors(style)
      for (const scheme of ['light', 'dark'] as const) {
        const c = colors[scheme]
        const at = `${style.kind}/${style.base} seed ${style.seed} ${scheme}`
        // Cupertino's outlined button: the primary's dark words on its tint.
        expect([at, (contrastRatio(c.primary?.dark, c.tint?.primary) ?? 0) >= 4.5]).toEqual([at, true])
        // Material 3's secondary button: the text color on the secondary tint.
        expect([at, (contrastRatio(c.text?.primary, c.tint?.secondary) ?? 0) >= 4.5]).toEqual([at, true])
        // Every fill a button takes sits near the brand hue, or is near gray.
        for (const fill of [c.tint?.primary, c.tint?.secondary, c.secondary?.main]) expect([at, fill, near(fill, h)]).toEqual([at, fill, true])
      }
      // The compiler's button on a brand band stands apart from the band.
      expect([style.kind, style.seed, (contrastRatio(colors.light.secondary?.main, colors.light.primary?.main) ?? 0) >= 3]).toEqual([style.kind, style.seed, true])
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

describe('how a site moves, chosen with its look (AGL-3941)', () => {
  const SEEDS = Array.from({ length: 200 }, (_, index) => Math.imul(index + 1, 0x9e3779b1) >>> 0)

  it('asks the look for one of the motion styles, and reads only those', () => {
    const schema = AI_SITE_LOOK_TOOL.inputSchema as { required: string[]; properties: Record<string, { enum?: string[] }> }
    expect(schema.required).toContain('motion')
    expect(schema.properties['motion']?.enum).toEqual([...AI_SITE_MOTION_STYLES])
    expect(aiReadSiteLook({ motion: 'sides' })).toEqual({ motion: 'sides' })
    expect(aiReadSiteLook({ motion: 'bounce' })).toEqual({})
    expect(aiReadSiteLook({ motion: null })).toEqual({})
  })

  it('keeps the style the model chose for most sites, and draws the rest among those that suit the kind', () => {
    for (const site of AI_SITE_KINDS) {
      for (const motion of AI_SITE_MOTION_STYLES) {
        const drawn = SEEDS.map((seed) => aiSiteStyleFor({ kind: site, answer: { motion }, seed }).motion)
        const kept = drawn.filter((style) => style === motion).length / SEEDS.length
        expect([site.id, motion, kept >= AI_SITE_MOTION_KEEP - 0.1]).toEqual([site.id, motion, true])
        for (const style of drawn) expect([...aiSiteMotionStylesFor(site.id), motion]).toContain(style)
      }
      // With no choice, the seed draws every style that suits the kind, and nothing else.
      const unanswered = new Set(SEEDS.map((seed) => aiSiteStyleFor({ kind: site, answer: {}, seed }).motion))
      expect(unanswered).toEqual(new Set(aiSiteMotionStylesFor(site.id)))
    }
  })

  it('draws the motion last, so a look’s other choices are the ones the seed always drew', () => {
    for (const site of AI_SITE_KINDS) {
      for (const seed of SEEDS.slice(0, 20)) {
        const answer: AiSiteLookAnswer = { base: 'carbon', hue: 210, fonts: 'oswald', buttons: 'caps' }
        const unchosen = aiSiteStyleFor({ kind: site, answer, seed })
        const chosen = aiSiteStyleFor({ kind: site, answer: { ...answer, motion: 'still' }, seed })
        expect({ ...chosen, motion: unchosen.motion }).toEqual(unchosen)
      }
    }
  })
})

/*------------------------------------------
 * Keep my site and Improve it (AGL-4152)
 *-----------------------------------------*/

/** Plain JSON with every object's keys in order, so a digest of it is the value's own. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )
}

/**
 * Styles as live sites were saved with them before AGL-4152, none with a
 * field it added: every chroma, ground, corner, button, card and eyebrow, with
 * and without a brand, and the looks of sites brought in (AGL-4108, AGL-4138)
 * with their own page, third color and type, one of them a grey page at a
 * lightness of 0.88 that a style without Keep my site leaves out.
 */
function stylesBefore(): AiSiteStyle[] {
  const pick = <T,>(list: readonly T[], at: number): T => list[at % list.length] as T
  const brands = [null, '#00b0ff', '#c4622d', '#1565c0', '#ffeb3b', '#0b6e4f']
  const styles: AiSiteStyle[] = []
  for (let at = 0; at < 60; at += 1) {
    styles.push({
      v: 1,
      kind: pick(['professional', 'portfolio', 'trades', 'restaurant', 'blog'], at),
      base: pick(['starter', 'material3', 'carbon', 'minimal'], at),
      seed: 1000 + at * 7919,
      hue: (at * 37) % 360,
      accent: (at * 53 + 90) % 360,
      chroma: pick(['neutral', 'muted', 'balanced', 'vivid'] as const, at),
      ground: pick(['white', 'warm', 'cool', 'tinted'] as const, Math.floor(at / 4)),
      fonts: pick(['inter', 'fraunces', 'oswald', 'lora', 'syne'], at),
      corners: pick(['sharp', 'soft', 'round', 'pill'] as const, Math.floor(at / 3)),
      buttons: pick(AI_SITE_BUTTONS, at),
      cards: pick(['flat', 'outlined', 'elevated', 'tinted', 'rule'] as const, Math.floor(at / 2)),
      fields: pick(['outlined', 'filled', 'standard'] as const, at),
      eyebrow: pick(['caps', 'small', 'rule'] as const, Math.floor(at / 5)),
      header: pick(['line', 'shadow', 'flat'] as const, at),
      headerAlign: pick(['start', 'center'] as const, at),
      rhythm: pick(['calm', 'bold'] as const, at),
      headingScale: 0.95 + (at % 4) * 0.05,
      density: pick(['compact', 'regular', 'airy'] as const, at),
      brand: pick(brands, Math.floor(at / 6)),
      ...(at % 3 === 0 ? { motion: 'still' as const } : {}),
      // A site brought in: its own page, third color and type.
      ...(at % 4 === 1 ? { page: pick(['#f5f5f5', '#ffffff', '#d9d9d9', '#fffaf3'], Math.floor(at / 4)) } : {}),
      ...(at % 5 === 2 ? { tertiary: pick(['#e040fb', '#9d2db0'], at) } : {}),
      ...(at % 6 === 3 ? { sourceFonts: { body: { family: 'Roboto Flex', category: 'sans-serif' as const, weights: [400, 700] }, heading: at % 12 === 3 ? null : { family: 'Fraunces', category: 'serif' as const, weights: [] } } } : {}),
    })
  }
  return styles
}

/** A base with button styles of its own, as Material 3's and Carbon's are. */
const BUTTON_BASE = {
  ...DEFAULT_SITE_THEME,
  components: {
    ...(DEFAULT_SITE_THEME.components ?? {}),
    MuiButton: { variants: [{ props: { variant: 'outlined' }, sx: { borderColor: 'text.disabled' } }] },
  },
} as typeof DEFAULT_SITE_THEME

describe('a style saved before Keep my site (AGL-4152)', () => {
  it('draws exactly the colors and the theme it drew before, on a base with button styles of its own or none', () => {
    const styles = stylesBefore()
    const drawn = styles.map((style) => [aiSiteColors(style), aiSiteTheme(style, DEFAULT_SITE_THEME), aiSiteTheme(style, BUTTON_BASE)])
    // The digest of what the code drew before AGL-4152, from the same styles. Live sites were saved
    // from these themes: a change here is a change to every one of them, and needs saying so.
    expect(createHash('sha256').update(stableJson(drawn)).digest('hex')).toBe('55430ee96593eb95397f757a6ceee5f801b90f08be8249f8f74de3c4e8b41ac1')
    for (const style of styles) expect(aiSiteOwnButton(style)).toBeNull()
  })

  it('leaves out a grey page a lightness of 0.88 down, as before, where Keep my site keeps it', () => {
    const style = { ...stylesBefore()[9], page: '#d9d9d9' } as AiSiteStyle
    expect(aiHexOklch('#d9d9d9').L).toBeGreaterThan(0.85)
    expect(aiHexOklch('#d9d9d9').L).toBeLessThan(0.9)
    expect(aiSiteColors(style).light.background?.default).not.toBe('#d9d9d9')
    expect(aiSiteColors({ ...style, finish: 'keep' }).light.background?.default).toBe('#d9d9d9')
    // Improve keeps no page of the source's at all; a page on its style is read as before.
    expect(aiSiteColors({ ...style, finish: 'improve' })).toEqual(aiSiteColors(style))
  })
})

describe('Keep my site keeps the source’s grounds, button case and button fill (AGL-4152)', () => {
  /** A site brought in and kept, on aglyn.com’s light cyan and grey page. */
  const kept = (extra: Partial<AiSiteStyle> = {}): AiSiteStyle =>
    ({ ...stylesBefore()[0], kind: 'professional', brand: '#00b0ff', page: '#f5f5f5', buttons: 'rounded', finish: 'keep', ...extra }) as AiSiteStyle
  const variants = (style: AiSiteStyle) =>
    ((aiSiteTheme(style, DEFAULT_SITE_THEME).components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown>; sx?: Record<string, unknown> }>)

  it('draws the dark scheme on the source’s own dark ground, its paper a step lighter, where white reads on it', () => {
    const dark = aiSiteTheme(kept({ darkPage: '#2b2f36' }), DEFAULT_SITE_THEME).colorSchemes?.dark
    expect(dark?.background?.default).toBe('#2b2f36')
    expect(aiOklabDistance(dark?.background?.default as string, '#2b2f36')).toBeLessThanOrEqual(0.05)
    const paper = aiHexOklch(dark?.background?.paper as string)
    expect(paper.L - aiHexOklch('#2b2f36').L).toBeCloseTo(0.045, 2)
    // Its cards' surface and its rules keep their place against it, and its words read on each.
    expect(aiHexOklch(dark?.divider as string).L).toBeGreaterThan(aiHexOklch('#2b2f36').L)
    expect(contrastRatio(dark?.surface?.contrastText, dark?.surface?.main)).toBeGreaterThanOrEqual(4.5)
    for (const ground of [dark?.background?.default, dark?.background?.paper]) expect(contrastRatio(dark?.text?.primary, ground)).toBeGreaterThanOrEqual(4.5)
    // A grey white cannot read on is no dark ground, and the scheme keeps its own.
    expect(aiSiteColors(kept({ darkPage: '#777777' })).dark.background?.default).toBe(aiSiteColors(kept()).dark.background?.default)
  })

  it('sets the button Text Style in capitals, spaced 0.06 em, where the source’s buttons are, and in its words’ case where they are not', () => {
    expect(aiSiteTheme(kept({ buttonCase: 'upper' }), DEFAULT_SITE_THEME).typography?.variants?.button).toMatchObject({ textTransform: 'uppercase', letterSpacing: '0.06em' })
    const none = aiSiteTheme(kept({ buttons: 'caps', buttonCase: 'none' }), DEFAULT_SITE_THEME).typography?.variants?.button
    expect(none?.textTransform).toBe('none')
    expect(none?.letterSpacing).toBeUndefined()
    // No case of its own, and the buttons' style says, as before.
    expect(aiSiteTheme(kept({ buttons: 'caps' }), DEFAULT_SITE_THEME).typography?.variants?.button).toMatchObject({ textTransform: 'uppercase' })
  })

  it('makes a fill that reads on the page, under words that read on it, the brand itself: no shade of it', () => {
    // An orange white reads on at 4.2:1, carrying near-black words at 4.9:1.
    const style = kept({ brand: '#e65100', page: '#ffffff', buttonFill: '#e65100', buttonText: '#111111' })
    const light = aiSiteColors(style).light
    expect(light.primary?.main).toBe('#e65100')
    expect(light.primary?.contrastText).toBe('#111111')
    expect(aiSiteOwnButton(style)).toBeNull()
    // Without Keep my site it is deepened under white words, as always.
    expect(aiSiteColors({ ...style, buttonFill: undefined, buttonText: undefined }).light.primary?.main).not.toBe('#e65100')
  })

  it('draws the filled buttons alone in a light fill the page cannot carry, under its own dark words, and keeps the deeper brand for links', () => {
    // The 11/4 evidence: light cyan buttons under dark words, on a grey page they read on at 2.3:1.
    const style = kept({ darkPage: '#2b2f36', buttonFill: '#00b0ff', buttonText: '#0b1b2b' })
    const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
    const light = theme.colorSchemes?.light
    const dark = theme.colorSchemes?.dark
    expect(light?.primary?.light).toBe('#00b0ff')
    expect(dark?.primary?.light).toBe('#00b0ff')
    expect(contrastRatio(light?.primary?.main, '#f5f5f5')).toBeGreaterThanOrEqual(4.5)
    expect(aiSiteOwnButton(style)).toEqual({ label: 'common.black', outlined: false })
    const contained = variants(style).find((variant) => variant.props['variant'] === 'contained' && variant.props['color'] === 'primary')
    expect(contained?.sx).toMatchObject({ bgcolor: 'primary.light', color: 'common.black' })
    // Every color a palette role, the label on the words' own side of the fill and reading on it.
    expect(JSON.stringify(variants(style))).not.toMatch(/#[0-9a-f]{3,6}/i)
    expect(contrastRatio('#000000', '#00b0ff')).toBeGreaterThanOrEqual(4.5)
    expect(aiHexOklch('#0b1b2b').L).toBeLessThan(aiHexOklch('#00b0ff').L)
    // On its dark ground the cyan reads, so it is the dark scheme's brand: its outlined buttons are cyan there.
    expect(dark?.primary?.main).toBe('#00b0ff')
    expect(dark?.primary?.contrastText).toBe('#0b1b2b')
    // An outlined button keeps the brand where the cyan would not read on the page.
    expect(variants(style).filter((variant) => variant.props['variant'] === 'outlined').map((variant) => variant.sx?.['color'])).toEqual(['primary.main'])
  })

  it('takes the fill for outlined buttons too, where it reads on both pages', () => {
    // A mid red its own white words read on at 4.0:1, which reads on both pages: the words cross to black, the red stays.
    const style = kept({ brand: '#e53935', page: '#ffffff', buttonFill: '#e53935', buttonText: '#ffffff', darkPage: '#2b2f36' })
    expect(aiSiteOwnButton(style)).toEqual({ label: 'common.black', outlined: true })
    expect(aiSiteColors(style).light.primary?.main).toBe('#e53935')
    // Indigo buttons on a green brand's site: their own under white, and too deep for the dark page's outlines.
    const indigo = kept({ brand: '#0b6e4f', page: '#ffffff', buttonFill: '#3949ab', buttonText: '#eeeeee' })
    expect(aiSiteOwnButton(indigo)).toEqual({ label: 'common.white', outlined: false })
    // Near-black buttons: their own on the page, and on the dark page their nearest shade that stands apart from it.
    const black = kept({ brand: '#0b6e4f', page: '#ffffff', buttonFill: '#212121', buttonText: '#ffffff' })
    expect(aiSiteOwnButton(black)).toEqual({ label: 'common.white', outlined: false })
    const colors = aiSiteColors(black)
    expect(colors.light.primary?.light).toBe('#212121')
    expect(aiOklabDistance(colors.dark.primary?.light as string, colors.dark.background?.default as string)).toBeGreaterThanOrEqual(0.1)
    expect(contrastRatio('#ffffff', colors.dark.primary?.light)).toBeGreaterThanOrEqual(4.5)
    const grey = kept({ brand: '#0b6e4f', page: '#ffffff', buttonFill: '#7a7a7a', buttonText: '#000000' })
    expect(aiSiteOwnButton(grey)).toEqual({ label: 'common.black', outlined: true })
    expect(variants(grey).filter((variant) => variant.props['variant'] === 'outlined').pop()?.sx).toEqual({ color: 'primary.light', borderColor: 'primary.light' })
    // The links stay the brand's green.
    expect(aiHueGap(aiHexOklch(aiSiteColors(grey).light.primary?.main as string).h, aiHexOklch('#0b6e4f').h)).toBeLessThanOrEqual(4)
  })

  it('keeps the base’s own button styles before the fill’s', () => {
    const style = kept({ buttonFill: '#00b0ff', buttonText: '#0b1b2b' })
    const own = (aiSiteTheme(style, BUTTON_BASE).components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown> }>
    expect(own.map((variant) => variant.props)).toEqual([
      { variant: 'outlined' },
      { variant: 'outlined', color: 'primary' },
      { variant: 'text', color: 'primary' },
      { variant: 'contained', color: 'primary' },
    ])
  })

  it('draws no fill of its own that sits on the page like the page', () => {
    expect(aiSiteOwnButton(kept({ buttonFill: '#f4f4f4', buttonText: '#111111' }))).toBeNull()
  })

  it('keeps a light fill whose white words cannot be read on it, under black in both schemes', () => {
    // aglyn.com’s recorded white words on its light cyan read at 2.4:1, and have no lighter shade.
    const recorded = kept({ buttonFill: '#00b0ff', buttonText: '#ffffff', darkPage: '#161c21' })
    expect(aiSiteOwnButton(recorded)).toEqual({ label: 'common.black', outlined: false })
    const colors = aiSiteColors(recorded)
    expect(colors.light.primary?.light).toBe('#00b0ff')
    expect(colors.dark.primary?.light).toBe('#00b0ff')
    // The filled buttons are the only thing the fill colors: links stay the deeper shade white reads on.
    expect(contrastRatio('#ffffff', colors.light.primary?.main)).toBeGreaterThanOrEqual(4.5)
    // Its dark bands still carry the cyan itself.
    expect(colors.dark.primary?.main).toBe('#00b0ff')
    const contained = variants(recorded).find((variant) => variant.props['variant'] === 'contained')
    expect(contained?.sx).toMatchObject({ bgcolor: 'primary.light', color: 'common.black' })
  })

  it('draws a fill on the dark bands too where the dark brand cannot be it: terracotta on a dark green', () => {
    const style = kept({ brand: '#c4622d', page: '#ffffff', buttonFill: '#c4622d', buttonText: '#ffffff', darkPage: '#1d2b2a' })
    const colors = aiSiteColors(style)
    expect(colors.light.primary?.main).toBe('#c4622d')
    // Words and links on the dark bands take a lighter shade; the filled buttons keep the fill.
    expect(colors.dark.primary?.main).not.toBe('#c4622d')
    expect(colors.dark.primary?.light).toBe('#c4622d')
    expect(aiSiteOwnButton(style)?.label).toBe('common.black')
  })

  it('keeps the band’s own fill as the paper, in light and in the dark scheme where it is read', () => {
    expect(aiSiteColors(kept({ page: '#f5f5f5', paper: '#ffffff' })).light.background).toEqual({ default: '#f5f5f5', paper: '#ffffff' })
    expect(aiSiteColors(kept({ page: '#ffffff', paper: '#f4efe8' })).light.background).toEqual({ default: '#ffffff', paper: '#f4efe8' })
    // Too dark for the words to read on: the ground's own paper.
    expect(aiSiteColors(kept({ page: '#ffffff', paper: '#5b6168' })).light.background?.paper).not.toBe('#5b6168')
    expect(aiSiteColors(kept({ darkPage: '#161c21', darkPaper: '#2a3440' })).dark.background).toEqual({ default: '#161c21', paper: '#2a3440' })
    // Unread, a step above the dark page: lighter, as the light page's paper is.
    const stepped = aiSiteColors(kept({ darkPage: '#161c21' })).dark.background
    expect(aiHexOklch(stepped?.paper as string).L).toBeGreaterThan(aiHexOklch(stepped?.default as string).L)
    // Under Improve it the source's paper is not read.
    expect(aiSiteColors({ ...kept({ paper: '#f4efe8' }), finish: 'improve' }).light.background?.paper).not.toBe('#f4efe8')
  })

  it('holds its outlined and text buttons over whatever the base draws: no fill, the primary, each style’s own case', () => {
    // A base that draws an outlined button on the paper with a grey border and the page's words, and a text button in those words.
    const base = {
      ...DEFAULT_SITE_THEME,
      components: {
        MuiButton: {
          variants: [
            { props: { variant: 'outlined', color: 'primary' }, sx: { bgcolor: 'background.paper', borderColor: 'divider', color: 'text.primary' } },
            { props: { variant: 'text', color: 'primary' }, sx: { color: 'text.primary' } },
          ],
        },
      },
    } as typeof DEFAULT_SITE_THEME
    const style = kept({ buttonFill: '#00b0ff', buttonText: '#ffffff', buttonCase: 'upper', outlinedCase: 'upper', textCase: 'none', buttonOutline: '#0077ad' })
    const all = (aiSiteTheme(style, base).components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown>; sx?: Record<string, unknown> }>
    const last = (variant: string) => all.filter((entry) => entry.props['variant'] === variant).pop()?.sx
    expect(last('outlined')).toMatchObject({ color: 'primary.main', borderColor: 'primary.main', bgcolor: 'transparent' })
    expect(last('outlined')).not.toHaveProperty('textTransform')
    expect(last('text')).toMatchObject({ color: 'primary.main', bgcolor: 'transparent', textTransform: 'none' })
    expect(JSON.stringify(all)).not.toMatch(/#[0-9a-f]{3,6}/i)
    // Their own filled case on a page whose text buttons are in capitals too sets nothing more.
    const same = (aiSiteTheme(kept({ buttonCase: 'upper', textCase: 'upper' }), base).components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown>; sx?: Record<string, unknown> }>
    expect(same.filter((entry) => entry.props['variant'] === 'text').pop()?.sx).not.toHaveProperty('textTransform')
    // Outlined buttons drawn in the page's words draw in the theme's, never the brand.
    const inked = (aiSiteTheme(kept({ buttonOutline: '#000000' }), base).components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown>; sx?: Record<string, unknown> }>
    expect(inked.filter((entry) => entry.props['variant'] === 'outlined').pop()?.sx).toMatchObject({ color: 'text.primary', borderColor: 'text.primary' })
    // A site's own fill for them leaves the base's color alone; Improve it adds nothing at all.
    const filled = (aiSiteTheme(kept({ outlinedFill: '#ffffff' }), base).components?.['MuiButton']?.variants ?? []) as Array<{ props: Record<string, unknown>; sx?: Record<string, unknown> }>
    expect(filled.filter((entry) => entry.props['variant'] === 'outlined').pop()?.sx).not.toHaveProperty('bgcolor')
    const improved = aiSiteTheme({ ...style, finish: 'improve' }, base).components?.['MuiButton']?.variants ?? []
    expect(improved).toHaveLength(2)
  })

  it('never draws a kept theme that fails the reading checks, over every fill and words a source may give', () => {
    const fills = ['#00b0ff', '#ffb300', '#e65100', '#1565c0', '#212121', '#7a7a7a', '#c4622d', '#43a047', '#f06292', '#ffffff', '#ffeb3b']
    const words = ['#ffffff', '#000000', '#0b1b2b', '#333333', '#fafafa', '#777777']
    for (const fill of fills) {
      for (const text of words) {
        for (const darkPage of [undefined, '#2b2f36', '#161c21']) {
          const style = kept({ brand: fill === '#ffffff' ? '#1565c0' : fill, buttonFill: fill, buttonText: text, ...(darkPage ? { darkPage } : {}), buttonCase: 'upper' })
          const theme = aiSiteTheme(style, DEFAULT_SITE_THEME)
          const at = `${fill} ${text} ${darkPage ?? '-'}`
          expect([at, validateThemeForPublish(theme).ok]).toEqual([at, true])
          expect([at, theme.colorSchemes?.light?.primary?.main === DEFAULT_SITE_THEME.colorSchemes?.light?.primary?.main]).toEqual([at, false])
          const button = aiSiteOwnButton(style)
          for (const scheme of ['light', 'dark'] as const) {
            const colors = theme.colorSchemes?.[scheme]
            expect([at, scheme, (contrastRatio(colors?.primary?.contrastText, colors?.primary?.main) ?? 0) >= 4.5]).toEqual([at, scheme, true])
            if (button) {
              expect([at, scheme, (contrastRatio(button.label === 'common.white' ? '#ffffff' : '#000000', colors?.primary?.light) ?? 0) >= 4.5]).toEqual([at, scheme, true])
            }
          }
        }
      }
    }
  })
})
