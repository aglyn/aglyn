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
 * A small resource for the kit's specs: people with a list field, a
 * reference to a team, three match keys and one locked rule, and a file
 * that exercises every step — a matched row whose phone differs, a list
 * value the list lacks, a misspelled team, a date that reads either way, a
 * new row and a row repeated in the file.
 */

import type { TransferResourceDescriptor } from '@aglyn/aglyn/data-transfer'

import { createMemoryTransferClient } from '../lib/memory-transfer-client'
import type { MemoryTransferClientOptions } from '../lib/memory-transfer-client'

export const PEOPLE_RESOURCE: TransferResourceDescriptor = {
  key: 'people',
  label: 'People',
  singularLabel: 'Person',
  scope: 'org',
  kinds: ['records'],
  formats: ['csv', 'json', 'ndjson'],
  limits: { maxRows: 1000, maxBytes: 1_000_000 },
}

export const PEOPLE_CSV = [
  'Full Name,E-mail,Phone,Joined,Stage,Team,Score',
  'Ada Lovelace,ada@example.com,+1 555 0199,03/05/2024,Lead,Research,10',
  'Grace Hopper,grace@example.com,,2024-01-02,Prospect,Reseach,',
  'New Person,new@example.com,,2024-02-02,Customer,Research,',
  'New Again,new@example.com,,,,,',
].join('\n')

export function peopleOptions(
  overrides: Partial<MemoryTransferClientOptions> = {},
): MemoryTransferClientOptions {
  return {
    resource: PEOPLE_RESOURCE,
    catalog: {
      standard: [
        {
          id: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          aliases: ['full name'],
          group: 'main',
        },
        { id: 'email', label: 'Email', type: 'email', group: 'main' },
        { id: 'phone', label: 'Phone', type: 'phone', group: 'main' },
        { id: 'joined', label: 'Joined', type: 'date', group: 'main' },
        {
          id: 'stage',
          label: 'Stage',
          type: 'picklist',
          picklistId: 'stage',
          group: 'main',
        },
        {
          id: 'team',
          label: 'Team',
          type: 'lookup',
          lookup: { resource: 'teams', by: ['name'], creatable: true },
          group: 'main',
        },
        { id: 'score', label: 'Score', type: 'number', group: 'main' },
      ],
      custom: [{ key: 'shoe', label: 'Shoe size', type: 'number' }],
      derived: [
        { id: 'age', label: 'Days known', type: 'integer', group: 'main' },
      ],
      system: [{ id: 'createdAt', label: 'Created', type: 'datetime' }],
      groups: [{ id: 'main', label: 'Details' }],
    },
    matchKeys: [
      { fieldId: 'id', normalizer: 'aglynId' },
      { fieldId: 'email', normalizer: 'email' },
      { fieldId: 'name', normalizer: 'name' },
    ],
    defaultMatchKeys: ['id', 'email'],
    locked: [
      {
        fieldId: 'score',
        reason: 'Scores are computed from activity.',
        forced: { mode: 'keepExisting' },
      },
    ],
    picklists: {
      stage: {
        spec: { restricted: true, standardValues: [] },
        set: {
          values: [
            { id: 'lead', label: 'Lead', active: true },
            { id: 'customer', label: 'Customer', active: true },
          ],
          defaultValueId: null,
        },
      },
    },
    records: [
      {
        id: 'rec-1',
        values: {
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          phone: '+1 555 0100',
          stage: 'Lead',
          score: 50,
        },
      },
      {
        id: 'rec-2',
        values: {
          name: 'Grace Hopper',
          email: 'grace@example.com',
          stage: 'Customer',
        },
      },
      { id: 'rec-3', values: { name: 'Sam Lee', email: 'sam1@example.com' } },
      { id: 'rec-4', values: { name: 'Sam Lee', email: 'sam2@example.com' } },
    ],
    lookupTargets: {
      teams: [
        { id: 'team-1', label: 'Research', values: { name: 'Research' } },
      ],
    },
    recordLabel: (record) => String(record.values['name'] ?? record.id),
    canCreateCustomField: true,
    now: () => Date.UTC(2026, 9, 5),
    ...overrides,
  }
}

export const createPeopleClient = (
  overrides: Partial<MemoryTransferClientOptions> = {},
) => createMemoryTransferClient(peopleOptions(overrides))
