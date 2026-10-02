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

import { PLUGIN_RECORD_PAGES_DECLARED } from './first-party-plugins.generated'
import { pluginRecordPage, pluginRecordPageLink } from './plugin-record-pages'

/**
 * Where a person reads a record kind, for a server's notification link
 * (AGL-3080): declared by the plugin whose page shows it, compiled, and
 * answered by kind — never by naming the plugin.
 */
describe('record pages', () => {
  it('answers a form submission with the page the Inbox declares', () => {
    expect(pluginRecordPage('formSubmission')).toEqual({
      pluginId: 'inbox',
      kind: 'formSubmission',
      path: '/inbox',
    })
    expect(pluginRecordPageLink('formSubmission', 'host-1')).toBe('/host-1/inbox')
  })

  it('answers nothing for a kind no plugin shows, or with no site to address', () => {
    expect(pluginRecordPage('bottle')).toBeNull()
    expect(pluginRecordPageLink('bottle', 'host-1')).toBeNull()
    expect(pluginRecordPageLink('formSubmission', '')).toBeNull()
  })

  it('holds one page per kind', () => {
    const kinds = PLUGIN_RECORD_PAGES_DECLARED.map((one) => one.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
