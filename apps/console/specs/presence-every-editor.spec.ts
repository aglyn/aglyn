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

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * EVERY editable document kind gets presence, in its own room (AGL-2486).
 *
 *
 * It already is. All five org-scoped besigner editors mount `usePresence` and
 * pass their own `docType`/`docId`, and the RTDB rules key on `$docType` and
 * `$docId` as WILDCARDS, so no document kind needs a rules change to get a
 * room. Confirmed live on 2026-08-23: two tabs on one component editor
 * produced two rows under `presence/hz_KgetqSq/component/LDfDBjRVOx`, with the
 * avatar stack rendering and no fault. What was broken for those editors was
 * never their wiring — it was the shared hook and the broker, so every fix in
 * this issue reached all five at once.
 *
 * The gap this closes is the NEXT one. A new editable kind is a new page, and
 * a page that simply forgets to call `usePresence` is invisible: it renders,
 * it saves, and it silently has no co-editing. The `docType` union in
 * `use-presence.ts` cannot catch that, because a page that never calls the
 * hook never names a type at all.
 *
 * Distinctness is asserted for the other half: two kinds sharing a `docType`
 * would put unrelated documents in one room and show strangers as co-editors,
 * which is the same class of lie as a phantom cursor.
 */

const ROOT = resolve(__dirname, '..')
const EDITOR_ROOT = join(ROOT, 'app', '(editor)')

/**
 * The staff email editor, `/admin/emails/[templateKey]/…`, is deliberately
 * OUT of scope and its own source says so: the room path is
 * `presence/{orgId}/…` and a platform document has no honest orgId to scope
 * it with. The AGL-674 conflict guard still protects its saves, which is the
 * part that protects work. Listed by path so that adding a second exemption
 * has to be a decision someone writes down.
 */
const NO_ORG_TO_SCOPE_WITH = /app\/\(editor\)\/admin\//

function* pages(dir: string): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* pages(path)
    else if (entry === 'page.tsx') yield path
  }
}

/** Every besigner editor page, which is what "an editable document" means. */
function besignerPages(): string[] {
  return [...pages(EDITOR_ROOT)].filter((path) =>
    /[\\/]besigner[\\/]page\.tsx$/.test(path),
  )
}

describe('presence in every editable document (AGL-2486)', () => {
  it('finds the editor pages at all, so an empty sweep cannot pass', () => {
    // Without this the whole file is green when the route folder moves.
    expect(besignerPages().length).toBeGreaterThanOrEqual(5)
  })

  it('mounts usePresence on every org-scoped besigner', () => {
    const missing: string[] = []
    for (const path of besignerPages()) {
      if (NO_ORG_TO_SCOPE_WITH.test(path)) continue
      const source = readFileSync(path, 'utf8')
      if (!/usePresence\(\{/.test(source)) missing.push(relative(ROOT, path))
    }
    expect(missing).toEqual([])
  })

  it('renders the avatar stack on every org-scoped besigner', () => {
    // Mounting the hook without rendering the stack is presence nobody can
    // see — the failure this whole issue started from.
    const missing: string[] = []
    for (const path of besignerPages()) {
      if (NO_ORG_TO_SCOPE_WITH.test(path)) continue
      const source = readFileSync(path, 'utf8')
      if (!/PresenceAvatars/.test(source)) missing.push(relative(ROOT, path))
    }
    expect(missing).toEqual([])
  })

  it('gives each kind its OWN docType, so rooms cannot collide', () => {
    const byType = new Map<string, string[]>()
    for (const path of besignerPages()) {
      if (NO_ORG_TO_SCOPE_WITH.test(path)) continue
      const source = readFileSync(path, 'utf8')
      const call = /usePresence\(\{[\s\S]{0,400}?\}\)/.exec(source)?.[0] ?? ''
      const docType = /docType:\s*'([^']+)'/.exec(call)?.[1] ?? '(none)'
      byType.set(docType, [...(byType.get(docType) ?? []), relative(ROOT, path)])
    }
    expect(byType.get('(none)')).toBeUndefined()
    const shared = [...byType.entries()].filter(([, files]) => files.length > 1)
    expect(shared).toEqual([])
  })

  it('covers every editable document kind', () => {
    const types = new Set<string>()
    for (const path of besignerPages()) {
      if (NO_ORG_TO_SCOPE_WITH.test(path)) continue
      const source = readFileSync(path, 'utf8')
      const call = /usePresence\(\{[\s\S]{0,400}?\}\)/.exec(source)?.[0] ?? ''
      const docType = /docType:\s*'([^']+)'/.exec(call)?.[1]
      if (docType) types.add(docType)
    }
    for (const kind of ['screen', 'component', 'layout', 'template', 'email']) {
      expect([...types]).toContain(kind)
    }
  })
})
