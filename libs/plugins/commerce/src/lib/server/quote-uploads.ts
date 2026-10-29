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

import type { VisitorUploadFile, VisitorUploadScope } from '@aglyn/aglyn/app-utils/visitor-upload'
import {
  defaultVisitorUploadDeps,
  deleteVisitorUpload,
  deleteVisitorUploads,
  finalizeVisitorUpload,
  mintVisitorUploadTicket,
  readVisitorUpload,
  sendVisitorUploadFile,
  type VisitorUploadResponse,
} from '@aglyn/tenant-data-admin/server/visitor-upload'

/**
 * The visitor-upload calls a quote's routes make (AGL-4096). The routes reach
 * this module by a dynamic import of it, so the upload pipeline, the bucket
 * and the SVG sanitizer load only when a proof or a customer's artwork is
 * actually sent or served, never with the routes' own modules.
 */
export interface QuoteUploadCalls {
  mint(input: Parameters<typeof mintVisitorUploadTicket>[1]): ReturnType<typeof mintVisitorUploadTicket>
  finalize(input: Parameters<typeof finalizeVisitorUpload>[1]): ReturnType<typeof finalizeVisitorUpload>
  read(scope: VisitorUploadScope, id: string): Promise<VisitorUploadFile | null>
  remove(path: string): Promise<void>
  removeAll(scope: VisitorUploadScope): Promise<void>
  send(res: VisitorUploadResponse, file: Pick<VisitorUploadFile, 'path' | 'name' | 'contentType'>): Promise<void>
}

export function quoteUploadCalls(): QuoteUploadCalls {
  const deps = defaultVisitorUploadDeps()
  return {
    mint: (input) => mintVisitorUploadTicket(deps, input),
    finalize: (input) => finalizeVisitorUpload(deps, input),
    read: (scope, id) => readVisitorUpload(deps, scope, id),
    remove: (path) => deleteVisitorUpload(deps, path),
    removeAll: (scope) => deleteVisitorUploads(deps, scope),
    send: (res, file) => sendVisitorUploadFile(deps, res, file),
  }
}
