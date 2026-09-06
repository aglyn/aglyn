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

import { csvDocument } from '@aglyn/aglyn'
import { mdiDownloadOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { downloadTextFile } from '../../model/contacts-csv'

export interface ReportExportProps {
  /** The file's name — see `reportFilename`. */
  filename: string
  /** The header row, in the table's column order. */
  columns: readonly string[]
  /**
   * The rows, one array per line in the header's order, built when the
   * button is pressed rather than on every render: a table of a thousand
   * rows is serialized once, on demand, and never while nobody asked.
   */
  rows: () => ReadonlyArray<ReadonlyArray<unknown>>
  /** Nothing to write yet — the window is still reading, or came back empty. */
  disabled?: boolean
  /**
   * What the table is grouped from, when that is not everything — the
   * card's own truncation notice, drawn beside the button so the file and
   * its limits are read together.
   */
  caption?: string
}

/**
 * Export CSV for one report table (AGL-2624).
 *
 * Client-side, from the window the card has already loaded: a report table
 * is at most a thousand grouped rows, and the file is those rows exactly as
 * drawn — the same names, the same counts, the same order — so a reader can
 * check the export against the screen. It is NOT a fresh read, so when the
 * card's window was full the caption beside the button says so, the way
 * the card says so beneath the table; an export that quietly wrote a sample
 * as if it were the whole would be the one thing the on-screen caption
 * exists to prevent.
 */
export function ReportExport(props: ReportExportProps) {
  const { filename, columns, rows, disabled = false, caption } = props
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
    >
      <Button
        size="small"
        startIcon={<MdiIcon path={mdiDownloadOutline.path} size={0.8} />}
        disabled={disabled}
        onClick={() =>
          downloadTextFile(filename, 'text/csv', csvDocument(columns, rows()))
        }
      >
        {'Export CSV'}
      </Button>
      {caption ? (
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
      ) : null}
    </Stack>
  )
}
ReportExport.displayName = 'ReportExport'

export default ReportExport
