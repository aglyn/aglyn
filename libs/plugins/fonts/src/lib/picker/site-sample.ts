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

import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'

import { type SiteSample, siteSampleFrom } from './site-sample-text'

export { type SiteSample, siteSampleFrom } from './site-sample-text'

/**
 * The site's name, its search title and its description, as the font
 * previews draw them (AGL-3656), so a family is judged in the words it will
 * set; generic words where the site has none yet.
 */
export function useSiteSample(hostId: string | null): SiteSample {
  const firestore = useFirestore()
  const { data } = useFirestoreDoc<{ displayName?: string; name?: string; seo?: { title?: string; description?: string } }>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  return siteSampleFrom(data)
}
