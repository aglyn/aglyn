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
 * @jest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  listQueryIndexes,
  missingListQueryIndexes,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { EXPERIMENT_LIST_QUERY } from './experiment-list-query'

/**
 * Every shape the Marketing lists' queries can take has its composite index
 * (AGL-3321).
 *
 * The emulator serves any query, so a missing index is invisible to every
 * other spec; production answers FAILED_PRECONDITION and the list shows a
 * load error the moment a reader sets the filter that needs it. A list
 * declared through `planListQuery` enumerates its shapes (`listQueryIndexes`)
 * and this holds the index file to them — and to the count, which the
 * project's index budget is spent from. A list that is not declared names its
 * shapes here by hand.
 */

const INDEXES = JSON.parse(
  readFileSync(join(__dirname, '../../../../../../cloud/firebase-firestore.indexes.json'), 'utf8'),
)

describe('a site’s A/B testing list (hosts/{hostId}/experiments)', () => {
  const needed = listQueryIndexes(EXPERIMENT_LIST_QUERY)

  it('has every composite its filters and search need', () => {
    expect(missingListQueryIndexes(INDEXES, 'experiments', needed, 'COLLECTION')).toEqual([])
  })

  it('spends four: one per filterable field and the search, under the one order', () => {
    expect(needed).toHaveLength(4)
    expect(needed.map((index) => index.fields[0].fieldPath).sort()).toEqual([
      'nameLower',
      'nameTokens',
      'status',
      'target',
    ])
    for (const index of needed) {
      expect(index.fields[1]).toEqual({ fieldPath: 'name', order: 'ASCENDING' })
    }
  })
})

describe('the Conversions lists (hosts/{hostId}/campaignAttributions)', () => {
  /*
   * Not declared through `planListQuery`: the card offers no Filters panel
   * and no search. Its two lists are each one query — the kind the toggle
   * picked, and the channel (or, reached from one campaign, that campaign) —
   * walked in document-name order (`collectionPage`). These are the shapes.
   */
  const shape = (...paths: string[]) => ({
    fields: paths.map((fieldPath) => ({ fieldPath, order: 'ASCENDING' as const })),
  })

  it('has the kind + channel and kind + campaign composites its lists read', () => {
    expect(
      missingListQueryIndexes(
        INDEXES,
        'campaignAttributions',
        [shape('kind', 'channel'), shape('kind', 'campaignId')],
        'COLLECTION',
      ),
    ).toEqual([])
  })

  it('CONTROL: an absent shape is reported missing, so the check is looking', () => {
    expect(
      missingListQueryIndexes(INDEXES, 'campaignAttributions', [shape('kind', 'nothing')], 'COLLECTION'),
    ).toHaveLength(1)
  })
})
