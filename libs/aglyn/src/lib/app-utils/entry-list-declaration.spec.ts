/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ENTRY_TITLE_TOKENS_FIELD } from './content-query-fields'
import { ENTRY_LIST_FILTER_FIELDS, ENTRY_LIST_QUERY } from './entry-list-declaration'

describe('entry list declaration', () => {
  it('searches and filters titles on the key the entry writers stamp', () => {
    expect(ENTRY_LIST_QUERY.search?.tokensPath).toBe(ENTRY_TITLE_TOKENS_FIELD)
    expect(ENTRY_LIST_FILTER_FIELDS.find((field) => field.column === 'title')?.tokensPath).toBe(
      ENTRY_TITLE_TOKENS_FIELD,
    )
  })
})
