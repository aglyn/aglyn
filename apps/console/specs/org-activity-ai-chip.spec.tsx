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

import { fireEvent, render, waitFor } from '@testing-library/react'

/**
 * The org feed renders the AI rows by their labels and offers an "AI" chip
 * (AGL-2929).
 *
 * The AI writers store catalog codes — `ai.job.output`, `ai.overage.cap` —
 * so the surfaces can recognize them; a reader must never see the code. And
 * "what did AI do here" is a toggle, offered only when the page holds an AI
 * row, that keeps the AI rows and nothing else. Harness lifted from
 * `org-activity-window-is-ordered.spec.tsx`: the route is a fake `fetch`.
 */

let response: { entries: unknown[] } = { entries: [] }

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
  ;(global as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ entries: response.entries, nextCursor: null }),
  }))
})

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
    expect(await findByText(/^Someone · /)).toBeTruthy()
  })

  it('offers the AI chip when the page holds an AI row, and it keeps only those rows', async () => {
    const { findByRole, queryByText, findByText } = render(
      <OrgActivityCard orgId="org-1" />,
    )
    const chip = await findByRole('button', { name: 'AI' })
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    await findByText('Renamed organization to "Acme"')
    fireEvent.click(chip)
    await waitFor(() => {
      expect(queryByText('Renamed organization to "Acme"')).toBeNull()
    })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(await findByText('AI generated — Home')).toBeTruthy()
    expect(await findByText('AI overage ceiling — $25')).toBeTruthy()
    fireEvent.click(chip)
    expect(await findByText('Renamed organization to "Acme"')).toBeTruthy()
  })

  it('offers no chip on a page with no AI row — a chip that can never match is furniture', async () => {
    response = { entries: [AI_ROWS[0]] }
    const { findByText, queryByRole } = render(<OrgActivityCard orgId="org-1" />)
    await findByText('Renamed organization to "Acme"')
    expect(queryByRole('button', { name: 'AI' })).toBeNull()
  })

  it('the free-text filter finds an AI row by the words on screen', async () => {
    const { findByRole, findByLabelText, queryByText, findByText } = render(
      <OrgActivityCard orgId="org-1" />,
    )
    await findByRole('button', { name: 'AI' })
    fireEvent.change(await findByLabelText('Filter this page'), {
      target: { value: 'ceiling' },
    })
    expect(await findByText('AI overage ceiling — $25')).toBeTruthy()
    await waitFor(() => {
      expect(queryByText('AI generated — Home')).toBeNull()
    })
  })
})
