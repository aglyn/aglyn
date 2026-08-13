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
 * AGL-1461: the delete confirmation must not wait on the usage scan.
 *
 * `/api/media/references` walks up to a 1,500-document budget across every
 * site in the org — screens, layouts, components, their published versions
 * and their history (`utils/server/scan-media-references.ts`). That work is
 * worth doing: it is what AGL-1413 put between an author and a delete. What
 * it must not do is hold the dialog closed, because a button that does
 * nothing for a second reads as broken and gets clicked again.
 *
 * So this is measured, not asserted by feel. Both shapes are built here over
 * the REAL `ConfirmationProviderComponent`, with the same simulated scan
 * duration, and the elapsed time from click to a visible dialog is compared:
 *
 *   old — `await scanReferences(...)` then `confirm({ description: string })`
 *   new — `confirm({ description: <MediaDeleteConfirmDescription scan={…}/> })`
 *
 * The new shape must open in a small constant time regardless of the scan,
 * and must then FILL IN the reference warning when it lands — showing the
 * dialog early is only an improvement if the warning still arrives.
 */

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx/components/confirmation-provider.component'
import { act, render, screen, waitFor } from '@testing-library/react'
import { MediaDeleteConfirmDescription } from './media-delete-confirm.component'
import type { MediaScanCoverage } from './media-usage-copy'

/**
 * How long the scan is made to take.
 *
 * Measured, not guessed: `scanMediaReferences` run against a Firestore
 * emulator over a 3-site / 254-document org took a median of 388 ms, and
 * 308 ms over an 8-site corpus large enough to exhaust the 1,500-read budget.
 * Both are FLOORS — the emulator is in-process, so every one of the scan's
 * ~38 sequential round trips costs nothing there and costs real latency
 * against production Firestore, on top of the client's own request.
 *
 * The assertions are about the RELATIONSHIP between this and the
 * time-to-dialog, so the exact value only has to be well clear of a render.
 */
const SCAN_MS = 750

type Scan = { coverage: MediaScanCoverage; names: string[] } | null

const slowScan = (result: Scan): Promise<Scan> =>
  new Promise((resolve) => setTimeout(() => resolve(result), SCAN_MS))

/** The click-to-dialog measurement, in milliseconds. */
async function timeToDialog(open: () => void): Promise<number> {
  const started = performance.now()
  act(() => open())
  await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy(), {
    timeout: 5000,
    interval: 5,
  })
  return performance.now() - started
}

function Harness(props: { onReady: (open: () => void) => void }) {
  const { confirm } = useConfirmationContext()
  props.onReady(() => {
    void confirm({
      title: 'Delete this file?',
      description: (
        <MediaDeleteConfirmDescription
          fileName="hero-banner.png"
          scan={slowScan({ coverage: 'full', names: ['Home', 'Pricing'] })}
        />
      ),
      confirmationText: 'Delete',
    }).catch(() => undefined)
  })
  return null
}

/** The shape that shipped: nothing renders until the scan resolves. */
function LegacyHarness(props: { onReady: (open: () => void) => void }) {
  const { confirm } = useConfirmationContext()
  props.onReady(() => {
    void (async () => {
      const scan = await slowScan({ coverage: 'full', names: ['Home'] })
      await confirm({
        title: 'Delete this file?',
        description: `"hero-banner.png" — ${scan?.names.length} refs`,
        confirmationText: 'Delete',
      }).catch(() => undefined)
    })()
  })
  return null
}

describe('delete confirmation latency (AGL-1461)', () => {
  it('opens the dialog without waiting for the usage scan', async () => {
    let open = () => undefined as void
    render(
      <ConfirmationProviderComponent>
        <Harness onReady={(fn) => (open = fn)} />
      </ConfirmationProviderComponent>,
    )
    const elapsed = await timeToDialog(open)
    // A render, not a round trip. Generous against a starved CI worker and
    // still an order of magnitude under the scan it used to wait on.
    expect({ elapsed: elapsed < SCAN_MS / 4 }).toEqual({ elapsed: true })
  })

  it('is the scan, and only the scan, that the old shape waited on', async () => {
    let open = () => undefined as void
    render(
      <ConfirmationProviderComponent>
        <LegacyHarness onReady={(fn) => (open = fn)} />
      </ConfirmationProviderComponent>,
    )
    const elapsed = await timeToDialog(open)
    expect({ elapsed: elapsed >= SCAN_MS }).toEqual({ elapsed: true })
  })
})

describe('what the early dialog says (AGL-1461)', () => {
  it('names the file and shows the check as running, immediately', () => {
    render(
      <MediaDeleteConfirmDescription
        fileName="hero-banner.png"
        scan={slowScan({ coverage: 'full', names: [] })}
      />,
    )
    expect(screen.getByText(/hero-banner\.png/)).toBeTruthy()
    expect(screen.getByText(/checking/i)).toBeTruthy()
  })

  /**
   * The half that makes the early dialog honest. Opening sooner is a
   * regression if the warning never lands — an author would then confirm
   * against a dialog that had not finished telling them what it knew.
   */
  it('fills in the reference warning when the scan lands', async () => {
    render(
      <MediaDeleteConfirmDescription
        fileName="hero-banner.png"
        scan={Promise.resolve({
          coverage: 'full' as MediaScanCoverage,
          names: ['Home', 'Pricing'],
        })}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/referenced in 2 places/i)).toBeTruthy(),
    )
    expect(screen.queryByText(/checking/i)).toBeNull()
  })

  /**
   * A scan that fails must degrade to the AGL-1413 "we could not check
   * everywhere" sentence, never to silence — silence after a visible check
   * reads as a clean bill of health.
   */
  it('degrades to the hedged sentence when the scan fails', async () => {
    render(
      <MediaDeleteConfirmDescription
        fileName="hero-banner.png"
        scan={Promise.reject(new Error('Scan failed (500)'))}
      />,
    )
    await waitFor(() =>
      expect(screen.getByText(/could not check everywhere/i)).toBeTruthy(),
    )
  })
})
