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
 * WHERE EACH KIND OF ARTIFACT GOES (AGL-3080).
 *
 * The console pages that offer a publish used to build the request
 * themselves — the endpoint, the payload key, the noun in the copy — which
 * made a layouts page a file that could not be right without being kept in
 * step with this plugin's routes. They now hand over what they HAVE, in
 * their own vocabulary, and this widget turns it into a request.
 *
 * That translation is the half which can fail quietly: a payload key spelled
 * differently from the route that reads it publishes nothing and says the
 * publish succeeded, because the route defends itself and answers politely.
 * So every kind is driven end to end here, through the real form, and the
 * assertion is the body that reaches the network.
 *
 * ⚠️ The kinds below are the ones the console offers today — the layouts
 * page's menu item and the org publish panel's seven. A kind added to a
 * console page and not here is the drift this exists to catch; a kind here
 * and not on a page is dead code, which the last test makes visible rather
 * than silent.
 */

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import { planSiteStarterTheme } from '@aglyn/aglyn/app-utils/site-starter-theme'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PublishArtifactDialog from './publish-artifact-dialog.component'
import {
  PUBLISHER_AGREEMENT_TITLE,
  PUBLISHER_AGREEMENT_VERSION,
} from '../model/publisher-agreement'

const posted: Array<{ url: string; body: Record<string, unknown> }> = []
let responseStatus = 200
let responseBody: Record<string, unknown> = { listingId: 'listing-1', version: 1 }

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (
    _user: unknown,
    url: string,
    init?: { body: string },
  ) => {
    const reply = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
    })
    posted.push({ url, body: JSON.parse(String(init?.body)) })
    return reply(responseStatus, responseBody)
  },
}))

const enqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))

/**
 * What a starter publish reads before the click (AGL-4049): documents by
 * path, a routed-pages read by id, the plan and the workspace address. Every
 * other kind reads none of it.
 */
const reads = {
  docs: new Map<string, Record<string, unknown>>(),
  plan: { ready: true, entitled: true, locked: false, planLabel: 'Pro', upgradeHref: '/acme/billing#plans' } as Record<
    string,
    unknown
  >,
}

jest.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_firestore: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  where: (_field: unknown, _op: unknown, ids: string[]) => ({ ids }),
  query: (ref: { path: string }, clause: { ids: string[] }) => ({ path: ref.path, ids: clause.ids }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'me', getIdToken: async () => 'token' } }),
  useFirestore: () => ({}),
  useFirestoreDoc: (build: () => { path: string } | null) => {
    const ref = build()
    return ref ? { data: reads.docs.get(ref.path), status: 'success' } : { data: undefined, status: 'loading' }
  },
  useFirestoreCollection: (build: () => { path: string; ids: string[] } | null) => {
    const ref = build()
    if (!ref) return { data: [], status: 'loading' }
    const data = ref.ids
      .filter((id) => reads.docs.has(`${ref.path}/${id}`))
      .map((id) => ({ $id: id, ...reads.docs.get(`${ref.path}/${id}`) }))
    return { data, status: 'success' }
  },
  usePlanFeature: () => reads.plan,
  useConsoleHostRoute: (hostId: string | null) =>
    hostId
      ? { base: '/acme/hosts/bistro', orgSlug: 'acme', subdomain: 'bistro' }
      : { base: null, orgSlug: null, subdomain: null },
}))

beforeEach(() => {
  posted.length = 0
  responseStatus = 200
  responseBody = { listingId: 'listing-1', version: 1 }
  enqueueSnackbar.mockClear()
  reads.docs.clear()
  reads.plan = { ready: true, entitled: true, locked: false, planLabel: 'Pro', upgradeHref: '/acme/billing#plans' }
})

/** Ticks the publisher agreement above Publish (AGL-4105). */
function agree(): void {
  fireEvent.click(screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }))
}

/** Opens the dialog for one artifact, agrees, and presses Publish. */
async function publish(artifact: Record<string, unknown>): Promise<void> {
  const onClose = jest.fn()
  render(<PublishArtifactDialog artifact={artifact as never} onClose={onClose} />)
  agree()
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
  await waitFor(() => expect(posted.length).toBeGreaterThan(0))
}

