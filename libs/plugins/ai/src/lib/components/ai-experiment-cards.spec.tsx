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
 * The two doors into the `experiment` job, mounted through the A/B testing
 * card's zones (AGL-2914).
 *
 * The case this file exists for is the LAST one: a result the figures did not
 * settle must READ as unsettled. Everything the step did — the exposure
 * floor, the normal approximation, the corrected confidence bar, the winner
 * taken back out of the model's sentence — is undone by a card that draws a
 * confident heading or marks the best-looking row, because a reader takes the
 * layout for the claim and never reaches the hedge. So the undecided cases
 * assert on the WHOLE rendered card, not on one string.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = require('util').TextDecoder
}
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = require('util').TextEncoder
}

const mockUser = { uid: 'u1', getIdToken: async () => 'tok' }
const mockFetch = jest.fn()

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
  useHostOrgId: (hostId: string | undefined) => (hostId ? 'org-1' : null),
}))

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (_user: unknown, url: string, init?: RequestInit) => mockFetch(url, init),
}))

import type { AiExperimentVerdict } from '../model/ai-experiment'
import { aiExperimentVerdictDisplay } from '../model/ai-experiment-proposal'
import {
  AiExperimentResultCard,
  AiExperimentVariantsCard,
  aiExperimentSubjectFrom,
  aiExperimentVariantDrafts,
  type AiExperimentVariantsCardProps,
  type AiExperimentZoneVariant,
} from './ai-experiment-cards.component'
import { forgetAiJobsVerdicts } from './use-ai-job-run'

/**
 * Words that make a claim about which variant is better. The same family the
 * step refuses in the model's sentence — a card that avoids them in prose and
 * then prints one in a chip has made the claim anyway.
 */
const CLAIMS = /\bwinner\b|winning|\bwon\b|beats?\b|outperform|\bahead\b|significant|conclusive|recommend/i

/**
 * Everything the card says EXCEPT the verdict's own two sentences, which are
 * code's constants and are denials — "No winner", "No variant is ahead of
 * another". They use these words to refuse the claim, so leaving them in
 * would make this control unfailable; taking them out leaves the headline,
 * the points, the table, the next step and every badge, which is where a
 * claim would actually appear.
 */
function claimsIn(container: HTMLElement, verdict: AiExperimentVerdict): string {
  const display = aiExperimentVerdictDisplay(verdict)
  // Text NODES joined with a space, not `textContent`. A chip beside an arm's
  // name concatenates into "BAhead", where a word boundary never falls and
  // this control would have passed a card marking a row.
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  return parts
    .join(' ')
    .split(display.status)
    .join(' ')
    .split(display.caveat)
    .join(' ')
}

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'experiment',
    status: 'done',
    brief: 'Explain it',
    batch: null,
    steps: [],
    outputs: [],
    creditsReserved: 0,
    creditsSpent: 0,
    createdBy: 'u1',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:05.000Z',
    error: null,
    running: false,
    plan: null,
    review: null,
    ...patch,
  }
}

const ARMS = [
  { id: 'A (control)', exposures: 4000, conversions: 200, rate: 5, lift: null, confidence: null },
  { id: 'B', exposures: 4000, conversions: 212, rate: 5.3, lift: 6, confidence: 71.2 },
]

const answered = (proposal: Record<string, unknown>, patch: Record<string, unknown> = {}) =>
  job({
    outputs: [
      {
        resource: 'experiment',
        id: 'exp-1',
        hostId: 'host-1',
        label: 'Hero copy',
        proposal,
      },
    ],
    ...patch,
  })

const explained = (patch: Record<string, unknown> = {}) =>
  answered({
    task: 'explain',
    verdict: 'inconclusive',
    test: 'Hero copy',
    headline: 'Both variants converted at about the same rate over eight thousand visitors.',
    points: ['A converted 200 of 4,000; B converted 212 of 4,000.'],
    winnerId: null,
    next: 'These variants are too close to separate. Try a bigger change rather than a longer test.',
    threshold: 95,
    arms: ARMS,
    ...patch,
  })

const VARIANTS_ANSWER = {
  task: 'variants',
  target: 'email',
  goal: 'replies',
  variants: [
    { name: 'A (control)', subject: 'Your quote', body: 'As it stands.', preheader: '', headline: '', rationale: '' },
    {
      name: 'B — the date',
      subject: 'Your quote is ready',
      body: 'Shorter, with the date.',
      preheader: '',
      headline: '',
      rationale: 'Tests whether specificity moves replies.',
    },
  ],
}

