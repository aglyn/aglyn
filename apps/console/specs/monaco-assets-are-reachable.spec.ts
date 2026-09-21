/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored. `middleware.ts` imports `next/server`, which does not load
 * under jsdom.
 */

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
 * AGL-3208: the vendored Monaco must be reachable, not merely deployed.
 *
 * AGL-1779 vendored `monaco-editor/min/vs` into `public/` and made the build
 * fail if the copy could not be produced. That guarded the BYTES, and the
 * bytes were fine. What nothing guarded was the URL: the copy landed at
 * `/monaco/vs`, and this app's own router answered 404 to all of it.
 *
 * `middleware.ts` reads an unrecognized first path segment as a workspace slug
 * and refuses an unknown one with a bare `404` (AGL-3017); on a workspace
 * subdomain `orgScopedPath` would instead have rewritten the same request to
 * `/{slug}/monaco/vs/...`. Either way Monaco's AMD loader never arrived, and
 * the besigner's Edit JSON dialog sat on its loading state.
 *
 * So the claim under test is the one that was false: the URL the editor asks
 * for is one the router never inspects. It is read from `MONACO_VS_PATH`
 * rather than restated, because a copy of the literal here would keep passing
 * while the editor asked for something else.
 *
 * Read out of the SOURCE, not imported. `shared-ui-json-editor` is lazy-loaded
 * by every besigner page, and `@nx/enforce-module-boundaries` refuses a static
 * import of a lazy-loaded library — importing it here would pull Monaco into
 * the console's static graph to read one string. Reading the declaration keeps
 * the single source of truth without that cost, and a rename of the constant
 * fails loudly below rather than silently passing.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isConsoleRouteSegment } from '../constants/console-routes'
import { config } from '../middleware'

/** `libs/shared/ui/json-editor/src/lib/components/monaco-editor.tsx`. */
const MONACO_EDITOR_SOURCE = join(
  __dirname,
  '../../../libs/shared/ui/json-editor/src/lib/components/monaco-editor.tsx',
)

/** The path `loader.config` is given, read off its declaration. */
const MONACO_VS_PATH = (() => {
  const source = readFileSync(MONACO_EDITOR_SOURCE, 'utf8')
  const declared = /export const MONACO_VS_PATH = '([^']+)'/.exec(source)
  if (!declared) {
    throw new Error(
      `MONACO_VS_PATH is no longer declared in ${MONACO_EDITOR_SOURCE}. ` +
        'This guard reads it rather than restating it — point it at the new ' +
        'declaration instead of inlining the path (AGL-3208).',
    )
  }
  return declared[1]
})()

/** Next's matcher entries are path regexes anchored at both ends. */
const matches = (path: string): boolean =>
  (config.matcher as string[]).some((pattern) =>
    new RegExp(`^${pattern}$`).test(path),
  )

/** What `@monaco-editor/loader` actually requests first. */
const LOADER_URL = `${MONACO_VS_PATH}/loader.js`

describe('the vendored Monaco is reachable (AGL-3208)', () => {
  it('is served from our own origin at an absolute path', () => {
    expect(MONACO_VS_PATH.startsWith('/')).toBe(true)
    expect(MONACO_VS_PATH).not.toMatch(/^https?:|^\/\//)
  })

  it('does NOT run middleware for the loader or its chunks', () => {
    // The refusal is the middleware's, and it runs before the filesystem, so
    // excluding the path is what makes the deployed file reachable at all.
    expect(matches(LOADER_URL)).toBe(false)
    expect(matches(`${MONACO_VS_PATH}/editor/editor.main.js`)).toBe(false)
    expect(matches(`${MONACO_VS_PATH}/editor/editor.main.css`)).toBe(false)
  })

  it('CONTROL — the matcher still gates ordinary pages', () => {
    // An exclusion that widened to everything would pass the test above while
    // turning the workspace gate off for the whole console.
    expect(matches('/test-org/hosts')).toBe(true)
    expect(matches('/')).toBe(true)
  })

  it('its first segment is one the apex gate admits', () => {
    // Belt and braces for the hosts that reach the gate anyway: AGL-3017 asks
    // Firestore whether an unadmitted first segment names a workspace, and
    // `monaco` is not one. `_`-prefixed segments are admitted by name.
    const first = MONACO_VS_PATH.split('/').filter(Boolean)[0]
    expect(isConsoleRouteSegment(first)).toBe(true)
  })

  it('CONTROL — the bare `monaco` namespace is still refused', () => {
    // The exact shape of the bug: had the path stayed at the apex, both gates
    // above would have rejected it. This fails if someone moves it back.
    expect(isConsoleRouteSegment('monaco')).toBe(false)
    expect(matches('/monaco/vs/loader.js')).toBe(true)
  })
})
