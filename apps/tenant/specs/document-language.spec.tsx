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
 * What language a tenant document declares (AGL-3153).
 *
 * `<html lang>` was the literal `"en"` in the host-agnostic root layout, so
 * every published site told every browser, screen reader and search engine it
 * was English — and because nothing on the platform had configured a locale,
 * nothing distinguished "correct" from "hardcoded". The load-bearing
 * assertion is therefore the one the old literal could never fail: two sites
 * that say different things about their language produce two different
 * documents.
 *
 * The second half is the boundary the fix draws. The shell moved DOWN to
 * `[host]/layout.tsx` — a path parameter rather than a `headers()` read —
 * because a dynamic API in the root layout de-opts static generation for
 * every route beneath it. That is what keeps the catch-all's ISR window, and
 * it is also why `<html lang>` is the SITE's language: no layout has the slug
 * a screen is resolved from. These pin both halves, including the gap, so
 * neither can be closed by accident.
 */

const mockGetHostCached = jest.fn()
jest.mock('../app/[host]/host-data', () => ({
  __esModule: true,
  getHostCached: (...args: unknown[]) => mockGetHostCached(...args),
}))

/**
 * The shell pulls the MUI/emotion client graph and the error beacon, neither
 * of which this suite asserts anything about — the same reason
 * `host-favicon-link.spec.tsx` mocks the theme providers. What IS asserted
 * about the shell is that it turns the `lang` it is handed into the document
 * element, and that case imports the real module below.
 */
jest.mock('../components/document-shell.component', () => ({
  __esModule: true,
  // `createElement` rather than JSX: a `jest.mock` factory is hoisted above
  // the file's own imports, so it may not close over the JSX runtime babel
  // inserts there.
  default: ({ lang, children }: { lang: string; children?: unknown }) =>
    require('react').createElement(
      'div',
      { 'data-document-lang': lang },
      children,
    ),
}))

jest.mock('@aglyn/shared-ui-jsx/components/status-screen-plain.component', () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock('@aglyn/aglyn/app-utils/redispatch-caught-error', () => ({
  __esModule: true,
  redispatchCaughtError: () => undefined,
}))

import {
  PLATFORM_DEFAULT_LOCALE,
  resolvePageLocale,
} from '@aglyn/aglyn/app-utils/seo-locale'
import { renderToStaticMarkup } from 'react-dom/server'
import RootError from '../app/error'
import RootLayout from '../app/layout'
import TenantDocumentLayout from '../app/[host]/layout'
import RootNotFound from '../app/not-found'

const HOST_ID = 'DXnRbPH4CQ'

/**
 * The `lang` the tenant shell is asked for, for a given host document.
 *
 * The layout is an async Server Component, so it is awaited to an element
 * tree rather than mounted; the mocked shell above records the attribute it
 * was handed.
 */
const siteLang = async (host: unknown) => {
  mockGetHostCached.mockResolvedValue({ host })
  const tree = (await TenantDocumentLayout({
    children: null,
    params: Promise.resolve({ host: HOST_ID }),
  } as never)) as unknown as { props: { lang: string } }
  return tree.props.lang
}

describe('a tenant document declares its own language (AGL-3153)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('takes the site’s `defaultLocale`', async () => {
    expect(
      await siteLang({ $id: HOST_ID, defaultLocale: 'es', locales: ['en', 'es'] }),
    ).toBe('es')
  })

  it('falls to the first of `locales` when no default is set', async () => {
    expect(await siteLang({ $id: HOST_ID, locales: ['ja', 'en'] })).toBe('ja')
  })

  it('declares the platform default when the site configured neither', async () => {
    expect(await siteLang({ $id: HOST_ID, displayName: 'Northwind Coffee' })).toBe(
      PLATFORM_DEFAULT_LOCALE,
    )
  })

  /**
   * The failure the old literal could not produce. Every site shipped `en`,
   * so a Spanish site and an English one were byte-identical on the one
   * attribute that told them apart.
   */
  it('gives two differently-written sites two different documents', async () => {
    const spanish = await siteLang({ $id: 'a', defaultLocale: 'es' })
    const japanese = await siteLang({ $id: 'b', defaultLocale: 'ja' })
    expect(spanish).toBe('es')
    expect(japanese).toBe('ja')
    expect(spanish).not.toBe(japanese)
  })

  /**
   * A corrupt stored value is DROPPED rather than emitted — `locale` is free
   * text in Firestore and this attribute reaches every reader of the page.
   */
  it('ignores an unparseable stored locale rather than publishing it', async () => {
    expect(
      await siteLang({ $id: HOST_ID, defaultLocale: 'not a language tag' }),
    ).toBe(PLATFORM_DEFAULT_LOCALE)
  })

  /**
   * A host whose lookup failed resolves to a null host, and the layout must
   * still produce a document: one that threw over a language attribute would
   * take the whole site down with it.
   */
  it('still declares a language when the host did not resolve', async () => {
    expect(await siteLang(null)).toBe(PLATFORM_DEFAULT_LOCALE)
  })
})

describe('the screen’s own language, and where it does and does not reach', () => {
  beforeEach(() => jest.clearAllMocks())

  /**
   * THE DELIBERATE GAP (AGL-3153). `resolvePageLocale` puts the screen first,
   * and no segment that can render `<html>` has one — a layout is the deepest
   * thing that can, and the screen is resolved from the slug below it. So a
   * locale variant's own language reaches the metadata surfaces, which call
   * the same resolver WITH the screen, while the document element names the
   * site the variant belongs to.
   *
   * Pinned rather than left implicit: closing it means resolving the screen
   * in a dynamic root layout, which costs the catch-all its ISR window.
   */
  it('a French screen on a Spanish site: the page says French, the document says Spanish', async () => {
    const host = { $id: HOST_ID, defaultLocale: 'es' }
    const screen = { locale: 'fr' }
    expect(resolvePageLocale({ screen, host })).toBe('fr')
    expect(await siteLang(host)).toBe('es')
  })
})

describe('a route with no tenant keeps the platform default', () => {
  beforeEach(() => jest.clearAllMocks())

  /**
   * The structural invariant the whole fix rests on: the root layout is
   * host-agnostic, so it renders no document element at all. Were it to
   * render one again, its only possible answer would be a literal, and the
   * per-site attribute below it would be an unreachable second `<html>`.
   */
  it('the root layout renders no document element of its own', () => {
    const tree = RootLayout({ children: 'CHILD' }) as unknown
    expect(tree).toBe('CHILD')
  })

  it('the root not-found boundary asks for the platform default', () => {
    const tree = RootNotFound() as unknown as { props: { lang: string } }
    expect(tree.props.lang).toBe(PLATFORM_DEFAULT_LOCALE)
  })

  it('the root error boundary asks for the platform default', () => {
    // Rendered rather than called: the boundary runs an effect, which a bare
    // call outside a renderer refuses and a server render skips.
    const markup = renderToStaticMarkup(
      <RootError
        error={Object.assign(new Error('boom'), { digest: 'd' })}
        reset={() => undefined}
      />,
    )
    expect(markup).toContain(`data-document-lang="${PLATFORM_DEFAULT_LOCALE}"`)
  })
})

describe('the shell turns the resolved language into the document element', () => {
  it('renders `<html lang>` from the value it is handed', async () => {
    const actual = jest.requireActual<{
      default: (props: { lang: string; children?: unknown }) => {
        type: string
        props: { lang: string }
      }
    }>('../components/document-shell.component')
    const tree = actual.default({ lang: 'zh-Hant', children: null })
    expect(tree.type).toBe('html')
    expect(tree.props.lang).toBe('zh-Hant')
  })
})
