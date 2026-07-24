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
  activityHref,
  activityPrimaryText,
  activityTargetLabel,
  activityTypeLabel,
} from './activity-presenter'

describe('activityTypeLabel', () => {
  it('maps known types to human nouns', () => {
    expect(activityTypeLabel('screen')).toBe('Screen')
    expect(activityTypeLabel('org')).toBe('Organization')
    expect(activityTypeLabel('invite')).toBe('Invitation')
  })

  it('title-cases an unknown type instead of failing', () => {
    expect(activityTypeLabel('gizmo')).toBe('Gizmo')
  })

  it('has a fallback for a missing type', () => {
    expect(activityTypeLabel(undefined)).toBe('Item')
  })
})

describe('activityTargetLabel', () => {
  it('prefers the recorded name', () => {
    expect(activityTargetLabel({ type: 'screen', id: 'abc', name: 'Home' })).toBe(
      'Home',
    )
  })

  it('degrades to the type label, NEVER the raw id', () => {
    const label = activityTargetLabel({ type: 'screen', id: 'x7Il1O0abc' })
    expect(label).toBe('Screen')
    expect(label).not.toContain('x7Il1O0abc')
  })
})

describe('activityPrimaryText', () => {
  it('suffixes the action with the target name', () => {
    expect(
      activityPrimaryText({
        action: 'Saved the screen',
        target: { type: 'screen', id: 'abc', name: 'Home' },
      }),
    ).toBe('Saved the screen — Home')
  })

  it('keeps the bare action when no name was recorded', () => {
    expect(
      activityPrimaryText({
        action: 'Saved the screen',
        target: { type: 'screen', id: 'abc' },
      }),
    ).toBe('Saved the screen')
  })

  it('falls back to the target label when there is no action', () => {
    expect(activityPrimaryText({ target: { type: 'theme' } })).toBe('Theme')
  })
})

describe('activityHref', () => {
  const orgSlug = 'acme'
  const host = 'shop'

  it('returns undefined without an orgSlug (no dead links)', () => {
    expect(
      activityHref(
        { target: { type: 'screen', id: 'abc' } },
        { host },
      ),
    ).toBeUndefined()
  })

  it('links a screen with a version to its detail view', () => {
    expect(
      activityHref(
        { target: { type: 'screen', id: 'scr1', versionId: 'v1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/screens/scr1/versions/v1/view')
  })

  it('links a version-less screen to the list', () => {
    expect(
      activityHref(
        { target: { type: 'screen', id: 'scr1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/screens/list')
  })

  it('links components, templates and layouts to their detail pages', () => {
    expect(
      activityHref(
        { target: { type: 'component', id: 'c1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/components/c1')
    expect(
      activityHref(
        { target: { type: 'template', id: 't1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/templates/t1')
    expect(
      activityHref(
        { target: { type: 'layout', id: 'l1' } },
        { orgSlug, host },
      ),
    ).toBe('/acme/hosts/shop/layouts/l1')
  })

  it('links type-level host targets to their section', () => {
    expect(
      activityHref({ target: { type: 'theme' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/theme')
    expect(
      activityHref({ target: { type: 'media' } }, { orgSlug, host }),
    ).toBe('/acme/hosts/shop/media')
  })

  it('routes org entries by scope (no hostId)', () => {
    expect(activityHref({ target: { type: 'org' } }, { orgSlug })).toBe(
      '/acme/settings',
    )
    expect(
      activityHref({ target: { type: 'member', id: 'uid9' } }, { orgSlug }),
    ).toBe('/acme/team/uid9')
    expect(
      activityHref({ target: { type: 'invite', id: 'inv1' } }, { orgSlug }),
    ).toBe('/acme/team')
  })

  it('tolerates legacy top-level type/targetId fields', () => {
    expect(
      activityHref({ type: 'org', targetId: 'o1' }, { orgSlug }),
    ).toBe('/acme/settings')
  })

  it('returns undefined for a type with nowhere to go', () => {
    expect(
      activityHref({ target: { type: 'mystery' } }, { orgSlug, host }),
    ).toBeUndefined()
  })
})
