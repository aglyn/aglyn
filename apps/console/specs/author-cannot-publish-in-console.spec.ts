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
 * The console says no to an author, instead of the database saying it
 * (AGL-2334 / AGL-2350).
 *
 * The `author` host role edits content and may not publish it. That was
 * enforced in exactly one place — `canPublishHostContent()` in the Firestore
 * rules, with the publish-pointer and `publishSchedule` field freezes beside
 * it — and the console rendered every publish control unconditionally. An
 * author's Publish button looked and behaved like an editor's right up to a
 * raw `permission-denied` toast.
 *
 * `canPublishHost` and `hostRoleCanPublish` were written for this, and their
 * own comment says so: they exist "so the console can say no with a message
 * instead of surfacing a bare permission-denied". Until `use-host-role.ts`
 * there was no hook for the UI to call them from, and grep confirmed neither
 * had a single non-spec caller in any component.
 *
 * ## Two halves, checked two ways
 *
 * The PREDICATE half is behavioural — `hostRoleFor` then `hostRoleCanPublish`
 * over the member shapes that actually occur, including the org owner who is
 * never listed on the site.
 *
 * The WIRING half is a source assertion, and deliberately so: these are four
 * controls across three 500–1600 line editor pages wired to Firestore, MUI,
 * the besigner canvas and the Next router. Rendering them in jsdom to read a
 * `disabled` attribute buys a large mocking exercise whose failures would be
 * about the mocks. What must not regress is that each control consults
 * `canPublish` at all — a control that stops asking is the whole defect, and
 * that is visible in the source.
 */

import {
  hostRoleCanPublish,
  hostRoleFor,
  HOST_CONTENT_WRITE_ROLES,
  HOST_PUBLISH_ROLES,
} from '@aglyn/aglyn'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')

/**
 * Comments removed, for assertions about what the code DOES.
 *
 * The first draft asserted the hook's source does not contain `memberRoles`
 * and went red on the hook's own docblock, which explains at length why it
 * reads the member doc INSTEAD of that projection. Prose about a thing is not
 * a use of it — the same distinction AGL-2278 and AGL-2354 were both about.
 */
const readCode = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

const EDITOR = 'apps/console/app/(editor)/[orgSlug]/hosts/[host]'
const VIEW_PAGE = `${EDITOR}/screens/[screenId]/versions/[versionId]/view/page.tsx`
const SCREEN_BESIGNER = `${EDITOR}/screens/[screenId]/versions/[versionId]/besigner/page.tsx`
const COMPONENT_BESIGNER = `${EDITOR}/components/[componentId]/versions/[versionId]/besigner/page.tsx`
const HOOK = 'apps/console/hooks/use-host-role.ts'

const AUTHOR = {
  role: 'editor',
  allHosts: false,
  hostAccess: { 'host-1': 'author' },
} as never
const SITE_EDITOR = {
  role: 'editor',
  allHosts: false,
  hostAccess: { 'host-1': 'editor' },
} as never
/** Never listed on the site — reaches it by org role. */
const ORG_OWNER = { role: 'owner' } as never

describe('the author role, resolved for the console', () => {
  it('PREMISE: author writes content and is not a publish role', () => {
    // If these two sets ever converge the role has stopped existing, and
    // every assertion below would pass for the wrong reason.
    expect(HOST_CONTENT_WRITE_ROLES).toContain('author')
    expect(HOST_PUBLISH_ROLES).not.toContain('author')
  })

  it('an author on a site cannot publish', () => {
    expect(hostRoleFor(AUTHOR, 'host-1' as never)).toBe('author')
    expect(hostRoleCanPublish(hostRoleFor(AUTHOR, 'host-1' as never))).toBe(false)
  })

  it('a site editor still can — the gate is the ROLE, not the scoping', () => {
    expect(hostRoleCanPublish(hostRoleFor(SITE_EDITOR, 'host-1' as never))).toBe(
      true,
    )
  })

  it('an org owner never listed on the site still can', () => {
    // The reason this hook reads the member doc rather than the host's
    // `memberRoles` projection: the owner of the workspace is frequently
    // absent from it, and would otherwise be told they may not publish their
    // own page.
    expect(hostRoleFor(ORG_OWNER, 'host-1' as never)).toBe('admin')
    expect(hostRoleCanPublish(hostRoleFor(ORG_OWNER, 'host-1' as never))).toBe(
      true,
    )
  })

  it('someone with no access to this site resolves to null, not a default', () => {
    expect(hostRoleFor(AUTHOR, 'other-host' as never)).toBeNull()
    expect(hostRoleCanPublish(null)).toBe(false)
  })
})

describe('the hook fails CLOSED, because it guards an enforced boundary', () => {
  const source = read(HOOK)

  it('starts un-permitted and only grants after the read lands', () => {
    // Hiding a control from someone entitled to it is a support ticket;
    // showing one the database will refuse is the defect being fixed.
    //
    // The INITIALIZER specifically, not `toContain('canPublish: false')`
    // anywhere in the file. The first draft did that and passed a mutation
    // that flipped the initial state to `true`, because the catch branch
    // further down still contained the string it was looking for — a guard
    // satisfied by a line other than the one it is about.
    expect(readCode(HOOK)).toMatch(
      /useState<HostRoleState>\(\{\s*hostRole: null,\s*canPublish: false,\s*loaded: false,\s*\}\)/,
    )
  })

  it('a failed read also leaves it un-permitted', () => {
    // The catch branch: `loaded` true so the caller stops waiting, and
    // `canPublish` false so nothing invites a click the rules will refuse.
    expect(readCode(HOOK)).toMatch(
      /setState\(\{\s*hostRole: null,\s*canPublish: false,\s*loaded: true\s*\}\)/,
    )
  })

  it('resolves through hostRoleFor, not the memberRoles projection', () => {
    const code = readCode(HOOK)
    expect(code).toContain('hostRoleFor')
    expect(code).toContain('hostRoleCanPublish')
    expect(code).not.toContain('memberRoles')
  })
})

describe('every publish control consults it', () => {
  it.each([VIEW_PAGE, SCREEN_BESIGNER, COMPONENT_BESIGNER])(
    'reads the host role: %s',
    (page) => {
      const source = read(page)
      expect(source).toContain('useHostRole')
      expect(source).toContain('canPublish')
    },
  )

  it('the view page gates all four of its publish-side controls', () => {
    // Publish/Update route, Unpublish, Schedule publish, and per-version
    // Publish now. Unpublish counts: the rules freeze the publish POINTER,
    // and removing a live page is as much a publish-side power as adding one.
    const source = read(VIEW_PAGE)
    expect(source.split('!canPublish').length - 1).toBeGreaterThanOrEqual(4)
  })

  it('states a REASON rather than silently disabling', () => {
    // `canPublishHost`'s comment asks for a message, not a dead button.
    for (const page of [VIEW_PAGE, SCREEN_BESIGNER, COMPONENT_BESIGNER]) {
      expect(read(page)).toContain('publishBlock')
    }
    expect(read(VIEW_PAGE)).toContain('can edit content but not publish it')
  })
})
