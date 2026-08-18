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

/**
 * AGL-1932: every new tenant site starts on the container standard.
 *
 * The starter templates seeded **zero** `muiContainer` nodes and four
 * hardcoded pixel caps (560 / 720), so a customer creating a site did not
 * drift out of AGL-1298's standard — they started outside it. Zach chose "fix
 * before launch", and from Sept 1 the people creating sites are strangers.
 *
 * The issue asked for coverage that can actually go red, so the predicates
 * here are asserted against the exact shapes the templates used to carry —
 * `560`, `720`, `'1328px'` — and not only against the good shape. Two of them
 * are inverted controls that would pass vacuously if the walk found nothing,
 * so the walk's own yield is asserted too.
 */
// The real constant, not a literal: the root id is `'_@_'`, and a wrong
// literal here would silently make `bandsOf` return nothing — the vacuous
// green this suite's first describe block exists to rule out.
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import {
  buildAllStarterTemplateDocs,
  STARTER_TEMPLATES,
  type StarterTemplateScreen,
} from '../constants/starter-templates'

const CANVAS_ROOT = CANVAS_ROOT_ELEMENT_ID

type StoredNode = {
  $id: string
  componentId: string
  parentId?: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
}

/**
 * MUI's stock breakpoint scale, plus the explicit full-bleed opt-out — the
 * same set `libs/plugins/mui/.../container.spec.tsx` pins for the authoring
 * side. Nothing else may reach a Container's `maxWidth`: `1328` is a CONTENT
 * width (1280 plus the Container's own 24px gutters), never a breakpoint.
 */
const STOCK_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl']

const isStockWidth = (value: unknown) =>
  value === false ||
  (typeof value === 'string' && STOCK_BREAKPOINTS.includes(value))

/**
 * True for the shape AGL-1932 exists to keep out: a raw pixel cap, whether
 * spelled as a number or as a `px` string.
 *
 * Percentages and `100%` are NOT caught — they are fluid and carry no
 * bespoke number. The ban is on hand-rolled pixel widths.
 */
const isPixelCap = (value: unknown) =>
  typeof value === 'number' ||
  (typeof value === 'string' && /^\d+(\.\d+)?px$/.test(value))

/** Every screen across every starter, with its starter id for the message. */
const allScreens = (): Array<{ starter: string; screen: StarterTemplateScreen }> =>
  STARTER_TEMPLATES.flatMap((starter) =>
    starter.screens.map((screen) => ({ starter: starter.id, screen })),
  )

/** Every stored node in a screen, excluding the canvas root itself. */
const nodesOf = (screen: StarterTemplateScreen): StoredNode[] =>
  Object.values(screen.nodes as Record<string, StoredNode>).filter(
    (node) => node.$id !== CANVAS_ROOT,
  )

/** The top-level BANDS: the canvas root's own children, in order. */
const bandsOf = (screen: StarterTemplateScreen): StoredNode[] => {
  const map = screen.nodes as Record<string, StoredNode>
  return (map[CANVAS_ROOT]?.nodes ?? []).map((id) => map[id])
}

describe('AGL-1932: the walk itself finds something', () => {
  // Every assertion below is a for-loop over one of these. An empty walk
  // would make all of them vacuously green, which is the exact failure mode
  // the issue warns about, so the yields are pinned first.
  it('there are starters, screens, bands and nodes to check', () => {
    expect(STARTER_TEMPLATES.length).toBeGreaterThanOrEqual(5)
    const screens = allScreens()
    expect(screens.length).toBeGreaterThanOrEqual(13)
    const bands = screens.flatMap(({ screen }) => bandsOf(screen))
    expect(bands.length).toBeGreaterThanOrEqual(13)
    expect(bands.every(Boolean)).toBe(true)
    expect(
      screens.flatMap(({ screen }) => nodesOf(screen)).length,
    ).toBeGreaterThan(50)
  })
})

