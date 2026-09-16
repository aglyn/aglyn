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
  CONTRAST_AA,
  CONTRAST_AA_LARGE,
  contrastRatio,
  hostThemeSource,
  resolveSiteTheme,
  themeOverridePatch,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import { overridePaths } from '@aglyn/aglyn/app-utils/marketplace-overrides'
import type { HostTheme } from '@aglyn/shared-data-types'
import {
  readThemeColor,
  writeThemeColor,
} from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import {
  aiThemeBriefScope,
  aiThemeProposalAfter,
  aiThemeStaleChanges,
  applyAiThemeChanges,
  buildAiThemeProposal,
  readAiThemeProposal,
  type BuildAiThemeProposalInput,
} from './ai-theme-proposal'

/**
 * Theme proposals (AGL-2938): a targeted diff over the editor's controls,
 * stored the way the editor's Save stores it, with dark values present and
 * every touched pair readable.
 */

/** A site's own, complete-enough theme: explicit surfaces in both schemes. */
const siteTheme = (): HostTheme => ({
  colorSchemes: {
    light: {
      primary: { main: '#1565c0' },
      background: { default: '#ffffff', paper: '#ffffff' },
      text: { primary: '#111111', secondary: '#4a4a4a' },
    },
    dark: {
      primary: { main: '#90caf9' },
      background: { default: '#121212', paper: '#1e1e1e' },
      text: { primary: '#f5f5f5', secondary: '#bdbdbd' },
    },
  },
  fonts: [{ family: 'Inter', weights: [400, 500, 700], source: 'google' }],
  typography: { fontFamily: '"Inter", sans-serif' },
  shape: { borderRadius: 8 },
  spacing: 8,
})

const input = (patch: Partial<BuildAiThemeProposalInput>): BuildAiThemeProposalInput => ({
  base: siteTheme(),
  source: 'custom',
  mode: 'modify',
  brief: 'Make it feel warmer.',
  summary: 'Warmer accents.',
  changes: [],
  components: [],
  resetComponents: false,
  ...patch,
})

describe('instruction → a targeted diff', () => {
  it('a "warmer" brief reaches the colors and nothing else', () => {
    const proposal = buildAiThemeProposal(
      input({
        changes: [
          { control: 'color.primary', scheme: 'light', value: '#c2410c' },
          { control: 'color.primary', scheme: 'dark', value: '#fdba74' },
          { control: 'fontFamily', scheme: null, value: 'Lora' },
          { control: 'borderRadius', scheme: null, value: 16 },
        ],
        components: [
          {
            component: 'MuiButton',
            target: 'styleOverrides',
            slot: 'root',
            property: 'textTransform',
            media: null,
            value: 'none',
          },
        ],
      }),
    )
    expect(proposal.changes.map((change) => change.control)).toEqual(['color.primary', 'color.primary'])
    expect(proposal.components).toEqual([])
    expect(proposal.dropped).toEqual([
      'fontFamily: the brief did not ask about typography',
      'borderRadius: the brief did not ask about corners',
      'MuiButton.textTransform: the brief did not ask about component styles',
    ])
    // Everything the proposal does not name is untouched by construction.
    const after = applyAiThemeChanges(siteTheme(), proposal)
    expect(after.fonts).toEqual(siteTheme().fonts)
    expect(after.shape).toEqual(siteTheme().shape)
    expect(after.spacing).toBe(8)
    expect(after.colorSchemes?.light?.background).toEqual(siteTheme().colorSchemes?.light?.background)
  })

  it('names the parts a brief is about, and takes a brief it cannot read as the whole design', () => {
    expect([...aiThemeBriefScope('bigger headings on mobile', 'modify')]).toEqual(['typography'])
    expect([...aiThemeBriefScope('more contrast on buttons', 'modify')]).toEqual(['color', 'components'])
    expect([...aiThemeBriefScope('Rends le site plus chaleureux', 'modify')]).toHaveLength(7)
    expect([...aiThemeBriefScope('warmer', 'create')]).toHaveLength(7)
  })

  it('leaves out a change that changes nothing', () => {
    const proposal = buildAiThemeProposal(
      input({
        mode: 'create',
        changes: [
          { control: 'spacing', scheme: null, value: 8 },
          { control: 'color.primary', scheme: 'light', value: '#1565c0' },
        ],
      }),
    )
    expect(proposal.changes).toEqual([])
  })
})

