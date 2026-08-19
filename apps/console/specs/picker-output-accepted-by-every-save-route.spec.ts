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

import { isMediaCdnPath } from '@aglyn/aglyn/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * EVERY save route behind a `MediaUrlField` must accept its own picker's
 * output (AGL-2286).
 *
 * AGL-2247 found this on the white-label branding profile and fixed it there.
 * It was never only there: `MediaUrlField` is used on four fields, and three
 * of them — the ORG PROFILE LOGO, the MEMBER AVATAR, and the staff identity
 * editor's twin of that avatar — kept a bare `^https://` test. Each rendered a
 * "Browse the org media library" button whose output its own server refused,
 * so the affordance the console advertises was dead on the org logo and on
 * every user's avatar.
 *
 * ## Why the grammar moved
 *
 * AGL-2247's predicate was a private regex inside `apps/console`. The avatar
 * boundary is `normalizeMemberPhotoUrl` in `libs/tenant/data/admin`, which
 * cannot import from an app — so a fix there would have been a THIRD copy of
 * the same regex. `isMediaCdnPath` now lives in `media-ref.ts`, the module
 * that already owns `MEDIA_CDN_ROUTE` and `isMediaCdnScope`, and every
 * validator delegates to it.
 *
 * ## What is asserted where
 *
 * The POLICY is a pure function and is tested as one, below and in
 * `member-photo.spec.ts`. The four call sites cannot be unit-tested without
 * standing up a closed-world mock of auth, entitlements and Firestore around
 * each route — the mock shape that has manufactured false verdicts in this
 * suite repeatedly — so they are checked as WIRING: the file must reach the
 * shared predicate, and must no longer carry the bare test it replaced.
 * Asserting the OLD pattern is gone is the half that catches a revert;
 * asserting the new name alone would stay green if someone re-added the
 * `^https://` refusal above it.
 */
const REPO_ROOT = resolve(__dirname, '../../..')

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

/**
 * Source with comments removed, so prose about a predicate cannot pass for a
 * call to it — every one of these files now explains the fix in a docblock
 * that names `isMediaCdnPath`, and a guard satisfied by that comment would
 * certify the fix's absence. (The exact failure `branding-coverage.spec.ts`
 * documents for `emailLogoUrl`.)
 *
 * ⚠️ THIS STRIPPER IS BLIND TO A LINE CONTAINING AN ESCAPED-SLASH REGEX.
 * `/^https:\/\//i` ends in `\/` `\/` `/`, whose last two characters are two
 * adjacent slashes — so `//.*$` reads the rest of that line as a comment and
 * deletes it. It cost a real false RED here: the wiring check could not see
 * `isMediaCdnPath(photoUrl)` sitting on the same line as the https test.
 * The shared copy of this helper in `branding-coverage.spec.ts` says it "can
 * HIDE a match, never invent one, so the guard errs strict" — true, and this
 * is what erring strict looks like from the inside. The validators here keep
 * the https test on its OWN line so the call is visible; a future guard
 * written against a one-line condition will fail for this reason and not
 * because the code is wrong.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
}

/** Exactly what `media-picker-dialog`'s `onPick` hands `MediaUrlField`. */
const PICKER_OUTPUT = '/api/media/cdn/org:org-1/media-1'

