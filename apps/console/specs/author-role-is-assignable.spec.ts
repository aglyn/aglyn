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
 * AGL-2334: a capability is not a feature until the console can hand it out.
 *
 * The `author` host role — "edit content but not publish" — is enforced in
 * the Firestore security rules, and the emulator suite proves the enforcement
 * (`cloud/rules-tests/firestore-rules.test.mjs`). This guard protects the
 * OTHER half, which no rules test can see: that a human can actually assign
 * the role. Four doors have to admit it, and the failure mode if one does not
 * is silent — the role exists, the rules enforce it, and the picker simply
 * never offers it, so nobody has it and every test still passes.
 *
 * Two of the four are API allowlists that fail CLOSED on an unknown role
 * (`400 Unknown role`), which is the right default and exactly why their
 * omission would be invisible: a role nobody can send is indistinguishable
 * from a role nobody wants.
 *
 * Read from SOURCE rather than imported. Three of the four are `const` sets
 * inside route modules that pull in `firebase-admin`, and the point is to
 * assert the literal list a reviewer sees, not a value some other module
 * re-exports.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** The four doors, and what each one is for. */
const DOORS: Array<{ path: string; what: string }> = [
  {
    path: 'apps/console/app/api/hosts/members/route.ts',
    what: 'the site-collaborator door the agency guide points an agency at',
  },
  {
    path: 'apps/console/app/api/orgs/members/route.ts',
    what: 'per-site access on an existing org member',
  },
  {
    path: 'apps/console/app/api/orgs/invites/route.ts',
    what: 'the pending host grant on an invite to an address with no account',
  },
  {
    path: 'apps/console/components/host-members-card.component.tsx',
    what: 'the site-collaborator role picker',
  },
]

const ORG_MEMBERS_CARD = 'apps/console/components/org-members-card.component.tsx'

describe('AGL-2334 · the author host role is assignable in the console', () => {
  it('read real, non-empty sources (the vacuous-pass floor)', () => {
    // Without this, a renamed or moved file would make every `toContain`
    // below throw at read time — but a TRUNCATED one would pass them all by
    // accident, and an empty string contains nothing to be wrong about.
    for (const { path } of [...DOORS, { path: ORG_MEMBERS_CARD }]) {
      expect([path, read(path).length > 1000]).toEqual([path, true])
    }
  })

  it.each(DOORS)('$path offers author — $what', ({ path }) => {
    expect(read(path)).toContain("'author'")
  })

  it('the org member card offers author BETWEEN viewer and editor', () => {
    // Order is part of the meaning: the picker is a ladder, and an `author`
    // listed after `editor` reads as stronger than it. Asserted on the
    // options array specifically, not on the file, so a stray mention of the
    // word elsewhere cannot satisfy it.
    const source = read(ORG_MEMBERS_CARD)
    const options = source.slice(
      source.indexOf('HOST_ROLE_OPTIONS'),
      source.indexOf('HOST_ROLE_HINTS'),
    )
    expect(options).toContain("'author'")
    expect(options.indexOf("'viewer'")).toBeLessThan(options.indexOf("'author'"))
    expect(options.indexOf("'author'")).toBeLessThan(options.indexOf("'editor'"))
  })

  it('both pickers say what the role cannot do, not just its name', () => {
    // "Author" alone does not tell an agency owner that this is the role the
    // guide's worked example means. The distinguishing sentence has to be on
    // screen at the moment of choosing.
    for (const path of [ORG_MEMBERS_CARD, DOORS[3].path]) {
      expect([path, read(path)]).toEqual([
        path,
        expect.stringContaining('cannot publish'),
      ])
    }
  })

  it('the site-collaborator card no longer claims the role is unenforced', () => {
    // The card used to say per-role restrictions "are recorded and roll out
    // with granular permissions" — true when nothing below admin was
    // enforced, and false the moment `author` shipped. A console that
    // understates what it enforces is how AGL-2334 started: the custom-role
    // tooltip denied a narrowing capability the code already had, and anyone
    // who believed it stopped looking.
    const card = read(DOORS[3].path)
    expect(card).not.toContain(
      'restrictions for editors and viewers are recorded and roll',
    )
    expect(card).toContain('cannot publish any of it')
  })

  it('the rules and the shared role lists spell the same two sets', () => {
    // The server helpers are an ECHO of the rules, not the enforcement. If
    // the two ever disagree, the console says one thing and the database does
    // another — and the rules win, silently.
    const rules = read('cloud/firebase-firestore.rules')
    expect(rules).toContain(
      "hostMemberRole(hostId) in ['admin', 'editor', 'author']",
    )
    expect(rules).toContain('function canPublishHostContent(hostId)')
    const shared = read('libs/aglyn/src/lib/app-utils/organizations.ts')
    expect(shared).toContain("'admin',\n  'editor',\n  'author',\n]")
    expect(shared).toContain(
      "export const HOST_PUBLISH_ROLES: readonly HostAccessRole[] = ['admin', 'editor']",
    )
  })

  it('publishSchedule is frozen wherever a version pointer is', () => {
    // The bypass, pinned as a TEXTUAL invariant beside the emulator proof: a
    // publish gate that leaves `publishSchedule` writable is defeated in one
    // write, because the cron executor then moves `versionId` and registers
    // the routing entry with ADMIN-SDK privileges, subject to no rule at all.
    // Every freeze that names `versionId` must name `publishSchedule` too.
    const rules = read('cloud/firebase-firestore.rules')
    const freezes = [...rules.matchAll(/hasAny\(\[([^\]]*)\]\)/g)]
      .map((match) => match[1])
      .filter((list) => list.includes('versionId'))
    expect(freezes.length).toBeGreaterThanOrEqual(3)
    for (const list of freezes) {
      expect([list, list.includes('publishSchedule')]).toEqual([list, true])
    }
  })
})
