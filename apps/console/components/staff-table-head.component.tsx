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

import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { TableHead, type TableHeadProps } from '@mui/material'

/**
 * The header row of a staff readout table.
 *
 * Every staff table sits in a `ScrollTable`, whose table fills its card and
 * wraps whatever can wrap. On a phone or tablet that shares the card's width
 * between several columns, and a header like "What is and is not in it" or
 * "Contracted / mo" breaks into three or four lines of one word each, which
 * makes every header cell in the row as tall as the worst one.
 *
 * Below `md` the labels stay on one line, so the table is as wide as its
 * headers and the `ScrollTable` box scrolls it sideways. From `md` up the
 * header wraps exactly as a plain `TableHead` does.
 */
export function StaffTableHead({ sx, ...props }: TableHeadProps) {
  return (
    <TableHead
      {...props}
      sx={mergeSxProps(
        { '& .MuiTableCell-head': { whiteSpace: { xs: 'nowrap', md: 'normal' } } },
        sx,
      )}
    />
  )
}

export default StaffTableHead
