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
 * AGL-2486: the staff org detail page lays its cards out as BALANCED columns.
 *
 * The defect was a twelve-card flex grid of six rigid rows: every item in a
 * wrapped row is as tall as the tallest one in it, so `Effective
 * entitlements` — a long table — stretched `Metered usage` beside it to its
 * own height and drew it as a mostly-empty card. Measured in Chrome at 1440px
 * with representative card heights, that empty tail was 1042px.
 *
 * jsdom performs no layout, so this asserts the CSS the component EMITS
 * rather than the geometry — the mechanism, which is the part that can
 * regress in a code change. The geometry was measured separately in a real
 * browser against exactly the declarations pinned here.
 */

import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import CardColumns, {
  type CardColumnsProps,
} from '../components/card-columns.component'

/** Every rule emotion emitted for the rendered tree, as text. */
const stylesheet = () =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText)
      } catch {
        return []
      }
    })
    .join('\n')

const rulesFor = (className: string) =>
  stylesheet()
    .split('\n')
    .filter((line) => line.includes(className))

function mount(props?: Omit<CardColumnsProps, 'items'>) {
  const { container } = render(
    <CardColumns
      {...props}
      items={[
        { key: 'a', children: <div>{'card a'}</div> },
        { key: 'b', children: <div>{'card b'}</div> },
      ]}
    />,
  )
  const root = container.firstElementChild as HTMLElement
  const generated = root.className
    .split(' ')
    .find((name) => name.startsWith('css-'))
  // Guard the guard: with no generated class every `toContain` below would be
  // asserting over the whole document's CSS, or over nothing at all.
  expect(generated).toBeTruthy()
  return { root, rules: rulesFor(generated as string) }
}

describe('CardColumns', () => {
  it('emits a two-column flow that the browser BALANCES', () => {
    const { rules } = mount()
    const text = rules.join('\n')
    // `column-fill` is left at its `balance` default on purpose — that
    // default is the whole mechanism, so declaring `auto` anywhere here
    // would silently restore a ragged first column.
    expect(text).not.toContain('column-fill: auto')
    expect(text).toMatch(/@media \(min-width:900px\)/)
    expect(
      rules.find((rule) => rule.includes('min-width:900px')),
    ).toContain('column-count: 2')
  })

  it('collapses to ONE column below md', () => {
    // The narrow case is not a nicety: two columns of cards at phone width is
    // unreadable, and the flex grid it replaces collapsed via `xs: 12`.
    const { rules } = mount()
    const base = rules.find((rule) => rule.includes('min-width:0px'))
    expect(base).toContain('column-count: 1')
  })

  it('never lets a card be sawn across the column boundary', () => {
    // Multicol is a fragmentation context. Without this a long table is split
    // in half and continues at the top of the next column — a worse defect
    // than the hole this component exists to close.
    const { rules } = mount()
    const child = rules.find((rule) => rule.includes('>*'))
    // Anchored, not `toContain`: `-webkit-column-break-inside: avoid`
    // CONTAINS the string `break-inside: avoid`, so the loose form passes
    // with the standard property deleted — which is what the mutation run
    // caught. The prefixed alias alone does not stop modern Chrome.
    expect(child).toMatch(/(^|[;{] ?)break-inside: avoid/)
    expect(child).toContain('page-break-inside: avoid')
    expect(child).toContain('-webkit-column-break-inside: avoid')
  })

  it('spaces the cards from the theme, not from a hard-coded pixel count', () => {
    const wide = mount({ spacing: 3 })
    expect(wide.rules.join('\n')).toContain('column-gap: 24px')
    expect(wide.rules.find((rule) => rule.includes('>*'))).toContain(
      'margin-bottom: 24px',
    )
    const tight = mount({ spacing: 1 })
    expect(tight.rules.join('\n')).toContain('column-gap: 8px')
  })

  it('honours a column count other than two', () => {
    const { rules } = mount({ columns: 3 })
    expect(rules.find((rule) => rule.includes('min-width:900px'))).toContain(
      'column-count: 3',
    )
  })

  it('hides a wrapper whose card rendered NOTHING', () => {
    // `PluginWidgetSlot` renders an empty fragment when no plugin is entitled
    // for the slot. Its wrapper would then be an empty block carrying only
    // `margin-bottom`, which multicol counts as content and balances the
    // columns around — a hole reintroduced by the component that exists to
    // close holes.
    const { rules } = mount()
    const empty = rules.find((rule) => rule.includes(':empty'))
    expect(empty).toBeTruthy()
    expect(empty).toContain('display: none')
    // THE CONTROL: it must be the `:empty` rule that hides them, not a blanket
    // one — the non-empty children are still `display: block`.
    const child = rules.find(
      (rule) => rule.includes('>*') && !rule.includes(':empty'),
    )
    expect(child).toContain('display: block')
  })

  it('renders every item it is handed, in order', () => {
    const { root } = mount()
    expect(root.children).toHaveLength(2)
    expect(root.textContent).toBe('card acard b')
  })
})

describe('the org detail page uses it', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app/(app)/admin/orgs/[orgId]/page.tsx'),
    'utf8',
  )

  it('reads a real file', () => {
    expect(source.length).toBeGreaterThan(10000)
  })

  it('no longer pins the cards into rigid rows of two', () => {
    // `size={{ xs: 12, md: 6 }}` on twelve cards IS the bug: it is what makes
    // a row, and a row is what stretches its shorter card.
    expect(source).toContain('CardColumns')
    expect(source).not.toMatch(/size:\s*\{\s*xs:\s*12,\s*md:\s*6\s*\}/)
  })

  it('does not reach for GridItems masonry, which cannot arrange same-width cards', () => {
    // `GridItems masonry` buckets by `size`; twelve identically-sized cards
    // are one bucket and therefore one half-width column with the other half
    // of the page empty. Pinned because it is the obvious wrong fix.
    expect(source).not.toContain('GridItems')
  })
})

