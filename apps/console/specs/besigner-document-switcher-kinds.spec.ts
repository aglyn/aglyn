/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

// Jest's cwd is the repo root here, not apps/console.
const read = (rel: string) =>
  readFileSync(join(process.cwd(), 'apps/console', rel), 'utf8')

const SWITCHER = 'components/besigner-document-switcher.component.tsx'
const EDITOR = 'app/(editor)/[orgSlug]/hosts/[host]'
const COMPONENT_BESIGNER = `${EDITOR}/components/[componentId]/versions/[versionId]/besigner/page.tsx`
const SCREEN_BESIGNER = `${EDITOR}/screens/[screenId]/versions/[versionId]/besigner/page.tsx`
const LAYOUT_BESIGNER = `${EDITOR}/layouts/[layoutId]/versions/[versionId]/besigner/page.tsx`

/**
 * AGL-2486. Why do we not have a component switcher like we have a
 * screen switcher in the besigner and layout switcher on layouts etc.
 *
 * There was no reason — the switcher's kind union stopped at
 * `'screen' | 'layout'`, and the components editor never mounted it. Source
 * assertions rather than a render test because the failure mode is a page that
 * simply does not pass the control, which renders perfectly and is missing.
 */
describe('besigner document switcher covers every editable kind (AGL-2486)', () => {
  it('accepts components in its kind union', () => {
    const source = read(SWITCHER)
    expect(source).toContain(
      "export type SwitchableKind = 'screen' | 'layout' | 'component'",
    )
  })

  it('routes a component selection to the component besigner', () => {
    // Picking a component must not fall through to the layout branch, which
    // is what a two-way ternary would have done with a third kind.
    expect(read(SWITCHER)).toContain('Route.COMPONENT_BESIGNER')
  })

  it('is mounted by all three editors that have one', () => {
    for (const page of [SCREEN_BESIGNER, LAYOUT_BESIGNER, COMPONENT_BESIGNER]) {
      expect(read(page)).toContain('BesignerDocumentSwitcherComponent')
    }
  })

  it('does not read components until the menu is opened', () => {
    // Standing rule: an expensive read needs an ask, not a mount. A besigner
    // that never touches this control should not pay for a list nobody asked
    // to see — the query is null until `anchorEl` exists.
    const source = read(SWITCHER)
    const gated = /anchorEl\s*\?\s*query\(\s*\n?\s*collection\(firestore, 'hosts', hostId, 'components'\)/
    expect(gated.test(source.replace(/\s+/g, ' ').replace(/ /g, ' '))).toBe(
      true,
    )
  })
})
