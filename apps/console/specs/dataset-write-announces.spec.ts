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
 * EVERY PATH THAT WRITES A DATASET RECORD ANNOUNCES IT (AGL-3113).
 *
 * The walk that decides WHICH pages is tested as data next to the module it
 * lives in. What is left is the failure that renders perfectly: a write path
 * that stores the row and tells nobody. There is no output to assert on — the
 * page is simply stale for an hour — so it is asserted against the SOURCE, the
 * shape the forms plugin's `form-publish-announce.spec.ts` uses.
 *
 * The list is closed on purpose. `dataset-referenced-ids.spec.ts` sweeps the
 * tree for a seventh record writer, so a path added later is caught there and
 * has to be answered here.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Repo-relative, from `apps/console/specs`. */
const source = (relative: string) =>
  readFileSync(join(__dirname, '..', '..', '..', relative), 'utf8')

describe('a dataset record write announces to the live pages', () => {
  it('the console record create and import both announce, the import ONCE', () => {
    const route = source('libs/plugins/data/src/lib/server/datasets-route.ts')
    expect(route).toContain(
      "import { announceDatasetRecords as announceDatasetChange } from './announce-dataset-records'",
    )
    // Four: the create, the import's single post-loop call, the leg the
    // browser's own client-direct edits reach, and the page-address fill's
    // single post-loop call (AGL-3475). A fifth would mean a chunk loop had
    // grown a per-chunk announce, which is the burst this bounds.
    expect(route.match(/announceDatasetChange\(/g)).toHaveLength(4)
    // The address fill writes in chunks too, and announces once after them.
    const fillAt = route.indexOf("action === 'add-address-field'")
    const fillAnnounceAt = route.indexOf(
      'await announceDatasetChange({ firestore, orgId, datasetId })',
      fillAt,
    )
    const fillLoopEnd = route.lastIndexOf('await batch.commit()', fillAnnounceAt)
    expect(fillAt).toBeGreaterThan(0)
    expect(fillLoopEnd).toBeGreaterThan(fillAt)
    expect(route.slice(fillLoopEnd, fillAnnounceAt)).not.toContain('for (')
    // After the chunk loop, never inside it: a thousand rows arrive as one
    // import and make the same pages stale once.
    const loopEnd = route.indexOf('if (refusedAt !== null) {')
    // The import's call is the last in the file; the address fill's is earlier.
    const announceAt = route.lastIndexOf(
      'await announceDatasetChange({ firestore, orgId, datasetId })',
      loopEnd,
    )
    expect(announceAt).toBeGreaterThan(0)
    expect(announceAt).toBeLessThan(loopEnd)
    expect(route.slice(announceAt, loopEnd)).not.toContain('for (')
  })

  it('every /v1 record write announces — create, update and delete', () => {
    // The data plugin's `/v1/datasets`, served through the registry (AGL-3080).
    const resources = source('libs/plugins/data/src/lib/server/api-v1/datasets.ts')
    expect(resources).toContain(
      "import { announceDatasetRecords as announceDatasetChange } from '../announce-dataset-records'",
    )
    // AGL-2462 recorded that a `/v1` write cannot publish and only the TTL
    // made it visible. All three legs answer that now: a deleted row is as
    // stale on a page as a changed one. The fourth is the dataset's own
    // schema update, which reformats every bound page (AGL-3386).
    expect(resources.match(/announceDatasetChange\(\{/g)).toHaveLength(4)
  })

  it('the form submission leg announces, inside the swallow that protects the lead', () => {
    // The leg is the data plugin's form record target now (AGL-3080); the
    // submit route files through the platform's contract and names no dataset.
    const route = source('libs/plugins/data/src/lib/form-target/dataset-form-record-target.server.ts')
    expect(route).toContain(
      "import { announceDatasetRecordChange } from '../server/dataset-live-pages'",
    )
    const announceAt = route.indexOf('await announceDatasetRecordChange({')
    const swallowAt = route.indexOf("console.error('form dataset append failed', error)")
    expect(announceAt).toBeGreaterThan(0)
    // Inside the try that already guards the append. A refused cache must
    // never turn a stored lead into a lost one.
    expect(announceAt).toBeLessThan(swallowAt)
  })

  it('an import and its undo announce on the server, once per chunk', () => {
    // A dataset import runs on the transfer framework (AGL-3530): the
    // plugin's `apply` and `revert` hooks write the records, so they tell the
    // pages — once for each chunk they wrote, not once per row.
    const transfer = source('libs/plugins/data/src/lib/transfer/dataset-transfer.server.ts')
    expect(transfer).toContain("import { announceDatasetRecords } from '../server/announce-dataset-records'")
    expect(transfer.match(/await announceDatasetRecords\(\{ firestore: deps\.firestore, orgId: ctx\.orgId, datasetId: dataset\.id \}\)/g))
      .toHaveLength(2)
  })

  it('the automation dataset steps announce — append, and both legs of update', () => {
    // The steps are the data plugin's, run for the engine through the
    // platform's server-step seam (AGL-3080).
    const steps = source('libs/plugins/data/src/lib/server/dataset-steps.server.ts')
    expect(steps).toContain("import { announceDatasetRecordChange } from './dataset-live-pages'")
    // One call per step that writes a row: `datasetAppend`, and
    // `updateDataset` covering its merge and its append leg together.
    expect(steps.match(/await announceDatasetStepWrite\(request\.orgId, datasetDoc\.id\)/g))
      .toHaveLength(2)
    expect(source('libs/plugins/data/src/lib/declarations.server.ts')).toContain(
      'registerServerStepExecutor(\n    DATASET_STEP_TYPES,',
    )
    // The AGL-3105 workflow executor and the older Actions runner share
    // `runServerStep`, and it hands every plugin's step to the seam.
    const engine = source('libs/plugins/workflows/src/lib/engine/run-event-actions.ts')
    expect(engine).toContain('async function runServerStep(')
    expect(engine).toContain('await pluginServerStepExecutor(step.type)')
  })

  it('the browser leg announces its client-direct edits and deletes', () => {
    // Record edits and deletes never reach a server route — AGL-473 moved
    // only creates there, for quota — so a server-only fix would have left
    // the two most ordinary console actions refreshing nothing.
    const card = source(
      'libs/plugins/data/src/lib/components/host-datasets-card.component.tsx',
    )
    expect(card).toContain("action: 'announce-records'")
    // Two: a record edit, and a delete — which loops over every dataset its
    // reference fixups rewrote as well. Imports run on the server since
    // AGL-3530 and announce there, below.
    expect(card.match(/await announceRecords\(/g)).toHaveLength(2)
    expect(card).toContain('alsoChanged.add(other.$id)')
    // The route's own leg, gated by the same membership and visibility the
    // create is — a drop grants nothing the rules withhold, but which
    // datasets exist is still not a stranger's to learn.
    const route = source('libs/plugins/data/src/lib/server/datasets-route.ts')
    expect(route).toContain("action === 'announce-records'")
    const gateAt = route.indexOf('!memberCanSee(')
    const legAt = route.indexOf("if (action === 'announce-records') {")
    expect(gateAt).toBeGreaterThan(0)
    expect(gateAt).toBeLessThan(legAt)
  })

  it('site import still drops the whole host, which covers its dataset rows', () => {
    // The one path that already announced. A restore rewrites the routing
    // map, the screens and the datasets at once, so naming addresses would
    // be narrower than the change — `revalidateEntireHost` is correct here
    // and a per-dataset announce on top of it would be redundant work.
    const route = source('apps/console/app/api/hosts/import/route.ts')
    expect(route).toContain('await revalidateEntireHost(firestore, hostId)')
  })

  it('the tenant registers the in-process dropper at boot', () => {
    // Without this registration a tenant-side write announces to nothing, and
    // that reads exactly like a working feature until somebody watches a page
    // fail to change.
    const instrumentation = source('apps/tenant/instrumentation.ts')
    expect(instrumentation).toContain('registerLivePageDropping')
    const dropper = source('apps/tenant/utils/live-page-dropper.ts')
    expect(dropper).toContain('registerLivePageDropper(dropLivePagesInProcess)')
    // The rows tag FIRST, then the paths — a page dropped before its data tag
    // regenerates from the records it was just told to stop showing.
    const tagAt = dropper.indexOf('revalidateTag(tenantDataTag(target.hostId)')
    const pathAt = dropper.indexOf('revalidatePath(`/${host}/${scheme}')
    expect(tagAt).toBeGreaterThan(0)
    expect(tagAt).toBeLessThan(pathAt)
    // Every first-party import STATIC. A deferred one registers a dynamic nx
    // edge, and nx then forbids every static import of that library across
    // every project reaching it (AGL-949/1329/2282) — including
    // `publish-schedule-job.ts`, which this change never touched.
    expect(dropper).not.toContain("await import('@aglyn/")
    expect(dropper).toContain(
      "import { tenantDataTag } from '@aglyn/tenant-data-admin/render-cache'",
    )
  })
})