describe('the billing page pairs its narrow cards (AGL-2486)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app/(app)/[orgSlug]/billing/page.tsx'),
    'utf8',
  )

  it('reads a real file', () => {
    expect(source.length).toBeGreaterThan(10000)
  })

  it('routes the narrow cards through CardColumns', () => {
    expect(source).toContain('<CardColumns')
  })

  it('keeps GridItems masonry for the band whose cards differ in width', () => {
    // The two are used TOGETHER here, and that is the point: the top band is
    // `md: 4` beside `md: 8`, which is masonry's actual case. Deleting it in
    // favour of one layout would flatten Current plan / Usage / Metered
    // estimate into equal columns and lose the emphasis.
    expect(source).toContain('masonry')
    expect(source).toMatch(/size:\s*\{\s*xs:\s*12,\s*md:\s*8\s*\}/)
  })

  it('no longer gives a one-sentence card the full page width', () => {
    // Every one of these declared `size: { xs: 12 }`, and a full-width item
    // is its own band — one card per page width, seven deep. They are keyed
    // items inside CardColumns now, so the presence of the key with no
    // sibling `size` is what says the card is in the balanced flow.
    for (const key of [
      'usage-history',
      'storage-cap',
      'usage-budget',
      'billing-history',
      'plan-addons',
      'register-seats',
      'collaborator-seats',
    ]) {
      expect(source).toContain(`key: '${key}'`)
    }
  })

  it('leaves the plan comparison grid at full width', () => {
    // The win is the narrow cards pairing up. The plan grid is twelve
    // columns of tier comparison and the Enterprise row spans it — pairing
    // those would be a regression, so the full-width items must survive.
    expect(source).toMatch(/size:\s*\{\s*xs:\s*12\s*\}/)
    expect(source).toContain('<BillingPlanCardsComponent')
  })
})

describe('the staff user detail page balances its narrow run (AGL-2486)', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app/(app)/admin/users/[uid]/page.tsx'),
    'utf8',
  )

  it('reads a real file', () => {
    expect(source.length).toBeGreaterThan(10000)
  })

  it('no longer pins the five narrow cards into rows of two', () => {
    // Five cards declaring `md: 6` are three rigid rows — the same shape the
    // org page had, and the same consequence: `Organizations` is a table that
    // grows with the account's memberships and stretched `Password` beside it
    // into a mostly-empty card, while the fifth card sat alone with a
    // half-width hole next to it.
    expect(source).toContain('<CardColumns')
    expect(source).not.toMatch(/size:\s*\{\s*xs:\s*12,\s*md:\s*6\s*\}/)
  })

  it('does not reach for GridItems masonry, the obvious WRONG fix', () => {
    // `GridItems masonry` buckets by `size`: five cards sharing one width
    // share ONE column and leave the other half of the page empty. It is the
    // regression the org page arrived at by using the fix, so pin it here
    // rather than rediscover it on a staff-only page nobody measures.
    //
    // Anchored to the JSX PROP, not to the word: the page's own comment names
    // `GridItems masonry` as the fix it declined, and a loose `toContain`
    // fails on that comment while a page that actually passed the prop with
    // the comment deleted would pass. It is the prop that changes the layout.
    expect(source).not.toMatch(/^\s*masonry\s*$/m)
  })

  it('carries every one of the five cards into the balanced flow', () => {
    // A key with no sibling `size` is what says a card is in the multicol
    // flow rather than a grid band. Named individually so dropping one on the
    // floor during a future edit is a red, not a quietly shorter page.
    for (const key of [
      'identity',
      'organizations',
      'password',
      'device-sessions',
      'erase',
    ]) {
      expect(source).toContain(`key: '${key}'`)
    }
  })

  it('leaves the two wide cards in the grid, at full width', () => {
    // The win is the narrow run pairing up. Legal acceptances and the audit
    // trail are wide tables and earn the page width, so `GridItems` stays and
    // the full-width items with it — CardColumns is nested inside one of
    // them, exactly as on the billing page.
    expect(source).toContain('<GridItems')
    expect(source).toMatch(/size:\s*\{\s*xs:\s*12\s*\}/)
  })
})
