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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The org feed renders the AI rows by their labels and offers an "AI" chip
 * (AGL-2929), and its toolbar filters the whole log (AGL-3321).
 *
 * The AI writers store catalog codes — `ai.job.output`, `ai.overage.cap` —
 * so the surfaces can recognize them; a reader must never see the code. "What
 * did AI do here" is a toggle that asks the ROUTE for those codes, so it is
 * answered across the log rather than over the page on screen. Harness lifted
 * from `org-activity-window-is-ordered.spec.tsx`: the route is a fake `fetch`.
 */

let response: { entries: unknown[]; nextCursor?: string | null } = { entries: [] }
/** Every URL the card asked the route for. */
let urls: URL[] = []

const AI_ROWS = [
  {
    $id: 'a',
    action: 'Renamed organization to "Acme"',
    actorId: 'u1',
    actorEmail: 'ada@example.test',
    target: { type: 'org', id: 'org-1' },
    createdAt: { seconds: 400 },
  },
  {
    $id: 'b',
    action: 'ai.job.output',
    actorId: 'u1',
    actorEmail: 'ada@example.test',
    target: { type: 'screen', id: 'screen-1', name: 'Home', versionId: 'v1' },
    createdAt: { seconds: 300 },
  },
  {
    $id: 'c',
    action: 'ai.overage.cap',
    actorId: 'u1',
    actorEmail: 'ada@example.test',
    target: { type: 'org', name: '$25' },
    createdAt: { seconds: 200 },
  },
  {
    $id: 'd',
    action: 'ai.addon.removed',
    actorId: null,
    actorEmail: null,
    target: { type: 'subscription', name: 'Acme AI' },
    createdAt: { seconds: 100 },
  },
]

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { uid: 'u1', getIdToken: async () => 'id-token' } }),
}))

jest.mock('next/navigation', () => ({
  useParams: () => ({ orgSlug: 'acme' }),
  // The rows link to their targets through `AppLink`, which reads the
  // current path to mark the active one.
  usePathname: () => '/acme/team',
}))

jest.mock('firebase/firestore', () => {
  const refuse = () => {
    throw new Error('the activity card must not read Firestore directly')
  }
  return {
    collection: refuse,
    query: refuse,
    orderBy: refuse,
    limit: refuse,
    onSnapshot: refuse,
    getDocs: refuse,
  }
})

import OrgActivityCard from '../components/org-activity-card.component'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'

// The AI codes' labels and group are the AI plugin's declaration (AGL-2939),
// loaded the way the console shell loads it.
beforeAll(() => registerPluginDeclarations())

beforeEach(() => {
  response = { entries: AI_ROWS }
  urls = []
  ;(global as any).fetch = jest.fn(async (url: string) => {
    urls.push(new URL(String(url), 'http://localhost'))
    return {
      ok: true,
      status: 200,
      json: async () => ({
        entries: response.entries,
        nextCursor: response.nextCursor ?? null,
        facets: {
          actors: [{ value: 'u1', label: 'ada@example.test' }],
          sites: [
            { value: 'org-1', label: 'Organization' },
            { value: 'h1', label: 'Acme shop' },
          ],
        },
      }),
    }
  })
})

const lastUrl = () => urls[urls.length - 1]
const filtersOf = (url: URL) => JSON.parse(url.searchParams.get('filters') ?? '[]')