describe('where the change is stored', () => {
  it('follows where the site’s theme came from', () => {
    expect(hostThemeSource({ theme: {}, themeInstalledFrom: { listingId: 'l-1' } })).toBe('installed')
    expect(hostThemeSource({ theme: siteTheme() })).toBe('custom')
    expect(hostThemeSource({ theme: {} })).toBe('default')
    expect(hostThemeSource(null)).toBe('default')
  })

  it('on the default theme, stores the changed values and never a copy of the defaults', () => {
    const proposal = buildAiThemeProposal(
      input({
        base: undefined,
        source: 'default',
        mode: 'create',
        changes: [
          { control: 'color.secondary', scheme: 'light', value: '#0f766e' },
          { control: 'color.secondary', scheme: 'dark', value: '#5eead4' },
          { control: 'borderRadius', scheme: null, value: 12 },
        ],
      }),
    )
    expect(proposal.source).toBe('default')
    expect(applyAiThemeChanges({}, proposal)).toEqual({
      colorSchemes: {
        light: { secondary: { main: '#0f766e' } },
        dark: { secondary: { main: '#5eead4' } },
      },
      shape: { borderRadius: 12 },
    })
  })

  it('on an installed theme, the editor’s save stores exactly the tokens the proposal names', () => {
    const host = {
      theme: siteTheme(),
      themeInstalledFrom: { listingId: 'listing-1', sha256: 'abc' },
    }
    const resolved = resolveSiteTheme(host)
    const proposal = buildAiThemeProposal(
      input({
        base: resolved,
        source: hostThemeSource(host),
        brief: 'Use #0f766e as the secondary color.',
        changes: [
          { control: 'color.secondary', scheme: 'light', value: '#0f766e' },
          { control: 'color.secondary', scheme: 'dark', value: '#5eead4' },
        ],
      }),
    )
    expect(proposal.source).toBe('installed')
    const edited = applyAiThemeChanges(resolved, proposal)
    // `handleThemeSave` stores this patch for an installed theme: the
    // publisher's version is untouched and the site diverges in two tokens.
    expect(overridePaths(themeOverridePatch(host, edited)).sort()).toEqual([
      'colorSchemes.dark.secondary.main',
      'colorSchemes.light.secondary.main',
    ])
  })
})

describe('dark mode values are present', () => {
  it('gives an accent changed only for light a dark value with the same hue, and names it', () => {
    const proposal = buildAiThemeProposal(
      input({
        brief: 'A deep green primary color.',
        changes: [{ control: 'color.primary', scheme: 'light', value: '#14532d' }],
      }),
    )
    const dark = proposal.changes.find(
      (change) => change.control === 'color.primary' && change.scheme === 'dark',
    )
    expect(typeof dark?.value).toBe('string')
    expect(
      contrastRatio(dark?.value, siteTheme().colorSchemes?.dark?.background?.default),
    ).toBeGreaterThanOrEqual(CONTRAST_AA_LARGE)
    expect(proposal.corrections).toContainEqual(
      expect.objectContaining({ control: 'color.primary', scheme: 'dark', reason: 'dark-value' }),
    )
  })

  it('derives nothing while the site’s dark scheme is off', () => {
    const base = { ...siteTheme(), darkScheme: 'off' as const }
    const proposal = buildAiThemeProposal(
      input({
        base,
        brief: 'A deep green primary color.',
        changes: [{ control: 'color.primary', scheme: 'light', value: '#14532d' }],
      }),
    )
    expect(proposal.changes.filter((change) => change.scheme === 'dark')).toEqual([])
    expect(proposal.corrections).toEqual([])
  })

  it('says a surface changed only for light keeps its dark value rather than inventing one', () => {
    const proposal = buildAiThemeProposal(
      input({
        brief: 'A cream background.',
        changes: [{ control: 'color.background.paper', scheme: 'light', value: '#fff7ed' }],
      }),
    )
    expect(proposal.changes.filter((change) => change.scheme === 'dark')).toEqual([])
    expect(proposal.notes).toContain(
      'background.paper keeps its current dark value; only its light value changes.',
    )
  })
})

