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

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { RESERVED_SUBDOMAINS } from '@aglyn/aglyn/app-utils/host-naming'
import { Route } from '../constants/route-links'
import {
  APEX_PATH_SEGMENTS,
  CONSOLE_TOP_LEVEL_SEGMENTS,
  orgScopedPathname,
} from '../constants/console-routes'

/**
 * `/support` IS A LITERAL SEGMENT IN AN ORG-SCOPED NAMESPACE (AGL-3265).
 *
 * The page itself is guarded by `utils/support-entry.spec.ts`. What is
 * guarded HERE is the set of conditions outside the page that decide whether
 * the URL resolves at all — three of them, each owned by a different file,
 * each individually reasonable to change, and none of which fails loudly.
 *
 * The failure mode is quiet in all three directions: the route 404s, or it
 * takes an address away from a workspace, or it stops being the org's own
 * support page on a host that already names the org. None of those is a
 * crash; every one of them is someone not finding help.
 */

const REPO_ROOT = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')
const PAGE = 'apps/console/app/(app)/support/page.tsx'

describe('the org-agnostic support entry point (AGL-3265)', () => {
  it('exists, and the route table names it', () => {
    expect(Route.SUPPORT_ENTRY).toBe('/support')
    expect(existsSync(join(REPO_ROOT, PAGE))).toBe(true)
  })

  /**
   * INSIDE the `(app)` group, which is the whole signed-out story: that
   * group's layout mounts `AuthenticatedLayout`, which pushes
   * `/signin?continue=<path>` and returns the visitor HERE. A copy of this
   * page anywhere else would silently lose the return target — the customer
   * signs in and lands on a dashboard, which is the dead end this page exists
   * to remove. Same reasoning as the billing entry point.
   */
  it('sits under the authenticated shell, so the signed-out leg keeps its return target', () => {
    expect(PAGE).toContain('/app/(app)/')
    expect(read('apps/console/app/(app)/layout.tsx')).toContain(
      'AuthenticatedLayout',
    )
  })

  /**
   * Without this row the AGL-3017 middleware gate reads `support` as a
   * workspace slug, asks Firestore, is told no such org exists, and answers
   * 404 — to a route that is right there in `app/`. `console-top-level-routes`
   * holds the set and the tree together in both directions; this names the one
   * row, because it is the row the whole feature rests on.
   */
  it('is registered as a top-level console segment, or the gate 404s it', () => {
    expect(CONSOLE_TOP_LEVEL_SEGMENTS.has('support')).toBe(true)
  })

  /**
   * The precondition for putting ANY literal segment at the apex: an org that
   * could hold the slug `support` would find its own address serving this page
   * instead. `BILLING_ENTRY` rests on exactly the same guarantee, and neither
   * route may outlive it.
   */
  it('cannot be claimed by an org, so the literal never shadows a real workspace', () => {
    expect(RESERVED_SUBDOMAINS.has('support')).toBe(true)
    expect(RESERVED_SUBDOMAINS.has('billing')).toBe(true)
  })

  /**
   * And the deliberate NON-registration, which reads like an omission.
   *
   * `APEX_PATH_SEGMENTS` is the list the workspace-subdomain rewrite must not
   * scope into an org (AGL-627). `support` is absent on purpose: on
   * `acme.aglyn.com` and on a custom console domain the HOST already names the
   * workspace, so `/support` there must become `/acme/support` — that org's own
   * support page — and never a picker asking which org the reader meant when
   * the address already said. The rewrite itself is driven in
   * `middleware.spec.ts`; this pins the intent beside the route so the next
   * author does not "fix" the omission.
   *
   * Read from the constant itself since AGL-3314 moved it out of the
   * middleware so the client could share the rule — and asked of the rule
   * too, which is what both of them now call.
   */
  it('is deliberately absent from the apex rewrite exemptions', () => {
    // Anti-vacuity: an emptied list must fail here rather than pass by
    // having nothing to look in.
    expect(APEX_PATH_SEGMENTS.has('manage')).toBe(true)
    expect(APEX_PATH_SEGMENTS.has('support')).toBe(false)
    expect(orgScopedPathname('/support', 'acme')).toBe('/acme/support')
  })
})
