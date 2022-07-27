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

import '@aglyn/shared-data-jsx'
import { _isArr } from '@aglyn/shared-util-guards'
import { useMemo } from 'react'
import type { Theme as DefaultTheme } from '../../vendor/mui'

export function useForkedSxProps<Theme extends DefaultTheme>(
  ...sxProps: JSX.SxProps<Theme>[]
): JSX.SxStyleArrayProp<Theme> {
  const deps = useMemo(() => [...sxProps], [sxProps])
  return useMemo(
    () => mergeSxProps(...sxProps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  )
}

export function mergeSxProps<Theme extends DefaultTheme>(
  ...sxProps: JSX.SxProps<Theme>[]
): JSX.SxStyleArrayProp<Theme> {
  const merged = []

  for (const sx of sxProps) {
    if (_isArr(sx)) merged.push(...sx.map((i) => i || false))
    else merged.push(sx || false)
  }

  return merged
}

export default mergeSxProps
