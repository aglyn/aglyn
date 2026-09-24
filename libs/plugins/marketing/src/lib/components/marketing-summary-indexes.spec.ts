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
 * Index coverage for the Overview's email figures (`readSendFigures`).
 *
 * **Neither the emulator nor this repo's specs enforce index requirements.**
 * A site's Overview sums the sends it sent — `orgs/{orgId}/campaigns`
 * filtered by `visibleTo array-contains-any ['host:{id}']` — and an
 * aggregation over a filtered query needs a composite index pairing the
 * filter with the summed or compared field. Without one the aggregate fails
 * with `FAILED_PRECONDITION` in production only, and the card draws a dash
 * where the figure should be: safe, and silently useless.
 *
 * So this asserts the deployed index file carries each shape. The org
 * Overview's own figures carry no filter and ride the automatic single-field
 * indexes, which is why only the site shapes are here. **If you add or
 * change a figure in `readSendFigures`, add its shape here.**
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface IndexField {
  fieldPath: string
  order?: 'ASCENDING' | 'DESCENDING'
  arrayConfig?: 'CONTAINS'
}
interface CompositeIndex {
  collectionGroup: string
  queryScope: string
  fields: IndexField[]
}

const CONFIG: { indexes: CompositeIndex[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'),
    'utf8',
  ),
)

const signature = (fields: IndexField[]) =>
  fields
    .map((field) => `${field.fieldPath}:${field.arrayConfig ? 'ARRAY' : field.order}`)
    .join(' > ')

/** Every COLLECTION-scope shape declared on the org's sends. */
const sendShapes = new Set(
  CONFIG.indexes
    .filter(
      (index) =>
        index.collectionGroup === 'campaigns' && index.queryScope === 'COLLECTION',
    )
    .map((index) => signature(index.fields)),
)

describe('the site Overview’s email figures have their indexes', () => {
  it.each(['stats.sent', 'stats.opens', 'stats.clicks'])(
    'declares visibleTo + %s for the sum over one site’s sends',
    (field) => {
      expect(sendShapes).toContain(`visibleTo:ARRAY > ${field}:ASCENDING`)
    },
  )

  it('declares visibleTo + status for the count of scheduled sends', () => {
    expect(sendShapes).toContain('visibleTo:ARRAY > status:ASCENDING')
  })

  it('CONTROL: the file was read and holds the sends’ existing shapes', () => {
    // A path that read an empty file would pass nothing above, but a guard
    // that asserts presence has to prove it looked.
    expect(sendShapes).toContain('visibleTo:ARRAY > emailCampaignId:ASCENDING')
  })
})
