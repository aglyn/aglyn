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

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAglynSiteTheme } from '@aglyn/aglyn-node-renderer/hooks/use-aglyn-site-theme'
import { BesignerDeviceFlag } from '@aglyn/besigner/constants/besigner'
import { devicePreviewWidth } from '@aglyn/besigner/device-preview-width'
import {
  AI_AUDIT_DEVICES,
  aiDeviceAuditFindings,
  aiInventoryHostTheme,
  aiLayoutRowIsBand,
  type AiDeviceAudit,
} from '../runtime/ai-device-audit'
import {
  AI_FREE_PAGE_FIXTURE,
  AI_FREE_PRACTICE_AREAS_FIXTURE,
  AI_PAGE_BRIEF_FIXTURES,
  AI_TWO_PERSON_PAGE_FIXTURE,
  type AiGoldenSection,
  type AiPageBriefFixture,
} from './fixtures/ai-page-briefs'

/**
 * The golden pages at every width the besigner's device switcher previews
 * (AGL-2907, AGL-3020).
 *
 * The audit is a RECORDED fixture, not a run: rendering the pages through the
 * component bundles and laying them out in a browser takes minutes, so
 * `tools/scripts/record-ai-page-axe.mts` renders each page at each device of
 * the switcher — the width `devicePreviewWidth` gives it on the site theme's
 * breakpoints, with the theme and every element pinned to that width as the
 * canvas pins them — and writes what the browser measured. These hold the
 * page step's goldens to it: nothing wider than a screen, no band that keeps
 * its desktop columns on a phone, every golden row one column on a phone and
 * more than one on a laptop and a desktop, and no serious or critical axe
 * violation at any width. A changed golden answer changes its fingerprint,
 * and a width the switcher no longer previews is a different number, so a
 * stale recording is a failure here rather than a quiet, meaningless pass.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

interface RecordedPage extends AiDeviceAudit {
  id: string
  answers: string
  markupChars: number
}

const recorded = JSON.parse(readFileSync(join(__dirname, 'fixtures/ai-page-axe.generated.json'), 'utf8')) as {
  axeVersion: string
  rulesOff: string[]
  pages: RecordedPage[]
}

/** Every golden page the page step's evals build from a site's inventory, in the order the recorder renders them. */
const GOLDEN_PAGES: readonly AiPageBriefFixture[] = [
  ...AI_PAGE_BRIEF_FIXTURES,
  AI_FREE_PAGE_FIXTURE,
  AI_FREE_PRACTICE_AREAS_FIXTURE,
  AI_TWO_PERSON_PAGE_FIXTURE,
]

/** The fingerprint the recorder writes, computed the same way it computes it. */
const fingerprint = (fixture: AiPageBriefFixture): string =>
  createHash('sha256').update(JSON.stringify(fixture.answers)).digest('hex').slice(0, 16)

const pageOf = (fixture: AiPageBriefFixture): RecordedPage => {
  const page = recorded.pages.find((entry) => entry.id === fixture.id)
  if (!page) throw new Error(`${fixture.id} was never recorded`)
  return page
}

/** The Grid containers a section answer draws: after its repeated items are drawn, still one each. */
const gridContainers = (answer: AiGoldenSection): number =>
  Object.values(answer.nodes).filter((node) => node.componentId === 'muiGrid' && node.props?.['container'] === true).length

describe('the golden pages at every device width (AGL-3020)', () => {
  it('renders every golden page the page step builds from a site, from the answers they hold now', () => {
    expect(recorded.pages.map((page) => page.id)).toEqual(GOLDEN_PAGES.map((fixture) => fixture.id))
    // Re-record with: node tools/scripts/record-ai-page-axe.mts
    expect(GOLDEN_PAGES.filter((fixture) => pageOf(fixture).answers !== fingerprint(fixture)).map((fixture) => fixture.id)).toEqual([])
    expect(recorded.pages.every((page) => page.markupChars > 0)).toBe(true)
  })

  it.each(GOLDEN_PAGES.map((fixture) => [fixture.id, fixture] as const))(
    '%s: rendered at each device of the switcher, at the width the switcher previews it at on the site theme',
    (_id, fixture) => {
      // The theme the canvas renders the site with, and so the breakpoints its switcher reads.
      const theme = createAglynSiteTheme({ theme: aiInventoryHostTheme(fixture.inventory.theme) ?? undefined })
      const expected = AI_AUDIT_DEVICES.map((device) => ({
        device,
        width: devicePreviewWidth(BesignerDeviceFlag[device], theme.breakpoints.values),
      }))
      expect(pageOf(fixture).devices.map(({ device, width }) => ({ device, width }))).toEqual(expected)
    },
  )

  it('finds no page wider than a screen and no band that keeps its desktop columns on a phone', () => {
    expect(recorded.pages.flatMap((page) => aiDeviceAuditFindings(page).map((finding) => `${page.id}: ${finding}`))).toEqual([])
  })

  it('holds every row a golden page draws to one column on a phone and more than one at MD and LG', () => {
    const rows = recorded.pages.flatMap((page) =>
      page.rows.filter((row) => row.grid || aiLayoutRowIsBand(row)).map((row) => ({ page: page.id, row })),
    )
    expect(
      rows
        .filter(({ row }) => !(row.columns.XS === 1 && row.columns.MD > 1 && row.columns.LG > 1))
        .map(({ page, row }) => `${page}: ${row.node} ${JSON.stringify(row.columns)}`),
    ).toEqual([])
    // Every Grid container the goldens write is a row the recording measured,
    // so a golden grid cannot pass by never being measured.
    for (const fixture of GOLDEN_PAGES) {
      const written = fixture.answers.reduce((sum, answer) => sum + gridContainers(answer), 0)
      expect([fixture.id, pageOf(fixture).rows.filter((row) => row.grid).length]).toEqual([fixture.id, written])
    }
    expect(rows.length).toBeGreaterThan(GOLDEN_PAGES.length)
    // The two-person introduction is a Stack whose direction turns at md, not a Grid: held all the same.
    expect(pageOf(AI_TWO_PERSON_PAGE_FIXTURE).rows.filter((row) => !row.grid && aiLayoutRowIsBand(row))).toEqual([
      expect.objectContaining({ component: 'muiStack', columns: { XS: 1, SM: 1, MD: 2, LG: 2, XL: 2 } }),
    ])
  })

  it('finds no serious or critical axe violation on any golden page at any width', () => {
    const unaudited = recorded.pages.flatMap((page) =>
      page.devices.filter((render) => render.violations === undefined).map((render) => `${page.id} ${render.device}`),
    )
    expect(unaudited).toEqual([])
    const serious = recorded.pages.flatMap((page) =>
      page.devices.flatMap((render) =>
        (render.violations ?? [])
          .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
          .map((violation) => `${page.id} ${render.device}: ${violation.id}`),
      ),
    )
    expect(serious).toEqual([])
  })

  it('names in the developer notes what it measured, at which widths, and every rule it left off', () => {
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toContain(`axe-core ${recorded.axeVersion}`)
    // A rule the recorder turned off is a gap the notes own, not a silence.
    for (const rule of recorded.rulesOff) expect(notes).toContain(rule)
    const [first] = recorded.pages
    const widths = first.devices.map((render) => `${render.device} ${render.width}`)
    expect(notes).toContain(`${widths.slice(0, -1).join(', ')} and ${widths[widths.length - 1]}`)
    // Lighthouse's accessibility category is axe underneath, but no Lighthouse
    // run happens here and the notes must not imply one.
    expect(notes).not.toMatch(/lighthouse/i)
  })
})
