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

/** The plugin id: `plugins.config.json`, `org.enabledPlugins`, every registry. */
export const WAIVERS_PLUGIN_ID = 'waivers'

/**
 * The entitlement every surface stands on (AGL-4042). A waiver is part of
 * selling a visit — a ride pass, a camp spot, a rental — so it rides the key
 * the store itself does, on every plan that sells. No price of its own.
 */
export const WAIVERS_ENTITLEMENT = 'commerce'

/**
 * Where this plugin keeps what it keeps, under `orgs/{orgId}`. Written and
 * read by the plugin's server half only; the Firestore rules refuse every
 * client, staff and the owner included, because a signature holds a signer's
 * date of birth, a minor's name and a drawn signature.
 *
 * - `waivers/{waiverId}`: one waiver the merchant wrote, for one site — its
 *   words, checkboxes, minors switch, validity, status and version.
 * - `waivers/{waiverId}/versions/{version}`: the words as they stood at each
 *   version, so a signature always points at the text it agreed to.
 * - `waiverSignatures/{signatureId}`: one signing, online, at the window or on
 *   paper, with its audit trail.
 */
export const WAIVERS_COLLECTIONS = {
  waivers: 'waivers',
  versions: 'versions',
  signatures: 'waiverSignatures',
} as const

/**
 * Private Storage, beneath the org prefix that org erasure sweeps. Never the
 * media library: no download token is ever minted for these objects, and the
 * Storage rules refuse every client; the console reads them through the
 * plugin's own gated route.
 */
export function waiverSignatureImagePath(orgId: string, signatureId: string): string {
  return `orgs/${orgId}/waiverSignatures/${signatureId}/signature.png`
}

export function waiverPaperPhotoPath(orgId: string, signatureId: string, extension: 'jpg' | 'png'): string {
  return `orgs/${orgId}/waiverSignatures/${signatureId}/paper.${extension}`
}

/** The email a signer receives with their signed copy: a catalog key in `tenant-emails.ts`. */
export const WAIVERS_EMAIL_KEYS = {
  signed: 'waiver-signed',
} as const

/** The permissions this plugin declares (AGL-435 registry). */
export const WAIVERS_PERMISSIONS = {
  /** Write, publish and retire waivers; void a signature. */
  manage: 'manageWaivers',
  /** Read signatures (personal data), take one at the window, record a paper one. */
  collect: 'collectWaivers',
} as const

/** The source word a signer's CRM capture carries. */
export const WAIVERS_CONTACT_SOURCE = 'waiver'

/**
 * The CRM capture door this plugin declares (core `registerPluginContactSource`):
 * what a contact's source, and a timeline entry from a signature, read as.
 */
export const WAIVERS_CONTACT_SOURCE_DECLARATION = {
  source: WAIVERS_CONTACT_SOURCE,
  label: 'Waiver signed',
  openLabel: 'Open waiver',
} as const

/**
 * The register's check-in zone this plugin fills (AGL-4043 hosts it in the
 * commerce plugin), named by id only: a plugin never imports another.
 */
export const WAIVERS_CHECK_IN_SLOT = 'posCheckIn'
export const WAIVERS_CHECK_IN_WIDGET_ID = 'waivers-check-in-status'

/** The console's public signing page, beneath `/kiosk/waivers`. */
export const WAIVERS_PUBLIC_PAGE_PATH = '/sign'

/** Every route this plugin serves, under `/api/`. */
export const WAIVERS_API_ROUTES = {
  /** Console: a site's waivers (GET), or save one (POST). */
  templates: 'waivers/templates',
  /** Console: one waiver with its version history (GET), publish, retire (POST). */
  template: 'waivers/template',
  /** Console: a site's signatures, searched (GET; `format=csv` for a spreadsheet). */
  signatures: 'waivers/signatures',
  /** Console: one signature's record (GET), or void it (POST). */
  signature: 'waivers/signature',
  /** Console: the signed copy as a PDF. */
  signaturePdf: 'waivers/signature-pdf',
  /** Console: the drawn signature or the paper photo. */
  signatureFile: 'waivers/signature-file',
  /** Console: sign at the window, on a tablet handed over by staff. */
  signAtWindow: 'waivers/sign-at-window',
  /** Console: record a waiver signed on paper, with a photo of the page. */
  paper: 'waivers/paper',
  /** Console: one person's waiver status for a day. */
  status: 'waivers/status',
  /** Public: a site's published waivers, or one of them to sign. */
  publicWaiver: 'waivers/public',
  /** Public: sign one. */
  publicSign: 'waivers/sign',
} as const