describe('AGL-1932: every band is a Container at a stock width', () => {
  it('no screen has a bare div/Stack band any more — zero Containers was the finding', () => {
    const offenders: string[] = []
    for (const { starter, screen } of allScreens()) {
      for (const band of bandsOf(screen)) {
        if (band.componentId !== 'muiContainer') {
          offenders.push(`${starter}/${screen.key}: ${band.$id} is ${band.componentId}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('and the count is not zero — the whole finding was that it WAS', () => {
    const containers = allScreens().flatMap(({ screen }) =>
      nodesOf(screen).filter((node) => node.componentId === 'muiContainer'),
    )
    expect(containers.length).toBeGreaterThanOrEqual(13)
  })

  it('every Container width is a stock breakpoint, never a bespoke number', () => {
    const offenders: string[] = []
    for (const { starter, screen } of allScreens()) {
      for (const node of nodesOf(screen)) {
        if (node.componentId !== 'muiContainer') continue
        if (!isStockWidth(node.props?.['maxWidth'])) {
          offenders.push(
            `${starter}/${screen.key}: ${node.$id} = ${JSON.stringify(
              node.props?.['maxWidth'],
            )}`,
          )
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('XL is the default and the majority — Zach confirmed it 2026-08-18', () => {
    // "XL is fine for the default page width on the marketing site, I like
    // that." A standard whose default is used once is not a default.
    const widths = allScreens()
      .flatMap(({ screen }) => nodesOf(screen))
      .filter((node) => node.componentId === 'muiContainer')
      .map((node) => node.props?.['maxWidth'])
    const xl = widths.filter((width) => width === 'xl').length
    expect(xl).toBeGreaterThan(widths.length / 2)
    // All three cases are in use, and nothing outside them.
    expect(new Set(widths)).toEqual(new Set(['xl', 'lg', 'md']))
  })
})

describe('AGL-1932: no hardcoded pixel cap survives anywhere', () => {
  it('no node carries a pixel sx.maxWidth', () => {
    const offenders: string[] = []
    for (const { starter, screen } of allScreens()) {
      for (const node of nodesOf(screen)) {
        const cap = node.sx?.['maxWidth']
        if (cap !== undefined && isPixelCap(cap)) {
          offenders.push(`${starter}/${screen.key}: ${node.$id} sx.maxWidth=${cap}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('nor a pixel props.maxWidth — the same ban, the other spelling', () => {
    const offenders: string[] = []
    for (const { starter, screen } of allScreens()) {
      for (const node of nodesOf(screen)) {
        const cap = node.props?.['maxWidth']
        if (cap !== undefined && isPixelCap(cap)) {
          offenders.push(`${starter}/${screen.key}: ${node.$id} props.maxWidth=${cap}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the four caps the issue listed are gone by VALUE, not just by shape', () => {
    // 560 twice on the landing/portfolio contact bands, 560 on contact-us,
    // 720 on the about-us prose body. Serialized so a cap hiding anywhere in
    // the document — a nested prop, a variant — is still caught.
    const serialized = JSON.stringify(buildAllStarterTemplateDocs())
    expect(serialized).not.toContain('"maxWidth":560')
    expect(serialized).not.toContain('"maxWidth":720')
    expect(serialized).not.toContain('"maxWidth":"560px"')
    expect(serialized).not.toContain('"maxWidth":"720px"')
    expect(serialized).not.toContain('1328')
  })
})

describe('AGL-1932 RED on purpose: the predicates REJECT the old shapes', () => {
  // A predicate that only ever sees passing input proves nothing. These are
  // the exact values `starter-templates.ts` carried at lines 412/463/486/546,
  // plus the marketing host's bespoke content widths.
  it('isPixelCap accepts exactly the shapes the ban targets', () => {
    for (const bad of [560, 720, '560px', '720px', 1328, '1328px', '1392px']) {
      expect(isPixelCap(bad)).toBe(true)
    }
  })

  it('and rejects the shapes that are not pixel caps', () => {
    for (const ok of ['xl', 'md', 'lg', false, undefined, null, '100%']) {
      expect(isPixelCap(ok)).toBe(false)
    }
  })

  it('isStockWidth rejects every bespoke number, including 1328', () => {
    expect(isStockWidth('1328px')).toBe(false)
    expect(isStockWidth(1328)).toBe(false)
    expect(isStockWidth(560)).toBe(false)
    expect(isStockWidth(720)).toBe(false)
    expect(isStockWidth('1392px')).toBe(false)
    expect(isStockWidth('')).toBe(false)
    expect(isStockWidth(null)).toBe(false)
    expect(isStockWidth(undefined)).toBe(false)
  })

  it('and accepts every width the Container plugin actually offers', () => {
    for (const good of ['xs', 'sm', 'md', 'lg', 'xl', false]) {
      expect(isStockWidth(good)).toBe(true)
    }
  })

  it('the band check would CATCH a reintroduced bare band', () => {
    // The pre-fix shape, reconstructed: a top-level Stack carrying the band's
    // own gutters and a pixel cap. Fed through the same two predicates the
    // suite uses, it fails both — so those assertions are load-bearing.
    const reintroduced = {
      $id: 'l_contact',
      componentId: 'muiStack',
      sx: { px: 4, py: 6, maxWidth: 560 },
    } as StoredNode
    expect(reintroduced.componentId).not.toBe('muiContainer')
    expect(isPixelCap(reintroduced.sx?.['maxWidth'])).toBe(true)
    expect(isStockWidth(reintroduced.sx?.['maxWidth'])).toBe(false)
  })
})

describe('AGL-1932: the three width cases are each used deliberately', () => {
  const bandWidth = (starterId: string, screenKey: string, bandId: string) => {
    const screen = STARTER_TEMPLATES.find(
      (starter) => starter.id === starterId,
    )?.screens.find((candidate) => candidate.key === screenKey)
    expect(screen).toBeDefined()
    const band = bandsOf(screen as StarterTemplateScreen).find(
      (candidate) => candidate.$id === bandId,
    )
    expect(band).toBeDefined()
    return band?.props?.['maxWidth']
  }

  it('PROSE: the about-us body is MD, the case the Prose Container exists for', () => {
    // Was `maxWidth: 720`. At XL a paragraph runs 110–120 characters a line;
    // MD (900px) lands near the 65–75 the eye tracks.
    expect(bandWidth('business', 'about-us', 'a_wrapSection')).toBe('md')
  })

  it('PROSE: all three contact bands are MD, not four different numbers', () => {
    expect(bandWidth('landing', 'landing', 'l_contactSection')).toBe('md')
    expect(bandWidth('business', 'contact-us', 'c_wrapSection')).toBe('md')
    expect(bandWidth('portfolio', 'portfolio', 'p_contactSection')).toBe('md')
  })

  it('SECTION: hero and feature bands are XL', () => {
    expect(bandWidth('landing', 'landing', 'l_heroSection')).toBe('xl')
    expect(bandWidth('landing', 'landing', 'l_featuresSection')).toBe('xl')
    expect(bandWidth('business', 'home', 'b_servicesSection')).toBe('xl')
    expect(bandWidth('portfolio', 'portfolio', 'p_gridSection')).toBe('xl')
  })

  it('MIDDLE: LG is claimed by the text-led commerce screens', () => {
    // Not decoration — a cart and an account screen are wide tables read line
    // by line, so a full XL band spreads them past where the eye tracks.
    expect(bandWidth('physical-shop', 'cart', 'ps_c_section')).toBe('lg')
    expect(bandWidth('physical-shop', 'account', 'ps_a_section')).toBe('lg')
    expect(bandWidth('digital-shop', 'cart', 'ds_c_section')).toBe('lg')
  })
})

describe('AGL-1932: persisted node ids are not renamed by this change', () => {
  it('every id the old templates carried still exists, as a child', () => {
    // The file states it plainly: node ids appear in stored documents and
    // must never be renamed. Bands were WRAPPED — the Containers are new ids
    // — so the pre-existing ones survive with their parents re-pointed.
    const ids = new Set(
      allScreens().flatMap(({ screen }) => nodesOf(screen).map((n) => n.$id)),
    )
    for (const id of [
      'l_hero',
      'l_features',
      'l_contact',
      'l_contactTitle',
      'b_services',
      'a_wrap',
      'c_wrap',
      'p_grid',
      'p_contact',
      'ps_h_grid',
      'ps_s_title',
      'ps_c_cart',
      'ds_a_account',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('and every wrapped band now has a Container as its parent', () => {
    for (const { screen } of allScreens()) {
      const map = screen.nodes as Record<string, StoredNode>
      for (const band of bandsOf(screen)) {
        for (const childId of band.nodes ?? []) {
          expect(map[childId]?.parentId).toBe(band.$id)
        }
      }
    }
  })

  it('the seeded document ids are unchanged — re-seeding overwrites, not stacks', () => {
    // `starterTemplateDocId` derives from starter id + screen key, and this
    // pass touched neither. Pinned so a future band edit cannot quietly
    // duplicate every starter on the next seed run.
    expect(buildAllStarterTemplateDocs().map((doc) => doc.id)).toEqual([
      'starter-landing-landing',
      'starter-business-home',
      'starter-business-about-us',
      'starter-business-contact-us',
      'starter-portfolio-portfolio',
      'starter-physical-shop-home',
      'starter-physical-shop-shop',
      'starter-physical-shop-product',
      'starter-physical-shop-cart',
      'starter-physical-shop-account',
      'starter-digital-shop-home',
      'starter-digital-shop-shop',
      'starter-digital-shop-product',
      'starter-digital-shop-cart',
      'starter-digital-shop-account',
    ])
  })
})
