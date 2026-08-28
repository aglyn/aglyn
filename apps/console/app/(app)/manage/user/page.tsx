/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { DEFAULT_ACCOUNT_SECTION_HREF } from '../../../../constants/account-sections'

/**
 * `/manage/user` is the section index and renders nothing of its own
 * (AGL-693).
 *
 * Every section is a route, so the index only has to send the reader to the
 * first one. `replace`, not `push`: a redirect nobody asked for must not
 * become a history entry their back button bounces off.
 */
const ManageUser: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  useEffect(() => {
    router.replace(DEFAULT_ACCOUNT_SECTION_HREF)
  }, [router])
  return null
}
ManageUser.displayName = 'Page:ManageUser'

export default ManageUser
