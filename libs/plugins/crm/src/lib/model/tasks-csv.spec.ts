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

import { TASK_CSV_COLUMNS, tasksCsv } from './tasks-csv'

/**
 * The tasks file (AGL-2621): the kind, priority and status as labels, the
 * due and completed instants as ISO timestamps, the assignee by address,
 * and each linked record by the name the list resolved for it.
 */
describe('the tasks CSV', () => {
  it('labels the enums, stamps the instants, and names the assignee and the records', () => {
    const csv = tasksCsv(
      [
        {
          title: 'Call Ada, re: renewal',
          kind: 'call',
          priority: 'high',
          status: 'open',
          dueAtMs: Date.UTC(2026, 8, 6, 14),
          assigneeUid: 'uid-1',
          contactId: 'c-ada',
          dealId: 'd-1',
          notes: 'Before noon',
        },
        {
          title: 'Send deck',
          kind: 'todo',
          priority: 'normal',
          status: 'done',
          completedAtMs: Date.UTC(2026, 8, 1),
          companyId: 'co-acme',
        },
      ],
      {
        assigneeEmail: (uid) => (uid === 'uid-1' ? 'ada@example.com' : uid),
        recordName: (kind, id) =>
          kind === 'contact' && id === 'c-ada'
            ? 'Ada Lovelace'
            : kind === 'company' && id === 'co-acme'
              ? 'Acme'
              : undefined,
      },
    )
    expect(csv.split('\n')).toEqual([
      TASK_CSV_COLUMNS.join(','),
      '"Call Ada, re: renewal",Call,High,Open,2026-09-06T14:00:00.000Z,ada@example.com,Ada Lovelace,,d-1,,Before noon',
      'Send deck,To-do,Normal,Done,,,,Acme,,2026-09-01T00:00:00.000Z,',
    ])
  })
})
