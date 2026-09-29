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
 * Every screen create STORES `deletedAt: null` (AGL-3321), swept across the
 * whole repo.
 *
 * A campaign's screens list leaves tombstones out on its query:
 * `deletedAt == null`. Firestore's equality matches only a document that
 * HOLDS the field, so a screen created without the stored null still opens,
 * still publishes and still lists everywhere else — and is missing from
 * every campaign it is filed under, which nobody would notice.
 *
 * The screen's list keys — the null among them — come from ONE helper,
 * `artifactCreateListKeys` (`libs/aglyn/src/lib/app-utils/artifact-list-keys.ts`),
 * and a script that cannot import it writes `deletedAt: null` itself. So:
 *
 *   - every file that CREATES screens is a door, named below, and its code
 *     calls the helper or writes the null;
 *   - every other file that names the `screens` collection beside a
 *     create-shaped write (`tx.create(`, `batch.set(`, `.doc(…).set(`,
 *     `merge: false`, …) is named as NOT creating screens, with the reason.
 *
 * A new file of that shape fails here until it is put in one list or the
 * other — which is the moment somebody has to answer whether it stamps.
 * The sweep is textual: a writer that reaches `screens` only through a
 * collection name held in a variable, in a file that never spells it, is
 * outside what it can see, which is why the doors are pinned by name too.
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../..')

/** The files that create screen documents, each of which must stamp. */
const DOORS = [
  // `POST /api/hosts/resources`: every console create (the screens page,
  // email designs, a page from a template).
  'apps/console/app/api/hosts/resources/route.ts',
  // A site import writes each bundled screen whole.
  'apps/console/app/api/hosts/import/route.ts',
  // Duplicate, from the console, the AI tool and the page step.
  'libs/tenant/data/admin/src/lib/server/duplicate-resource.ts',
  'libs/plugins/marketplace/src/lib/server/install-email-starter.ts',
  'libs/plugins/ai/src/lib/jobs/ai-job-drafts.ts',
  'libs/plugins/email/src/lib/server-email-drafts.ts',
  // Scripts, which write the null themselves.
  'tools/scripts/backfill-artifacts-list-keys.mjs',
  'tools/scripts/seed-e2e.mjs',
  'tools/scripts/lib/seed-demo.mjs',
  'tools/scripts/seed-marketing-screens.mjs',
  'tools/e2e/capture-docs-shots.mjs',
  'tools/e2e/starter-root-wire.mjs',
  'tools/e2e/dam-replace-and-video.e2e.mjs',
]

/** Files the sweep's shape matches that write no screen document, and why. */
const NOT_SCREEN_CREATES: Readonly<Record<string, string>> = {
  'apps/console/app/api/hosts/collections/route.ts': 'creates collections; only updates a screen’s kind',
  'apps/console/app/api/hosts/versions/route.ts': 'creates versions under a screen, never the screen',
  'apps/console/utils/api-v1-resources.ts': 'creates datasets, records and media; reads the routing map',
  'apps/console/constants/screen-publishing.ts': 'merge-sets the publish fields of a screen that exists',
  'libs/plugins/ai/src/lib/server/ai-seo-apply.ts': 'creates a version under a screen that exists',
  'libs/plugins/marketing/src/lib/server/campaign-manage.ts': 'creates campaigns and sends; reads a design screen',
  'libs/plugins/marketing/src/lib/server/campaign-send.ts': 'writes sends; reads a design screen',
  'libs/plugins/marketing/src/lib/components/host-experiments-card.component.tsx':
    'writes experiments through a batch; names the screen under test',
  'tools/e2e/besigner-editors.e2e.mjs': 'seeds components and templates; reads the seeded home screen',
  'tools/e2e/presence-two-session.e2e.mjs': 'seeds members and roles; reads the seeded home screen',
  'tools/e2e/save-as-template.e2e.mjs': 'seeds layouts, components and templates; reads screens',
  'tools/scripts/backfill-reconstructed-activity.mjs': 'writes activity entries about screens',
  'tools/scripts/backfill-scheme-dark.mjs': 'rewrites themes on hosts; updates artifacts that exist',
  'tools/scripts/backfill-theme-history.mjs': 'writes theme history; names screens in its rules fixture',
}

