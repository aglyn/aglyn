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

// A registry of its own in production mode re-evaluates React, MUI and the
// card's graph before the first keystroke; on a loaded CI shard that has run
// past jest's 30 s default, so the budget is set for that load.
const TYPING_BURST_TIMEOUT_MS = 120_000

// Each hook answers with the same object every render, as the real ones do
// once the org doc has loaded: a fresh one would re-run the card's prefill.
jest.mock('../../hooks/use-org-scope', () => {
  const scope = { currentOrg: { $id: 'o-1', orgName: 'Acme' }, loading: false }
  return { __esModule: true, default: () => scope, useOrgScope: () => scope, useOrgSlug: () => 'acme' }
})
jest.mock('../../hooks/use-current-org', () => {
  const value = { org: { logoUrl: '' }, orgId: 'o-1', ready: true, entitlementsFromCache: false }
  return { __esModule: true, default: () => value, useCurrentOrg: () => value }
})
jest.mock('../../hooks/use-org-settings-request', () => {
  const request = async () => undefined
  return { __esModule: true, default: () => request }
})
jest.mock('@aglyn/shared-ui-snackstack', () => {
  const value = { enqueueSnackbar: () => undefined, closeSnackbar: () => undefined }
  return { __esModule: true, useSnackbar: () => value }
})
// The closed media picker beside each logo field needs no Firebase.
jest.mock('@aglyn/tenant-feature-instance', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance'),
  useHostOrgId: () => undefined,
}))

/**
 * "Maximum update depth exceeded" while typing a logo URL in Settings →
 * Profile.
 *
 * Production reported minified React error #185 from the Logo URL field's
 * `onChange`. Each logo previews in an MUI `Avatar`, and an Avatar whose
 * `src` changes resets its loaded state from a passive effect. Fed straight
 * from the field, every keystroke changed both previews' `src`, so every
 * keystroke's commit left that update pending. React 19 counts each commit
 * that leaves one as nested, and keystrokes delivered back to back never let
 * the count clear: the 51st throws. The previews now follow a deferred copy
 * of the URL, which renders after the typing rather than inside it.
 *
 * Run against the PRODUCTION build of React, in a registry of its own, with
 * the keystrokes dispatched in one task outside `act`, the way a busy browser
 * delivers queued input (AGL-3423's specs of the same failure).
 */
describe('typing a logo URL in the organization profile', () => {
  it('takes a burst of keystrokes without exceeding React’s update depth', async () => {
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    // Widened: the Next typings declare `NODE_ENV` read-only.
    const env = process.env as Record<string, string | undefined>
    const environment = env['NODE_ENV']
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT
    const errors: string[] = []
    const onError = (event: ErrorEvent) => {
      errors.push(String(event.error?.message ?? event.message))
      event.preventDefault()
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    env['NODE_ENV'] = 'production'
    scope.IS_REACT_ACT_ENVIRONMENT = false
    window.addEventListener('error', onError)
    let unmount: () => void = () => undefined
    try {
      jest.resetModules()
      const react = jest.requireActual<typeof import('react')>('react')
      const client = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
      const Card = jest.requireActual<typeof import('./org-profile-card.component')>(
        './org-profile-card.component',
      ).default
      const root = client.createRoot(host)
      unmount = () => root.unmount()
      root.render(react.createElement(Card))
      await new Promise((resolve) => setTimeout(resolve, 100))
      // The first field on the card.
      const logo = host.querySelector('input') as HTMLInputElement
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      const url = 'https://cdn.example.com/'
      for (let typed = 1; typed <= 80; typed += 1) {
        setValue?.call(logo, url + 'x'.repeat(typed))
        logo.dispatchEvent(new Event('input', { bubbles: true }))
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(errors).toEqual([])
      expect(logo.value).toBe(url + 'x'.repeat(80))
    } finally {
      unmount()
      window.removeEventListener('error', onError)
      host.remove()
      env['NODE_ENV'] = environment
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment
    }
  }, TYPING_BURST_TIMEOUT_MS)
})
