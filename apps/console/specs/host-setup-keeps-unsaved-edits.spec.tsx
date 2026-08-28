/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * Host Setup keeps a half-typed edit when the reader changes section.
 *
 * ## The defect
 *
 * Typing into Display name, switching to SEO, and switching back lost the
 * edit — and the card went back to reading "UP TO DATE", so nothing on screen
 * said anything had been discarded. Reproduced by hand on the running console
 * before it was fixed.
 *
 * The cause is one missing prop, two libraries down. MUI's `TabPanel` renders
 * `(keepMounted || value === context.value) && children`, and this page passes
 * no `keepMounted` — so the inactive panel is UNMOUNTED, taking the form state
 * with it.
 *
 * ## Why the fix is not `keepMounted`
 *
 * That is the one-line answer and it is the wrong one: it would mount every
 * tab's cards at once — the logo card, the contact cards, the theme cards —
 * and every read behind them, on a page where four of the five tabs are not
 * being looked at. Trading silent data loss for silently mounting five tabs is
 * not an improvement.
 *
 * So the DRAFT is hoisted above the panel instead, into a ref on the page, and
 * the panel goes on unmounting. The read cost of that is nil: a ref holds
 * values that were already in memory, mounts nothing, and subscribes nothing.
 *
 * ## What this file drives
 *
 * The tab chrome is faithful where it matters — `TabPanel` here unmounts
 * exactly as MUI's does, because that unmount IS the defect. A pass-through
 * panel would keep the form mounted and the spec would pass against the broken
 * page. The form renderer is a stub that holds a value and reports changes the
 * way `react-final-form` does, so what is under test is the PAGE's plumbing:
 * that it stores what it is told, and seeds from the store on the way back.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
/** The `initialValues` each form was seeded with, by schema id. */
const mockSeeds: Record<string, Record<string, unknown>> = {}
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
  // The setup page mounts `ApprovedImageHostsCard` (AGL-1152), which reads
  // Firestore directly. An inert handle is enough: these specs are about the
  // theme-save guard, and the card's own reads resolve to nothing.
  useFirestore: () => ({}),
  // The REAL guard (AGL-1358). A stub would let all three writes through
  // whatever the page passed it, which is what these specs disprove.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance')
    .writeGuardedBySeed,
}))

