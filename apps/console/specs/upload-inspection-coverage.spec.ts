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

import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * EVERY door, or none (AGL-1475).
 *
 * A structural check wired to four of five ingresses is not a control, it is
 * a claim — the fifth is simply where uploads go instead. AGL-1475 was filed
 * believing there were two media chokepoints; by the time it was built there
 * were five, because AGL-1465, AGL-2463 and the marketplace each added one
 * without anything forcing the question. That is the failure this file is
 * here to stop repeating.
 *
 * So the guard is not "the routes we know about call the inspector". It is
 * "every place in the repository that writes bytes to a Storage bucket is
 * either covered or explicitly exempted, with a reason". A new ingress fails
 * this spec until somebody decides which it is.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')

/** The ingresses that MUST call `inspectUploadBytes`. */
const COVERED_INGRESSES = [
  // 1. Console DAM, base64 JSON — bytes in process.
  'apps/console/app/api/media/upload/route.ts',
  // 2. Console DAM, signed direct-to-storage — inspected at finalize through
  //    ranged reads, because the bytes never enter the function.
  'apps/console/app/api/media/upload-url/route.ts',
  // 3. Console DAM, replace — swaps bytes behind a live `cdnPath`.
  'apps/console/app/api/media/replace/route.ts',
  // 4. The public `/v1` media write (AGL-2463), authenticated by API key.
  'apps/console/utils/api-v1-resources.ts',
  // 5. Marketplace listing preview image — a publisher-supplied image served
  //    to unauthenticated browsers, and NOT through `serveMediaCdn`.
  'libs/plugins/marketplace/src/lib/server/preview-image.ts',
]

/**
 * Storage writes that legitimately do not carry caller-supplied bytes.
 *
 * Each entry is a decision, not a silence. Adding to this list is how a new
 * write says "these bytes are ours"; if that is not true of it, it belongs in
 * `COVERED_INGRESSES` instead.
 */
const EXEMPT_WRITES: Readonly<Record<string, string>> = {
  'apps/console/app/api/admin/audit-archive/route.ts':
    'Server-generated JSONL assembled from Firestore audit rows. No caller ' +
    'supplies these bytes; staff and cron are the only callers.',
  'libs/plugins/marketplace/src/lib/server/publish-plugin.ts':
    'The plugin bundle is JavaScript by design — `application/javascript` is ' +
    'the point of it, so an executable-container refusal is meaningless ' +
    'here. Its integrity control is a different one: static verification ' +
    '(`checkPluginBundle`), a content-addressed immutable path, review on ' +
    'the version, and an Ed25519 signature checked before the realm runs it.',
}

/** Directories worth walking; everything else has no Storage access. */
const SEARCH_ROOTS = ['apps', 'libs']

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  '.turbo',
])

function* walk(directory: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(directory)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry)) continue
    const full = join(directory, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx?$/.test(entry) && !/\.spec\.tsx?$/.test(entry)) {
      yield full
    }
  }
}

const relative = (absolute: string): string =>
  absolute.slice(REPO_ROOT.length + 1).split('\\').join('/')

/**
 * A write of a whole object to a bucket. Deliberately matches the two shapes
 * the repo actually uses — `file.save(` and `.file(x).save(` — rather than
 * every `.save(`, which would sweep in Firestore and canvas-context calls.
 */
