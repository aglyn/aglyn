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

import { redirect } from 'next/navigation'
import { DEFAULT_ACCOUNT_SECTION_HREF } from '../../../../constants/account-sections'
import {
  sectionIndexTarget,
  type SearchParams,
} from '../../../../utils/section-index-redirect'

/**
 * `/manage/user` is the section index and renders nothing of its own
 * (AGL-693).
 *
 * A SERVER component. This index names no dynamic segment at all — the target
 * is a constant — so as a client page it was paying a bundle, a hydration and
 * a client navigation to arrive at a string that was known before the request
 * was answered. The reader saw that as a blank main area.
 *
 * The incoming query is carried across: a redirect that drops it silently
 * deletes whatever somebody else put in the URL.
 */
export default async function ManageUserIndex({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}): Promise<never> {
  redirect(sectionIndexTarget(DEFAULT_ACCOUNT_SECTION_HREF, await searchParams))
}
