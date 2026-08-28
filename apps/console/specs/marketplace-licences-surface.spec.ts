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
 *
 * @jest-environment node
 */

/**
 * THE LICENCE SURFACE IS REACHABLE (AGL-2331).
 *
 * A marketplace purchase licenses the installing organization now, which
 * creates two questions nothing in the console could answer: which workspace
 * holds a licence, and whether this workspace needs its own. The model change
 * is not shipped until somebody can see the answer — a panel that exists in
 * the repo but hangs off no route is the same as no panel.
 *
 * Source-level rather than a render test, deliberately: what can silently
 * regress here is the WIRING (a tab removed, a prop dropped, the panel gated
 * behind the publisher permission it must not be gated behind), and every one
 * of those survives a render test of the component in isolation.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (relative: string) =>
  readFileSync(join(__dirname, '..', relative), 'utf8')

// Licences is a section ROUTE since AGL-693, so its wiring lives in the
// section list and its own page rather than in one page's tab array.
const SECTIONS = 'constants/marketplace-sections.ts'
const PAGE = 'app/(app)/[orgSlug]/marketplace/(sections)/licences/page.tsx'
const PANEL = 'components/org-licences-panel.component.tsx'

describe('the org marketplace carries a Licences section (AGL-2331)', () => {
  it('mounts the panel from its own section page', () => {
    const page = read(PAGE)
    expect(page).toContain('<OrgLicencesPanel')
    expect(page).toContain('org-licences-panel.component')
  })

  it('is listed as a section, so the rail and the trail both name it', () => {
    expect(read(SECTIONS)).toContain("id: 'licences'")
  })

  it('is NOT gated on the publisher permission', () => {
    /*
     * The section that answers "does this workspace own it" is for BUYERS.
     * The seller sections beside it carry `seller: true`, which the layout
     * turns into both a hidden rail entry and a refused route — and marking
     * this one the same way, the obvious slip since it sits adjacent to them,
     * would hide it from every customer who never publishes, which is nearly
     * all of them.
     *
     * Read off the section's own entry rather than from its position in the
     * file: ordering says nothing once the gate is a field.
     */
    const sections = read(SECTIONS)
    const entry = sections.slice(sections.indexOf("id: 'licences'"))
    const nextEntry = entry.indexOf("id: '", 1)
    expect(entry.slice(0, nextEntry)).toContain('seller: false')
  })

  it('reads the licence by ORG, not only by buyer', () => {
    // The whole point. A panel that queried `buyerUid` alone would show the
    // buyer their own receipts and show a colleague nothing — reproducing, in
    // the surface, exactly the person-scoped model this issue removed.
    const panel = read(PANEL)
    expect(panel).toContain("where('buyerOrgId', '==', orgId)")
    expect(panel).toContain("where('buyerUid', '==', uid)")
  })

  it('holds both queries at null until their key resolves', () => {
    // `marketplacePurchases` is buyer/org/seller-gated and a rules-shaped LIST
    // is evaluated against the QUERY (AGL-1440), so a sentinel key is a
    // guaranteed denial retried on the refusal cadence — not an empty list.
    const panel = read(PANEL)
    expect(panel).toMatch(/orgId\s*\n?\s*\?\s*query\(/)
    expect(panel).toMatch(/uid\s*\n?\s*\?\s*query\(/)
    expect(panel).not.toContain('-anonymous-')
    expect(panel).not.toContain('-pending-')
  })

  it('says what a legacy purchase licenses instead of guessing a workspace', () => {
    // A purchase written before AGL-2331 names no organization. Rendering it
    // as belonging to the workspace you happen to be standing in would be the
    // silent reinterpretation the migration refuses to make.
    expect(read(PANEL)).toContain('Every workspace you belong to')
  })
})
