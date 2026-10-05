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
 * The two document stages a page render runs around the loader (AGL-3568),
 * called the way Next calls them, so the render canaries exercise the real
 * code rather than a copy of it.
 *
 * - The SITE LAYOUT, `[host]/[scheme]/layout.tsx`. An async Server Component
 *   is a function: calling it runs every await it makes (the host, the theme
 *   fonts, the navigation, the org, the icon facts) and returns the element
 *   tree without rendering the children. That is the stage that hung on
 *   2026-10-05 while the loader-only canary stayed green.
 * - The PAGE HEAD, the catch-all page's `generateMetadata`, which builds the
 *   title, the social card and the generator tag from the loader's props.
 *
 * Its own module, imported lazily by `canary.ts`, so the canary's host
 * resolution stays free of the whole page graph and a spec can stand these
 * in without loading it.
 */
import HostLayout from '../../../[host]/[scheme]/layout'
import { generateMetadata } from '../../../[host]/[scheme]/[[...slug]]/page'

/** The scheme the canary renders in: the one a visitor with no cookie gets. */
const CANARY_SCHEME = 'light'

/** Run the site layout for `host`, children empty. Resolves to its element. */
export async function runSiteLayout(host: string): Promise<unknown> {
  return HostLayout({
    children: null,
    params: Promise.resolve({ host, scheme: CANARY_SCHEME }),
  })
}

/** Run the home page's head for `host`. Resolves to its metadata. */
export async function runSiteHead(host: string): Promise<unknown> {
  return generateMetadata({ params: Promise.resolve({ host, slug: [] }) })
}
