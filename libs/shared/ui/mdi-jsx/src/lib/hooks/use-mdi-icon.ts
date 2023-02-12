/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import DEFAULT_ICON from '@aglyn/shared-data-mdi/constants/default-icon'
import { useAsyncEffect } from '@aglyn/shared-ui-jsx'
import type * as MdiJs from '@mdi/js'
import { useState } from 'react'

type IconPath<T> = [T] extends [keyof typeof MdiJs] ? typeof MdiJs[T] : string

export function useMdiIcon<T>(id: T): IconPath<T> {
  const [path, setPath] = useState<IconPath<T>>(() => DEFAULT_ICON.path)

  useAsyncEffect(
    async (isMounted) => {
      if (!id || typeof id !== 'string') return
      const data = await import('@mdi/js')
        .then(({ [id]: path }) => path as IconPath<T>)
        .catch(console.error)
      if (isMounted() && data) setPath(data)
    },
    [id],
  )

  // useEffect(() => {
  //   let unmounted = false
  //
  //   ;(async () => {
  //     if (!id || typeof id !== 'string') return
  //     const data = await import('@mdi/js')
  //       .then(({ [id]: path }) => path as IconPath<T>)
  //       .catch(console.error)
  //     if (unmounted) return
  //     if (data) setPath(data)
  //   })()
  //
  //   return () => {
  //     unmounted = true
  //   }
  // }, [id])

  return path
}

export default useMdiIcon