describe('contrast is auto-corrected to the nearest passing shade', () => {
  it('moves text the proposal made unreadable, and names the pair, the ratio and the bar', () => {
    const proposal = buildAiThemeProposal(
      input({
        brief: 'Softer text color.',
        changes: [
          { control: 'color.text.primary', scheme: 'light', value: '#aaaaaa' },
          { control: 'color.text.primary', scheme: 'dark', value: '#f5f5f5' },
        ],
      }),
    )
    const correction = proposal.corrections.find((entry) => entry.reason === 'contrast')
    expect(correction).toMatchObject({
      control: 'color.text.primary',
      scheme: 'light',
      from: '#aaaaaa',
      required: CONTRAST_AA,
      against: ['#ffffff', '#ffffff'],
    })
    expect(correction?.ratio).toBeLessThan(CONTRAST_AA)
    // The proposal carries the corrected value, which clears the bar.
    const light = proposal.changes.find(
      (change) => change.control === 'color.text.primary' && change.scheme === 'light',
    )
    expect(light?.value).toBe(correction?.to)
    expect(contrastRatio(light?.value, '#ffffff')).toBeGreaterThanOrEqual(CONTRAST_AA)
  })

  it('holds the primary color to 3:1 on a background the proposal changed', () => {
    const proposal = buildAiThemeProposal(
      input({
        brief: 'A pale yellow page.',
        changes: [
          { control: 'color.background.default', scheme: 'light', value: '#fef9c3' },
          { control: 'color.background.default', scheme: 'dark', value: '#121212' },
          { control: 'color.primary', scheme: 'light', value: '#facc15' },
          { control: 'color.primary', scheme: 'dark', value: '#facc15' },
        ],
      }),
    )
    const after = applyAiThemeChanges(siteTheme(), proposal)
    expect(
      contrastRatio(readThemeColor(after, 'light', 'primary'), '#fef9c3'),
    ).toBeGreaterThanOrEqual(CONTRAST_AA_LARGE)
  })

  it('names a pair that already fell short, and leaves colors the brief did not ask about', () => {
    const base = writeThemeColor(siteTheme(), 'light', 'text.secondary', '#bbbbbb')
    const proposal = buildAiThemeProposal(
      input({
        base,
        brief: 'Warmer primary.',
        changes: [
          { control: 'color.primary', scheme: 'light', value: '#b45309' },
          { control: 'color.primary', scheme: 'dark', value: '#fbbf24' },
        ],
      }),
    )
    expect(proposal.changes.some((change) => change.control === 'color.text.secondary')).toBe(false)
    expect(proposal.notes.some((note) => note.startsWith('text.secondary on background.default in light'))).toBe(
      true,
    )
  })
})

describe('applying later, to the theme as it is then', () => {
  it('re-checks contrast against the current theme and says which values moved since', () => {
    const proposal = buildAiThemeProposal(
      input({
        brief: 'Darker text.',
        changes: [
          { control: 'color.text.primary', scheme: 'light', value: '#333333' },
          { control: 'color.text.primary', scheme: 'dark', value: '#f5f5f5' },
        ],
      }),
    )
    expect(aiThemeStaleChanges(siteTheme(), proposal)).toEqual([])
    // The page and the paper went dark in light mode after the proposal was made.
    const current = writeThemeColor(
      writeThemeColor(
        writeThemeColor(siteTheme(), 'light', 'background.default', '#202020'),
        'light',
        'background.paper',
        '#202020',
      ),
      'light',
      'text.primary',
      '#222222',
    )
    expect(aiThemeStaleChanges(current, proposal).map((change) => change.control)).toEqual([
      'color.text.primary',
    ])
    const after = aiThemeProposalAfter(current, proposal)
    expect(after.corrections).toContainEqual(
      expect.objectContaining({ control: 'color.text.primary', scheme: 'light', reason: 'contrast' }),
    )
  })

  it('reads a stored proposal back exactly, and refuses anything that is not one', () => {
    const proposal = buildAiThemeProposal(
      input({
        mode: 'create',
        changes: [
          { control: 'color.primary', scheme: 'light', value: '#14532d' },
          { control: 'navHeight.xs', scheme: null, value: 64 },
        ],
        components: [
          {
            component: 'MuiTypography',
            target: 'styleOverrides',
            slot: 'h1',
            property: 'fontSize',
            media: 'mobile',
            value: '2.25rem',
          },
        ],
        resetComponents: true,
      }),
    )
    const stored = JSON.parse(JSON.stringify(proposal))
    expect(readAiThemeProposal(stored)).toEqual(proposal)
    expect(readAiThemeProposal(null)).toBeNull()
    expect(readAiThemeProposal({ version: 2 })).toBeNull()
    const tampered = readAiThemeProposal({
      ...stored,
      changes: [...stored.changes, { control: 'color.accent', scheme: 'light', value: '#000' }],
      components: [...stored.components, { component: 'MuiDrawer', target: 'styleOverrides', property: 'x', value: 1, media: null }],
    })
    expect(tampered?.changes).toEqual(proposal.changes)
    expect(tampered?.components).toEqual(proposal.components)
  })
})
