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

import { artifactRenameListKeys } from './artifact-list-keys'
import { SCREEN_DETAILS_ACTIVITY, buildScreenDetailsUpdate } from './screen-details-update'

describe('a page’s name and description, as saved (AGL-4235)', () => {
  it('writes the trimmed name with the keys that find it, and the trimmed description', () => {
    expect(buildScreenDetailsUpdate({ displayName: '  Our story ', description: ' Who we are ' })).toEqual({
      displayName: 'Our story',
      ...artifactRenameListKeys('screens', 'Our story'),
      description: 'Who we are',
    })
  })

  it('writes only what it is given, and clears a description with null or empty', () => {
    expect(buildScreenDetailsUpdate({ description: null })).toEqual({ description: '' })
    expect(buildScreenDetailsUpdate({ description: '' })).toEqual({ description: '' })
    expect(Object.keys(buildScreenDetailsUpdate({ displayName: 'About' }) ?? {})).not.toContain('description')
    expect(buildScreenDetailsUpdate({})).toEqual({})
  })

  it('refuses a name that trims to nothing', () => {
    expect(buildScreenDetailsUpdate({ displayName: '   ', description: 'x' })).toBeNull()
  })

  it('names the activity row the details card writes', () => {
    expect(SCREEN_DETAILS_ACTIVITY).toBe('Updated screen details')
  })
})
