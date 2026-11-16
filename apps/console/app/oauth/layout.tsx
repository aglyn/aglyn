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

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { segmentTitle } from '../page-title'

/**
 * Title-only shell for the connector consent page (AGL-4225): the page is a
 * client component, so its title lives here.
 *
 * Kept out of search indexes, and it sends no referrer: its address carries
 * the app's sign-in request, which no page it links to has any use for.
 */
export const metadata: Metadata = {
  title: segmentTitle('Connect an app'),
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function ConnectAppTitleLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
