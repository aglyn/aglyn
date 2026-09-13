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
 * Every element with an External URL warns while it holds only a `#fragment`
 * (AGL-2867).
 *
 * The attributes form rendering the warning is proved in the besigner's
 * `element-props-form-fragment-link.spec.tsx`. This proves the other half:
 * that each linking element declares it, so the warning is not on the Button
 * and missing from the Screen Link beside it.
 */

import * as Aglyn from '@aglyn/aglyn'
import { schema as button } from './button'
import { schema as image } from './image'
import { schema as linkBox } from './link-box'
import { schema as screenLink } from './screen-link'

describe('External URL warns on a bare #fragment (AGL-2867)', () => {
  it.each([
    ['Button', button],
    ['Screen Link', screenLink],
    ['Link Container', linkBox],
    ['Image', image],
  ])('%s', (_name, schema) => {
    const href = schema.attributes?.find((field) => field.name === 'href')
    expect(href?.['label']).toBe('External URL')
    const resolve = href?.resolveProps as
      | ((props: unknown, field: unknown, options: unknown) => unknown)
      | undefined
    expect(resolve?.({}, { input: { value: '#watch' } }, {})).toEqual({
      helperText: Aglyn.bareFragmentLinkWarning('#watch'),
    })
    expect(resolve?.({}, { input: { value: 'https://example.com' } }, {})).toEqual({})
  })
})
