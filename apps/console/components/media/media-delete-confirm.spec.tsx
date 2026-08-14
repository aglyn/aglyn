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
 * So this is asserted, not taken on feel. Both shapes are built here over the
 * REAL `ConfirmationProviderComponent`, with the same simulated scan:
 *
 *   old — `await scanReferences(...)` then `confirm({ description: string })`
 *   new — `confirm({ description: <MediaDeleteConfirmDescription scan={…}/> })`
 *
 * The new shape must open regardless of the scan, and must then FILL IN the
 * reference warning when it lands — showing the dialog early is only an
 * improvement if the warning still arrives.
 *
 * ## Asserted as ORDERING, not as duration (AGL-1740)
 *
 * These two tests used to time the click-to-dialog gap with `performance.now()`
 * and assert it came in under a fraction of the simulated scan. That made the
 * result a fact about the machine as much as about the code: the margin held
 * on an idle box and went red on a worker starved by 262 sibling suites, where
 * it was read as a regression more than once before being recognised as the
 * threshold giving way.
 *
 * The claim underneath was never about milliseconds. It is an ORDERING — the
 * dialog is on screen while the scan is still outstanding. Under fake timers
 * that is exact rather than probable: the scan is a `setTimeout` nobody has
 * advanced, so "before the scan resolves" is a state the test HOLDS instead of
 * a deadline it hopes to beat, and a starved worker cannot change the answer.
 *
 * The two tests are each other's control. The same query runs at the same
 * point on the timeline over both shapes and gives opposite answers: a dialog
 * for the new one, none for the old. That is what makes the assertion
 * non-vacuous — a change that made the new shape await the scan would move it
 * onto the old shape's answer and turn the first test red, which is the job
 * the timing assertion was there to do.
 */

import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ConfirmationProviderComponent } from '@aglyn/shared-ui-jsx/components/confirmation-provider.component'
import { act, render, screen, waitFor } from '@testing-library/react'
import {
  confirmMediaDelete,
  MediaDeleteConfirmDescription,
} from './media-delete-confirm.component'
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
 * Nothing is timed against it any more (AGL-1740) — it is now the delay on a
 * fake timer, and the assertions turn on whether that timer has been advanced
 * rather than on how long anything took. The real figure is kept because it is
 * what makes the scenario a realistic one to hold pending.
 */
const SCAN_MS = 750

type Scan = { coverage: MediaScanCoverage; names: string[] } | null

const slowScan = (result: Scan): Promise<Scan> =>
  new Promise((resolve) => setTimeout(() => resolve(result), SCAN_MS))

/**
 * Let React flush the work the click queued WITHOUT letting the scan's timer
 * fire, so the assertion that follows is made with the scan still outstanding.
 *
 * `waitFor` cannot be used for this: under fake timers RTL advances them
 * itself, which would resolve the very scan the test needs held pending and
 * quietly turn the ordering assertion back into a timing one.
 */
async function settleWithScanPending(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
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

describe('delete confirmation ordering (AGL-1461/AGL-1740)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('opens the dialog while the usage scan is still outstanding', async () => {
    let open = () => undefined as void
    render(
      <ConfirmationProviderComponent>
        <Harness onReady={(fn) => (open = fn)} />
      </ConfirmationProviderComponent>,
    )
    act(() => open())
    await settleWithScanPending()
    // The scan's timer has NOT been advanced, so this dialog cannot be on the
    // far side of it.
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })

  it('is the scan, and only the scan, that the old shape waited on', async () => {
    let open = () => undefined as void
    render(
      <ConfirmationProviderComponent>
        <LegacyHarness onReady={(fn) => (open = fn)} />
      </ConfirmationProviderComponent>,
    )
    act(() => open())
    await settleWithScanPending()
    // The same query at the same point on the timeline as the test above, and
    // the opposite answer. This is what proves that assertion discriminates.
    expect(screen.queryByRole('dialog')).toBeNull()

    // And it was the scan in the way, nothing else: advance exactly it.
    await act(async () => {
      jest.advanceTimersByTime(SCAN_MS)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).not.toBeNull()
  })
})