const BUCKET_WRITE = /\b(?:file|bucket\.file\([^)]*\))\.save\(/

const sourceFiles: { path: string; source: string }[] = []
for (const root of SEARCH_ROOTS) {
  for (const absolute of walk(join(REPO_ROOT, root))) {
    sourceFiles.push({
      path: relative(absolute),
      source: readFileSync(absolute, 'utf8'),
    })
  }
}

describe('structural upload inspection covers every ingress (AGL-1475)', () => {
  it('finds the source tree at all — the guard cannot pass by reading nothing', () => {
    expect(sourceFiles.length).toBeGreaterThan(500)
    expect(sourceFiles.some((file) => file.path === COVERED_INGRESSES[0])).toBe(
      true,
    )
  })

  it.each(COVERED_INGRESSES)('%s calls inspectUploadBytes', (path) => {
    const file = sourceFiles.find((candidate) => candidate.path === path)
    // A renamed or deleted ingress must fail loudly, not silently pass.
    expect(file).toBeDefined()
    expect(file?.source).toContain('inspectUploadBytes(')
  })

  it('inspects BEFORE it stores, at every covered ingress', () => {
    for (const path of COVERED_INGRESSES) {
      const source = sourceFiles.find((f) => f.path === path)?.source ?? ''
      const inspected = source.indexOf('inspectUploadBytes(')
      const stored = source.search(BUCKET_WRITE)
      expect(inspected).toBeGreaterThan(-1)
      expect(stored).toBeGreaterThan(-1)
      // Refusing after the write would leave the object in the bucket and
      // the customer billed for it — the exact defect AGL-1613 fixed for
      // quarantine, which this control must not reintroduce.
      expect({ path, inspected, stored }).toEqual({
        path,
        inspected,
        stored: expect.any(Number),
      })
      expect(inspected).toBeLessThan(stored)
    }
  })

  it('leaves NO bucket write unaccounted for — a sixth ingress fails here', () => {
    const writers = sourceFiles
      .filter((file) => BUCKET_WRITE.test(file.source))
      .map((file) => file.path)
      .sort()

    // The scan has to actually be finding writes, or "all accounted for" is
    // a verdict about an empty set.
    expect(writers.length).toBeGreaterThanOrEqual(COVERED_INGRESSES.length)

    const unaccounted = writers.filter(
      (path) =>
        !COVERED_INGRESSES.includes(path) &&
        !Object.prototype.hasOwnProperty.call(EXEMPT_WRITES, path),
    )
    expect(unaccounted).toEqual([])
  })

  it('keeps every exemption pointed at a file that still exists', () => {
    for (const path of Object.keys(EXEMPT_WRITES)) {
      expect(sourceFiles.some((file) => file.path === path)).toBe(true)
      expect(EXEMPT_WRITES[path].length).toBeGreaterThan(40)
    }
  })

  it('never CLAIMS to be antivirus in the ingress code', () => {
    /**
     * AGL-2463 found the media docs claiming uploads received "virus
     * scanning", which was never true of any path, and replaced it with what
     * actually happens. This control is structural validation, and shipping
     * it must not quietly re-license the old sentence.
     *
     * The check is negation-aware on purpose. These files SHOULD say "this is
     * not an antivirus scan" — repeatedly, because that is the property most
     * likely to be lost in a future summary — so a bare substring match would
     * fail on exactly the sentences it wants to encourage. What must not
     * appear is the AFFIRMATIVE form.
     */
    const claim =
      /\b(virus scan|antivirus scan|malware scan|scanned for (?:viruses|malware))/i
    const negated = /\b(not|never|no|without|rather than|isn't|does not|cannot)\b/i

    const affirmativeClaims = (source: string): string[] =>
      source
        .split('\n')
        .filter((line) => claim.test(line) && !negated.test(line))
        .map((line) => line.trim())

    // The check must be able to fail. A sentence of the shape AGL-2463
    // deleted has to trip it, or "no claims found" means nothing.
    expect(
      affirmativeClaims('Every upload receives virus scanning before storage.'),
    ).toHaveLength(1)
    // ...and the denial these files are full of must NOT trip it.
    expect(
      affirmativeClaims('Structure only — this is not an antivirus scan.'),
    ).toEqual([])

    for (const path of COVERED_INGRESSES) {
      const source = sourceFiles.find((f) => f.path === path)?.source ?? ''
      expect({ path, claims: affirmativeClaims(source) }).toEqual({
        path,
        claims: [],
      })
    }
  })
})