describe('the shared picker-output predicate', () => {
  it('holds its premise: the picker really does write a relative CDN path', () => {
    // Without this the whole spec could be about a shape the UI stopped
    // producing years ago — a guard asserting a false premise, which is the
    // way a sweep manufactures findings instead of catching them.
    const field = stripComments(
      read('apps/console/components/media-url-field.component.tsx'),
    )
    expect(field).toContain('cdnPath')
    // And the value it writes must be the one this spec calls the picker
    // output, not merely something with the same name.
    expect(isMediaCdnPath(PICKER_OUTPUT)).toBe(true)
  })

  it.each([
    ['the picker output', PICKER_OUTPUT],
    ['a host-qualified restricted asset', '/api/media/cdn/org:org-1:host-9/m-1'],
    ['a bare host scope', '/api/media/cdn/host-9/media-1'],
  ])('accepts %s', (_label, value) => {
    expect(isMediaCdnPath(value)).toBe(true)
  })

  /**
   * The refusals are the reason the acceptances are safe. A predicate that
   * returned true for everything would satisfy every positive case above and
   * turn four fields into an `<img src>`/`<a href>` sink at once.
   */
  it.each([
    ['an absolute https URL — a DIFFERENT shape, handled by the caller', 'https://x.example/a.png'],
    ['http, not https', 'http://x.example/a.png'],
    ['a javascript: scheme', 'javascript:alert(1)'],
    ['a data: URI', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['protocol-relative, which names a FOREIGN host', '//evil.example/x.png'],
    ['a path outside the media CDN', '/api/admin/secrets'],
    ['the CDN prefix with a traversal escape', '/api/media/cdn/../../etc/pw'],
    ['a CDN path with no media id', '/api/media/cdn/org:org-1'],
    ['a CDN path with an extra segment', '/api/media/cdn/org:org-1/med/1'],
    ['a query smuggled onto a CDN path', '/api/media/cdn/org:org-1/m?x=1'],
    ['a prefix that only looks like ours', '/api/media/cdnx/org:org-1/m-1'],
    ['leading whitespace', ' /api/media/cdn/org:org-1/media-1'],
    ['a three-part org scope', '/api/media/cdn/org:a:b:c/media-1'],
    ['a non-string', 42],
  ])('refuses %s', (_label, value) => {
    expect(isMediaCdnPath(value)).toBe(false)
  })
})

/**
 * Each save path behind a `MediaUrlField`: the field it guards, the token
 * proving it reaches the shared predicate, and the bare test it must no
 * longer carry for that field.
 */
const SAVE_PATHS: Array<{
  file: string
  field: string
  reaches: string
  mustNotContain: string
}> = [
  {
    file: 'apps/console/app/api/orgs/settings/route.ts',
    field: 'the organization profile logo (Organization Settings)',
    reaches: 'isBrandingImageUrl(logoUrl)',
    mustNotContain: '!/^https:\\/\\//i.test(logoUrl)',
  },
  {
    file: 'apps/console/app/api/admin/users/manage/route.ts',
    field: "the staff identity editor's avatar twin",
    reaches: 'isMediaCdnPath(photoUrl)',
    mustNotContain: "{ error: 'Photo URLs must be https://' }",
  },
  {
    file: 'apps/console/app/(app)/manage/user/page.tsx',
    field: 'Manage Account → Profile image (the client courtesy check)',
    reaches: 'isMediaCdnPath(cleaned)',
    mustNotContain: "'Image URLs must be https://'",
  },
  {
    file: 'apps/console/app/api/_lib/branding-url.ts',
    field: 'the white-label logo / favicon / email logo (AGL-2247)',
    reaches: 'isMediaCdnPath(value)',
    // The private regex this file used to own. It must be gone, not merely
    // unused — a second grammar beside the shared one is the drift AGL-2286
    // removed.
    mustNotContain: 'MEDIA_CDN_PATH',
  },
]

describe('every MediaUrlField save path reaches the shared predicate', () => {
  it.each(SAVE_PATHS)('$field — $file', ({ file, reaches, mustNotContain }) => {
    const source = stripComments(read(file))
    expect(source).toContain(reaches)
    expect(source).not.toContain(mustNotContain)
  })

  it('can tell a wired file from an unwired one', () => {
    // The instrument. If `stripComments` ever ate the whole file, every check
    // above would pass its `not.toContain` half vacuously and the
    // `toContain` half would fail loudly — but a subtler break (stripping
    // only some forms) would not show. So: a file that has never heard of the
    // predicate must read as unwired.
    const unrelated = stripComments(read('apps/console/app/page-title.ts'))
    expect(unrelated).not.toContain('isMediaCdnPath')
    expect(unrelated.length).toBeGreaterThan(100)
  })
})
