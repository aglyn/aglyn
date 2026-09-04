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
 * A form can be placed from the besigner on EVERY kind of document.
 *
 * An id-based entity picker resolves its options from `EntityPickerContext`,
 * and the context is mounted per besigner surface — one EntityPickerProvider
 * per page, six pages. That is the shape of the failure worth guarding: a
 * document kind is a whole route of its own, so a new one arrives as a new
 * page, and a page that forgets the provider has a Form element whose Form
 * picker offers nothing on a site full of forms.
 *
 * Source assertions, because the failure mode is an ABSENCE and an absence
 * renders perfectly — the same reason `form-is-a-besigner-document.spec.ts`
 * reads the rules and the route table rather than driving them.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Jest's cwd is the repo root here, not apps/console.
const EDITOR_ROOT = join('apps', 'console', 'app', '(editor)')

/** Every `…/besigner/page.tsx` under the editor route group. */
function besignerPages(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...besignerPages(path))
    } else if (entry === 'page.tsx' && dir.endsWith('besigner')) {
      found.push(path)
    }
  }
  return found.sort()
}

const PAGES = besignerPages(EDITOR_ROOT)
const source = (path: string) => readFileSync(path, 'utf8')
const mountsPicker = (path: string) =>
  source(path).includes('<EntityPickerProvider hostId={hostId}>')

const HOST_ROUTE = join('hosts', '[host]')

/**
 * The document kinds an author designs on a SITE, by the route segment that
 * identifies one. Named rather than derived: the point of the list is that
 * the four the owner asked about are each covered by name, so a rename cannot
 * quietly empty the sweep.
 *
 * Host-scoped by construction — `emails` exists twice, once here and once
 * under `/admin` for Aglyn's own templates, and only the site one has a
 * site's forms to offer.
 */
const DOCUMENT_KINDS: Record<string, string> = {
  screen: join(HOST_ROUTE, 'screens', '[screenId]'),
  layout: join(HOST_ROUTE, 'layouts', '[layoutId]'),
  component: join(HOST_ROUTE, 'components', '[componentId]'),
  template: join(HOST_ROUTE, 'templates', '[templateId]'),
  form: join(HOST_ROUTE, 'forms', '[formId]'),
  email: join(HOST_ROUTE, 'emails', '[templateKey]'),
}

describe('the besigner surfaces this sweep covers', () => {
  it('finds a besigner page at all', () => {
    // The control on the search itself: a walk that found nothing would let
    // every assertion below pass vacuously.
    expect(PAGES.length).toBeGreaterThanOrEqual(
      Object.keys(DOCUMENT_KINDS).length,
    )
  })

  it.each(Object.entries(DOCUMENT_KINDS))(
    'has exactly one besigner page for a %s',
    (_kind, segment) => {
      expect(PAGES.filter((path) => path.includes(segment))).toHaveLength(1)
    },
  )
})

describe('every host document kind supplies the entity picker context', () => {
  it.each(Object.entries(DOCUMENT_KINDS))(
    'mounts EntityPickerProvider on the %s besigner',
    (_kind, segment) => {
      const page = PAGES.find((path) => path.includes(segment)) as string
      expect(mountsPicker(page)).toBe(true)
      // Mounted from the one provider, not a hand-rolled context value: a
      // second implementation is a second place for the forms query to be
      // wrong.
      expect(source(page)).toContain(
        "components/entity-picker-provider.component'",
      )
    },
  )

  it('leaves no host besigner without it', () => {
    // Derived rather than listed, so a document kind added later is covered
    // the day its route lands.
    const hostPages = PAGES.filter((path) => path.includes(HOST_ROUTE))
    expect(hostPages.filter((path) => !mountsPicker(path))).toEqual([])
  })

  it('exempts only the surface that HAS no host to scope to', () => {
    // The platform email besigner edits Aglyn's own templates under
    // `/admin`, where there is no site and so no site's forms. Its pickers
    // say they cannot list entities here rather than reporting a site with
    // none — but the exemption has to be structural, not a page someone
    // forgot.
    const unscoped = PAGES.filter((path) => !mountsPicker(path))
    expect(unscoped).not.toEqual([])
    for (const page of unscoped) {
      expect(page).not.toContain(HOST_ROUTE)
      expect(page).toContain(join('(editor)', 'admin'))
    }
  })
})

describe('the provider reads the host forms collection', () => {
  const PROVIDER = join(
    'apps',
    'console',
    'components',
    'entity-picker-provider.component.tsx',
  )

  it('lists the forms of the host it was mounted for', () => {
    const provider = source(PROVIDER)
    expect(provider).toContain("['hosts', hostId, 'forms']")
  })

  it('orders by document id, so an unnamed form is still in its own picker', () => {
    // `orderBy` on a data field DROPS every document missing it, and a form
    // saved without a name would then be invisible in the picker that is
    // supposed to offer it — indistinguishable from a site with no forms.
    // Every kind's BROWSE read is ordered this way for the same reason. The
    // one data-field ordering in the file is the name search, where it is
    // safe: `array-contains` on `nameTokens` has already excluded every
    // document that could be missing `nameLower`.
    const provider = source(PROVIDER)
    expect(provider).toContain('orderBy(documentId())')
    expect(provider).not.toContain("orderBy('displayName')")
    expect(provider).not.toContain("orderBy('name')")
    expect(provider).not.toContain("orderBy('updatedAt'")
    expect(provider.match(/orderBy\('[a-zA-Z]+'\)/g)).toEqual([
      "orderBy('nameLower')",
    ])
  })

  it('reads a page of forms rather than a thousand of them', () => {
    // The window was `FORMS_MAX_PER_HOST` — 1,000 documents to fill a
    // dropdown — because one bulk read had to contain whatever an author had
    // already picked. It does not any more, and the constant has no business
    // in a picker.
    const provider = source(PROVIDER)
    expect(provider).not.toContain('FORMS_MAX_PER_HOST')
    expect(provider).toContain('ENTITY_PICKER_BROWSE_LIMIT')
  })

  it('leaves no hand-written read window behind in the provider', () => {
    // Derived rather than listed: every kind's window is the one constant,
    // so any bare `limit(<number>)` here is a fifth literal creeping back.
    const provider = source(PROVIDER)
    expect(provider.match(/limit\(\d+\)/g)).toBeNull()
  })
})
