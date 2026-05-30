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

import type { SxProps } from '@mui/system'
import { useMemo } from 'react'
import type { Theme as DefaultTheme } from '../../vendor/mui'

type MaybeSxProps<Theme extends object> = SxProps<Theme> | boolean | null | undefined

export function useMergeSxProps<Theme extends DefaultTheme>(
  ...sxProps: MaybeSxProps<Theme>[]
): SxProps<Theme> {
  return useMemo(() => mergeSxProps(...sxProps), [sxProps])
}

export function mergeSxProps<Theme extends DefaultTheme>(
  ...sxProps: MaybeSxProps<Theme>[]
): SxProps<Theme> {
  return sxProps.flat(2) as SxProps<Theme>
}

export default mergeSxProps