/** The jobs route, then the create door; no card reaches any other route. */
function routes(answers: { verdict?: () => unknown; create?: () => unknown }) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/ai/jobs') {
      return Promise.resolve(answers.create?.() ?? json({ error: 'no create' }, 500))
    }
    if (url.startsWith('/api/ai/jobs?')) {
      return Promise.resolve(answers.verdict?.() ?? json({ jobs: [] }))
    }
    throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`)
  })
}

const EDITOR_VARIANTS: AiExperimentZoneVariant[] = [
  { id: 'a', name: 'A (control)', subject: 'Your quote', body: 'As it stands.' },
  { id: 'b', name: 'B', subject: '', body: '' },
]

const proposeVariants = jest.fn()

const variantsProps = (
  patch: Partial<AiExperimentVariantsCardProps> = {},
): AiExperimentVariantsCardProps => ({
  hostId: 'host-1',
  experimentId: 'exp-1',
  name: 'Subject line',
  target: 'email',
  goal: 'formSubmission',
  variants: EDITOR_VARIANTS,
  proposeVariants,
  ...patch,
})

beforeEach(() => {
  jest.clearAllMocks()
  forgetAiJobsVerdicts()
})

describe('whether either card is here at all', () => {
  it('stays absent while the release flag is off, and asks nothing else', async () => {
    routes({ verdict: () => json({ error: 'Not found' }, 404) })
    const result = render(<AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(result.container.textContent).toBe('')

    forgetAiJobsVerdicts()
    const variants = render(<AiExperimentVariantsCard {...variantsProps()} />)
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(1))
    expect(variants.container.textContent).toBe('')
    // Nothing was started: the door is not merely hidden, it is unreachable.
    expect(mockFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('stays absent for a workspace whose plan does not carry generation', async () => {
    routes({ verdict: () => json({ error: 'Forbidden' }, 403) })
    const { container } = render(
      <AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />,
    )
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })
})

describe('a result the figures did not settle', () => {
  it('renders as undecided: no claim anywhere on the card, and no marked arm', async () => {
    routes({ verdict: () => json({ jobs: [] }), create: () => json({ job: explained() }) })
    const { container } = render(
      <AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this result' }))
    await screen.findByText(/Both variants converted/)

    // Everything the card says but its own refusal — chip, headline, points,
    // table and next step — not one sentence of it.
    expect(claimsIn(container, 'inconclusive')).not.toMatch(CLAIMS)
    expect(screen.getByText('No winner')).toBeTruthy()
    expect(screen.getByText(/did not settle anything/)).toBeTruthy()
    // Nothing is marked, and no row is set apart from the others.
    expect(container.querySelectorAll('[aria-selected="true"], .Mui-selected')).toHaveLength(0)
    // Code's sentence about what to do next, never a recommendation.
    expect(screen.getByText(/too close to separate/)).toBeTruthy()
    // And no confidence bar quoted beside a result that cleared none.
    expect(container.textContent).not.toMatch(/Called at/)
  })

  it('marks nothing even when the stored answer carries a winner beside that verdict', async () => {
    routes({
      verdict: () => json({ jobs: [] }),
      create: () => json({ job: explained({ winnerId: 'B', next: 'Ship B.' }) }),
    })
    const { container } = render(
      <AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this result' }))
    await screen.findByText(/Both variants converted/)

    expect(claimsIn(container, 'inconclusive')).not.toMatch(CLAIMS)
    expect(container.textContent).not.toMatch(/Ship B/)
    expect(screen.getByText(/too close to separate/)).toBeTruthy()
  })

  it('says a test is early rather than undecided, which is a different instruction', async () => {
    routes({
      verdict: () => json({ jobs: [] }),
      create: () =>
        json({
          job: explained({
            verdict: 'too-early',
            headline: 'Only a few hundred visitors have seen each variant.',
            next: '',
          }),
        }),
    })
    const { container } = render(
      <AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this result' }))
    await screen.findByText(/Only a few hundred/)

    expect(claimsIn(container, 'too-early')).not.toMatch(CLAIMS)
    expect(screen.getByText('No result yet')).toBeTruthy()
    expect(screen.getByText(/Leave the test running/)).toBeTruthy()
  })
})

describe('a result the figures did settle', () => {
  it('names the arm the figures named, and only that one', async () => {
    routes({
      verdict: () => json({ jobs: [] }),
      create: () =>
        json({
          job: explained({
            verdict: 'winner',
            winnerId: 'B',
            headline: 'B converted better than A over eight thousand visitors.',
            next: 'Keep B and test the next idea.',
            arms: [ARMS[0], { ...ARMS[1], confidence: 97.4 }],
          }),
        }),
    })
    render(<AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this result' }))
    await screen.findByText(/B converted better/)

    expect(screen.getByText('One variant is ahead')).toBeTruthy()
    // One mark on the card, on the arm the reading named.
    const marks = screen.getAllByText('Ahead')
    expect(marks).toHaveLength(1)
    expect(marks[0].closest('tr')?.textContent).toContain('B')
    expect(screen.getByText('Called at 95% confidence.')).toBeTruthy()
    expect(screen.getByText('Keep B and test the next idea.')).toBeTruthy()
  })
})

describe('the doors', () => {
  it('asks for an explanation of the test the results dialog has open', async () => {
    routes({ verdict: () => json({ jobs: [] }), create: () => json({ job: explained() }) })
    render(<AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this result' }))
    await screen.findByText(/Both variants converted/)

    const [, init] = mockFetch.mock.calls.find(([, request]) => request?.method === 'POST') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'experiment',
      brief: 'Explain the result of the A/B test “Hero copy” in plain words.',
      inputs: { task: 'explain', test: 'Hero copy', experimentId: 'exp-1' },
    })
  })

  it('asks for variants of the copy under test, and says what it varies', async () => {
    routes({ verdict: () => json({ jobs: [] }), create: () => json({ job: answered(VARIANTS_ANSWER) }) })
    render(<AiExperimentVariantsCard {...variantsProps()} />)
    // An email test's control copy is in the editor, so the field arrives filled.
    const field = (await screen.findByLabelText(/copy under test/)) as HTMLTextAreaElement
    expect(field.value).toBe('Your quote\n\nAs it stands.')
    fireEvent.click(screen.getByRole('button', { name: 'Write variants' }))
    await screen.findByText('B — the date')

    const [, init] = mockFetch.mock.calls.find(([, request]) => request?.method === 'POST') ?? []
    expect(JSON.parse(String(init?.body))).toEqual({
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'experiment',
      brief: 'Write variants of this email for the A/B test “Subject line”.',
      inputs: {
        task: 'variants',
        target: 'email',
        subject: 'Your quote\n\nAs it stands.',
        goal: 'formSubmission',
        experimentId: 'exp-1',
      },
    })
  })

  it('leaves the copy field empty for a page, whose variants are screen versions', async () => {
    routes({ verdict: () => json({ jobs: [] }) })
    render(<AiExperimentVariantsCard {...variantsProps({ target: 'screen' })} />)
    const field = (await screen.findByLabelText(/copy under test/)) as HTMLTextAreaElement
    expect(field.value).toBe('')
    // Nothing to write variants of yet, so the door is shut until there is.
    expect(
      screen.getByRole('button', { name: 'Write variants' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('says why a job failed, and proposes nothing', async () => {
    routes({
      verdict: () => json({ jobs: [] }),
      create: () =>
        json({
          job: job({ status: 'failed', error: 'A/B testing is not available on this workspace, so there is no test to work on.' }),
        }),
    })
    render(<AiExperimentResultCard hostId="host-1" experimentId="exp-1" test="Hero copy" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this result' }))
    await screen.findByText(/A\/B testing is not available/)
    expect(screen.queryByLabelText('What this result shows')).toBeNull()
  })
})

describe('putting variants into the editor', () => {
  it('fills the editor’s own variants, in order, without changing the test’s shape', async () => {
    routes({ verdict: () => json({ jobs: [] }), create: () => json({ job: answered(VARIANTS_ANSWER) }) })
    render(<AiExperimentVariantsCard {...variantsProps()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Write variants' }))
    await screen.findByText('B — the date')
    fireEvent.click(screen.getByRole('button', { name: 'Put into the variants' }))

    expect(proposeVariants).toHaveBeenCalledTimes(1)
    const [drafts, key] = proposeVariants.mock.calls[0]
    expect(key).toBe('job-1')
    // The editor's own ids, its own count, its own order: a proposal writes
    // copy for the arms that exist and cannot add, drop or reorder one.
    expect(drafts).toEqual([
      { id: 'a', name: 'A (control)', subject: 'Your quote', body: 'As it stands.' },
      { id: 'b', name: 'B — the date', subject: 'Your quote is ready', body: 'Shorter, with the date.' },
    ])
    expect(screen.getByText(/In the variants above/)).toBeTruthy()
  })

  it('fills only a page variant’s name, because its copy is a screen version', () => {
    const drafts = aiExperimentVariantDrafts('screen', EDITOR_VARIANTS, {
      target: 'screen',
      goal: '',
      // Carrying the email fields as well: a reading that reached a browser
      // is a plain record, and the editor's subject and body do not exist on
      // a page test, so what lands there must be nothing.
      variants: [
        { name: 'A (control)', headline: 'As it stands', body: 'Page copy', subject: 'Not a subject', preheader: 'Nor this', rationale: '' },
        { name: 'B — shorter', headline: 'Shorter', body: 'Shorter copy', subject: 'Nor this one', preheader: '', rationale: '' },
      ],
    })
    expect(drafts).toEqual([
      { id: 'a', name: 'A (control)', subject: '', body: '' },
      { id: 'b', name: 'B — shorter', subject: '', body: '' },
    ])
  })

  it('leaves an arm the proposal did not reach exactly as it was', () => {
    const three = [...EDITOR_VARIANTS, { id: 'c', name: 'C', subject: 'Kept', body: 'Kept too' }]
    const drafts = aiExperimentVariantDrafts('email', three, {
      target: 'email',
      goal: '',
      variants: VARIANTS_ANSWER.variants,
    })
    expect(drafts[2]).toEqual({ id: 'c', name: 'C', subject: 'Kept', body: 'Kept too' })
  })
})

describe('the pieces', () => {
  it('reads an email test’s copy off its control, and a page test’s off nothing', () => {
    expect(aiExperimentSubjectFrom('email', EDITOR_VARIANTS)).toBe('Your quote\n\nAs it stands.')
    expect(aiExperimentSubjectFrom('screen', EDITOR_VARIANTS)).toBe('')
    expect(aiExperimentSubjectFrom('email', [])).toBe('')
  })
})
