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
 * The agency batch card (AGL-2911), mounted through the `orgSites` zone's
 * props: it stays absent while the generative doors say the feature does not
 * exist, offers only the sites the page resolved for this reader, shows what
 * a run is estimated to cost before it starts one, posts one request for the
 * whole run, and shows the batch's progress with a link into each site.
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  AppLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import type { ConsoleOrgSitesZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import {
  AI_SITE_PAGES,
  AI_SITE_SUBMISSION_CHOICES,
  aiSiteCreditEstimate,
} from '../model/ai-site-job'
import AiSiteBatchCard, {
  aiLatestSiteBatch,
  aiSiteBatchJobs,
} from './ai-site-batch-card.component'

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
})

const HOSTS = [
  { id: 'host-a', name: 'Wag & Co', subdomain: 'wag' },
  { id: 'host-b', name: 'Paws', subdomain: 'paws' },
  { id: 'host-c', name: 'Fetch', subdomain: null },
]

const props: ConsoleOrgSitesZoneProps = {
  hostId: null,
  orgMount: {
    orgId: 'org-1',
    hosts: HOSTS,
    hostsReady: true,
    orgSlug: 'acme',
    hostsPath: '/acme/hosts',
  },
  basePath: '/acme/hosts',
}

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-a',
    kind: 'site',
    status: 'queued',
    brief: 'A site for a dog groomer',
    batch: 'batch-1',
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-09-16T00:00:00.000Z',
    updatedAt: '2026-09-16T00:00:00.000Z',
    error: null,
    running: false,
    plan: null,
    review: null,
    ...patch,
  }
}

let mockFetch: jest.Mock

beforeEach(() => {
  mockFetch = jest.fn().mockResolvedValue(json({ jobs: [] }))
  global.fetch = mockFetch as unknown as typeof fetch
})

/**
 * Nothing drawn, anywhere: not in the tree the card was mounted in, and not
 * in the document its own fields would portal a menu into.
 *
 * `container` alone is empty whether the card returned nothing or drew
 * something outside its own tree, so it cannot tell a flag-off workspace's
 * page from one the card reached past its container to write on. Every
 * question the card asks is ruled out by name for the same reason: a control
 * a workspace may not have is not present to read, not merely unopened.
 */
function expectNothingDrawn(container: HTMLElement) {
  expect(container.textContent).toBe('')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.body.textContent).toBe('')
  expect(document.querySelector('[class*="MuiDialog"]')).toBeNull()
  expect(screen.queryByLabelText(/Where do form submissions go\?/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Generate/ })).toBeNull()
}

/** Opens the form and fills what the door requires. */
async function openForm() {
  render(<AiSiteBatchCard {...props} />)
  await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  fireEvent.click(
    await screen.findByRole('button', { name: /Generate for several sites/ }),
  )
  fireEvent.change(screen.getByLabelText('What these sites are for'), {
    target: { value: 'A neighborhood dog groomer' },
  })
  fireEvent.change(screen.getByLabelText('Kind of business'), {
    target: { value: 'dog groomer' },
  })
}