describe('the org feed and the AI rows (AGL-2929)', () => {
  it('renders every AI code by its label, and never the dotted code', async () => {
    const { findByText, container } = render(<OrgActivityCard orgId="org-1" />)
    expect(await findByText('AI generated — Home')).toBeTruthy()
    expect(await findByText('AI overage ceiling — $25')).toBeTruthy()
    expect(await findByText('Removed the AI add-on — Acme AI')).toBeTruthy()
    expect(container.textContent).not.toContain('ai.job.output')
    expect(container.textContent).not.toContain('ai.overage.cap')
    expect(container.textContent).not.toContain('ai.addon.removed')
  })

  it('an actorless AI row says Someone rather than naming a person', async () => {
    const { findByText } = render(<OrgActivityCard orgId="org-1" />)
    expect(await findByText('Someone')).toBeTruthy()
  })

  it('the AI chip asks the route for the AI codes, across the log, and hands the clause back', async () => {
    const { findByRole, findByText } = render(<OrgActivityCard orgId="org-1" />)
    const chip = await findByRole('button', { name: 'AI' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    await findByText('Renamed organization to "Acme"')
    fireEvent.click(chip)
    await waitFor(() => expect(filtersOf(lastUrl())).toHaveLength(1))
    const [clause] = filtersOf(lastUrl())
    expect(clause).toMatchObject({ field: 'action', op: 'isAnyOf' })
    expect(clause.value.split(',')).toEqual(
      expect.arrayContaining(['ai.job.output', 'ai.overage.cap', 'ai.addon.removed']),
    )
    expect(clause.value.split(',')).not.toContain('Renamed organization to "Acme"')
    await waitFor(() => expect(chip.getAttribute('aria-pressed')).toBe('true'))
    // Shown as a chip over the grid, each code by its label.
    expect(await findByText(/^Action is any of .*AI generated/)).toBeTruthy()
    fireEvent.click(chip)
    await waitFor(() => expect(lastUrl().searchParams.get('filters')).toBeNull())
  })

  it('offers the chip whatever the page holds — the route answers it over the whole log', async () => {
    response = { entries: [AI_ROWS[0]] }
    const { findByText, findByRole } = render(<OrgActivityCard orgId="org-1" />)
    await findByText('Renamed organization to "Acme"')
    expect(await findByRole('button', { name: 'AI' })).toBeTruthy()
  })
})

describe('the org-wide log’s toolbar (AGL-3321)', () => {
  it('filters through the grid’s own panel and searches the whole log', async () => {
    render(<OrgActivityCard orgId="org-1" orgWide />)
    await screen.findByText('AI generated — Home')
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ada' } })
    await waitFor(() => expect(lastUrl().searchParams.get('search')).toBe('ada'))
    expect(lastUrl().searchParams.get('scope')).toBe('org-wide')
    expect(await screen.findByText(/Each page looks through up to 250 entries/)).toBeTruthy()
  })

  it('asks for the Who and Where choices once, with the first page', async () => {
    render(<OrgActivityCard orgId="org-1" orgWide />)
    await screen.findByText('AI generated — Home')
    expect(urls[0].searchParams.get('facets')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    await waitFor(() => expect(urls.length).toBeGreaterThan(1))
    expect(lastUrl().searchParams.get('facets')).toBeNull()
  })

  it('a filter change starts the walk again at page one, with no cursor', async () => {
    response = { entries: AI_ROWS, nextCursor: 'after-d' }
    render(<OrgActivityCard orgId="org-1" orgWide />)
    await screen.findByText('AI generated — Home')
    fireEvent.click(screen.getByLabelText(/go to next page/i))
    await waitFor(() => expect(lastUrl().searchParams.get('cursor')).toBe('after-d'))
    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    await waitFor(() => expect(filtersOf(lastUrl())).toHaveLength(1))
    expect(lastUrl().searchParams.get('cursor')).toBeNull()
    // And the filtered log pages forward with the cursor its route hands back.
    await waitFor(() =>
      expect((screen.getByLabelText(/go to next page/i) as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(screen.getByLabelText(/go to next page/i))
    await waitFor(() => expect(lastUrl().searchParams.get('cursor')).toBe('after-d'))
    expect(filtersOf(lastUrl())).toHaveLength(1)
  })

  it('the organization-level feed offers no search, which its route cannot answer', async () => {
    render(<OrgActivityCard orgId="org-1" />)
    await screen.findByText('AI generated — Home')
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
