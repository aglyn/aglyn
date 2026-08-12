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
 *
 * @jest-environment jsdom
 */

/**
 * Site Setup must not rewrite a host document from a seed the server never
 * confirmed (AGL-1358).
 *
 * Three writers on this page, all seeded from the same host LISTENER and all
 * replacing whole maps rather than patching fields:
 *
 * - the THEME. `mergeFields` replaces `theme` atomically — deliberately, so a
 *   cleared colour does not linger from a deep merge — and the editor is
 *   seeded from `resolveSiteTheme(data)`, so the payload carries EVERY token.
 *   Save one colour against a cached seed and every other token on a live
 *   site reverts to whatever the cache last held. This is the nastiest of the
 *   three: nothing about it looks like a destructive write.
 * - the OVERRIDE patch, same shape, plus the patch itself is diffed against
 *   the same stale `data`.
 * - the DETAILS/SEO form. `FormRenderer` gets `initialValues: data` and
 *   submits every field it holds, so `merge: true` protects nothing.
 *
 * Both directions are asserted for each. The positive controls matter most —
 * these guards stand in front of the ordinary save on the page every site
 * owner uses.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()

/** Mutable so each spec picks the host listener's verdict before rendering. */
const hostDoc = {
  data: {
    $id: 'host-1',
    subdomain: 'shop',
    displayName: 'Shop',
    theme: { palette: { primary: '#111111' } },
  } as Record<string, unknown>,
  status: 'success' as 'success' | 'error',
  fromCache: false,
  /**
   * A snapshot has arrived at least once, from cache or from the server
   * (AGL-1066). What the Theme tab renders on, so that a refused listen the
   * persistent cache is still answering keeps its editor instead of
   * collapsing the tab to nothing.
   */
  hasEmitted: true,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useHost: () => ({ doc: hostDoc, setDoc: mockSetDoc }),
  useAnalytics: () => ({}),
  useUser: () => ({ data: { getIdToken: async () => 'token' } }),
  // The REAL guard (AGL-1358). A stub would let all three writes through
  // whatever the page passed it, which is what these specs disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/aglyn', () => ({
  HostEntityType: { ORGANIZATION: 'Organization', PERSON: 'Person' },
}))
jest.mock('@aglyn/aglyn/app-utils/marketplace-theme', () => ({
  resolveSiteTheme: (host: { theme?: unknown }) => host?.theme ?? {},
  themeOverridePatch: () => ({ palette: { primary: '#222222' } }),
}))
jest.mock('@aglyn/aglyn/app-utils/marketplace-overrides', () => ({
  overrideWriteValue: (patch: unknown) => ({ patch }),
}))

/**
 * The three editors are replaced by the one control each needs to fire its
 * handler. What is under test is what the page's save does with the verdict,
 * not how a colour picker collects a hex value.
 */
jest.mock('../components/theme-editor/theme-editor.component', () => ({
  __esModule: true,
  default: ({ onSave }: { onSave: (theme: unknown) => void }) => (
    <button onClick={() => onSave({ palette: { primary: '#ff0000' } })}>
      {'Save theme'}
    </button>
  ),
}))
/**
 * The overrides card reports the refusal itself, so what the PAGE owes it is
 * an honest verdict rather than a silent no-op. Capture what it hands back.
 */
