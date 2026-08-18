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
 * The staff erasure SURFACE (AGL-1977).
 *
 * `eraseUser` was implemented, guarded, audited and spec-covered, and no
 * console surface called it — which is precisely the failure Zach's AGL-1900
 * rule names: a capability that exists only as a route is not shipped. So the
 * first thing this file asserts is not a behaviour at all, it is that the card
 * is MOUNTED, read off the page source. A component spec for a component
 * nothing renders would be another green check proving nothing.
 *
 * After that, the three properties that stop the button being worse than no
 * button: it does not appear for a role whose request would 403, it does not
 * fire without the reason and the typed confirmation the route demands, and an
 * `owns-orgs` refusal names the workspaces instead of failing opaquely.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockStaffRole = { value: 'super' as string | null }

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useStaffRole: () => mockStaffRole.value,
  useIsStaff: () => true,
}))

const mockEnqueue = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: any) => (
    <section aria-label={String(header)}>{children}</section>
  ),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { StaffUserEraseCard } = require('./staff-user-erase-card.component')

const PAGE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  'admin',
  'users',
  '[uid]',
  'page.tsx',
)
const ADMIN_LAYOUT = join(__dirname, '..', 'app', '(app)', 'admin', 'layout.tsx')

beforeEach(() => {
  jest.clearAllMocks()
  mockStaffRole.value = 'super'
})

describe('the surface exists at all', () => {
  it('is MOUNTED on /admin/users/[uid]', () => {
    // The AGL-1900 property. If this file passed while nothing rendered the
    // card, every assertion below would be about a component no staff member
    // can reach — which is the exact state AGL-1977 was filed about.
    const page = readFileSync(PAGE, 'utf8')
    expect(page).toContain('staff-user-erase-card.component')
    expect(page).toMatch(/<StaffUserEraseCard\b/)
  })

  it('lives under the /admin StaffGuard, so a non-staff visitor gets a 404', () => {
    // Staff routes are `/admin/*`, and the group's own layout renders a plain
    // `notFound()` for anyone without the claim — a non-staff visitor must not
    // learn the surface exists, which a 403 would tell them.
    const layout = readFileSync(ADMIN_LAYOUT, 'utf8')
    expect(layout).toContain('StaffGuard')
    const guard = readFileSync(
      join(__dirname, 'staff-guard.component.tsx'),
      'utf8',
    )
    expect(guard).toContain('notFound()')
    // The page carries the page-level twin as defence in depth, the same way
    // its siblings do.
    expect(readFileSync(PAGE, 'utf8')).toContain('<StaffOnly>')
  })
})

describe('StaffUserEraseCard', () => {
  const props = {
    uid: 'victim-uid',
    subjectLabel: 'someone@example.com',
    isSelf: false,
  }

  it('offers NO button to a support-role staffer', async () => {
    // The route is super-only. A button that 403s teaches an operator the
    // console is broken at the moment they most need to trust it.
    mockStaffRole.value = 'support'
    render(<StaffUserEraseCard {...props} onErase={jest.fn()} />)
    expect(screen.queryByRole('button', { name: /erase account/i })).toBeNull()
    expect(screen.getByText(/requires the super staff role/i)).toBeTruthy()
  })

  it('renders nothing while the claim is still resolving', () => {
    mockStaffRole.value = null
    const { container } = render(
      <StaffUserEraseCard {...props} onErase={jest.fn()} />,
    )
    expect(container.textContent).toBe('')
  })

  it('says out loud that there is NO 7-day hold', () => {
    // An operator arriving from /admin/orgs has just used a button with a
    // seven-day hold and a Cancel control, and will carry that model here.
    render(<StaffUserEraseCard {...props} onErase={jest.fn()} />)
    expect(screen.getByText(/no 7-day hold/i)).toBeTruthy()
  })

  it('refuses to fire without BOTH a reason and a typed DELETE', async () => {
    const onErase = jest.fn().mockResolvedValue({})
    render(<StaffUserEraseCard {...props} onErase={onErase} />)
    fireEvent.click(screen.getByRole('button', { name: /erase account/i }))

    const submit = screen.getByRole('button', { name: /erase permanently/i })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    // Reason alone is not enough.
    fireEvent.change(screen.getByLabelText(/why/i), {
      target: { value: 'DSAR-2026-14' },
    })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    // Nor is the typed confirmation alone — the route demands the reason and
    // 400s without it, so the UI must not be able to send a request that
    // cannot succeed.
    fireEvent.change(screen.getByLabelText(/why/i), { target: { value: '  ' } })
    fireEvent.change(screen.getByLabelText(/type delete/i), {
      target: { value: 'DELETE' },
    })
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(/why/i), {
      target: { value: 'DSAR-2026-14' },
    })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(onErase).toHaveBeenCalledWith('DSAR-2026-14'))
  })

  it('NAMES the workspaces blocking an erasure', async () => {
    const onErase = jest.fn().mockRejectedValue(
      Object.assign(new Error('This person owns workspaces'), {
        skippedReason: 'owns-orgs',
        blockers: [
          {
            orgId: 'o1',
            orgName: 'Acme Studios',
            hasLiveSubscription: true,
            otherMembers: 3,
          },
        ],
      }),
    )
    render(<StaffUserEraseCard {...props} onErase={onErase} />)
    fireEvent.click(screen.getByRole('button', { name: /erase account/i }))
    fireEvent.change(screen.getByLabelText(/why/i), {
      target: { value: 'DSAR-2026-14' },
    })
    fireEvent.change(screen.getByLabelText(/type delete/i), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: /erase permanently/i }))

    // The name, not a count — "transfer ownership" is useless advice when you
    // do not know which of eleven workspaces is the problem.
    await waitFor(() => expect(screen.getByText('Acme Studios')).toBeTruthy())
    expect(screen.getByText(/active subscription/i)).toBeTruthy()
    expect(screen.getByText(/3 other members/i)).toBeTruthy()
    // A refusal is not an error snackbar — nothing went wrong.
    expect(mockEnqueue).not.toHaveBeenCalled()
  })

  it('will not erase the signed-in staff account', async () => {
    // The route refuses self-erasure with a 400; refusing here too means the
    // operator never meets a button that cannot work.
    render(<StaffUserEraseCard {...props} isSelf onErase={jest.fn()} />)
    const button = screen.getByRole('button', { name: /erase account/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})