// Same reason as `useFirestore` above: the approved-image-hosts card reads the
// host doc through this hook. `undefined` data is the card's empty state, which
// renders and does nothing — exactly what these specs want it to do.
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: () => ({ data: undefined, ready: true }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

jest.mock('@aglyn/aglyn', () => ({
  HostEntityType: { ORGANIZATION: 'Organization', PERSON: 'Person' },
  /*
    The REAL patterns, not stand-ins (AGL-2486). The Tracking tab's schema
    reads `.source` off both at module scope, so a mock missing them throws
    before a single case runs — which is this mock earning its keep rather
    than a nuisance. Copying the expressions instead of importing them would
    put a second spelling of "what a GA id looks like" in the repo, and the
    whole point of the shared constant is that there is one.
  */
  GA_MEASUREMENT_ID_PATTERN:
    jest.requireActual('@aglyn/aglyn').GA_MEASUREMENT_ID_PATTERN,
  META_PIXEL_ID_PATTERN:
    jest.requireActual('@aglyn/aglyn').META_PIXEL_ID_PATTERN,
  GOOGLE_ADS_ID_PATTERN:
    jest.requireActual('@aglyn/aglyn').GOOGLE_ADS_ID_PATTERN,
  LINKEDIN_PARTNER_ID_PATTERN:
    jest.requireActual('@aglyn/aglyn').LINKEDIN_PARTNER_ID_PATTERN,
  GTM_CONTAINER_ID_PATTERN:
    jest.requireActual('@aglyn/aglyn').GTM_CONTAINER_ID_PATTERN,
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
jest.mock('@aglyn/shared-ui-jsx-forms', () => {
  const react = jest.requireActual('react')
  return {
    FieldComponentType: new Proxy({}, { get: (_t, k) => String(k) }) as Record<
      string,
      string
    >,
    FieldValidatorType: new Proxy({}, { get: (_t, k) => String(k) }) as Record<
      string,
      string
    >,
    simpleComponentMapper: {},
    /*
     * One text input standing in for the whole form, holding `initialValues`
     * and reporting every change through `debug` — the contract
     * `react-final-form` offers for observing state without subscribing to it.
     *
     * `decorators` is honoured, and that is the half this file exists for: a
     * restored draft arrives through a decorator's `form.change`, which is the
     * same call typing makes. Seeding the form from the draft instead would
     * restore the text and lose the fact that it is unsaved, so a stub that
     * ignored decorators would pass while the page told the reader their edit
     * was already saved.
     */
    FormRenderer: ({
      schema,
      initialValues,
      onSubmit,
      debug,
      decorators,
    }: {
      schema: { id: string }
      initialValues: Record<string, unknown>
      onSubmit: (values: unknown) => void
      debug?: (state: { values: Record<string, unknown>; dirty: boolean }) => void
      decorators?: Array<(form: unknown) => unknown>
    }) => {
      const [values, setValues] = react.useState(() => ({ ...initialValues }))
      // What the form was SEEDED with, exposed so a spec can tell a restored
      // draft (an edit on top of the stored values) from a form seeded with
      // the draft itself (which reports as already saved).
      mockSeeds[schema.id] = initialValues
      react.useEffect(() => {
        for (const decorate of decorators ?? []) {
          decorate({
            batch: (fn: () => void) => fn(),
            change: (key: string, value: unknown) =>
              setValues((prev: Record<string, unknown>) => ({
                ...prev,
                [key]: value,
              })),
          })
        }
        // Once per mount, like the real decorator contract.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return (
        <div>
          <input
            aria-label={`${schema.id}-displayName`}
            value={String(values.displayName ?? '')}
            onChange={(event: { target: { value: string } }) => {
              const next = { ...values, displayName: event.target.value }
              setValues(next)
              debug?.({ values: next, dirty: true })
            }}
          />
          <button onClick={() => onSubmit({ ...values, displayName: 'Renamed' })}>
            {`Submit ${schema.id}`}
          </button>
        </div>
      )
    },
  }
})

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
/*
 * A FAITHFUL tab panel: it unmounts its children when it is not the selected
 * one, exactly as `@mui/lab`'s does without `keepMounted`. That unmount is the
 * defect under test — a pass-through panel keeps the form mounted and the spec
 * passes against the broken page.
 */
jest.mock('@mui/lab', () => {
  // Built INSIDE the factory: jest's out-of-scope guard admits only
  // `mock`-prefixed bindings, and a context object is neither.
  const react = jest.requireActual('react')
  const TabValue = react.createContext('')
  return {
    TabContext: ({ value, children }: { value: string; children: ReactNode }) =>
      react.createElement(TabValue.Provider, { value }, children),
    TabList: () => null,
    TabPanel: ({ value, children }: { value: string; children: ReactNode }) => {
      const active = react.useContext(TabValue)
      return react.createElement('div', null, value === active ? children : null)
    },
  }
})
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
jest.mock('../components/consent-banner-card.component', () => nullCard)
jest.mock('../components/social-image-card.component', () => nullCard)
// The SEO tab's entity-logo picker (AGL-2486) — a media pick beside the
// favicon and social-image cards, stubbed for the same reason they are: this
// suite is about the theme form's write correctness, and an unstubbed card
// only contributes its own Firestore and media-resolver surface to the mock
// budget.
jest.mock('../components/entity-logo-card.component', () => nullCard)
jest.mock('../components/business-details-card.component', () => nullCard)
jest.mock('../components/logo-card.component', () => nullCard)
jest.mock('../components/error-screens-card.component', () => nullCard)
jest.mock('../components/languages-card.component', () => nullCard)
jest.mock('../components/site-backup-card.component', () => nullCard)
jest.mock('../components/site-template-card.component', () => nullCard)
jest.mock('../components/theme-editor/theme-source-card.component', () => nullCard)
jest.mock('../components/host-display-name.component', () => nullCard)
// New since this file was written (AGL-2099). It is an unrelated sibling card
// — it reads the org's `removeBranding` entitlement and renders a sentence —
// so it is stubbed like every other card here rather than given a fake
// entitlement surface. Its absence is what took the suite from asserting nine
// write-correctness properties to asserting none.
jest.mock('../components/site-branding-badge-card.component', () => nullCard)
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

/**
 * The tab the page is showing, driven directly rather than through the URL.
 *
 * `mock`-prefixed because the factory below closes over it, which is the one
 * prefix jest's out-of-scope guard admits.
 */
let mockCurrentTab = 'hostDetails'
jest.mock('@aglyn/shared-ui-next/hooks/use-tab-param', () => ({
  __esModule: true,
  default: ({ onChange }: { onChange?: (value: string) => void }) => ({
    tab: mockCurrentTab,
    onTabChange: (_event: unknown, value: string) => {
      mockCurrentTab = value
      onChange?.(value)
    },
  }),
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const SETUP = '../app/(app)/[orgSlug]/hosts/[host]/setup/(sections)'
const SetupLayout = require(`${SETUP}/layout`).default
const SECTION_PAGES: Record<string, () => JSX.Element> = {
  details: require(`${SETUP}/details/page`).default,
  seo: require(`${SETUP}/seo/page`).default,
  tracking: require(`${SETUP}/tracking/page`).default,
  theme: require(`${SETUP}/theme/page`).default,
  emails: require(`${SETUP}/emails/page`).default,
}

/**
 * The layout with ONE section inside it, which is how Next mounts them
 * (AGL-693). Setup's sections are routes, so the page under test is the
 * section — the layout is the shared scope around it.
 */
const HostSetup = ({ section = 'details' }: { section?: string } = {}) => {
  const SectionPage = SECTION_PAGES[section]
  return (
    <SetupLayout>
      <SectionPage />
    </SetupLayout>
  )
}
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



const setTab = (value: string) => {
  mockCurrentTab = value
}

const field = (id: string) =>
  screen.getByLabelText(`${id}-displayName`) as HTMLInputElement

describe('host Setup keeps an unsaved edit across a section change', () => {
  beforeEach(() => {
    mockCurrentTab = 'hostDetails'
    hostDoc.status = 'success'
    mockSetDoc.mockClear()
  })

  /**
   * The CONTROL, and it is not decoration.
   *
   * The assertion below is "the typed value came back", and a page that never
   * unmounted the form would satisfy it while proving nothing — the edit would
   * have survived because it was never discarded. Sections are ROUTES, so Next
   * mounts one page: this proves the harness really does destroy the section
   * being left, which is both how the read cost stays flat and why a draft has
   * to be held above it.
   */
  it('CONTROL: leaving a section really does unmount its form', () => {
    const { rerender } = render(<HostSetup section="details" />)
    expect(screen.queryByLabelText('hostDetails-displayName')).not.toBeNull()
    expect(screen.queryByLabelText('hostSeo-displayName')).toBeNull()

    rerender(<HostSetup section="seo" />)
    expect(screen.queryByLabelText('hostDetails-displayName')).toBeNull()
    expect(screen.queryByLabelText('hostSeo-displayName')).not.toBeNull()
  })

  it('brings a half-typed edit back when the reader returns to the section', () => {
    const { rerender } = render(<HostSetup section="details" />)

    fireEvent.change(field('hostDetails'), {
      target: { value: 'Shop — half typed' },
    })

    rerender(<HostSetup section="seo" />)
    rerender(<HostSetup section="details" />)

    // The section page was destroyed and rebuilt in between; the draft, held
    // in the LAYOUT that survives the navigation, is what it was rebuilt from.
    expect(field('hostDetails').value).toBe('Shop — half typed')
  })

  /**
   * A restored draft is still UNSAVED, and the form has to say so.
   *
   * Seeding the form FROM the draft would restore the text and lose that: the
   * seed is what a form compares against to decide it is pristine, so the card
   * would read "Up to date" over an edit nobody has written — the same
   * misleading signal as the defect this fix is about — and Save would be
   * disabled, so the reader could not even act on it. Caught on the running
   * console, not in review.
   *
   * So the assertion is on the SEED, not on the value: the form is seeded from
   * the stored host document, and the draft arrives on top as an edit.
   */
  it('restores the draft as an edit, not as the saved state', () => {
    const { rerender } = render(<HostSetup section="details" />)
    fireEvent.change(field('hostDetails'), { target: { value: 'Half typed' } })

    rerender(<HostSetup section="seo" />)
    rerender(<HostSetup section="details" />)

    expect(field('hostDetails').value).toBe('Half typed')
    // Seeded from the host document — 'Shop' — so the restored text reads as a
    // change against it rather than as the stored value.
    expect(mockSeeds['hostDetails'].displayName).toBe('Shop')
  })

  /*
   * A draft belongs to the section that owns it. Leaking one across would show
   * a reader their Details edit inside the SEO form, which is a different and
   * worse bug than the one being fixed.
   */
  it('keeps each section draft to itself', () => {
    const { rerender } = render(<HostSetup section="details" />)
    fireEvent.change(field('hostDetails'), { target: { value: 'Details edit' } })

    rerender(<HostSetup section="seo" />)

    // Seeded from the host doc, not from the Details draft.
    expect(field('hostSeo').value).toBe('Shop')
  })

  /*
   * Once the edit is SAVED the draft has no further claim: the next mount must
   * read the host doc, or a reader who saved and came back would go on being
   * shown a stale copy of what they already committed.
   */
  it('drops the draft after a successful save', async () => {
    const { rerender } = render(<HostSetup section="details" />)
    fireEvent.change(field('hostDetails'), { target: { value: 'Before save' } })

    fireEvent.click(screen.getByText('Submit hostDetails'))
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalled())

    rerender(<HostSetup section="seo" />)
    rerender(<HostSetup section="details" />)

    expect(field('hostDetails').value).toBe('Shop')
  })
})
