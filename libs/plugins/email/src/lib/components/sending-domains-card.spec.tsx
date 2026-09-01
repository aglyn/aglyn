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
 * SENDING ON THE SHARED DOMAIN IS SAID PLAINLY, NOT HIDDEN.
 *
 * Most workspaces will never verify a domain, and for them the honest answer
 * is that their mail leaves on an Aglyn address. That is not an error state
 * and it must not read like one — but it is also not nothing, because the
 * consequence is real: the site's delivery reputation is pooled with every
 * other workspace's rather than being its own.
 *
 * Every major vendor does exactly this. HubSpot sends unverified from-
 * addresses on a HubSpot-managed domain. The failure mode worth testing
 * against is the opposite of alarm — a surface that quietly says "Sending as
 * hello@…" and never mentions whose domain that is, leaving a merchant to
 * discover it in a recipient's inbox.
 */

import { act, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SendingDomainsCard } from './sending-domains-card'

/*
 * What the section actually hands every card: the Emails base, with no
 * section segment on it. A fixture carrying `/sending` already made
 * `${basePath}/${domain}` look right, which is how a card that navigated to
 * `/emails/{domain}` — a route that renders nothing — passed its own tests.
 */
const BASE_PATH = '/acme/hosts/site/emails'

/** Every path this render navigated to, in order. */
const pushed: string[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (path: string) => {
      pushed.push(path)
    },
    replace: () => undefined,
  }),
  usePathname: () => `${BASE_PATH}/sending`,
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'uid-1', getIdToken: async () => 'token' } }),
  /*
   * The card composes the drawer that edits who the site sends as, and that
   * drawer offers a picker over the site's people. Doubled rather than
   * omitted: the drawer is mounted whether it is open or not, so a missing
   * hook is a card that cannot render at all.
   *
   * `useFirestoreCollection` answers nothing here, which is also what it does
   * in the product while the drawer is closed — it builds a null query, so
   * no read is issued until somebody asks for one.
   */
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: [], status: 'success' }),
}))
jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  /*
   * The header ACTION is rendered as well as the children. The card's primary
   * control lives there, so a double that dropped it would make every
   * assertion about who may add a domain pass by rendering nothing.
   */
  CardDisplay: ({ children, HeaderProps }: any) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  HelpTip: () => null,
  MdiIcon: () => null,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  /*
   * The confirmation the row menu's Remove opens. Doubled as an ACCEPT so the
   * assertions below exercise the call that follows it; a double that
   * rejected would make "the request was sent" untestable and would pass by
   * never sending anything.
   */
  useConfirmationContext: () => ({
    confirm: () => Promise.resolve(undefined),
  }),
}))
/*
 * The row overflow, flattened to its items.
 *
 * A double rather than the real menu because the real one hides its items
 * behind a click, and what these tests are about is WHICH items a row offers
 * and which of them are inert — a menu that had to be opened first would let
 * an assertion pass against a menu that never rendered. `title` carries the
 * disabled reason, which is where the real component puts it too.
 */
