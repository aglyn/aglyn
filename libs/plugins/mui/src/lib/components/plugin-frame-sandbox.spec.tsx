/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
 *
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
 * `sandbox` and `referrerPolicy` are the frame's, not the caller's
 * (AGL-2484).
 *
 * The iframe listed both attributes BEFORE `{...rest}`, so a prop of either
 * name reaching this component would have replaced them — `sandbox` is the
 * only thing standing between a marketplace bundle and the page it renders
 * on, and JSX resolves duplicate attributes by taking the last one.
 *
 * No caller passes either today and `PluginFrameProps` does not declare
 * them, so this was latent rather than live. It is also one line to make
 * unreachable, and the props do arrive here from renderers that spread
 * author-controlled bags, which is exactly the shape that turns "no caller
 * does this" into "a caller does this now".
 *
 * The casts below are the point of the test: they stand in for a future
 * caller that has an untyped bag of props and spreads it.
 */

import { render } from '@testing-library/react'
import PluginFrame from './plugin-frame'
import type { PluginFrameProps } from './plugin-frame'

/** Cross-origin, so `assertCrossOrigin` lets the frame render at all. */
const BASE: PluginFrameProps = {
  pluginOrigin: 'https://plugins.example.com',
  listingId: 'listing-1',
  version: '1.0.0',
  sha256: 'deadbeef',
}

function renderFrame(extra: Record<string, unknown>) {
  const { container } = render(
    <PluginFrame {...BASE} {...(extra as Partial<PluginFrameProps>)} />,
  )
  const frame = container.querySelector('iframe')
  expect(frame).toBeTruthy()
  return frame as HTMLIFrameElement
}

describe('the plugin frame owns its own sandbox (AGL-2484)', () => {
  it('CONTROL: stamps the locked-down attributes with no caller props', () => {
    const frame = renderFrame({})
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('ignores a caller-supplied `sandbox`', () => {
    const frame = renderFrame({
      sandbox: 'allow-scripts allow-same-origin allow-top-navigation allow-popups',
    })
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  })

  it('ignores a caller trying to drop the sandbox entirely', () => {
    const frame = renderFrame({ sandbox: '' })
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  })

  it('ignores a caller-supplied `referrerPolicy`', () => {
    // Leaks the console URL — which carries the org slug and host — to the
    // plugin origin on every subresource request.
    const frame = renderFrame({ referrerPolicy: 'unsafe-url' })
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('CONTROL: still passes through props that are not the frame’s own', () => {
    // The spread must keep working; this is a pin on two attributes, not a
    // decision to stop accepting props.
    const frame = renderFrame({ 'data-testid': 'passed-through' })
    expect(frame.getAttribute('data-testid')).toBe('passed-through')
  })
})
