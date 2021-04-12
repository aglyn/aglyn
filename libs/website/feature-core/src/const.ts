/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { version as pkgJsonVer } from '../../../../package.json'


export const PKG_VERSION = JSON.stringify(pkgJsonVer ?? 'N/A')
export const PRODUCTION = process.env.NODE_ENV === 'production'

export enum EventFlag {
  INSTANCE_CREATED = 'website:app:created-instance',
  SET_MODULE = 'website:app:set-module',
  SET_COMPONENT = 'website:app:set-component',
}

export enum RestrictType {
  LIMIT = 'limit',
  DISALLOW = 'disallow',
}
