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

//     ____  _________________   ____________________  _   _______
//    / __ \/ ____/ ____/  _/ | / /  _/_  __/  _/ __ \/ | / / ___/
//   / / / / __/ / /_   / //  |/ // /  / /  / // / / /  |/ /\__ \
//  / /_/ / /___/ __/ _/ // /|  // /  / / _/ // /_/ / /|  /___/ /
// /_____/_____/_/   /___/_/ |_/___/ /_/ /___/\____/_/ |_//____/
// 👇

export * from './definitions/components.types'
// One postal address + one phone format, shared by the personal profile, the
// org billing address and the Stripe customer (AGL-1133). The failure this
// prevents is a phone number stored three ways in three collections.
export * from './definitions/contact.types'
export * from './definitions/organization.types'
export * from './definitions/shared'
// `HOST_UNPERSISTED_FIELDS` is a VALUE for the same reason its org twin below
// is: it states which `hosts/{hostId}` keys are never fields. It is exported
// here so the write boundary can enforce that declaration at runtime
// (AGL-1429), not only so the rules coverage guard can read it.
export {
  // The four error slots as a VALUE (AGL-2092). Exported because their COUNT
  // is now the bound on `kind: 'error'` exemptions (`ERROR_SCREEN_MAX_PER_HOST`)
  // as well as the console card's picker list — one list, so the pickers and
  // the bound cannot drift apart.
  HOST_ERROR_SCREEN_SLOTS,
  HOST_UNPERSISTED_FIELDS,
  HostEntityType,
  HostRedirectParams,
  HostScreenStatus,
  HostScreenVisibility,
  HostViewFormat,
  HostViewType,
} from './definitions/platform.types'
// AglynScreenVersion/AglynLayoutVersion are exported (specialized with the
// SDK's NodeSchema) from ../types/screen instead of this generic form.
// Org billing vocabulary (see definitions/org-billing.types.ts and the
// glossary). The two ownership maps are VALUES, not types: they are the
// declared client-writable/unpersisted partition of `orgs/{orgId}` that the
// AGL-1355 coverage guard checks the Firestore rules against.
export {
  ORG_CLIENT_WRITABLE_FIELDS,
  ORG_UNPERSISTED_FIELDS,
} from './definitions/org-billing.types'
export type {
  AglynOrgBilling,
  OrgBandwidthCap,
  OrgBrandingProfile,
  OrgDiscount,
  OrgEntitlements,
  OrgFeatureFlags,
  OrgPlan,
  OrgSeatAddons,
  OrgSubscription,
  OrgUid,
} from './definitions/org-billing.types'
export type {
  AglynDocument,
  AglynHost,
  AglynHostComponent,
  AglynHostComponentVersion,
  AglynHostMedia,
  AglynHostMediaFolder,
  AglynHostTheme,
  AglynLayout,
  AglynRedirect,
  AglynScreen,
  AglynTemplate,
  AglynUser,
  ComponentDefUid,
  HostAnnouncementBar,
  HostErrorScreens,
  HostErrorScreenSlot,
  HostPopup,
  HostMediaUid,
  HostPath,
  HostUid,
  LayoutUid,
  ProjectNumber,
  ProjectUid,
  PublishSchedule,
  RedirectUid,
  ReusableComponentIcon,
  ReusableComponentProp,
  ReusableComponentPropType,
  ScopeToken,
  ScreenSlug,
  ScreenUid,
  TemplateKind,
  TemplatePlaceholder,
  TemplateSource,
  TemplateUid,
  UserUid,
  VersionUid,
} from './definitions/platform.types'

//    __________  _   ________________    _   _____________
//   / ____/ __ \/ | / / ___/_  __/   |  / | / /_  __/ ___/
//  / /   / / / /  |/ /\__ \ / / / /| | /  |/ / / /  \__ \
// / /___/ /_/ / /|  /___/ // / / ___ |/ /|  / / /  ___/ /
// \____/\____/_/ |_//____//_/ /_/  |_/_/ |_/ /_/  /____/
// 👇

export * from './constants/_internal'
export * from './constants/app'
export * from './constants/canvas'
export * from './constants/components'
export * from './constants/shared'
export * from './constants/symbol'
