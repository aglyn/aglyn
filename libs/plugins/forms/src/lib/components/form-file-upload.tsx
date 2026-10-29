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

import * as Aglyn from '@aglyn/aglyn'
import { mdiPaperclip } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import { forwardRef, lazy, Suspense } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

/*
 * THE FILE UPLOAD FIELD (AGL-4098): files a person attaches to a form, such as
 * a logo with a quote request.
 *
 * A form element like MUI's: it carries a `name`, a label and `required`, and
 * the form sends what it posts. Its files go up as they are picked, through
 * the shared visitor upload, under the pending key its Form minted; the form
 * then sends them by id, and their names are the field's answer.
 *
 * This shell is all a page loads until the field draws: its body, with the
 * upload code, is a chunk of its own (`form-file-upload-body.tsx`).
 *
 * The component id is persisted in documents; never rename it. The core's
 * form reader restates it (`FORM_PLUGIN_ANSWER_ELEMENTS`).
 */
export const FILE_UPLOAD_ID: Aglyn.ComponentId = 'formFileUpload'

export interface FormFileUploadProps {
  /** What the files' names are sent as. */
  name?: string
  /** The question, above the button. */
  label?: string
  /** A line under it: what to attach. */
  helperText?: string
  required?: boolean
  /**
   * The kinds of file taken, comma-separated (`images,pdf`); every kind when
   * empty. Picked from a list, never typed.
   */
  kinds?: string
  /** At most how many files, 1 to 10. */
  maxFiles?: number | string
}

const FormFileUploadBody = lazy(() => import('./form-file-upload-body'))

/** Files a person attaches to a form; sent with it by name. */
export const FormFileUpload = forwardRef<HTMLDivElement, FormFileUploadProps>((props, ref) => (
  <Suspense
    fallback={
      <Box sx={{ py: 1 }}>
        <CircularProgress size={20} aria-label="Loading the file field" />
      </Box>
    }
  >
    <FormFileUploadBody ref={ref} {...props} />
  </Suspense>
))
FormFileUpload.displayName = 'AglynFormFileUpload'

export const formFileUploadSchema: Aglyn.ComponentSchema<FormFileUploadProps> = {
  $id: FILE_UPLOAD_ID,
  pluginId: BUNDLE_ID,
  displayName: 'File upload',
  description:
    'Lets a person attach files to the form, such as a logo or a sketch. The files arrive with the submission in your Inbox.',
  category: Aglyn.ComponentCategory.FORMS,
  icon: { path: mdiPaperclip.path, sx: { color: 'info.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'label',
      label: 'Label',
      description: 'The question above the button, such as “Your logo or artwork”.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'name',
      label: 'Field name',
      description: 'The name the files are listed under in the Inbox and exports.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'helperText',
      label: 'Hint',
      description: 'A line under the label saying what to attach.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'required',
      label: 'Required?',
      description: 'The form can’t be sent until at least one file is attached.',
      component: Aglyn.FieldComponentType.SWITCH,
    },
    {
      name: 'kinds',
      label: 'Kinds of file',
      description: 'Which files it takes. Each file can be up to 25 MB.',
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: 'images,pdf,design', label: 'Images, PDFs and design files' },
        { value: 'images', label: 'Images only (PNG, JPEG, WebP, GIF)' },
        { value: 'pdf', label: 'PDFs only' },
        { value: 'design', label: 'Design files only (SVG, AI, EPS, PSD, TIFF)' },
        { value: 'images,pdf', label: 'Images and PDFs' },
        { value: 'images,design', label: 'Images and design files' },
        { value: 'pdf,design', label: 'PDFs and design files' },
      ],
    },
    {
      name: 'maxFiles',
      label: 'Most files',
      description: 'How many files a person can attach, up to 10.',
      component: Aglyn.FieldComponentType.SELECT,
      options: Array.from({ length: 10 }, (_, index) => ({
        value: String(index + 1),
        label: index === 0 ? '1 file' : `${index + 1} files`,
      })),
    },
  ],
}

export const formFileUploadPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(FILE_UPLOAD_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'File upload',
    pluginId: BUNDLE_ID,
    description: 'Lets a person attach files, such as a logo or artwork',
    category: Aglyn.ComponentCategory.FORMS,
    icon: { path: mdiPaperclip.path, sx: { color: 'info.main' } },
    data: {
      $id: null,
      componentId: FILE_UPLOAD_ID,
      pluginId: BUNDLE_ID,
      props: { name: 'files', label: 'Files', kinds: 'images,pdf,design', maxFiles: '10' },
    },
  },
]

export default FormFileUpload
