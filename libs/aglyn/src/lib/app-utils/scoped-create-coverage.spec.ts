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

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Creation-side coverage for the AGL-1037 scope (AGL-1478).
 *
 * Both enforcement layers fail CLOSED on a missing `visibleTo` — the rules'
 * `hasAny` errors, the client's `array-contains-any` matches nothing — so a
 * document created without it is not "unrestricted", it is invisible to
 * every scoped read. AGL-1466 was that bug in `mediaFolders`: two creation
 * paths, both building the document inline, both forgetting the field, and
 * the symptom (114 files collapsing into "No folder") looked like data loss
 * rather than scoping.
 *
 * The audit that followed found the same hole in three more places. That is
 * the pattern worth guarding: not one call site, but the fact that a writer
 * of a scoped collection can forget. So this file is a list of every
 * creation path into `SCOPED_COLLECTIONS`, and a failure here means a new
 * one arrived — or an existing one lost its stamp.
 *
 * It reads the repo source directly rather than rendering anything: these
 * writers are a plugin API handler, a React console page with four Firestore
 * listener stacks, an upload route that needs a Storage bucket, and two node
 * seed scripts. Behaviour lives in their own specs and against the emulator;
 * what lives here is the wiring, which is exactly what went missing.
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')

function read(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

/** Mirrors `apps/console/utils/server/backfill-scope.ts`'s list. */
const SCOPED_COLLECTIONS = [
  'datasets',
  'media',
  'mediaFolders',
  'contacts',
  'contactSegments',
]

describe('AGL-1478 · every creator of a scoped collection stamps the scope', () => {
  /**
   * One row per creation path. `mustContain` names the helper that decides
   * the scope — the point being that the decision is made by shared code
   * that cannot be omitted, not re-derived inline at each site.
   */
  const CREATORS: Array<{ file: string; mustContain: string[]; why: string }> = [
    {
      // The reference implementation: honours the org's AGL-1048 default.
      //
      // `newResourceScopeFields` since AGL-1484. This row asked only for
      // `defaultScopeForNewResource`, which decides WHAT the scope is and
      // says nothing about whether it reaches the document — the field was
      // still written by hand into an object literal. AGL-1478 built the
      // required-argument gate for precisely the collections with no
      // document constructor of their own and named `datasets` first, and
      // then three of the four dataset creators bypassed it.
      file: 'apps/console/app/api/orgs/datasets/route.ts',
      mustContain: ['defaultScopeForNewResource', 'newResourceScopeFields'],
      why: 'org Data page → new dataset',
    },
    {
      file: 'libs/plugins/marketplace/src/lib/server/install-dataset-schema.ts',
      mustContain: ['defaultScopeForNewResource', 'newResourceScopeFields'],
      why: 'installing a dataset schema from the marketplace',
    },
    {
      // The creator this list did not have (AGL-1484). A restore writes new
      // documents into THREE scoped collections — `datasets`, `media`,
      // `mediaFolders` — straight past `/api/orgs/datasets`, and it was
      // missing here because it is spelled as a restore rather than as a
      // create. It stamps the importing site rather than the org default,
      // deliberately: a bundle restored into an agency's org must not
      // publish one client's data to the whole roster.
      file: 'apps/console/app/api/hosts/import/route.ts',
      mustContain: ['newResourceScopeFields', 'hostScopeToken'],
      why: 'restoring a site backup into an org',
    },
    {
      // AGL-1478's live-ish hole. The forked copy lands in whatever
      // collection its original lived in, so the fork has to carry a scope
      // decision for the scoped ones — and `Target.forkScope` is REQUIRED,
      // so a sixth artifact type cannot be added without answering it.
      file: 'libs/plugins/marketplace/src/lib/server/update-artifact.ts',
      mustContain: ['forkScope', 'newResourceScopeFields'],
      why: 'taking a marketplace update as a separate copy',
    },
    {
      // Inert today — `contactSegments` has no `array-contains-any` reader
      // and the rules gate it on `isOrgWideMember()` — which is precisely
      // why it went unnoticed. It becomes AGL-1466 the first time anyone
      // adds a scoped read.
      file: 'libs/plugins/contacts/src/lib/components/contacts-console-page.tsx',
      mustContain: ['newResourceScopeFields'],
      why: 'saving a contact filter as a segment',
    },
    {
      // A third writer onto `orgs/{orgId}/media` used to sit here: the legacy
      // API-only org-media route, which hardcoded `['org']` while these two
      // honoured `defaultResourceScope`, so the same upload landed with a
      // different scope depending on which door it came through. AGL-1478
      // gave it the shared decision; AGL-1485 then deleted the route outright
      // (no caller since AGL-821, and a divergent document besides), which is
      // why this list is two rows rather than three. Its absence is asserted
      // in `apps/console/specs/media-create-shape.spec.ts`.
      file: 'apps/console/app/api/media/upload/route.ts',
      mustContain: ['defaultScopeForNewResource'],
      why: 'console media upload',
    },
    {
      file: 'apps/console/app/api/media/upload-url/route.ts',
      mustContain: ['defaultScopeForNewResource'],
      why: 'signed media upload',
    },
  ]

  // Asserted on the list of MISSING tokens, not on the source: a failure
  // here should print the verdict, not the 560-line handler that produced
  // it (the same call the AGL-1466 wiring spec makes).
  it.each(CREATORS)('$why ($file)', ({ file, mustContain }) => {
    const source = read(file)
    const missing = mustContain.filter((token) => !source.includes(token))
    expect(missing).toEqual([])
  })

  /**
   * `media-library.component.tsx` has its own guard in
   * `apps/console/components/media/media-folder-scope-wiring.spec.ts`
   * (AGL-1466), which counts its creates rather than merely finding one.
   * Named here so the list above reads as complete.
   */
  it('defers the media library to its own AGL-1466 wiring spec', () => {
    expect(
      read(
        'apps/console/components/media/media-folder-scope-wiring.spec.ts',
      ),
    ).toContain('newMediaFolderDoc')
  })
})

/**
 * The seeds are the other half. `upsert-contact.ts` dedupes an inbound form
 * submission through `scopedToHost`, so an unstamped seeded contact is
 * invisible to its own dedupe query: a second submission from the same email
 * creates a duplicate instead of merging. The e2e and demo fixtures could
 * not reproduce a correctly-scoped read at all, which is why no test caught
 * any of this.
 *
 * `seed-scope-fixture.mjs` is excluded deliberately — it exists to seed
 * documents in every scope state, unstamped included.
 */
describe('AGL-1478 · the seeds write documents a scoped read can find', () => {
  const SEEDS = ['tools/scripts/seed-e2e.mjs', 'tools/scripts/seed-demo-host.mjs']

  it.each(SEEDS)('%s stamps every org-scoped document it writes', (file) => {
    const source = read(file)
    const unstamped = scopedSeedWrites(source)
      .filter((write) => !carriesScope(write.body, source))
      .map((write) => `${write.collection}: ${write.body.slice(0, 60)}…`)
    expect(unstamped).toEqual([])
  })
})

/**
 * Whether a seeded document literal carries a scope — written out, or
 * spread from a `const` in the same file that does. `seed-demo-host`
 * resolves its target to an org OR a host and so has to spread a decision
 * rather than a literal; following the spread is what keeps this a check on
 * the DOCUMENT rather than on how tersely it was written.
 */
function carriesScope(body: string, source: string): boolean {
  if (/visibleTo/.test(body)) return true
  for (const [, name] of body.matchAll(/\.\.\.([A-Za-z_$][\w$]*)/g)) {
    const declared = new RegExp(`const ${name}\\s*=([^\\n]*)`).exec(source)
    if (declared && /visibleTo/.test(declared[1])) return true
  }
  return false
}

/**
 * Every `put(<ref>, { … })` in a seed whose ref lands in a scoped
 * collection, with the document literal that goes with it.
 *
 * The LAST `.collection('…')` in the ref expression is the one that matters:
 * `orgRef.collection('datasets').doc(id).collection('records')` writes a
 * record, and records inherit their dataset's scope rather than carrying
 * one (AGL-1041).
 *
 * A host ref is skipped: `hosts/{hostId}` subcollections are private by
 * construction and store no scope, the same rule `newMediaFolderDoc`'s
 * `null` branch encodes. `seed-demo-host` resolves `dataRef` to whichever
 * it has, so the check follows the same conditional the seed must.
 */
function scopedSeedWrites(
  source: string,
): Array<{ collection: string; body: string }> {
  const writes: Array<{ collection: string; body: string }> = []
  const opener = /\bput\(/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source))) {
    const open = match.index + match[0].length - 1
    const close = matchingParen(source, open)
    if (close < 0) continue
    const call = source.slice(open + 1, close)
    const comma = topLevelComma(call)
    if (comma < 0) continue
    const ref = call.slice(0, comma)
    if (/hostRef/.test(ref)) continue
    const collections = [...ref.matchAll(/\.collection\('([^']+)'\)/g)]
    const collection = collections[collections.length - 1]?.[1]
    if (!collection || !SCOPED_COLLECTIONS.includes(collection)) continue
    writes.push({ collection, body: call.slice(comma + 1).trim() })
  }
  return writes
}

/** Index of the `)` closing the `(` at `open`, or -1. */
function matchingParen(source: string, open: number): number {
  let depth = 0
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === '(') depth += 1
    else if (source[at] === ')') {
      depth -= 1
      if (depth === 0) return at
    }
  }
  return -1
}

/** Index of the first comma not nested inside brackets, or -1. */
function topLevelComma(text: string): number {
  let depth = 0
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1
    else if (char === ',' && depth === 0) return at
  }
  return -1
}
