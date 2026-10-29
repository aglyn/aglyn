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

import {
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * WHETHER A MEMBER'S FILE FITS THE WORKSPACE'S STORAGE (AGL-4096).
 *
 * A file a member attaches outside the media library (a quote's proof) is
 * kept by the shared upload pipeline (`@aglyn/tenant-data-admin/server/visitor-upload`)
 * and counted toward the workspace's storage like a library file. Before it
 * is taken it meets the same storage band a library upload does: refused on
 * a plan that does not bill storage past its allowance, taken and billed on
 * one that does, refused past a storage cap the workspace set.
 *
 * The band and its rules live with the app that holds the media ingress, so
 * this is a contract: the console registers the one implementation at boot
 * (`instrumentation.ts`), the same direction as `core.media-ingest`.
 *
 * Only a MEMBER's file is asked about. A file a site's visitor sends (a
 * customer's artwork on a quote, a form's file) is never refused for the
 * business's storage; it is counted all the same. A process that registered
 * nothing (the site app) answers `null` from {@link uploadStorageGate}, and
 * the file is taken.
 */

export interface UploadStorageGateInput {
  /** The site the file is kept on; its workspace's storage is the one asked. */
  hostId: string
  /** The file's size in bytes. */
  bytes: number
}

/** Why the file does not fit, as the member is told. */
export interface UploadStorageRefusal {
  status: number
  error: string
  /** The storage gate's machine code, as the media library's upload routes answer it. */
  code: string
}

export interface UploadStorageGate {
  /** `null` when the file may be kept; otherwise why it may not. */
  check(input: UploadStorageGateInput): Promise<UploadStorageRefusal | null>
}

/** One implementation: the app that holds the storage band. */
export const UPLOAD_STORAGE_GATE = definePluginServiceContract<UploadStorageGate>(
  'core.upload-storage-gate',
  { multiple: false },
)

export function registerUploadStorageGate(
  gate: UploadStorageGate,
  options?: { pluginId?: string },
): void {
  if (typeof gate?.check !== 'function') throw new Error('an upload storage gate needs check')
  registerPluginService(UPLOAD_STORAGE_GATE, gate, {
    ...(options?.pluginId ? { pluginId: options.pluginId } : {}),
  })
}

/** The registered gate, or `null` in a process that registered none. */
export function uploadStorageGate(): UploadStorageGate | null {
  return resolvePluginService(UPLOAD_STORAGE_GATE) ?? null
}
