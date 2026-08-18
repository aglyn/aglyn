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
 * AGL-2113: an enforced per-site quota is visible BEFORE it refuses.
 *
 * Two halves, and the second is the one that matters. The first exercises the
 * component. The second is a CALL-SITE assertion over the seven cards that
 * enforce a per-site quota — in the shape AGL-2056/AGL-2080 established,
 * because a spec that only rendered this component would have passed for the
 * entire period five of those cards never mounted it. The endpoint was never
 * the problem; the card never asked.
 */

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import QuotaReadoutComponent from './quota-readout.component'

const LIB = join(__dirname, '..', '..', '..', '..', '..', '..')

/**
 * Console surface → the quota it enforces, and the file that enforces it.
 * A card that gates a create on `checkQuota` and never shows the number is
 * the defect; this table is the set, so a sibling nobody checked cannot be
 * how the next one gets here.
 */
const QUOTA_SURFACES: Array<{ file: string; quota: string }> = [
  {
    file: 'plugins/commerce/src/lib/components/console/products-hub-card.component.tsx',
    quota: 'productsPerHost',
  },
  {
    file: 'plugins/commerce/src/lib/components/console/locations-card.component.tsx',
    quota: 'inventoryLocations',
  },
  {
    file: 'plugins/workflows/src/lib/components/host-workflows-card.component.tsx',
    quota: 'workflowsPerHost',
  },
  {
    file: 'plugins/redirects/src/lib/components/redirects-console-page.tsx',
    quota: 'redirectsPerHost',
  },
  {
    file: 'plugins/bookings/src/lib/components/bookings-console-page.tsx',
    quota: 'servicesPerHost',
  },
  {
    file: 'plugins/data/src/lib/components/host-datasets-card.component.tsx',
    quota: 'recordsPerDataset',
  },
]

function source(file: string): string {
  return readFileSync(join(LIB, file), 'utf8')
}

describe('QuotaReadoutComponent', () => {
  it('shows used over limit once the plan has resolved', () => {
    render(
      <QuotaReadoutComponent
        ready
        used={7}
        limit={100}
        noun="product"
      />,
    )
    expect(screen.getByText('7/100 products on your plan')).toBeTruthy()
  })

  it('renders an unlimited cap as ∞ rather than "Infinity"', () => {
    render(
      <QuotaReadoutComponent
        ready
        used={4}
        limit={Number.POSITIVE_INFINITY}
        noun="redirect"
      />,
    )
    expect(screen.getByText('4/∞ redirects on your plan')).toBeTruthy()
  })

  it('never invents a denominator while the plan is in flight', () => {
    // THE LOADING-DEFAULT TRAP. `checkQuota(undefined, …)` resolves the FREE
    // tier, not "unknown" — so a readout that rendered `limit` before the org
    // doc landed would tell a paying customer they are on `0/0`. It must show
    // no denominator at all until `ready`.
    const { container } = render(
      <QuotaReadoutComponent
        ready={false}
        used={12}
        limit={0}
        noun="service"
      />,
    )
    expect(screen.getByText('12 services · checking your plan…')).toBeTruthy()
    expect(container.textContent).not.toContain('/0')
    expect(container.textContent).not.toContain('on your plan')
  })

  it('agrees with the singular while it is still loading', () => {
    render(
      <QuotaReadoutComponent
        ready={false}
        used={1}
        limit={0}
        noun="record"
      />,
    )
    expect(screen.getByText('1 record · checking your plan…')).toBeTruthy()
  })

  it('honours an irregular plural', () => {
    render(
      <QuotaReadoutComponent
        ready
        used={2}
        limit={5}
        noun="entry"
        nounPlural="entries"
      />,
    )
    expect(screen.getByText('2/5 entries on your plan')).toBeTruthy()
  })
})

describe('AGL-2113 · every enforced per-site quota has a standing readout', () => {
  it('asserts over a real, non-empty surface table', () => {
    // A table that silently matched nothing would let every per-surface
    // check below pass by iterating an empty list.
    expect(QUOTA_SURFACES.length).toBeGreaterThanOrEqual(6)
    expect(new Set(QUOTA_SURFACES.map((s) => s.quota)).size).toBe(
      QUOTA_SURFACES.length,
    )
  })

  it.each(QUOTA_SURFACES)('$file enforces $quota', ({ file, quota }) => {
    // The premise of the row. If a card stops enforcing the quota, this
    // table is stale and the readout assertion below is meaningless.
    expect(source(file)).toContain(`'${quota}'`)
  })

  it.each(QUOTA_SURFACES)(
    '$file mounts the shared readout',
    ({ file }) => {
      const text = source(file)
      expect(text).toContain('QuotaReadoutComponent')
      // Mounted, not merely imported — an unused import satisfies a
      // grep for the name and renders nothing.
      expect(text).toMatch(/<QuotaReadoutComponent\b/)
    },
  )

  it.each(QUOTA_SURFACES)(
    '$file passes a real ready flag, never a literal',
    ({ file }) => {
      // `ready` is the whole loading-default guard. `ready` (bare, i.e.
      // `ready={true}`) or `ready={true}` would render the free tier's cap
      // at a paying customer for the first render or two.
      const text = source(file)
      const mount = /<QuotaReadoutComponent[\s\S]*?\/>/.exec(text)?.[0] ?? ''
      expect(mount).toMatch(/ready=\{/)
      expect(mount).not.toMatch(/ready=\{true\}/)
      expect(mount).not.toMatch(/ready(\s|\n)*[/>]/)
    },
  )

  it('no card re-implements the readout string locally', () => {
    // The duplication this replaced. Two cards had hand-rolled it and five
    // had nothing; a sixth hand-rolling it again is how the wording drifts
    // back apart.
    for (const { file } of QUOTA_SURFACES) {
      const text = source(file)
      const handRolled = /`\$\{[^`]*\}\/\$\{[^`]*\} [a-z]+ on your plan`/
      expect(text).not.toMatch(handRolled)
    }
  })
})
