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
 * Proves the container-width detector can FAIL (AGL-1296).
 *
 * The audit it backs is the only thing that measures whether AGL-1298's
 * standard — `props.maxWidth` on prebuilt breakpoints, never a bespoke pixel
 * cap — actually holds in the corpus. That corpus is authored node data in
 * Firestore, so the audit needs credentials and cannot run on a PR. Its
 * DETECTOR does not, and this is the half that runs in CI: a scan whose
 * failure path has never executed is not evidence, whoever runs it.
 *
 * The claim being replaced is `container.spec.tsx`'s "the /pricing audit
 * measured 8/8 sections on maxWidthXl", which is a COMMENT beside an
 * assertion about a preset literal. Nothing re-derived it, and nothing would
 * have failed if the page had drifted to 3/8.
 *
 * Read with `tools/scripts/audit-marketing-containers.mjs`, which is how the
 * corpus half is run:
 *
 *   npm run audit:marketing-containers -- --published-only
 *
 * from a checkout with ADC on `aglyn-main`. It exits 1 on any finding below.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  STOCK_MAX_WIDTHS,
  auditContainerNodes,
  containerDepth,
} from './marketing-containers.mjs'

/** A one-section screen: root → band → Container → content. */
const screen = ({ container = {}, band = {} } = {}) => ({
  root: { componentId: 'box', nodes: ['band'] },
  band: { componentId: 'muiStack', parentId: 'root', nodes: ['c'], ...band },
  c: {
    componentId: 'muiContainer',
    parentId: 'band',
    nodes: [],
    props: { maxWidth: 'xl' },
    ...container,
  },
})

describe('container-width detector (AGL-1296)', () => {
  it('is CLEAN on a stock screen — the baseline the failures are measured against', () => {
    const census = auditContainerNodes(screen())
    assert.deepEqual(census.bespoke, [])
    assert.deepEqual(census.nonStock, [])
    assert.deepEqual(census.uncontained, [])
    assert.equal(census.sections, 1)
    assert.deepEqual(census.widths, { '"xl"': 1 })
  })

  it('flags a bespoke sx cap — the exact 1328px shape AGL-1298 banned', () => {
    // `1b0bfda38`'s deleted one-shot script wrote precisely this: an
    // `sx.maxWidth` pixel cap alongside `maxWidth: false`. It is the thing
    // that must never come back, and until now nothing could tell if it had.
    const census = auditContainerNodes(
      screen({ container: { props: { maxWidth: false }, sx: { maxWidth: '1328px' } } }),
      { name: 'pricing' },
    )
    assert.equal(census.bespoke.length, 1)
    assert.equal(census.bespoke[0].sx, '1328px')
    assert.equal(census.bespoke[0].nodeId, 'c')
    assert.equal(census.bespoke[0].name, 'pricing')
  })

  it('finds an sx cap nested under props too', () => {
    // Node documents carry `sx` in both places depending on how they were
    // written; reading only one of them would report clean over the other.
    const census = auditContainerNodes(
      screen({ container: { props: { maxWidth: 'xl', sx: { maxWidth: 1328 } } } }),
    )
    assert.equal(census.bespoke.length, 1)
    assert.equal(census.bespoke[0].sx, 1328)
  })

  it('flags a NON-STOCK props.maxWidth, which the dropdown cannot produce', () => {
    // The attribute offers only the six prebuilt values, so a hit here means
    // an import, an API write or a pasted node map got in — the write paths
    // the authoring UI does not cover. That gap is why the ban was
    // documentation rather than enforcement.
    const census = auditContainerNodes(
      screen({ container: { props: { maxWidth: '1328px' } } }),
    )
    assert.equal(census.nonStock.length, 1)
    assert.equal(census.nonStock[0].props, '1328px')
    // And not double-counted as a bespoke sx cap — the two arrive by
    // different routes and the report has to say which.
    assert.deepEqual(census.bespoke, [])
  })

  it('accepts every stock value, including false and an unset attribute', () => {
    // `false` means "do not constrain" and an unset attribute renders at
    // MUI's own default. Flagging either would make the check noise, and a
    // noisy check gets turned off — which is how a ban ends up as a comment.
    for (const width of STOCK_MAX_WIDTHS) {
      const census = auditContainerNodes(
        screen({ container: { props: { maxWidth: width } } }),
      )
      assert.deepEqual(census.nonStock, [], `${JSON.stringify(width)} flagged`)
    }
    const unset = auditContainerNodes(screen({ container: { props: {} } }))
    assert.deepEqual(unset.nonStock, [])
    assert.deepEqual(unset.widths, { '(missing)': 1 })
  })

  it('flags a section with no Container anywhere beneath it', () => {
    const census = auditContainerNodes({
      root: { componentId: 'box', nodes: ['band'] },
      band: {
        componentId: 'muiStack',
        parentId: 'root',
        nodes: ['t'],
        props: { ariaLabel: 'newsletter' },
      },
      t: { componentId: 'muiTypography', parentId: 'band' },
    })
    assert.equal(census.uncontained.length, 1)
    assert.equal(census.uncontained[0].label, 'newsletter')
  })

  it('does not count a layout slot or a reusable instance as a section', () => {
    // Both delegate their structure elsewhere, so demanding a Container
    // inside them would manufacture findings the author cannot act on.
    const census = auditContainerNodes({
      root: { componentId: 'box', nodes: ['slot', 'inst'] },
      slot: { componentId: 'layoutSlot', parentId: 'root' },
      inst: { componentId: 'reusableInstance', parentId: 'root' },
    })
    assert.equal(census.sections, 0)
    assert.deepEqual(census.uncontained, [])
  })

  it('finds a Container at any depth under the band', () => {
    assert.equal(
      containerDepth(
        { componentId: 'muiStack', nodes: ['a'] },
        {
          a: { componentId: 'muiBox', nodes: ['b'] },
          b: { componentId: 'muiContainer', nodes: [] },
        },
      ),
      2,
    )
  })
})
