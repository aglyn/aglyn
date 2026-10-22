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
 * The stale-seed refusal exists in exactly ONE source file (AGL-1449).
 *
 * ## Why a spec at the guard could not have caught this
 *
 * AGL-1446 rewrote the refusal copy and pinned it verbatim — next to the
 * guard, against the guard's own function. That spec is right and it is also
 * structurally blind: it can only see the copy it is standing on. Two console
 * save paths had re-implemented the refusal as inline early-return `if`s with
 * their own hand-typed strings, so AGL-1446's fix — which added the one remedy
 * that works in a permanently cache-only tab — reached 126 call sites and not
 * those two. Nothing failed. Nothing could have.
 *
 * That was the smaller half of the damage. A hand-rolled guard holds only the
 * conditions whoever wrote it happened to think of: `plugin-config-card`
 * checked `fromCache` and the session heuristic and had nothing for
 * `unreadable`, and the content page checked the session heuristic ALONE. Both
 * wrote where `writeGuardedBySeed` refuses, on whole-object payloads that
 * `merge` does not protect. Copy drift was the visible symptom of a
 * data-integrity bug.
 *
 * ## What this spec does about it
 *
 * It reads the CORPUS — every `.ts`/`.tsx` under `apps/` and `libs/` — rather
 * than a list of files someone remembered to add. A hand-listed set has the
 * same blind spot as the guard-local spec: the next twin is by definition the
 * file nobody thought to list. A third copy anywhere in the workspace fails
 * here, naming its path.
 *
 * Specs are excluded, and deliberately so: nineteen of them across eleven
 * projects assert this copy as the discriminator between the guard's three
 * reasons, which is what SHOULD happen. Asserting the copy is fine. Producing
 * it is what may only happen once.
 *
 * The second half catches the twin that paraphrases every word. `session-
 * health` is the guard's injected third signal, and a call site reaching for
 * `getSessionHealth()` directly is hand-rolling the guard whatever it then
 * says to the user — which is the shape both AGL-1449 sites actually wore.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const SEARCH_ROOTS = ['apps', 'libs'].map((dir) => join(REPO_ROOT, dir))

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  'coverage',
  '.nx',
  'tmp',
])

/** The one file allowed to produce the refusal. */
const GUARD =
  'libs/tenant/feature/instance/src/lib/hooks/helpers/guarded-seed-write.ts'

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(full))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    // A spec that ASSERTS the copy is the mechanism working, not a twin.
    if (/\.spec\.tsx?$/.test(entry.name)) continue
    found.push(full)
  }
  return found
}

const corpus = SEARCH_ROOTS.flatMap(sourceFiles).map((file) => ({
  path: relative(REPO_ROOT, file).split(sep).join('/'),
  text: readFileSync(file, 'utf8'),
}))

/**
 * Fragments of all three refusals, each contained within a single source line
 * so the string concatenation in `refusalMessage` cannot hide one from the
 * sweep. Every fragment is asserted to be present in the guard below, so a
 * copy rewrite that drops one fails HERE rather than quietly turning this
 * spec into a sweep for a string that no longer exists.
 */
const REFUSAL_PHRASES = [
  // unreadable
  'could not be loaded, so there is nothing safe to',
  'overwrite the stored copy with blanks',
  // unconfirmed
  'with the server, so what is',
  'Check your connection and reload; if it is refused again,',
  'open this page in a new browser tab',
  // stale-session
  'Your session went stale, so your',
  'saving now could overwrite newer values.',
  'Sign in again and reload.',
]

describe('the stale-seed refusal has ONE source (AGL-1449)', () => {
  /** Guards the premise: a sweep that read nothing would pass silently. */
  it('reads the corpus, not a hand-listed set of files', () => {
    expect(corpus.length).toBeGreaterThan(2000)
    expect(corpus.map(({ path }) => path)).toContain(GUARD)
  })

  it('still describes the copy that actually ships', () => {
    const guard = corpus.find(({ path }) => path === GUARD)
    expect(guard).toBeDefined()
    for (const phrase of REFUSAL_PHRASES) {
      expect(guard!.text).toEqual(expect.stringContaining(phrase))
    }
  })

  it.each(REFUSAL_PHRASES)('is written in one place only: "%s"', (phrase) => {
    const producers = corpus
      .filter(({ text }) => text.includes(phrase))
      .map(({ path }) => path)
    expect(producers).toEqual([GUARD])
  })
})

/**
 * The other way a twin announces itself, and the one that survives a
 * paraphrase.
 *
 * `session-health` is the guard's THIRD signal, and the library reaches it
 * only through the check the console registers at startup. Any other file
 * asking `getSessionHealth()` for a verdict is deciding on its own whether a
 * write is safe — which is precisely what both AGL-1449 call sites were doing,
 * and what left them missing `fromCache` and `unreadable` entirely.
 */
describe('nothing hand-rolls the guard off session-health (AGL-1449)', () => {
  const READS_SESSION_HEALTH = /\bgetSessionHealth\s*\(/

  /**
   * A reason is mandatory. The value of the sweep is that "we decided" is
   * written down, not that the list is short.
   */
  const EXEMPT: Record<string, string> = {
    'apps/console/utils/session-health.ts':
      'Defines the verdict. The module that computes `staleSession` from the accumulated denial evidence necessarily names its own accessor.',
    'apps/console/utils/firestore-one-shot-retry.ts':
      'PRODUCES the evidence rather than consuming it: it reads `deniedCollections` to decide whether a retry budget was spent on a dead session, and reports denials in. It writes nothing to Firestore.',
    'apps/console/components/layouts/firebase-app.layout.tsx':
      'The registration seam itself (AGL-1358). `setStaleSessionCheck(() => getSessionHealth().staleSession)` at module scope is the ONLY way this console signal reaches a guard that lives in the library.',
    'libs/tenant/feature/instance/src/lib/hooks/helpers/guarded-seed-write.ts':
      'The guard. Names `getSessionHealth()` in prose only — explaining why the console-side verdict is injected rather than imported — and the lib could not import it if it wanted to.',
  }

  const consumers = corpus
    .filter(({ text }) => READS_SESSION_HEALTH.test(text))
    .map(({ path }) => path)
    .filter((path) => !(path in EXEMPT))

  it('leaves the verdict to the guard at every write site', () => {
    expect(consumers).toEqual([])
  })

  it('records a reason for every exemption, and each still applies', () => {
    for (const [path, reason] of Object.entries(EXEMPT)) {
      expect(reason.length).toBeGreaterThan(60)
      expect(readFileSync(join(REPO_ROOT, path), 'utf8')).toMatch(
        READS_SESSION_HEALTH,
      )
    }
  })
})
