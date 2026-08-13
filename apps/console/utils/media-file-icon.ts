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

import type { SvgIconComponent } from '@mui/icons-material'
import AudiotrackIcon from '@mui/icons-material/Audiotrack'
import DataObjectIcon from '@mui/icons-material/DataObject'
import DescriptionIcon from '@mui/icons-material/Description'
import FolderZipIcon from '@mui/icons-material/FolderZip'
import ImageIcon from '@mui/icons-material/Image'
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile'
import MovieIcon from '@mui/icons-material/Movie'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import SlideshowIcon from '@mui/icons-material/Slideshow'
import TableChartIcon from '@mui/icons-material/TableChart'

/** What a DAM tile shows for a file it cannot draw a thumbnail of. */
export interface MediaFileTypeIcon {
  /** MUI icon component — the console's existing icon set, no new dep. */
  Icon: SvgIconComponent
  /** Short caption, e.g. `ZIP`. Never the raw 70-character office MIME. */
  label: string
}

/**
 * Exact content-type matches (AGL-1463).
 *
 * The upload allowlist today is images, mp4/webm/quicktime video, PDF and
 * ZIP — see `/api/media/upload`, `SIGNED_UPLOAD_MAX_BYTES` and the library's
 * `accept` attribute. The office/text entries below are deliberately wider
 * than that allowlist: those types are not accepted yet, but a DAM asset can
 * also arrive by import or by a widened allowlist later, and an icon that is
 * merely unused costs nothing where a missing one is a blank card.
 */
const EXACT_TYPE_ICONS: Record<string, MediaFileTypeIcon> = {
  'application/pdf': { Icon: PictureAsPdfIcon, label: 'PDF' },

  // Archives. `normalizeUploadContentType` folds the Windows alias to
  // `application/zip` on the way in, but documents written before that fold
  // (AGL-1317) still carry the alias, so both are mapped.
  'application/zip': { Icon: FolderZipIcon, label: 'ZIP' },
  'application/x-zip-compressed': { Icon: FolderZipIcon, label: 'ZIP' },
  'application/gzip': { Icon: FolderZipIcon, label: 'GZIP' },
  'application/x-tar': { Icon: FolderZipIcon, label: 'TAR' },
  'application/x-7z-compressed': { Icon: FolderZipIcon, label: '7Z' },
  'application/vnd.rar': { Icon: FolderZipIcon, label: 'RAR' },

  // Word processing.
  'application/msword': { Icon: DescriptionIcon, label: 'DOC' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    Icon: DescriptionIcon,
    label: 'DOCX',
  },
  'application/rtf': { Icon: DescriptionIcon, label: 'RTF' },

  // Spreadsheets.
  'application/vnd.ms-excel': { Icon: TableChartIcon, label: 'XLS' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    Icon: TableChartIcon,
    label: 'XLSX',
  },
  'text/csv': { Icon: TableChartIcon, label: 'CSV' },

  // Presentations.
  'application/vnd.ms-powerpoint': { Icon: SlideshowIcon, label: 'PPT' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    Icon: SlideshowIcon,
    label: 'PPTX',
  },

  // Text-ish payloads.
  'text/plain': { Icon: DescriptionIcon, label: 'TXT' },
  'text/markdown': { Icon: DescriptionIcon, label: 'MD' },
  'application/json': { Icon: DataObjectIcon, label: 'JSON' },
}

/** Family fall-backs, tried in order when no exact match hits. */
const PREFIX_TYPE_ICONS: ReadonlyArray<[string, SvgIconComponent]> = [
  ['image/', ImageIcon],
  ['video/', MovieIcon],
  ['audio/', AudiotrackIcon],
  ['text/', DescriptionIcon],
]

/** Short type label from a content type, e.g. `image/png` → `PNG`. */
function subtypeLabel(value: string): string {
  const subtype = value.split('/')[1] ?? ''
  // `image/svg+xml` → SVG; a suffix is never the interesting half.
  return subtype ? subtype.split('+')[0].toUpperCase() : 'FILE'
}

/**
 * The icon and caption for a stored asset's content type (AGL-1463).
 *
 * **This function never returns nothing.** The DAM grid used to special-case
 * PDF and hand everything else to an `<img>`, so a ZIP — the one non-image
 * type the org library actually holds today — rendered as a broken image,
 * i.e. an empty card. A per-type map with no floor would only move that
 * boundary to the next unmapped type, so an unrecognised (or absent) type
 * resolves to a generic document icon rather than falling through.
 */
export function mediaFileTypeIcon(
  contentType: string | undefined,
): MediaFileTypeIcon {
  const value = String(contentType ?? '')
    .trim()
    // `text/csv; charset=utf-8` is a legal stored value.
    .split(';')[0]
    .toLowerCase()

  const exact = EXACT_TYPE_ICONS[value]
  if (exact) return exact

  for (const [prefix, Icon] of PREFIX_TYPE_ICONS) {
    if (value.startsWith(prefix)) return { Icon, label: subtypeLabel(value) }
  }

  return { Icon: InsertDriveFileIcon, label: subtypeLabel(value) }
}
