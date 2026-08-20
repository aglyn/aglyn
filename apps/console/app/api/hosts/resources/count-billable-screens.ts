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

import { billableScreenIds, type BillableScreenSource } from '@aglyn/aglyn/server'

/**
 * The RULE itself lives in `screen-route.ts`, beside `screenClaimsToBeAPage`
 * (AGL-2093 / AGL-1445). What is left here is the READ: turning a host's
 * `screens` collection into the rows the rule is applied to.
 *
 * The split is not tidiness. The console's Screens page runs the same rule as
 * a precheck, and while it lived in this module — under `app/api/`, importing
 * `@aglyn/aglyn/server`, which pulls `node:stream` in through the API adapter —
 * the page could not import it and restated it instead. It then drifted: the
 * restatement never learned AGL-2093's error-screen bound, so the console
 * offered room the API refused. Re-exported here so every existing caller
 * keeps its import.
 */
export {
  billableScreenIds,
  exemptErrorScreenIds,
  nonPageScreenIds,
  type BillableScreenSource,
  type ScreenRoutingMap,
} from '@aglyn/aglyn/server'

/** The shape this reads off a Firestore snapshot — kept structural so the
 * unit test doesn't need the admin SDK. */
interface FieldSnapshot {
  id: string
  get(field: string): unknown
}

interface QuerySnapshotLike {
  docs: Array<FieldSnapshot>
}

interface HostRefLike {
  collection(name: string): {
    select(...fields: Array<string>): { get(): Promise<QuerySnapshotLike> }
  }
}

/**
 * How many screens spend the host's plan allowance, read from the server.
 *
 * The rule is `billableScreenIds`; this is the scan it is applied to.
 * `routingMap` costs no read: every caller holds the host snapshot already.
 *
 * ## What the scan costs (AGL-1440)
 *
 * ONE BILLED READ PER SCREEN DOCUMENT, unbounded. The `select()` below is a
 * projection: it keeps whole documents off the wire, and it does not reduce the
 * read count by one. Callers that already hold the rows must use
 * `billableScreenIds` directly rather than calling this — see
 * `measureScreenCaps`, which was scanning the same collection a second time on
 * the same sweep.
 */
export async function countBillableScreens(
  hostRef: HostRefLike,
  routingMap?: Record<string, unknown> | null,
): Promise<number> {
  return billableScreenIds(await readScreenSources(hostRef), routingMap).size
}

/**
 * The host's screens, projected to the two fields every rule here reads.
 *
 * Exported so a caller needing BOTH answers — `billableScreenIds` for
 * `screensPerHost` and `nonPageScreenIds` for the flat cap (AGL-1399) — pays for
 * one scan rather than two. The projection keeps whole documents off the wire
 * but does not reduce the read count, which is one per screen document
 * (AGL-1440), so the second scan would be the whole cost again.
 */
export async function readScreenSources(
  hostRef: HostRefLike,
  /**
   * How to execute the projected query. Defaults to executing it directly;
   * `/api/hosts/resources` passes `(query) => tx.get(query)` so the scan is
   * the TRANSACTION's read and the pessimistic lock it takes covers every
   * screen the cap is counted from (AGL-2231). A count read outside the
   * transaction that then writes inside it is not serialized against a
   * concurrent create, which is the whole defect.
   */
  read: (query: {
    get(): Promise<QuerySnapshotLike>
  }) => Promise<QuerySnapshotLike> = (query) => query.get(),
): Promise<Array<BillableScreenSource>> {
  const screens = await read(
    hostRef.collection('screens').select('kind', 'deletedAt'),
  )
  return screens.docs.map((screen) => ({
    id: screen.id,
    kind: screen.get('kind'),
    deletedAt: screen.get('deletedAt'),
  }))
}
