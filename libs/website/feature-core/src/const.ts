/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { version } from '../../../../package.json'


export const PKG_VERSION = JSON.stringify(version ?? 'N/A')
export const PRODUCTION = process.env.NODE_ENV === 'production'

export enum EventKey {
  INSTANCE_CREATED = 'site.created-singleton-instance',
  COMPONENT_REGISTERED = 'site.registered-site-component',
}

export enum RestrictType {
  LIMIT = 'limit',
  DISALLOW = 'disallow',
}