jest.mock('@aglyn/shared-ui-jsx/components/row-actions-menu.component', () => ({
  __esModule: true,
  default: ({ items }: { items: any[] }) => (
    <div>
      {items.map((item) =>
        item.href ? (
          <a key={item.key} href={item.href}>
            {item.label}
          </a>
        ) : (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            title={item.disabledReason}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  ),
}))
jest.mock('@aglyn/shared-ui-jsx/components/navigation-drawer.component', () => ({
  NavigationDrawerComponent: ({
    open,
    children,
  }: {
    open: boolean
    children: ReactNode
  }) => (open ? <div>{children}</div> : null),
}))

/** What the sending-identity route reports, staged per case. */
let identity: Record<string, unknown> = {}

/** Every body this render POSTed, so a claim cannot happen unnoticed. */
const posted: Record<string, unknown>[] = []

beforeEach(() => {
  pushed.length = 0
  /*
   * A site with no domain of its own, as the resolver actually answers it.
   *
   * `identitySource` is `'shared'` and the address is a POOL MEMBER, not
   * `noreply@aglyn.com`. A host-scoped resolution cannot produce the platform
   * identity at all — that is Aglyn's own `aglyn.com` mail — so a fixture
   * carrying it was describing a state the product cannot reach, and the card
   * was being tested against an impossible answer.
   */
  identity = {
    orgId: 'org-1',
    selected: '',
    // No domain of its own, which is why the pool is carrying its receipts.
    platformDomain: '',
    // Both derived server-side from the entitlement tables, so the card never
    // writes a tier name of its own. They name the same tier today and are
    // still two values, because two separate gates decide them.
    customDomainPlan: 'Pro',
    dedicatedDomainPlan: 'Pro',
    localPart: 'hello',
    identity:
      'Sending as notifications@shared1.mail.aglyn.app on a shared Aglyn ' +
      'domain. Delivery reputation there is pooled with the other sites using ' +
      'it, and only receipts and account email leave on it.',
    identitySource: 'shared',
    refusal: null,
    options: [],
    domains: [],
    canManage: true,
    entitled: true,
    dedicated: { available: true, proposed: 'acme.mail.aglyn.app' },
  }
  posted.length = 0
  ;(global as any).fetch = jest.fn(async (url: string, init?: any) => {
    if (init?.method === 'POST') posted.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () =>
        init?.method === 'POST'
          ? { selected: 'acme.mail.aglyn.app', created: true }
          : String(url).includes('sending-identity')
            ? identity
            : { domains: [] },
    }
  })
})

const mount = async () => {
  render(<SendingDomainsCard hostId="host-1" basePath={BASE_PATH} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('a workspace with no verified domain', () => {
  it('names the address its mail actually leaves on', async () => {
    await mount()

    expect(screen.getByText('This site sends as')).toBeTruthy()
    expect(screen.getByText(/notifications@shared1\.mail\.aglyn\.app/)).toBeTruthy()
  })

  it('says what using the shared domain costs', async () => {
    await mount()

    // The half a surface is tempted to leave out. "Sending as notifications@…"
    // is true and tells a merchant nothing about whose reputation they are
    // borrowing, or that their recipients will not see their own brand.
    expect(
      screen.getByText(/reputation on it is shared with the other sites/i),
    ).toBeTruthy()
  })

  /**
   * The disclosure has to name what the pooling COSTS, not just that it
   * happens.
   *
   * A merchant who reads "your mail sends on a shared address" and then finds
   * their campaigns paused has been told half of an arrangement. Campaigns
   * send from the pool, and they are graded against tighter complaint and
   * bounce limits there — the card is where that is learned rather than from a
   * paused sender.
   */
  it('says campaigns on the shared address are held to tighter limits', async () => {
    await mount()

    expect(
      screen.getByText(/Campaigns send on the shared address too/i),
    ).toBeTruthy()
    expect(
      screen.getByText(/tighter complaint and bounce limits/i),
    ).toBeTruthy()
  })

  /**
   * …and names BOTH ways out of it.
   *
   * A merchant told "marketing needs a domain of your own" and nothing else
   * has been given a refusal, not an answer. The two shapes arrive at the same
   * tier and are not the same choice: one costs DNS work in the merchant's own
   * zone and puts their name in the `From:` line, the other costs nothing and
   * shows recipients an Aglyn address. A card naming only one of them decides
   * that trade on the merchant's behalf.
   */
  it('names both ways to get a domain, and what each costs', async () => {
    await mount()

    expect(screen.getByText(/A domain we set up/i)).toBeTruthy()
    expect(screen.getByText(/you publish three records in your zone/i)).toBeTruthy()
  })

  it('does not present it as a failure', async () => {
    await mount()

    // It is the ordinary state of most workspaces, not a broken one — and a
    // surface that alarms about it teaches people to ignore the alarm that
    // matters, which is the refusal below.
    expect(screen.queryByText('This site cannot send')).toBeNull()
  })
})

describe('a workspace whose selected domain is unfinished', () => {
  it('says the site cannot send, and why', async () => {
    /*
     * The control for the case above, and the state that IS an alarm. The two
     * have to look different: one is "this works and here is the trade-off",
     * the other is "nothing will go out until you do something".
     */
    identity = {
      ...identity,
      selected: 'acme.com',
      identity: 'Blocked: acme.com is not verified.',
      identitySource: null,
      refusal: {
        code: 'domain-unverified',
        domain: 'acme.com',
        message:
          'acme.com has not been verified yet, so this send was refused ' +
          'rather than sent from a different address.',
        missing: ['TXT:send.acme.com'],
      },
    }

    await mount()

    expect(screen.getByText('This site cannot send')).toBeTruthy()
    expect(screen.getByText(/acme\.com has not been verified/)).toBeTruthy()
    // And it must NOT also claim the site is happily sending on the shared
    // domain, which is exactly the silent fallback the feature forbids.
    expect(screen.queryByText('This site sends as')).toBeNull()
  })
})

describe('what a reader may do is what the server says they may do', () => {
  it('offers Add domain to an org admin on the right plan', async () => {
    await mount()

    expect(screen.getByText('Add domain')).toBeTruthy()
  })

  it('hides Add domain from somebody who cannot manage, and says so', async () => {
    identity = { ...identity, canManage: false }

    await mount()

    expect(screen.queryByText('Add domain')).toBeNull()
    expect(screen.getByText(/needs the organization admin role/i)).toBeTruthy()
  })

  it('explains the plan gate rather than offering an action that 403s', async () => {
    identity = { ...identity, entitled: false }

    await mount()

    expect(screen.getByText(/starts on the Pro plan/i)).toBeTruthy()
    // And it says the site still sends. A plan gate on the two domains is not
    // a gate on the mail: the shared address carries account email at every
    // tier, and a card that only said "not on your plan" would read as an
    // outage.
    expect(screen.getByText(/sends without either of those/i)).toBeTruthy()
  })
})

/*
 * A DOMAIN'S OWN PAGE IS REACHED AT `/emails/sending/{domain}`.
 *
 * `/emails/{domain}` resolves to no section and renders an empty page. That
 * is the worst possible landing for the two navigations below, because both
 * happen at the moment the reader needs the DNS records: right after adding
 * the domain, and on clicking the row that says the records are outstanding.
 */
describe('navigating to one domain', () => {
  it('sends a row click to the domain page under the sending section', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'requested', records: [] },
    ]
    await mount()
    const row = screen.getByText('acme.com').closest('tr') as HTMLElement
    await act(async () => {
      row.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(pushed).toEqual([`${BASE_PATH}/sending/acme.com`])
  })

  it('THE CONTROL: the section segment is not already in the base', () => {
    // Without this, a base that ended in `/sending` would make the assertion
    // above pass against the very bug it exists to catch.
    expect(BASE_PATH.endsWith('/sending')).toBe(false)
  })

  it('points the row menu at the same address the row does', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'requested', records: [] },
    ]
    await mount()
    // An anchor, not a handler: the domain's page has to be middle-clickable
    // like any other link. And the same one derivation as the row click, so
    // the two cannot drift apart.
    expect(
      screen.getByRole('link', { name: 'Open domain' }).getAttribute('href'),
    ).toBe(`${BASE_PATH}/sending/acme.com`)
  })
})

