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
 * THE BACKFILL'S TABLE, CHECKED AGAINST THE BUNDLES IT CLAIMS TO DESCRIBE.
 *
 * `tools/scripts/backfill-node-plugin-ids.mjs` maps a component id to the
 * bundle that registers it. Nothing in a `.mjs` script can import a TypeScript
 * bundle, so that table is written by hand — and a hand-written table about
 * which package holds which element is exactly the thing that goes stale the
 * next time an element moves. It goes stale SILENTLY, too: a missing row makes
 * the backfill report a clean zero for the ids it does not know about, which
 * reads as "nothing to fix".
 *
 * So the table is read out of the script's source and compared with the
 * registries. It is a source read rather than an import because the script is
 * an ESM entry point that connects to Firestore at module scope for every mode
 * except `--self-test`.
 *
 * The three moves this covers are the three that have happened: `booking` and
 * `eventList` left `mui` before `requiredSitePlugins` existed, and `form` /
 * `formField` left it after.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOKINGS_BUNDLE } from '@aglyn/plugins-bookings'
import { EVENTS_CALENDAR_BUNDLE } from '@aglyn/plugins-events-calendar'
import { MUI_BUNDLE } from '@aglyn/plugins-mui'
import { BUNDLE_ID as BOOKINGS_ID } from '@aglyn/plugins-bookings/constants/bundle-common'
import { BUNDLE_ID as EVENTS_ID } from '@aglyn/plugins-events-calendar/constants/bundle-common'
import { BUNDLE_ID as MUI_ID } from '@aglyn/plugins-mui/constants/bundle-common'
import { BUNDLE_ID as FORMS_ID } from './constants/bundle-common'
import { FORMS_BUNDLE } from './plugin'

const SCRIPT = 'tools/scripts/backfill-node-plugin-ids.mjs'

/** The script's `OWNING_BUNDLE` literal, parsed out of its source. */
function backfillTable(): Record<string, string> {
  // Jest's cwd is the repo root.
  const source = readFileSync(join(process.cwd(), SCRIPT), 'utf8')
  const start = source.indexOf('const OWNING_BUNDLE = {')
  expect(start).toBeGreaterThan(-1)
  const end = source.indexOf('}', start)
  const body = source.slice(source.indexOf('{', start) + 1, end)
  const table: Record<string, string> = {}
  for (const line of body.split('\n')) {
    const match = /^\s*([A-Za-z][\w-]*)\s*:\s*'([^']+)'\s*,\s*$/.exec(line)
    if (match) table[match[1]] = match[2]
  }
  return table
}

/** Which bundle each registry actually registers each id under. */
const REGISTERED: Record<string, string> = {}
for (const [bundleId, bundle] of [
  [FORMS_ID, FORMS_BUNDLE],
  [BOOKINGS_ID, BOOKINGS_BUNDLE],
  [EVENTS_ID, EVENTS_CALENDAR_BUNDLE],
  [MUI_ID, MUI_BUNDLE],
] as const) {
  for (const entry of bundle) REGISTERED[String(entry.schema.$id)] = bundleId
}

describe('the pluginId backfill names the bundles that exist', () => {
  const table = backfillTable()

  it('reads a table at all', () => {
    // The parser is the risk: a regex that matched nothing would make every
    // assertion below vacuously true.
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(4)
  })

  it('maps every id to the bundle that registers it TODAY', () => {
    for (const [componentId, bundleId] of Object.entries(table)) {
      expect({ componentId, bundleId }).toEqual({
        componentId,
        bundleId: REGISTERED[componentId],
      })
    }
  })

  it('names the elements that have changed packages', () => {
    // Ids, spelled the way they are PERSISTED. `event-list` appears in prose
    // in several places and is not a component id anywhere, so a table row
    // spelled that way would match nothing and report a clean zero.
    expect(Object.keys(table).sort()).toEqual([
      'booking',
      'eventList',
      'form',
      'formField',
    ])
  })

  it('never claims an id the mui bundle still registers', () => {
    // The failure this catches is the reverse of a missing row: a row left
    // behind after an element moved BACK, or written for one that never left,
    // would restamp live nodes away from the bundle that draws them.
    for (const componentId of Object.keys(table)) {
      expect({
        componentId,
        stillInMui: MUI_BUNDLE.some((entry) => entry.schema.$id === componentId),
      }).toEqual({ componentId, stillInMui: false })
    }
  })

  it('THE CONTROL: mui still registers the ids that never moved', () => {
    // Without this, the assertion above is satisfied by an empty MUI_BUNDLE.
    const muiIds = MUI_BUNDLE.map((entry) => entry.schema.$id)
    expect(muiIds).toContain('muiTypography')
    expect(muiIds.length).toBeGreaterThan(30)
  })

  it('covers every id this repo has moved out of a bundle', () => {
    // The bundles that were extracted from `mui` each keep a departure comment
    // where their element used to sit. Every id named in one has to be in the
    // table, or the backfill silently skips it.
    const muiPlugin = readFileSync(
      join(process.cwd(), 'libs/plugins/mui/src/lib/plugin.ts'),
      'utf8',
    )
    const departed = [
      ...muiPlugin.matchAll(/^\s*\/\/ ([\w, ]+) moved to @aglyn\/plugins-/gm),
    ].flatMap((match) => match[1].split(',').map((id) => id.trim()))
    expect(departed.length).toBeGreaterThan(0)
    for (const componentId of departed) {
      expect({ componentId, inTable: componentId in table }).toEqual({
        componentId,
        inTable: true,
      })
    }
  })
})
