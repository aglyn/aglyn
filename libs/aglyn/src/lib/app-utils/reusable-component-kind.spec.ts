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

import {
  REUSABLE_COMPONENT_CATEGORY,
  REUSABLE_EMAIL_BLOCK_CATEGORY,
} from '../foundation/constants/components'
import { HostViewType } from '../foundation/definitions/platform.types'
import {
  EMAIL_VIEW_BUNDLE_ID,
  isReusableComponentKind,
  reusableComponentEditorView,
  reusableComponentKindForRoot,
  reusableComponentKindForView,
  reusableComponentKindOf,
  reusableComponentPaletteSlot,
} from './reusable-component-kind'

/**
 * Where a reusable component is placed — pages or emails (AGL-3287). Each
 * answer below is read by a different surface, so they are pinned together:
 * a component saved as one kind and offered as the other is the bug this
 * field exists to prevent.
 */
describe('reusable component kind (AGL-3287)', () => {
  it('reads every component made before the field as a page component', () => {
    expect(reusableComponentKindOf({})).toBe('site')
    expect(reusableComponentKindOf(undefined)).toBe('site')
    expect(reusableComponentKindOf({ kind: 'site' })).toBe('site')
    // A value no reader knows files nothing away from the pages that use it.
    expect(reusableComponentKindOf({ kind: 'newsletter' })).toBe('site')
    expect(reusableComponentKindOf({ kind: 'email' })).toBe('email')
  })

  it('stores only the two kinds', () => {
    expect(isReusableComponentKind('site')).toBe(true)
    expect(isReusableComponentKind('email')).toBe(true)
    expect(isReusableComponentKind('page')).toBe(false)
    expect(isReusableComponentKind('')).toBe(false)
    expect(isReusableComponentKind(undefined)).toBe(false)
  })

  it('makes an email block from an email, and a page component anywhere else', () => {
    expect(reusableComponentKindForView(HostViewType.EMAIL)).toBe('email')
    expect(reusableComponentKindForView(HostViewType.SCREEN)).toBe('site')
    expect(reusableComponentKindForView(HostViewType.LAYOUT)).toBe('site')
    // No view set: a component editor, which edits like a page.
    expect(reusableComponentKindForView(undefined)).toBe('site')
  })

  it('reads the same answer off the element promoted, for a surface with no view', () => {
    expect(reusableComponentKindForRoot({ pluginId: EMAIL_VIEW_BUNDLE_ID })).toBe(
      'email',
    )
    expect(reusableComponentKindForRoot({ pluginId: 'mui' })).toBe('site')
    expect(reusableComponentKindForRoot(undefined)).toBe('site')
  })

  it('opens an email block in the email view, and leaves a page component in its own', () => {
    expect(reusableComponentEditorView('email')).toBe(HostViewType.EMAIL)
    // Undefined, not SCREEN: the component editor has never set one, and the
    // LAYOUT view would offer a slot that has nowhere to graft (AGL-680).
    expect(reusableComponentEditorView('site')).toBeUndefined()
  })

  it('files an email block under the email bundle, in a group of its own', () => {
    expect(reusableComponentPaletteSlot('email')).toEqual({
      category: REUSABLE_EMAIL_BLOCK_CATEGORY,
      pluginId: EMAIL_VIEW_BUNDLE_ID,
    })
    // A page component still belongs to no plugin, exactly as before.
    expect(reusableComponentPaletteSlot('site')).toEqual({
      category: REUSABLE_COMPONENT_CATEGORY,
    })
    expect(REUSABLE_EMAIL_BLOCK_CATEGORY).toBe('Your email blocks')
  })
})
