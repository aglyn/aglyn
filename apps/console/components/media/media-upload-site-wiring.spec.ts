/**
 * @jest-environment node
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
 * Every request that creates an asset names the site it was made from.
 *
 * Both upload routes have read `forHostId` since the org's Default sharing
 * shipped, and applied it through `defaultScopeForNewResource`. The library
 * never sent it: its upload bodies carried `scopeBody` — the org — and nothing
 * else, so every file uploaded on a site's Media tab or through a site's
 * picker landed on All sites whatever the org had chosen. Folders were right
 * all along, because their scope is computed here from the same prop.
 *
 * `media-upload-default-sharing.spec.ts` proves what the routes do with the
 * site. This proves the component sends it, over source text rather than a
 * render, for the reason `media-folder-scope-wiring.spec.ts` gives: the
 * library mounts four listener stacks, the DAM counters and a dnd-kit
 * surface, and rendering it would be a test of the mocks.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from '../../specs/source-text'

const CODE = code(
  readFileSync(join(__dirname, 'media-library.component.tsx'), 'utf8'),
  'media-library.component.tsx',
)

/** Index of the bracket closing the one at `open`, or -1. */
function closing(source: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' }
  const stack: string[] = []
  for (let at = open; at < source.length; at += 1) {
    const char = source[at]
    if (pairs[char]) stack.push(pairs[char])
    else if (char === stack[stack.length - 1]) {
      stack.pop()
      if (!stack.length) return at
    }
  }
  return -1
}

/** Every `authorizedFetch(user, '<route>', { … })` call, with its options. */
function requestsTo(route: string): Array<{ method: string; options: string }> {
  const calls: Array<{ method: string; options: string }> = []
  const opener = new RegExp(
    `authorizedFetch\\(\\s*user,\\s*'${route.replace(/\//g, '\\/')}',\\s*\\{`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = opener.exec(CODE))) {
    const open = match.index + match[0].length - 1
    const options = CODE.slice(open, closing(CODE, open) + 1)
    const method = /method:\s*'([A-Z]+)'/.exec(options)?.[1] ?? 'GET'
    calls.push({ method, options })
  }
  return calls
}

describe('an asset create names the site it was made from', () => {
  it('builds the site body from the org scope and the site prop, and nothing else', () => {
    // An org library with a site on screen sends it; the org Media page (no
    // `forHostId`) and a site's own library (no `orgId`) send nothing.
    expect(CODE).toMatch(
      /const uploadSiteBody = useMemo\(\s*\(\) => \(orgId && forHostId \? \{ forHostId \} : \{\}\),\s*\[orgId, forHostId\],\s*\)/,
    )
  })

  it('sends it on the direct upload, and on the edited copy', () => {
    const creates = requestsTo('/api/media/upload').filter(
      (call) => call.method === 'POST',
    )
    // The drop/file-input upload and the image editor's "save as copy".
    expect(creates).toHaveLength(2)
    for (const create of creates) {
      expect(create.options).toContain('...uploadSiteBody')
    }
  })

  it('sends it on both halves of the signed upload', () => {
    const signed = requestsTo('/api/media/upload-url')
    expect(signed.map((call) => call.method).sort()).toEqual(['PATCH', 'POST'])
    for (const call of signed) {
      expect(call.options).toContain('...uploadSiteBody')
    }
  })

  it('keeps it off the requests that create nothing', () => {
    // A delete addresses an asset that already has its scope.
    const deletes = requestsTo('/api/media/upload').filter(
      (call) => call.method === 'DELETE',
    )
    expect(deletes.length).toBeGreaterThan(0)
    for (const call of deletes) {
      expect(call.options).not.toContain('uploadSiteBody')
    }
  })
})