/*==========================================
  What a row offers, and what it refuses to
==========================================*/

/**
 * A MENU ITEM IS A PROMISE THAT THE ROUTE BEHIND IT WILL ANSWER.
 *
 * The table had no per-row control at all, so every operation on a domain
 * meant opening its page first. What it must not gain instead is a menu of
 * actions that 403 — the routes behind these gate on the organization admin
 * role and on the own-domain entitlement, and both are already in the view
 * this card holds. So an item the reader cannot use is present and INERT with
 * the reason on it, which is the one of the three states that says something:
 * an absent control and an inapplicable one look identical to a reader.
 */
describe('the row menu offers only what the routes will accept', () => {
  const menuItem = (label: RegExp) =>
    screen.getByRole('button', { name: label }) as HTMLButtonElement

  it('refuses to check DNS for a domain with no records yet', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'requested', records: [] },
    ]
    await mount()

    const item = menuItem(/Check DNS/i)
    expect(item.disabled).toBe(true)
    expect(item.getAttribute('title')).toMatch(/nothing to look for/i)
  })

  it('checks DNS through the domains route once records exist', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'records-issued', records: [] },
    ]
    await mount()

    await act(async () => {
      menuItem(/Check DNS/i).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(posted).toContainEqual({
      orgId: 'org-1',
      domain: 'acme.com',
      action: 'verify',
    })
  })

  it('will not send as a domain that is not verified, and says why', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'records-issued', records: [] },
    ]
    await mount()

    const item = menuItem(/Send this site’s email as this domain/i)
    expect(item.disabled).toBe(true)
    expect(item.getAttribute('title')).toMatch(/Only a verified domain/i)
  })

  it('will not offer to send as the domain already in use', async () => {
    identity.selected = 'acme.com'
    identity.domains = [
      { domain: 'acme.com', status: 'verified', records: [] },
    ]
    await mount()

    const item = menuItem(/Send this site’s email as this domain/i)
    expect(item.disabled).toBe(true)
    expect(item.getAttribute('title')).toMatch(/already sends as this domain/i)
  })

  it('moves the selection through the identity route', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'verified', records: [] },
    ]
    await mount()

    await act(async () => {
      menuItem(/Send this site’s email as this domain/i).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // The IDENTITY route, whose write gate is the per-site selection — not
    // the domains route, which decides what the ORG has proved.
    expect(posted).toContainEqual({ hostId: 'host-1', domain: 'acme.com' })
  })

  /**
   * The gate the card can see, applied before the route has to. A viewer is
   * shown the whole menu with the reason on the items they cannot use, rather
   * than a shorter menu that leaves them wondering whether the console can do
   * these things at all.
   */
  it('inerts the domains-route actions for somebody who cannot manage', async () => {
    identity.canManage = false
    identity.domains = [
      { domain: 'acme.com', status: 'verified', records: [] },
    ]
    await mount()

    expect(menuItem(/Check DNS/i).disabled).toBe(true)
    expect(menuItem(/Remove domain/i).disabled).toBe(true)
    expect(menuItem(/Remove domain/i).getAttribute('title')).toMatch(
      /organization admin role/i,
    )
    // Opening it is still offered — reading a domain's records needs nothing.
    expect(
      screen.getByRole('link', { name: 'Open domain' }),
    ).toBeTruthy()
  })

  it('removes a domain through the domains route, after confirming', async () => {
    identity.domains = [
      { domain: 'acme.com', status: 'verified', records: [] },
    ]
    await mount()

    await act(async () => {
      menuItem(/Remove domain/i).click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // The URL as well as the verb: a DELETE carries no body, so the org and
    // the domain travel in the query and an assertion on the method alone
    // would pass against a call that named neither.
    const calls = ((global as any).fetch as jest.Mock).mock.calls
    expect(
      calls.some(
        ([url, init]: [string, any]) =>
          init?.method === 'DELETE' &&
          String(url).includes('/api/email/sending-domains') &&
          String(url).includes('orgId=org-1') &&
          String(url).includes('domain=acme.com'),
      ),
    ).toBe(true)
  })

  it('inerts them for a workspace whose plan does not carry own domains', async () => {
    identity.entitled = false
    identity.domains = [
      { domain: 'acme.com', status: 'verified', records: [] },
    ]
    await mount()

    expect(menuItem(/Check DNS/i).disabled).toBe(true)
    expect(menuItem(/Check DNS/i).getAttribute('title')).toMatch(
      /plan that carries sending as your own domain/i,
    )
  })
})

