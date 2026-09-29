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

import { isSafeNodeUrl } from './node-url-policy'
import { EXTERNAL_HREF_PATTERN, SAFE_HREF_PATTERN } from './screen-link-value'

/*
 * A "Text us" button stores `sms:+1…` and rendered as a button with no link,
 * because the href allow-list knew `tel:` and not `sms:` (AGL-3388).
 */
describe('an sms: href (AGL-3388)', () => {
  const SMS = 'sms:+15128430942'

  it('survives the href allow-list a linking element renders through', () => {
    expect(SAFE_HREF_PATTERN.test(SMS)).toBe(true)
    expect(isSafeNodeUrl('href', SMS)).toBe(true)
    expect(isSafeNodeUrl('href', `  ${SMS}  `)).toBe(true)
  })

  it('leaves the site, as tel: does', () => {
    expect(EXTERNAL_HREF_PATTERN.test(SMS)).toBe(true)
    expect(EXTERNAL_HREF_PATTERN.test('tel:+15128430942')).toBe(true)
  })

  it('keeps refusing the schemes that execute', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'smsx:+1']) {
      expect(SAFE_HREF_PATTERN.test(href)).toBe(false)
      expect(isSafeNodeUrl('href', href)).toBe(false)
    }
  })
})
