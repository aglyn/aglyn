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

import { SCREEN_ROOT_PATH } from './screen-slug'
import {
  SCREEN_VERSION_PUBLISH_DELETED,
  SCREEN_VERSION_PUBLISH_NO_ADDRESS,
  SCREEN_VERSION_PUBLISH_NO_PARENT_ADDRESS,
  screenVersionPublish,
  screenVersionPublishTakenCopy,
} from './screen-version-publish'

/**
 * Publish from a version's preview (AGL-3616): what it does to a page that
 * is live, one that is not, and each page it refuses, as the page's own
 * Publish refuses it.
 */
describe('screenVersionPublish', () => {
  const base = {
    screenId: 'home',
    versionId: 'v-ai',
    routingMap: {} as Record<string, string>,
    screensById: {},
  }

  it('says the version the site serves is live', () => {
    expect(
      screenVersionPublish({ ...base, screen: { versionId: 'v-ai', slug: '/' }, routingMap: { home: SCREEN_ROOT_PATH } }),
    ).toEqual({ kind: 'live', path: SCREEN_ROOT_PATH })
  })

  it('makes another version of a live page the one it serves, through the route seam for the placeholder home', () => {
    const live = { ...base, screen: { versionId: 'v-live', slug: '/' }, routingMap: { home: SCREEN_ROOT_PATH } }
    expect(screenVersionPublish(live)).toEqual({ kind: 'replace', path: SCREEN_ROOT_PATH, placeholder: false })
    expect(screenVersionPublish({ ...live, defaultHomeScreenId: 'home' })).toEqual({
      kind: 'replace',
      path: SCREEN_ROOT_PATH,
      placeholder: true,
    })
  })

  it('puts a page that is not on the site at its address under its parents', () => {
    expect(
      screenVersionPublish({
        ...base,
        screenId: 'team',
        screen: { versionId: 'v-ai', slug: 'Team', parentId: 'about' },
        routingMap: { about: 'about' },
        screensById: { about: { slug: 'about' } },
      }),
    ).toEqual({ kind: 'first', slug: 'team', path: 'about/team' })
  })

  it('takes the root from the placeholder home, and from no other page', () => {
    const home = { ...base, screen: { versionId: 'v-ai', slug: '/' }, routingMap: { starter: SCREEN_ROOT_PATH } }
    expect(screenVersionPublish({ ...home, defaultHomeScreenId: 'starter' })).toEqual({
      kind: 'first',
      slug: SCREEN_ROOT_PATH,
      path: SCREEN_ROOT_PATH,
    })
    expect(screenVersionPublish(home)).toEqual({ kind: 'blocked', reason: screenVersionPublishTakenCopy(SCREEN_ROOT_PATH) })
  })

  it('refuses, with the reason, what the page’s own Publish refuses', () => {
    expect(screenVersionPublish({ ...base, screen: null })).toEqual({ kind: 'blocked', reason: SCREEN_VERSION_PUBLISH_DELETED })
    expect(screenVersionPublish({ ...base, screen: { slug: 'x', deletedAt: 1 } })).toEqual({
      kind: 'blocked',
      reason: SCREEN_VERSION_PUBLISH_DELETED,
    })
    expect(screenVersionPublish({ ...base, screen: { slug: '' } })).toEqual({ kind: 'blocked', reason: SCREEN_VERSION_PUBLISH_NO_ADDRESS })
    expect(
      screenVersionPublish({ ...base, screen: { slug: 'team', parentId: 'about' }, screensById: { about: {} } }),
    ).toEqual({ kind: 'blocked', reason: SCREEN_VERSION_PUBLISH_NO_PARENT_ADDRESS })
    expect(screenVersionPublish({ ...base, screen: { slug: 'api' } })).toMatchObject({
      kind: 'blocked',
      reason: expect.stringContaining('"/api" is a reserved address'),
    })
    expect(screenVersionPublish({ ...base, screen: { slug: 'about' }, routingMap: { other: 'about' } })).toEqual({
      kind: 'blocked',
      reason: screenVersionPublishTakenCopy('about'),
    })
  })

  it('leaves a template, an error page, a group and an email to the Besigner', () => {
    for (const kind of ['template', 'error', 'group', 'email']) {
      expect(screenVersionPublish({ ...base, screen: { slug: 'x', kind } })).toMatchObject({ kind: 'blocked' })
    }
  })
})
