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

import { resolveScreenHref, splitLinkValue } from '@aglyn/aglyn/app-utils/screen-link-value'
import {
  DATASET_PAGE_FIELD,
  DATASET_PAGE_FIELD_TYPE,
  datasetPageScreenId,
  datasetPageValue,
  isDatasetPageValue,
} from './dataset-page-field'

describe('a record’s page (AGL-3763)', () => {
  it('is a text field named "page", labeled Page', () => {
    expect(DATASET_PAGE_FIELD).toMatchObject({ name: DATASET_PAGE_FIELD_TYPE, label: 'Page', baseType: 'text' })
    expect(DATASET_PAGE_FIELD_TYPE).toBe('page')
  })

  it('stores a picked page as its link reference, and reads the page back out', () => {
    expect(datasetPageValue('drywall-1')).toBe('screen:drywall-1')
    expect(datasetPageScreenId('screen:drywall-1')).toBe('drywall-1')
    expect(isDatasetPageValue('screen:drywall-1')).toBe(true)
    expect(DATASET_PAGE_FIELD.validate?.('screen:drywall-1')).toBeNull()
  })

  it('refuses a typed address, a bare id, and every other kind of link target', () => {
    for (const value of [
      '/services/drywall',
      'https://example.com/drywall',
      'drywall-1',
      'screen:',
      'screen:a/b',
      ' screen:drywall-1',
      'screen:drywall-1 ',
      'collection:blog',
      'entry:blog/post-1',
      'feed:blog',
      '',
      7,
    ]) {
      expect(isDatasetPageValue(value)).toBe(false)
    }
    expect(DATASET_PAGE_FIELD.validate?.('/services/drywall')).toBe('Pick one of the site’s pages')
  })

  it('resolves to the page’s current address when bound into either link slot', () => {
    const routes = { 'drywall-1': 'services/drywall-repair', home: '/' }
    const value = datasetPageValue('drywall-1')
    // `{{item.page}}` in a Button's href slot…
    const fromHref = splitLinkValue(undefined, value)
    expect(fromHref).toEqual({ screenId: 'drywall-1' })
    expect(resolveScreenHref(routes, fromHref.screenId)).toBe('/services/drywall-repair')
    // …or in its page slot.
    expect(resolveScreenHref(routes, splitLinkValue(value, undefined).screenId)).toBe('/services/drywall-repair')
    // A rename moves the address and not the record.
    expect(resolveScreenHref({ 'drywall-1': 'drywall' }, value)).toBe('/drywall')
  })
})