/** The collection, spelled as a literal. */
const SCREENS = /['"]screens['"]/
/** A write that can bring a document into existence. */
const CREATE_SHAPE =
  /\b(?:tx|transaction|batch|writer|bulkWriter)\.(?:create|set)\(|\.doc\([^)]*\)\s*\.(?:create|set)\(|merge:\s*false/
/** What a door writes: the helper's keys, or the null itself. */
const STAMPS = /artifactCreateListKeys\(|deletedAt:\s*null/

/**
 * The source without its comments, which describe the shapes this looks
 * for. Strings and template literals are stepped over whole, so a `//`
 * inside one is kept.
 */
function withoutComments(source: string): string {
  let out = ''
  let at = 0
  while (at < source.length) {
    const char = source[at]
    const next = source[at + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2)
      at = end === -1 ? source.length : end + 2
    } else if (char === "'" || char === '"' || char === '`') {
      let end = at + 1
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1
      out += source.slice(at, end + 1)
      at = end + 1
    } else {
      out += char
      at += 1
    }
  }
  return out
}

/** Whether a file's code names the screens collection beside a create-shaped write. */
function mayCreateScreens(code: string): boolean {
  return SCREENS.test(code) && CREATE_SHAPE.test(code)
}

const code = (file: string) => withoutComments(readFileSync(join(REPO_ROOT, file), 'utf8'))

describe('AGL-3321 · every screen create stores deletedAt: null', () => {
  const candidates = (): string[] =>
    execSync('git ls-files "*.ts" "*.tsx" "*.mjs" "*.js" "*.cjs"', {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    })
      .toString()
      .split('\n')
      .filter(Boolean)
      .filter((file) => !/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
      .filter((file) => !file.endsWith('.d.ts') && !file.startsWith('apps/docs/'))
      .filter((file) => mayCreateScreens(code(file)))

  it('stamps at every door', () => {
    const unstamped = DOORS.filter((file) => !STAMPS.test(code(file)))
    expect(unstamped).toEqual([])
  })

  it('knows every file that could create a screen: a door, or named as not one', () => {
    const unclassified = candidates().filter(
      (file) => !DOORS.includes(file) && !(file in NOT_SCREEN_CREATES),
    )
    expect(unclassified).toEqual([])
  })

  it('names nothing as not creating screens that no longer matches the sweep', () => {
    // A stale entry would excuse whatever file next takes its name.
    const found = new Set(candidates())
    expect(Object.keys(NOT_SCREEN_CREATES).filter((file) => !found.has(file))).toEqual([])
  })

  it('CONTROL: sees the create shapes, and not a read or a comment', () => {
    expect(mayCreateScreens("tx.create(hostRef.collection('screens').doc(id), data)")).toBe(true)
    expect(mayCreateScreens("await db.collection('screens').doc(id).set({ displayName })")).toBe(true)
    expect(mayCreateScreens("const name = 'screens'; batch.set(ref, doc)")).toBe(true)
    expect(mayCreateScreens("await hostRef.collection('screens').doc(id).get()")).toBe(false)
    expect(
      mayCreateScreens(withoutComments("// tx.create(hostRef.collection('screens').doc(id), data)")),
    ).toBe(false)
    expect(STAMPS.test("{ ...doc, ...artifactCreateListKeys('screens', doc) }")).toBe(true)
    expect(STAMPS.test('{ displayName, deletedAt: null }')).toBe(true)
    expect(STAMPS.test('{ displayName, deletedAt: Timestamp.now() }')).toBe(false)
  })
})
