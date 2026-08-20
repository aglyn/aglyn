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
 * AGL-1926, the half that names the symptom: hydrating an entry byline must
 * not make React report a mismatch.
 *
 * The legacy collection surface (`catch-all-client.tsx`) is a CLIENT
 * component that Next also renders on the server, so an entry's published
 * date is formatted twice — once on Vercel and once in the visitor's
 * browser. This spec drives exactly that: the markup is produced with the
 * server's runtime defaults, the DOM is hydrated with the VISITOR's, and the
 * assertion is on what REACT SAID, not on what the DOM ended up looking
 * like. A hydration mismatch is recoverable and the recovered DOM looks
 * correct, which is why reading the DOM would prove nothing — the same
 * reasoning as `rich-text-hydration.spec.tsx`.
 *
 * The runtime difference is driven by replacing the DEFAULTS a bare
 * `toLocaleDateString()` picks up, not by `process.env.TZ`: V8 caches the
 * zone and under jest a reassignment does not move the clock at all, so a
 * spec written that way silently asserts against whatever zone the machine
 * is in.
 *
 * ## Why this cannot pass vacuously
 *
 * `PlantedByline` renders the byline the way the surface used to — a bare
 * `toLocaleDateString()` — and the first case asserts React DOES report. If
 * the harness ever stopped noticing mismatches (defaults not installed, no
 * hydration, a swallowed `onRecoverableError`), the planted case goes green
 * and fails the suite. The fixed case on its own would be a check that
 * cannot fail.
 */

import { formatCollectionEntryDate } from '@aglyn/aglyn'
import { act } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

/** 02:30 UTC on the 10th — the 9th in every US zone. */
const PUBLISHED_AT = { seconds: Date.UTC(2026, 7, 10, 2, 30, 0) / 1000 }

/** A perfectly ordinary visitor: not our locale, not our zone. */
const VISITOR_LOCALE = 'en-GB'
const VISITOR_ZONE = 'America/Los_Angeles'

/** The byline as the surface renders it today: through the one formatter. */
function FixedByline() {
  return (
    <article>
      <h1>{'Aglyn is in early access'}</h1>
      <p style={{ opacity: 0.7 }}>{formatCollectionEntryDate(PUBLISHED_AT)}</p>
    </article>
  )
}

/** The byline as it was before AGL-1926 — the runtime decides the string. */
function PlantedByline() {
  return (
    <article>
      <h1>{'Aglyn is in early access'}</h1>
      <p style={{ opacity: 0.7 }}>
        {new Date(PUBLISHED_AT.seconds * 1000).toLocaleDateString()}
      </p>
    </article>
  )
}

/**
 * Make the ambient runtime behave like the visitor's browser: bare calls
 * answer in `en-GB`/Los Angeles, calls that pin both locale and zone are
 * untouched. Returns the undo.
 */
function installVisitorRuntime(): () => void {
  const realFormat = Date.prototype.toLocaleDateString
  Date.prototype.toLocaleDateString = function (
    this: Date,
    locale?: any,
    options?: any,
  ) {
    if (locale != null && options?.timeZone != null) {
      return realFormat.call(this, locale, options)
    }
    return realFormat.call(this, locale ?? VISITOR_LOCALE, {
      ...(options ?? {}),
      timeZone: VISITOR_ZONE,
    })
  } as typeof Date.prototype.toLocaleDateString
  return () => {
    Date.prototype.toLocaleDateString = realFormat
  }
}

/**
 * Render as the server, hydrate as the visitor, and hand back everything
 * React complained about. `onRecoverableError` is where a hydration mismatch
 * surfaces; `console.error` is captured too so nothing is missed if React
 * changes which channel it uses.
 */
async function hydrateAsVisitor(
  Component: () => JSX.Element,
): Promise<string[]> {
  const reported: string[] = []
  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => {
      reported.push(args.map((value) => String(value)).join(' | '))
    })
  // The server pass runs on OUR runtime, which is what builds the ISR HTML.
  const serverHtml = renderToString(<Component />)
  const restore = installVisitorRuntime()
  try {
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = serverHtml
    await act(async () => {
      hydrateRoot(container, <Component />, {
        onRecoverableError: (error) =>
          reported.push(`recoverable: ${(error as Error)?.message}`),
      })
    })
    return reported
  } finally {
    restore()
    consoleError.mockRestore()
  }
}

/** React words it differently across builds; match the concept, not a string. */
const isMismatch = (message: string) =>
  /hydrat|did not match|does not match|#418|#425/i.test(message)

describe('entry byline hydration across runtimes (AGL-1926)', () => {
  it('reports a mismatch when the runtime picks the date (planted red)', async () => {
    const reported = await hydrateAsVisitor(PlantedByline)
    expect(reported.filter(isMismatch)).not.toHaveLength(0)
  })

  it('reports nothing when the date comes from the shared formatter', async () => {
    const reported = await hydrateAsVisitor(FixedByline)
    expect(reported.filter(isMismatch)).toHaveLength(0)
  })

  it('serves the visitor the same day the server rendered', async () => {
    const server = formatCollectionEntryDate(PUBLISHED_AT)
    const restore = installVisitorRuntime()
    try {
      expect(formatCollectionEntryDate(PUBLISHED_AT)).toBe(server)
      expect(server).toBe('8/10/2026')
    } finally {
      restore()
    }
  })
})
