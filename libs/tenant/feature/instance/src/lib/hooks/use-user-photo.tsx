/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import {
  gravatarUrlFromEmail,
  type GravatarUrlOptions,
} from '@aglyn/shared-util-tools'
import { useMemo } from 'react'
import { useUser } from './firebase/firebase-services'

export function useUserGravatar(options?: GravatarUrlOptions) {
  const { data } = useUser()
  const email = data?.email
  return useMemo(() => gravatarUrlFromEmail(email, options), [email, options])
}

export function useUserPhotoUrl() {
  const { data } = useUser()
  return data?.photoURL
}

export function useUserPhoto(options?: { gravatar: GravatarUrlOptions }) {
  const gravatar = useUserGravatar(options?.gravatar)
  const photoUrl = useUserPhotoUrl()

  return useMemo(() => photoUrl || gravatar, [gravatar, photoUrl])
}

export default useUserPhoto
