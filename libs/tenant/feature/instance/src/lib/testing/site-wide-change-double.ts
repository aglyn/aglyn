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
 * A stand-in for `hooks/helpers/site-wide-change` in a card's spec (AGL-3386).
 *
 * A card that saves something a published page renders writes through
 * `writeSiteWideChange`, which batches the write with a publish outbox entry
 * and asks the console to drop the site's cache. A card's spec is about the
 * write the card makes, and it already doubles `firebase/firestore`'s
 * `setDoc`/`updateDoc`/`deleteDoc` to see it. This routes each staged batch
 * operation to the SAME double call the card made before it batched — so a
 * spec keeps asserting what reached storage, and says nothing about a cache
 * drop it is not testing. The helper's own contract is pinned in
 * `site-wide-change.spec.ts`.
 *
 * Use it as the factory of the module mock:
 *
 *     jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () =>
 *       jest
 *         .requireActual('@aglyn/tenant-feature-instance/testing/site-wide-change-double')
 *         .siteWideChangeThroughSdk(() => jest.requireMock('firebase/firestore')),
 *     )
 *
 * The SDK is handed in rather than required here: Jest injects `jest` into
 * each spec module rather than onto `globalThis`, so this file cannot reach
 * the spec's mock itself.
 */

type SdkCall = (...args: unknown[]) => Promise<unknown>

interface SdkWrites {
  setDoc: SdkCall
  updateDoc: SdkCall
  deleteDoc: SdkCall
}

/** The module's exports, with every write sent to the doubled SDK calls. */
export function siteWideChangeThroughSdk(sdk: () => SdkWrites) {
  const batchOverSdk = (pending: Promise<unknown>[]) => ({
    set: (...args: unknown[]) => {
      pending.push(sdk().setDoc(...args))
    },
    update: (...args: unknown[]) => {
      pending.push(sdk().updateDoc(...args))
    },
    delete: (...args: unknown[]) => {
      pending.push(sdk().deleteDoc(...args))
    },
  })
  return {
    __esModule: true,
    SITE_WIDE_OUTBOX_COLLECTION: 'publishOutbox',
    SITE_WIDE_OUTBOX_PATHS: ['/'],
    writeSiteWideChange: async (options: {
      write: (batch: ReturnType<typeof batchOverSdk>) => void
    }) => {
      const pending: Promise<unknown>[] = []
      options.write(batchOverSdk(pending))
      await Promise.all(pending)
    },
    commitWithSiteWideEntry: async (
      _hostId: string,
      commit: (stage: undefined) => Promise<void>,
    ) => {
      await commit(undefined)
      return null
    },
    settleSiteWideChange: () => undefined,
    announceSiteWideChange: async () => null,
    releaseSiteWideOutboxEntry: async () => undefined,
    stageSiteWideOutboxEntry: () => null,
  }
}
