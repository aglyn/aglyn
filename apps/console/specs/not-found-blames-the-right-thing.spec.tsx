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
 * The 404 does not blame the workspace when the workspace is fine (AGL-2486).
 *
 * One description used to cover three unrelated causes — a stale link, a
 * workspace you cannot open, a site you cannot open — and on the commonest
 * 404 of all it named the wrong one. the * `/aglyn-org/hosts/aglyn-marketing/screens/pegb_4s5wV` names a workspace he
 * owns and a site that exists; the only thing wrong is that
 * `/screens/[screenId]` is not a route. Telling him the workspace might not be
 * his sends him hunting for a permissions problem that does not exist.
 *
 * The distinction is only drawable because the org scope now resolves the
 * URL-named workspace on this boundary at all. Where it does NOT resolve, the
 * vaguer wording stays on purpose: a miss genuinely conflates "no such
 * workspace", "not yours" and "not read yet", and a guess would read as a
 * verdict.
 */
import { render, screen } from '@testing-library/react'

const namedOrg: { value: { slug?: string; orgName?: string } | null } = {
  value: null,
}

jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamedOrg: () => namedOrg.value,
}))

async function renderAt(org: { slug?: string; orgName?: string } | null) {
  namedOrg.value = org
  const { NotFoundContent } = await import(
    '../components/not-found-content.component'
  )
  render(<NotFoundContent />)
}

describe('what the not-found page blames (AGL-2486)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('blames only the ADDRESS when the URL names a workspace you can open', async () => {
    await renderAt({ slug: 'aglyn-org', orgName: 'Aglyn LLC' })
    expect(screen.getByText(/isn’t a page in Aglyn LLC/)).toBeTruthy()
    // The misleading half, asserted as an absence on the rendered DOM.
    expect(screen.queryByText(/isn’t one you can open/)).toBeNull()
  })

  it('offers the way back INTO that workspace', async () => {
    await renderAt({ slug: 'aglyn-org', orgName: 'Aglyn LLC' })
    const back = screen.getByText('Back to Aglyn LLC').closest('a')
    expect(back?.getAttribute('href')).toBe('/aglyn-org/hosts')
  })

  it('stays deliberately vague when no workspace resolved', async () => {
    // Unresolved conflates three causes and must not pick one.
    await renderAt(null)
    expect(screen.getByText(/isn’t one you can open/)).toBeTruthy()
    expect(screen.queryByText(/Back to/)).toBeNull()
    expect(screen.getByText('Go to my workspaces')).toBeTruthy()
  })
})
