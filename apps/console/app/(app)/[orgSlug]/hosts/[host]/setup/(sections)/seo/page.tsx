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

import SearchIndexingCard from '../../../../../../../../components/search-indexing-card.component'
import { SetupForm, useSetupScope } from '../layout'

/**
 * SEO — the metadata a search engine reads, plus the switch that decides
 * whether it may read the site at all (AGL-2501).
 *
 * The indexing switch is its own card rather than a field on the schema: a
 * toggle that writes on change does not belong inside a form that writes on
 * save.
 */
export default function HostSetupSeoSection() {
  const { hostId } = useSetupScope()
  return (
    <>
      <SetupForm schemaId="hostSeo" />
      <div style={{ marginTop: 24 }}>
        <SearchIndexingCard hostId={hostId} />
      </div>
    </>
  )
}
