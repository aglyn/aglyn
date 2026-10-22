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

import { render } from '@testing-library/react'

/**
 * The top warning banner on /admin/flags rendered with extra vertical space
 * around it: the `HelpTip` appended inline after its text is an unsized
 * `IconButton` (~30px, sized for a touch target), taller than the single
 * line of body text it sits in, so it inflated the line box the same way an
 * un-trimmed `HelpTip` would in a `CardDisplay` header title — which is why
 * that header applies `fontSize: '0.8em', my: -0.5` to its own `HelpTip`
 * (`libs/shared/ui/jsx/src/lib/components/card-display.tsx`). This asserts
 * the alert's `HelpTip` carries that same compensating `sx`, so the banner
 * can't silently regress back to the taller, ill-fitting rendering.
 */

let capturedHelpTipProps: Record<string, unknown> | undefined

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'staff-1', getIdToken: async () => 'tok' } }),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ children }: any) => <div>{children}</div>,
  Container: ({ children }: any) => <div>{children}</div>,
  HelpTip: (props: any) => {
    capturedHelpTipProps = props
    return null
  },
}))

jest.mock('../components/staff-only.component', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../components/layouts/dashboard.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))
jest.mock('../components/layouts/authenticated.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))
jest.mock('../components/layouts/main.layout', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))

jest.mock('../hooks/use-is-staff', () => ({
  __esModule: true,
  useIsStaff: () => true,
  useStaffRole: () => 'super',
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => ({}),
}))

import AdminFlags from '../app/(app)/admin/flags/page'

beforeEach(() => {
  capturedHelpTipProps = undefined
  ;(globalThis as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ etag: 'etag-1', role: 'super', flags: [] }),
  }))
})

describe('/admin/flags top alert (owner feedback: extra vertical space)', () => {
  it("sizes the alert's HelpTip down to the compensating card-header sx", () => {
    render(<AdminFlags />)
    expect(capturedHelpTipProps).toBeDefined()
    expect(capturedHelpTipProps?.sx).toEqual({ fontSize: '0.8em', my: -0.5 })
  })
})
