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
 * A plan's warnings as the acknowledgement list words them — a sample about
 * the whole file (a column's name) names no row.
 */

import { TRANSFER_FILE_SAMPLE_ROW } from '@aglyn/aglyn/data-transfer'
import { transferWarningItems } from './transfer-acknowledgement-list.component'

describe('warning samples in words', () => {
  it('names the row of a row’s sample and no row for the file’s', () => {
    const [item] = transferWarningItems(
      [
        {
          class: 'screening',
          count: 2,
          rows: 1,
          fieldIds: ['email'],
          samples: [
            { row: TRANSFER_FILE_SAMPLE_ROW, value: 'Append Source', detail: 'A bought-list column' },
            { row: 3, fieldId: 'email', value: 'sales@lumen.co', detail: 'A shared mailbox' },
          ],
          requiresAcknowledgement: true,
        },
      ],
      (fieldId) => (fieldId === 'email' ? 'Email' : fieldId),
    )
    expect(item?.title).toBe('What this import’s own checks found')
    expect(item?.samples).toEqual([
      '"Append Source" · A bought-list column',
      'Row 4 · Email · "sales@lumen.co" · A shared mailbox',
    ])
  })
})