const overrideVerdicts: Array<{ ok: boolean; message?: string }> = []
jest.mock('../components/theme-editor/theme-overrides-card.component', () => ({
  __esModule: true,
  default: ({
    onWriteOverride,
  }: {
    onWriteOverride: (value: unknown) => Promise<{ ok: boolean }>
  }) => (
    <button
      onClick={() =>
        void onWriteOverride({ patch: {} }).then((verdict) =>
          overrideVerdicts.push(verdict),
        )
      }
    >
      {'Reset one override'}
    </button>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  FieldComponentType: new Proxy(
    {},
    { get: (_target, key) => String(key) },
  ) as Record<string, string>,
  FieldValidatorType: new Proxy(
    {},
    { get: (_target, key) => String(key) },
  ) as Record<string, string>,
  simpleComponentMapper: {},
  FormRenderer: ({
    onSubmit,
    initialValues,
  }: {
    onSubmit: (values: unknown) => void
    initialValues: unknown
  }) => (
    // Submits the SEEDED values, which is what the real form does: every
    // field it holds, not the one that changed.
    <button
      onClick={() =>
        onSubmit({ ...(initialValues as object), displayName: 'Renamed' })
      }
    >
      {'Submit details'}
    </button>
  ),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  GridItems: ({ items }: { items: Array<{ children: ReactNode }> }) => (
    <div>{items.map((item, index) => <div key={index}>{item.children}</div>)}</div>
  ),
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))

// Every other card on the page reads its own data and is not part of this
// shape; the tab chrome is replaced by a plain pass-through so all three
// panels render at once.
const passthrough = {
  __esModule: true,
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}
const nullCard = { __esModule: true, default: () => null }
jest.mock('@mui/lab', () => ({
  TabContext: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabList: () => null,
  TabPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
jest.mock('../components/layouts/dashboard.layout', () => passthrough)
jest.mock('../components/layouts/authenticated.layout', () => passthrough)
jest.mock('../components/layouts/main.layout', () => passthrough)
jest.mock('../components/host-activity-table.component', () => nullCard)
jest.mock('../components/card-display-form-template', () => nullCard)
jest.mock('../components/plugin-widget-slot.component', () => nullCard)
jest.mock('../components/auth-screens-card.component', () => nullCard)
jest.mock('../components/custom-domain-card.component', () => nullCard)
jest.mock('../components/site-emails-card.component', () => nullCard)
jest.mock('../components/favicon-card.component', () => nullCard)
jest.mock('../components/search-indexing-card.component', () => nullCard)
jest.mock('../components/social-image-card.component', () => nullCard)
jest.mock('../components/business-details-card.component', () => nullCard)
jest.mock('../components/logo-card.component', () => nullCard)
jest.mock('../components/error-screens-card.component', () => nullCard)
jest.mock('../components/languages-card.component', () => nullCard)
jest.mock('../components/site-backup-card.component', () => nullCard)
jest.mock('../components/site-template-card.component', () => nullCard)
jest.mock('../components/theme-editor/theme-source-card.component', () => nullCard)
jest.mock('../components/host-display-name.component', () => nullCard)
jest.mock('../components/host-id-provider', () => ({
  useHostId: () => 'host-1',
  useHostSubdomain: () => 'shop',
}))
jest.mock('../hooks/use-org-scope', () => ({ useOrgSlug: () => 'acme' }))
jest.mock('../hooks/use-host-activity-logger', () => ({
  __esModule: true,
  default: () => () => undefined,
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => ({}) }))
jest.mock('../constants/route-links', () => ({
  buildRoute: () => '/x',
  Route: { HOST_SETUP: 'host-setup', HOST_DASHBOARD: 'host-dashboard' },
}))
jest.mock('firebase/analytics', () => ({ logEvent: () => undefined }))
jest.mock('next/navigation', () => ({
  usePathname: () => '/acme/hosts/shop/setup',
  useRouter: () => ({ replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const HostSetup =
  require('../app/(app)/[orgSlug]/hosts/[host]/setup/page').default
/* eslint-enable @typescript-eslint/no-var-requires */

/** No network: a refused save must never have reached the rename API. */
const fetchMock = jest.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ subdomain: 'shop' }),
})

beforeEach(() => {
  overrideVerdicts.length = 0
  jest.clearAllMocks()
  hostDoc.fromCache = false
  hostDoc.status = 'success'
  hostDoc.hasEmitted = true
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
})

// The details and SEO tabs are two FormRenderers sharing one submit handler,
// so the first match is the one to drive.
const click = (name: string) =>
  fireEvent.click(screen.getAllByRole('button', { name })[0])

describe('Host Setup theme save (AGL-1358)', () => {
  it('REFUSES to replace the theme from an unconfirmed seed', async () => {
    hostDoc.fromCache = true
    render(<HostSetup />)

    click('Save theme')

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    const [message] = mockEnqueueSnackbar.mock.calls[0]
    expect(message).toEqual(expect.stringContaining('theme'))
    expect(message).toEqual(expect.stringMatching(/reload/i))
  })

  it('SAVES the theme once the server has confirmed the seed', async () => {
    render(<HostSetup />)

    click('Save theme')

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload, options] = mockSetDoc.mock.calls[0]
    // The WHOLE theme map, replaced atomically — which is exactly why the
    // guard has to stand in front of it.
    expect(payload.theme).toEqual({ palette: { primary: '#ff0000' } })
    expect(options).toEqual({ mergeFields: ['theme'] })
  })

  /**
   * The tab is gated on a snapshot having ARRIVED, not on the read being
   * healthy (AGL-1066). With nothing ever emitted there is no theme to edit,
   * so the tab stays empty — the case the `null` was written for.
   *
   * The guard is still given `unreadable` regardless: it costs nothing, and a
   * rendering condition three hundred lines away is not something a write
   * should depend on for its safety.
   */
  it('does not render the theme editor when nothing ever arrived', () => {
    hostDoc.status = 'error'
    hostDoc.hasEmitted = false
    render(<HostSetup />)

    expect(screen.queryByRole('button', { name: 'Save theme' })).toBeNull()
  })

  /**
   * The AGL-1066 decision, at the surface it was argued over. A refused
   * listen reaches `status: 'error'` now, and `persistentLocalCache` is still
   * serving the host doc — so the editor stays on screen with the theme in
   * it. Collapsing the whole tab to `null` around a working editor was the
   * "stop serving" outcome, and it is not what shipped.
   */
  it('KEEPS the theme editor when the read failed but the cache is serving it', async () => {
    hostDoc.status = 'error'
    hostDoc.fromCache = true
    render(<HostSetup />)

    expect(screen.getAllByRole('button', { name: 'Save theme' }).length)
      .toBeGreaterThan(0)

    // Visible, and still refused — the two halves of "keep serving, stop
    // presenting it as live".
    click('Save theme')
    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
  })
})

describe('Host Setup override reset (AGL-1358)', () => {
  it('REFUSES to replace the override patch from an unconfirmed seed', async () => {
    hostDoc.fromCache = true
    render(<HostSetup />)

    click('Reset one override')

    await waitFor(() => expect(overrideVerdicts).toHaveLength(1))
    expect(mockSetDoc).not.toHaveBeenCalled()
    // The refusal is REPORTED to the caller rather than swallowed — a card
    // that could not see it would announce a reset that never happened.
    expect(overrideVerdicts[0].ok).toBe(false)
    expect(overrideVerdicts[0].message).toEqual(
      expect.stringContaining('theme overrides'),
    )
  })

  it('WRITES the override once the server has confirmed the seed', async () => {
    render(<HostSetup />)

    click('Reset one override')

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    expect(mockSetDoc.mock.calls[0][1]).toEqual({
      mergeFields: ['themeOverride'],
    })
    expect(overrideVerdicts[0].ok).toBe(true)
  })
})

describe('Host Setup details save (AGL-1358)', () => {
  it('REFUSES the whole save from an unconfirmed seed — including the rename', async () => {
    hostDoc.fromCache = true
    render(<HostSetup />)

    click('Submit details')

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    // The rename endpoint owns the site's public address, and whether it is
    // called at all is decided by comparing the form against the SEED. A
    // guard that only covered the document write would leave a site renamed
    // with none of the settings meant to go with it.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringContaining('site settings'),
    )
  })

  it('REFUSES when the host read failed, and says so differently', async () => {
    hostDoc.status = 'error'
    render(<HostSetup />)

    click('Submit details')

    await waitFor(() => expect(mockEnqueueSnackbar).toHaveBeenCalled())
    expect(mockSetDoc).not.toHaveBeenCalled()
    expect(mockEnqueueSnackbar.mock.calls[0][0]).toEqual(
      expect.stringMatching(/could not be loaded/i),
    )
  })

  it('SAVES the details once the server has confirmed the seed', async () => {
    render(<HostSetup />)

    click('Submit details')

    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [payload, options] = mockSetDoc.mock.calls[0]
    expect(payload.displayName).toEqual('Renamed')
    // Every seeded field rides along, which is why `merge: true` is not
    // protection here.
    expect(payload.theme).toBeTruthy()
    expect(options).toEqual({ merge: true })
  })
})
