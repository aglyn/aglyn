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

/*
 * The Results step's notes (AGL-4245): a row that was written but still
 * leaves the person something to do, such as a product saved without the
 * photos that could not be copied, is listed on the step itself.
 */

import { transferResultsCsv, transferWrittenNotes } from './import-results-step.component'

describe('notes on written rows', () => {
  const rows = [
    { row: 0, outcome: 'created' as const, recordId: 'p1', message: '1 photo of "Kettle" could not be copied.' },
    { row: 1, outcome: 'created' as const, recordId: 'p2' },
    { row: 2, outcome: 'failed' as const, message: 'The product was deleted after the dry run.' },
    { row: 3, outcome: 'updated' as const, recordId: 'p3', message: '2 photos of "Lamp" could not be copied.' },
  ]

  it('lists the created and updated rows with a sentence, never a failure, which is counted already', () => {
    expect(transferWrittenNotes(rows).map((row) => row.row)).toEqual([0, 3])
    expect(transferWrittenNotes(rows.filter((row) => !row.message))).toEqual([])
  })

  it('keeps the sentence in the result file', () => {
    expect(transferResultsCsv(rows)).toContain('1 photo of ""Kettle"" could not be copied.')
  })
})