/**
 * AGL-1482: the same guarantee, with the clock taken out of it.
 *
 * The two measurements above compare a fast path to a slow one, which is the
 * honest way to answer "is it faster". It is not the strongest way to answer
 * "does it wait", because both shapes finish — a scan that takes 750 ms is
 * still a scan that resolves, so the assertion is a threshold and a threshold
 * is a judgement about a machine.
 *
 * A scan that NEVER settles removes the judgement. If anything on the path
 * from the click to the dialog awaits it, there is no dialog, at any timeout.
 *
 * This is what replaces `expect(handleDeleteBody()).not.toContain('await
 * scanReferences')` in `media-delete-wiring.spec.ts`. That assertion was a
 * claim about ordering expressed as a claim about a keyword: rename the
 * function, or await it through an alias, and it passes over a dialog that
 * waits. Running the flow cannot be fooled that way, and `confirmMediaDelete`
 * exists as a module precisely so it can be run.
 */
describe('the flow never waits on the scan (AGL-1461/AGL-1482)', () => {
  /** A scan that is still walking the corpus, and always will be. */
  const neverSettles = (): Promise<never> => new Promise<never>(() => undefined)

  it('opens the dialog with the scan still in flight', async () => {
    let open = () => undefined as void
    function Harness() {
      const { confirm } = useConfirmationContext()
      open = () => {
        void confirmMediaDelete({
          fileName: 'hero-banner.png',
          mediaId: 'm1',
          scanReferences: neverSettles,
          confirm,
        })
      }
      return null
    }
    render(
      <ConfirmationProviderComponent>
        <Harness />
      </ConfirmationProviderComponent>,
    )
    act(() => open())
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    // And it names the file, so the dialog that arrived early is usable.
    expect(screen.getByText(/hero-banner\.png/)).toBeTruthy()
    expect(screen.getByText(/checking/i)).toBeTruthy()
  })

  /**
   * The same fact without a renderer, stated as the ordering it actually is:
   * `confirm` is called on the tick the scan starts, not on the tick it
   * answers. Anything awaited above the `confirm` call moves it off this tick
   * and this fails with zero calls.
   */
  it('calls confirm in the same tick it starts the scan', () => {
    const confirm = jest.fn(() => new Promise<never>(() => undefined))
    void confirmMediaDelete({
      fileName: 'hero-banner.png',
      mediaId: 'm1',
      scanReferences: neverSettles,
      confirm,
    })
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  /** The scan still has to START — an unawaited scan is not a skipped one. */
  it('starts the scan against the file being deleted', () => {
    const scanReferences = jest.fn(neverSettles)
    void confirmMediaDelete({
      fileName: 'hero-banner.png',
      mediaId: 'm1',
      scanReferences,
      confirm: () => new Promise<never>(() => undefined),
    })
    expect(scanReferences).toHaveBeenCalledWith('m1')
  })

  /**
   * A dismissed dialog rejects, and that is an answer rather than a fault.
   * Reporting it as anything but `false` would delete a file the author
   * backed out of.
   */
  it('reads a dismissed dialog as a refusal, not a failure', async () => {
    await expect(
      confirmMediaDelete({
        fileName: 'hero-banner.png',
        mediaId: 'm1',
        scanReferences: neverSettles,
        confirm: () => Promise.reject(new Error('dismissed')),
      }),
    ).resolves.toBe(false)
  })

  it('reads a confirmed dialog as a yes', async () => {
    await expect(
      confirmMediaDelete({
        fileName: 'hero-banner.png',
        mediaId: 'm1',
        scanReferences: neverSettles,
        confirm: () => Promise.resolve(undefined),
      }),
    ).resolves.toBe(true)
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
