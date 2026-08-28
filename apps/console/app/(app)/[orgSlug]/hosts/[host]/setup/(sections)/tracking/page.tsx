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
'use client'

import ConsentBannerCard from '../../../../../../../../components/consent-banner-card.component'
import { SetupForm, useSetupScope } from '../layout'

/**
 * Tracking — the measurement ids, and the consent banner that governs whether
 * they may load (AGL-693).
 *
 * Beside the fields it governs (AGL-1498). The banner card lived on SEO while
 * its own comment said "same tab as the GA field": the intent was right and
 * the tab moved out from under it when Tracking was split off, leaving a
 * cross-reference that existed only because these two were apart.
 *
 * Its own card rather than fields on the schema, for the same reason as the
 * indexing switch: a toggle that writes on change does not belong inside a
 * form that writes on save.
 */
export default function HostSetupTrackingSection() {
  const { hostId } = useSetupScope()
  return (
    <>
      <SetupForm schemaId="hostTracking" />
      <div style={{ marginTop: 24 }}>
        <ConsentBannerCard hostId={hostId} />
      </div>
    </>
  )
}