/*==========================================
  The dedicated domain is offered, not issued
==========================================*/

/**
 * WHERE THE MARKETING REFUSAL SENDS A MERCHANT WHO CANNOT PUBLISH DNS.
 *
 * A platform subdomain is no longer handed to every paying site — it spends a
 * provider domain slot and three records in Aglyn's own zone, so it is asked
 * for. Which puts a burden on this card that did not exist while it arrived by
 * itself: a merchant who meets "marketing needs a domain of this site's own"
 * has to find something here to act on, and "Add domain" is only one of the
 * two ways out. Somebody whose registrar access is a support ticket away needs
 * the other one.
 */
describe('the offer of an Aglyn sending domain', () => {
  it('offers one to an entitled site that has none', async () => {
    await mount()

    // Named on the control itself, because an Aglyn-branded sending address is
    // the trade this option asks a merchant to accept and it cannot be weighed
    // unseen.
    expect(
      screen.getByRole('button', { name: /Ask for acme\.mail\.aglyn\.app/i }),
    ).toBeTruthy()
  })

  /**
   * The trade is stated in BOTH directions on the same screen. An offer that
   * only said "no records to publish" would read as the better option, and it
   * is the one that costs the platform a slot and the merchant their brand.
   */
  /**
   * The offer sits beside the sentence that states its cost, rather than in an
   * alert of its own repeating it. An action whose trade-off is a scroll away
   * is an action taken without the trade-off.
   */
  it('sits beside the sentence naming what it costs', async () => {
    await mount()

    expect(
      screen.getByText(/Recipients see an address on our domain rather than on yours/i),
    ).toBeTruthy()
    // And the other option's cost is stated too, so the two are a choice
    // rather than a recommendation.
    expect(screen.getByText(/The trade is the DNS work/i)).toBeTruthy()
  })

  it('asks for one, and asks the route rather than assuming', async () => {
    await mount()

    await act(async () => {
      screen
        .getByRole('button', { name: /Ask for acme\.mail\.aglyn\.app/i })
        .click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(posted).toContainEqual({
      hostId: 'host-1',
      action: 'request-dedicated',
    })
  })

  /**
   * NOTHING IS CLAIMED BY RENDERING. The whole point of the change behind this
   * card is that a domain is spent when somebody decides to spend it, and a
   * surface that requested one on mount would reintroduce exactly the
   * automatic draw that was removed from site creation and the upgrade
   * webhook.
   */
  it('claims nothing until the button is pressed', async () => {
    await mount()

    expect(posted).toEqual([])
  })

  it('offers nothing once the site already has one', async () => {
    identity = {
      ...identity,
      platformDomain: 'acme.mail.aglyn.app',
      dedicated: { available: false, proposed: 'acme.mail.aglyn.app' },
    }

    await mount()

    expect(screen.queryByRole('button', { name: /Ask for/i })).toBeNull()
    // The sentence still names the domain it has, so the reader is told what
    // this site sends on rather than simply shown nothing.
    expect(screen.getByText(/This site has one — acme\.mail\.aglyn\.app/)).toBeTruthy()
  })

  it('offers nothing to a reader who could not act on it', async () => {
    identity = { ...identity, canManage: false }

    await mount()

    // The notice about who CAN is what they get instead.
    expect(screen.queryByRole('button', { name: /Ask for/i })).toBeNull()
    expect(screen.getByText(/needs the organization admin role/i)).toBeTruthy()
  })

  /**
   * A console can be newer than the route it is talking to. An absent
   * `dedicated` must read as "no offer to show" rather than as an offer with
   * an undefined name in it.
   */
  it('shows nothing when the route did not report the field', async () => {
    identity = { ...identity, dedicated: undefined }

    await mount()

    expect(screen.queryByRole('button', { name: /Ask for/i })).toBeNull()
    // The explainer still renders — it is prose about the three places a
    // site's mail can leave from and does not depend on the offer being
    // available.
    expect(
      screen.getByText('Where this site’s mail can leave from'),
    ).toBeTruthy()
  })
})