describe('every kind the console can hand over', () => {
  it.each([
    [
      'layout',
      { kind: 'layout', hostId: 'host-1', artifactId: 'layout-1', displayName: 'Docs' },
      'marketplace/publish-layout',
      { hostId: 'host-1', layoutId: 'layout-1' },
    ],
    [
      'component',
      { kind: 'component', hostId: 'host-1', artifactId: 'component-1', displayName: 'Hero' },
      'marketplace/publish',
      { hostId: 'host-1', componentId: 'component-1' },
    ],
    [
      'site template',
      { kind: 'site', hostId: 'host-1', displayName: 'Acme' },
      'marketplace/publish-template',
      { hostId: 'host-1' },
    ],
    [
      'theme',
      { kind: 'theme', hostId: 'host-1', displayName: 'Acme theme' },
      'marketplace/publish-theme',
      { hostId: 'host-1' },
    ],
    [
      // Org-scoped, which is the one kind that does NOT travel on a hostId.
      'dataset schema',
      { kind: 'datasetSchema', orgId: 'org-1', artifactId: 'dataset-1', displayName: 'Leads' },
      'marketplace/publish-dataset-schema',
      { orgId: 'org-1', datasetId: 'dataset-1' },
    ],
    [
      'email template',
      { kind: 'emailTemplate', hostId: 'host-1', artifactId: 'welcome', displayName: 'Welcome' },
      'marketplace/publish-email-template',
      { hostId: 'host-1', templateKey: 'welcome' },
    ],
    [
      'email starter',
      { kind: 'emailStarter', hostId: 'host-1', artifactId: 'screen-1', displayName: 'Launch' },
      'marketplace/publish-email-starter',
      { hostId: 'host-1', screenId: 'screen-1' },
    ],
  ])(
    'sends a %s to its own route, with the fields that route reads',
    async (_label, artifact, endpoint, payload) => {
      await publish(artifact)
      expect(posted).toHaveLength(1)
      expect(posted[0].url).toBe(`/api/${endpoint}`)
      expect(posted[0].body).toMatchObject(payload)
      // The name the person left in the field, never the seed by itself: the
      // seed is editable and the listing is named by what they typed.
      expect(posted[0].body['displayName']).toBe(artifact['displayName'])
    },
  )

  it('seeds the name from the artifact and sends what the person typed instead', async () => {
    const onClose = jest.fn()
    render(
      <PublishArtifactDialog
        artifact={{ kind: 'layout', hostId: 'h', artifactId: 'l', displayName: 'Docs' } as never}
        onClose={onClose}
      />,
    )
    const name = screen.getByLabelText('Listing name') as HTMLInputElement
    expect(name.value).toBe('Docs')
    fireEvent.change(name, { target: { value: 'Docs, rebuilt' } })
    agree()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body['displayName']).toBe('Docs, rebuilt')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('a kind this marketplace does not sell', () => {
  /**
   * The console and this map going out of step is the failure mode of the
   * seam itself, and the person has already clicked by the time it shows. A
   * dialog that drew nothing would look like a broken control with nothing
   * to read; this says what happened and changes nothing.
   */
  it('says so rather than drawing nothing, and posts nothing', () => {
    render(
      <PublishArtifactDialog
        artifact={{ kind: 'spaceship', hostId: 'host-1' } as never}
        onClose={jest.fn()}
      />,
    )
    expect(screen.getByText(/does not publish a spaceship/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(posted).toHaveLength(0)
  })

  it('draws nothing at all while the page has nothing open', () => {
    render(<PublishArtifactDialog artifact={null} onClose={jest.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('what the server says is what the publisher reads', () => {
  it('reports a missing setup step as a warning, not an error', async () => {
    // 412 means a publisher profile or payouts are missing — actionable, and
    // the route's own words for it, never a sentence guessed here.
    responseStatus = 412
    responseBody = { error: 'Set up payouts before publishing a paid listing' }
    await publish({ kind: 'layout', hostId: 'h', artifactId: 'l', displayName: 'Docs' })
    await waitFor(() =>
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        'Set up payouts before publishing a paid listing',
        expect.objectContaining({ variant: 'warning' }),
      ),
    )
  })
})

/**
 * THE PUBLISHER AGREEMENT, AGREED TO ON EVERY PUBLISH (AGL-4105).
 *
 * Every kind above is published through this one form, so wiring it once
 * wires the seven: the box sits above Publish, unticked, Publish waits for
 * it, the publish carries it, and it is unticked again for the next one.
 */
describe('the publisher agreement', () => {
  const artifact = { kind: 'layout', hostId: 'h', orgId: 'org-1', artifactId: 'l', displayName: 'Docs' }

  it('starts unticked, and Publish waits for it', () => {
    render(<PublishArtifactDialog artifact={artifact as never} onClose={jest.fn()} />)
    const box = screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(posted).toHaveLength(0)
    agree()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('links the agreement from its title', () => {
    render(<PublishArtifactDialog artifact={artifact as never} onClose={jest.fn()} />)
    const link = screen.getByRole('link', { name: PUBLISHER_AGREEMENT_TITLE }) as HTMLAnchorElement
    expect(link.href).toMatch(/\/legal\/marketplace-publisher-agreement$/)
  })

  it.each(['layout', 'component', 'site', 'theme', 'emailTemplate', 'emailStarter', 'datasetSchema'])(
    'a %s publish carries the version it agreed to',
    async (kind) => {
      await publish({ kind, hostId: 'host-1', orgId: 'org-1', artifactId: 'a-1', displayName: 'Named' })
      expect(posted[0].body['agreement']).toEqual({ version: PUBLISHER_AGREEMENT_VERSION, accepted: true })
    },
  )

  it('is unticked again for the next artifact the dialog opens on', async () => {
    const onClose = jest.fn()
    const { rerender } = render(<PublishArtifactDialog artifact={artifact as never} onClose={onClose} />)
    agree()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    rerender(
      <PublishArtifactDialog artifact={{ ...artifact, artifactId: 'l2', displayName: 'Next' } as never} onClose={onClose} />,
    )
    const box = screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }) as HTMLInputElement
    expect(box.checked).toBe(false)
  })
})

/**
 * A WHOLE SITE AS A SITE STARTER (AGL-4049).
 *
 * The starter form adds what only a starter has: the theme it carries,
 * chosen by the publisher (a built-in with this site's brand colors, or the
 * site's full theme — neither chosen for them), the style it is listed
 * under, the pages it captures, and every setup step in its way said before
 * the click. The door's refusals are shown in its own words, in the dialog.
 */
describe('publishing a site as a starter', () => {
  const STARTER = {
    kind: 'siteStarter',
    hostId: 'h1',
    orgId: 'org-1',
    displayName: 'Corner bistro',
    description: 'A warm neighborhood restaurant',
  }

  /** A built-in the themes plugin contributes, as the theme library stores a pick of it. */
  const BOOTSTRAP = {
    id: 'theme-presets.bootstrap',
    name: 'Bootstrap',
    theme: {
      colorSchemes: {
        light: { primary: { main: '#0d6efd' }, background: { default: '#ffffff' } },
        dark: { primary: { main: '#6ea8fe' }, background: { default: '#212529' } },
      },
      shape: { borderRadius: 6 },
    },
  }

  /** A site that picked Bootstrap and set its own primary over it. */
  function seedBuiltinSite() {
    const { host } = planSiteStarterTheme({
      theme: { kind: 'builtin', base: 'bootstrap', brand: { light: { primary: '#1b5e20' }, dark: {} }, fonts: 'inter' },
      presets: [BOOTSTRAP],
      listing: { listingId: '', version: '', displayName: '' },
      newId: () => 'unused',
    })
    seedSite(host)
  }

  function seedSite(theme: Record<string, unknown>) {
    reads.docs.set('hosts/h1', { ...theme, screens: { s_home: '/', s_about: 'about', s_draft: 'draft' } })
    reads.docs.set('hosts/h1/screens/s_home', { displayName: 'Home', versionId: 'v1' })
    reads.docs.set('hosts/h1/screens/s_about', { displayName: 'About', versionId: 'v2' })
    reads.docs.set('hosts/h1/screens/s_draft', { displayName: 'Draft' })
    reads.docs.set('publisherProfiles/org-1', { handle: 'bistro', displayName: 'Bistro' })
  }

  const onClose = jest.fn()
  beforeEach(() => onClose.mockClear())

  const open = () => render(<PublishArtifactDialog artifact={STARTER as never} onClose={onClose} />)
  const publishButton = () => screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement
  const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement
  /** Where a notice sends the publisher: the shared notice draws its link as a button. */
  const fixedAt = (name: string) => (screen.getByRole('button', { name }) as HTMLAnchorElement).getAttribute('href')
  const BUILTIN = /^This site's built-in theme with its brand colors/
  const FULL = /^The site's full theme/

  function chooseStyle(name: string) {
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Closest style' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name }))
  }

  it('names what it publishes, and opens with neither theme chosen, Publish waiting for one', () => {
    seedBuiltinSite()
    open()
    expect(screen.getByRole('heading', { name: 'Publish as a starter' })).toBeTruthy()
    expect(radio(BUILTIN).checked).toBe(false)
    expect(radio(FULL).checked).toBe(false)
    agree()
    expect(publishButton().disabled).toBe(true)
    fireEvent.click(radio(FULL))
    expect(publishButton().disabled).toBe(false)
  })

  it('says how many published pages it captures, as the door counts them', () => {
    seedBuiltinSite()
    open()
    expect(screen.getByText(/^Captures its 2 published pages, the shared header and footer/)).toBeTruthy()
  })

  it("sends the site's built-in theme with its brand colors, a base starter and the closest style", async () => {
    seedBuiltinSite()
    open()
    expect(screen.getByText(/^Bootstrap, with the brand colors this site set over it, set in Inter\./)).toBeTruthy()
    fireEvent.click(radio(BUILTIN))
    chooseStyle('Restaurant & café')
    fireEvent.change(screen.getByLabelText('What kind of site is it?'), { target: { value: 'Bistro' } })
    agree()
    fireEvent.click(publishButton())
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].url).toBe('/api/marketplace/publish-starter')
    expect(posted[0].body).toEqual({
      hostId: 'h1',
      displayName: 'Corner bistro',
      description: 'A warm neighborhood restaurant',
      category: 'Bistro',
      priceUsd: 0,
      agreement: { version: PUBLISHER_AGREEMENT_VERSION, accepted: true },
      theme: {
        kind: 'builtin',
        base: 'bootstrap',
        brand: { light: { primary: '#1b5e20' }, dark: {} },
        fonts: 'inter',
      },
      mode: 'base',
      facets: { kind: 'restaurant' },
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      expect.stringMatching(/review/i),
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it("sends the full theme for the door to read off the site, with no style when none is chosen", async () => {
    seedBuiltinSite()
    open()
    fireEvent.click(radio(FULL))
    agree()
    fireEvent.click(publishButton())
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body).toMatchObject({ theme: { kind: 'full' }, mode: 'base', facets: { kind: null } })
  })

  it('offers a site that wears its own theme only its full theme, saying why', () => {
    seedSite({ theme: { colorSchemes: { light: { primary: { main: '#123456' } } } } })
    open()
    expect(radio(BUILTIN).disabled).toBe(true)
    expect(screen.getByText(/^This site wears its own theme, not a built-in one/)).toBeTruthy()
    expect(radio(FULL).disabled).toBe(false)
  })

  it('reads the theme every site is born with as a built-in', () => {
    seedSite({ theme: DEFAULT_SITE_THEME })
    open()
    expect(radio(BUILTIN).disabled).toBe(false)
  })

  describe('blocked before the click, with where each is fixed', () => {
    const ready = () => {
      seedBuiltinSite()
      open()
      fireEvent.click(radio(FULL))
      agree()
    }

    it('by a plan that does not sell on the marketplace', () => {
      reads.plan = { ...reads.plan, entitled: false, locked: true }
      ready()
      expect(screen.getByText('Publishing to the marketplace is included from Pro.')).toBeTruthy()
      expect(fixedAt('See plans')).toBe('/acme/billing#plans')
      expect(publishButton().disabled).toBe(true)
    })

    it('by a workspace with no publisher profile', () => {
      seedBuiltinSite()
      reads.docs.delete('publisherProfiles/org-1')
      open()
      fireEvent.click(radio(FULL))
      agree()
      expect(screen.getByText(/^Set up your publisher profile first/)).toBeTruthy()
      expect(fixedAt('Publisher Profile')).toBe('/acme/marketplace/profile')
      expect(publishButton().disabled).toBe(true)
    })

    it('by payouts, for a starter with a price only', () => {
      ready()
      expect(screen.queryByRole('button', { name: 'Payouts' })).toBeNull()
      fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '29' } })
      expect(screen.getByText(/^Set up payouts first to sell a starter with a price/)).toBeTruthy()
      expect(fixedAt('Payouts')).toBe('/acme/marketplace/payouts')
      expect(publishButton().disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '0' } })
      expect(publishButton().disabled).toBe(false)
    })

    it('by a site with no published Home page, in the starter check’s words', () => {
      seedBuiltinSite()
      reads.docs.set('hosts/h1/screens/s_home', { displayName: 'Home' })
      open()
      fireEvent.click(radio(FULL))
      agree()
      expect(screen.getByText(/^A starter needs a published Home page at \//)).toBeTruthy()
      expect(publishButton().disabled).toBe(true)
    })
  })

  describe("the door's refusals, in its own words, in the dialog", () => {
    const publishFull = async () => {
      seedBuiltinSite()
      open()
      fireEvent.click(radio(FULL))
      agree()
      fireEvent.click(publishButton())
      await waitFor(() => expect(posted).toHaveLength(1))
    }

    it('shows a 422 verbatim with every problem it names, and keeps the form open to fix it', async () => {
      responseStatus = 422
      responseBody = {
        error: 'The light primary color #777777 is 2.1:1 against the light page background, below 3:1.',
        errors: [
          { path: 'colorSchemes.light.primary.main', message: 'The light primary color #777777 is 2.1:1 against the light page background, below 3:1.' },
          { path: 'colorSchemes.dark.primary.main', message: 'The dark primary color #222222 is 1.4:1 against the dark page background, below 3:1.' },
        ],
      }
      await publishFull()
      expect(
        await screen.findByText('The light primary color #777777 is 2.1:1 against the light page background, below 3:1.'),
      ).toBeTruthy()
      expect(
        screen.getByText('The dark primary color #222222 is 1.4:1 against the dark page background, below 3:1.'),
      ).toBeTruthy()
      expect(onClose).not.toHaveBeenCalled()
      expect(enqueueSnackbar).not.toHaveBeenCalled()
    })

    it('shows a page the starter rule refuses, naming the page', async () => {
      responseStatus = 422
      responseBody = { error: 'Page "Menu": a script cannot be published' }
      await publishFull()
      expect(await screen.findByText('Page "Menu": a script cannot be published')).toBeTruthy()
    })

    it('shows a setup refusal as a warning, with where it is fixed', async () => {
      responseStatus = 412
      responseBody = { error: 'Publishing to the marketplace requires a Pro plan' }
      await publishFull()
      expect(await screen.findByText('Publishing to the marketplace requires a Pro plan')).toBeTruthy()
      expect(fixedAt('Publisher Profile')).toBe('/acme/marketplace/profile')
    })

    it('puts an agreement refusal on the box, unticked for the next try', async () => {
      responseStatus = 409
      responseBody = { error: 'The Marketplace Publisher Agreement changed while this was open.' }
      await publishFull()
      expect(await screen.findByText('The Marketplace Publisher Agreement changed while this was open.')).toBeTruthy()
      const box = screen.getByRole('checkbox', { name: `Agree to the ${PUBLISHER_AGREEMENT_TITLE}` }) as HTMLInputElement
      expect(box.checked).toBe(false)
    })
  })
})
