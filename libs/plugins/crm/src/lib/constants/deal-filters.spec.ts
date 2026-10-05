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
 * The Deals table's Type and Lead source filters (AGL-3516).
 *
 * What has to hold: the panel shows the labels a reader picks, and the
 * query asks the keys every deal writer stores beside them — a label in
 * any case or spacing meets its key, "none" is `== null`, and a clause the
 * query does not translate is asked as it is stored.
 */

import { CRM_NO_NEXT_ACTIVITY_CLAUSE } from '@aglyn/aglyn'
import {
  DEAL_FILTER_CODECS,
  DEAL_LIST_DECLARATION,
  DEAL_LIST_FILTER_FIELDS,
  DEAL_PICKLIST_FILTER_NONE,
  dealQueryClause,
} from './deal-filters'

describe('dealQueryClause', () => {
  it('asks a Type or a Lead source by its key', () => {
    expect(dealQueryClause({ field: 'type', op: 'equals', value: ' New  Business' })).toEqual({
      field: 'typeKey',
      op: 'equals',
      value: 'new business',
    })
    expect(
      dealQueryClause({ field: 'leadSource', op: 'isAnyOf', value: 'Trade show,Web' }),
    ).toEqual({ field: 'leadSourceKey', op: 'isAnyOf', value: 'trade show,web' })
  })

  it('asks "none" as a null key, and refuses it beside a value', () => {
    expect(dealQueryClause({ field: 'type', op: 'isEmpty', value: '' })).toEqual({
      field: 'typeKey',
      op: 'isEmpty',
      value: '',
    })
    expect(
      dealQueryClause({ field: 'leadSource', op: 'equals', value: DEAL_PICKLIST_FILTER_NONE }),
    ).toEqual({ field: 'leadSourceKey', op: 'isEmpty', value: '' })
    expect(
      dealQueryClause({ field: 'type', op: 'isAnyOf', value: `${DEAL_PICKLIST_FILTER_NONE},New Business` }),
    ).toHaveProperty('refused')
  })

  it('asks the status and "No next activity" as they are stored', () => {
    const status = { field: 'status', op: 'equals' as const, value: 'open' }
    expect(dealQueryClause(status)).toBe(status)
    expect(dealQueryClause(CRM_NO_NEXT_ACTIVITY_CLAUSE)).toBe(CRM_NO_NEXT_ACTIVITY_CLAUSE)
  })

  it('offers the labels in the panel and declares the keys to the query', () => {
    expect(DEAL_LIST_FILTER_FIELDS.map((field) => field.column)).toEqual([
      'status',
      'nextTaskAtMs',
      'type',
      'leadSource',
    ])
    expect(DEAL_LIST_DECLARATION.fields.map((field) => field.path)).toEqual([
      'status',
      'nextTaskAtMs',
      'typeKey',
      'leadSourceKey',
    ])
    // "No type" is the panel's own choice, stored as an `isEmpty` clause.
    expect(
      DEAL_FILTER_CODECS['type'].toClause({ id: 'x', field: 'type', operator: 'is', value: DEAL_PICKLIST_FILTER_NONE }),
    ).toEqual({ field: 'type', op: 'isEmpty', value: '' })
  })
})