describe('what the card shows', () => {
  it('stays absent while the generative doors say the feature does not exist', async () => {
    mockFetch.mockResolvedValue(json({ error: 'Not found' }, 404))
    const { container } = render(<AiSiteBatchCard {...props} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('stays absent on a workspace with one site, where a batch is a scaffold', async () => {
    const { container } = render(
      <AiSiteBatchCard
        {...props}
        orgMount={{ ...props.orgMount, hosts: [HOSTS[0]] }}
      />,
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  it('stays absent until the page has resolved its sites', async () => {
    const { container } = render(
      <AiSiteBatchCard
        {...props}
        orgMount={{ ...props.orgMount, hostsReady: false }}
      />,
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expectNothingDrawn(container)
  })

  /**
   * The negative control on {@link expectNothingDrawn}: a helper that cannot
   * see what the card draws would report every absence above as a pass.
   */
  it('is here when the workspace may have it, which is what the absences rule out', async () => {
    const { container } = await (async () => {
      const view = render(<AiSiteBatchCard {...props} />)
      await screen.findByRole('button', { name: /Generate for several sites/ })
      return view
    })()
    expect(() => expectNothingDrawn(container)).toThrow()
  })

  it('offers a row per site the page resolved, named as the page names it', async () => {
    await openForm()
    const table = screen.getByRole('table', { name: 'Sites to generate for' })
    for (const host of HOSTS) {
      expect(
        within(table).getByLabelText(`Generate for ${host.name}`),
      ).toBeTruthy()
      expect(
        (
          within(table).getByLabelText(
            `Business name for ${host.name}`,
          ) as HTMLInputElement
        ).value,
      ).toBe(host.name)
    }
  })
})

describe('the estimate before anything starts', () => {
  it('shows what one site and the whole run are estimated to cost', async () => {
    await openForm()
    expect(screen.getByText(/Pick up to/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Generate for Wag & Co'))
    fireEvent.click(screen.getByLabelText('Generate for Paws'))
    const perSite = aiSiteCreditEstimate(AI_SITE_PAGES.min + 1, {
      welcomeEmail: true,
    })
    const shown = screen.getByText(/Estimated cost/).textContent ?? ''
    expect(shown).toContain(`${perSite.toLocaleString('en-US')} credits a site`)
    expect(shown).toContain(
      `${(perSite * 2).toLocaleString('en-US')} for 2 sites`,
    )
    // Said to be an estimate, with what the real figure is.
    expect(shown).toMatch(/what its own steps spend/)
  })

  it('follows the pages asked for', async () => {
    await openForm()
    fireEvent.click(screen.getByLabelText('Generate for Wag & Co'))
    const before = screen.getByText(/Estimated cost/).textContent ?? ''
    fireEvent.mouseDown(screen.getByLabelText('Pages per site'))
    fireEvent.click(await screen.findByRole('option', { name: String(AI_SITE_PAGES.max) }))
    await waitFor(() =>
      expect(screen.getByText(/Estimated cost/).textContent).not.toBe(before),
    )
  })
})

describe('starting a run', () => {
  it('will not start without a brief, a business and a site', async () => {
    render(<AiSiteBatchCard {...props} />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    fireEvent.click(
      await screen.findByRole('button', { name: /Generate for several sites/ }),
    )
    expect(
      (screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('posts one request for the whole run, with each site’s own variables', async () => {
    await openForm()
    fireEvent.click(screen.getByLabelText('Generate for Wag & Co'))
    fireEvent.change(screen.getByLabelText('City for Wag & Co'), {
      target: { value: 'Austin' },
    })
    fireEvent.click(screen.getByLabelText('Generate for Paws'))
    fireEvent.change(screen.getByLabelText('Brand for Paws'), {
      target: { value: 'coral' },
    })
    mockFetch.mockResolvedValue(
      json({
        batchId: 'batch-1',
        jobs: [job(), job({ id: 'job-2', hostId: 'host-b' })],
        refused: [],
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate for 2 sites' }),
    )
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some((call) =>
          String(call[0]).includes('/api/ai/jobs/batch'),
        ),
      ).toBe(true),
    )
    const call = mockFetch.mock.calls.find((each) =>
      String(each[0]).includes('/jobs/batch'),
    )
    const body = JSON.parse(String((call?.[1] as { body: string }).body))
    expect(body.orgId).toBe('org-1')
    expect(body.businessType).toBe('dog groomer')
    expect(body.sites).toEqual([
      { hostId: 'host-a', businessName: 'Wag & Co', city: 'Austin', brand: '' },
      { hostId: 'host-b', businessName: 'Paws', city: '', brand: 'coral' },
    ])
  })

  /*
   * Where a run's submissions go (AGL-2918). A batch is one brief built again
   * and again, so its forms are the same form: asked once, carried onto every
   * job, binding on each site's form step rather than left to a proposal.
   */
  it('asks where submissions go, offering every answer the form step can bind', async () => {
    await openForm()
    const field = screen.getByLabelText(/Where do form submissions go\?/)
    fireEvent.mouseDown(field)
    expect(
      screen.getAllByRole('option').map((option) => option.getAttribute('data-value')),
    ).toEqual(AI_SITE_SUBMISSION_CHOICES.map((option) => option.id))
  })

  it('posts the run’s one answer, and starts on the Inbox when nobody changed it', async () => {
    await openForm()
    fireEvent.click(screen.getByLabelText('Generate for Wag & Co'))
    mockFetch.mockResolvedValue(
      json({ batchId: 'batch-1', jobs: [job()], refused: [] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate for 1 site' }))
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some((call) => String(call[0]).includes('/jobs/batch')),
      ).toBe(true),
    )
    const first = mockFetch.mock.calls.find((call) =>
      String(call[0]).includes('/jobs/batch'),
    )
    expect(JSON.parse(String((first?.[1] as { body: string }).body)).submissions).toBe(
      'inbox',
    )

    fireEvent.click(screen.getByRole('button', { name: /Generate for several sites/ }))
    fireEvent.mouseDown(screen.getByLabelText(/Where do form submissions go\?/))
    fireEvent.click(screen.getByRole('option', { name: /CRM as a lead/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate for 1 site' }))
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.filter((call) => String(call[0]).includes('/jobs/batch')),
      ).toHaveLength(2),
    )
    const second = mockFetch.mock.calls
      .filter((call) => String(call[0]).includes('/jobs/batch'))
      .at(-1)
    expect(JSON.parse(String((second?.[1] as { body: string }).body)).submissions).toBe(
      'lead',
    )
  })

  it('shows the run’s progress, and links a site that has an address', async () => {
    mockFetch.mockResolvedValue(
      json({
        jobs: [
          job({ status: 'needs_review' }),
          job({ id: 'job-2', hostId: 'host-b', status: 'running' }),
          job({
            id: 'job-3',
            hostId: 'host-c',
            status: 'done',
            outputs: [
              { resource: 'screen', id: 's', hostId: 'host-c', label: 'Home' },
            ],
          }),
        ],
      }),
    )
    render(<AiSiteBatchCard {...props} />)
    // A run is rows of jobs, so it is the shared grid, which scrolls its own
    // columns inside the card (AGL-3045).
    const run = await screen.findByRole('grid', {
      name: 'Sites in this run',
    })
    expect(within(run).getByText('Confirm the plan')).toBeTruthy()
    expect(within(run).getByText('Running')).toBeTruthy()
    expect(
      (within(run).getByText('Wag & Co') as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe('/acme/hosts/wag')
    // A site with no address the console can open gets no link.
    expect(within(run).getByText('Fetch').tagName).not.toBe('A')
    // Drafts are counted once a job has settled or produced one.
    const fetchRow = within(run).getByText('Fetch').closest('[role="row"]') as HTMLElement
    expect(within(fetchRow).getByText('1')).toBeTruthy()
  })

  it('draws the per-site form in a box that scrolls sideways (AGL-3045)', async () => {
    await openForm()
    const table = screen.getByRole('table', { name: 'Sites to generate for' })
    expect(getComputedStyle(table.parentElement as HTMLElement).overflowX).toBe('auto')
  })

  it('names the sites the door refused, and starts the rest', async () => {
    await openForm()
    fireEvent.click(screen.getByLabelText('Generate for Wag & Co'))
    fireEvent.click(screen.getByLabelText('Generate for Paws'))
    mockFetch.mockResolvedValue(
      json({
        batchId: 'batch-1',
        jobs: [job()],
        refused: [
          { hostId: 'host-b', error: 'You cannot generate on that site' },
        ],
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate for 2 sites' }),
    )
    expect(
      await screen.findByText(/Paws: You cannot generate on that site/),
    ).toBeTruthy()
  })

  it('shows the door’s own refusal when the plan does not hold a batch', async () => {
    await openForm()
    fireEvent.click(screen.getByLabelText('Generate for Wag & Co'))
    fireEvent.click(screen.getByLabelText('Generate for Paws'))
    mockFetch.mockResolvedValue(
      json({ error: 'Generating for many sites is included' }, 403),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Generate for 2 sites' }),
    )
    expect(
      await screen.findByText(/Generating for many sites is included/),
    ).toBeTruthy()
  })
})

describe('reading a run back', () => {
  it('groups the jobs of one batch and ignores the rest', () => {
    const jobs = [
      job(),
      job({ id: 'job-2', batch: 'batch-2' }),
      job({ id: 'job-3' }),
      job({ id: 'job-4', batch: null }),
    ] as never
    expect(aiSiteBatchJobs(jobs, 'batch-1').map((each) => each.id)).toEqual([
      'job-1',
      'job-3',
    ])
    expect(aiSiteBatchJobs(jobs, null)).toEqual([])
  })

  it('takes the newest batch a scaffold ran, and none when none did', () => {
    expect(aiLatestSiteBatch([job({ batch: 'batch-9' }), job()] as never)).toBe(
      'batch-9',
    )
    expect(
      aiLatestSiteBatch([job({ kind: 'page', batch: 'batch-9' })] as never),
    ).toBeNull()
    expect(aiLatestSiteBatch([])).toBeNull()
  })
})
