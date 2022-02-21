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

import {APP_TENANT, IS_PRODUCTION} from '@aglyn/shared-data-enums'
import {NextEmotionAppComponent, type NextEmotionAppComponentProps} from '@aglyn/shared-ui-next'
import {Fragment, useEffect, useMemo} from 'react'


export interface _AppProps<Props, InitialProps>
  extends NextEmotionAppComponentProps<Props, InitialProps> {}

function _App<Props, InitialProps>(props: _AppProps<Props, InitialProps>) {
  const {NextAppWrapperProps, ...rest} = props
  const {
    metaElements: wrapperMetaElements,
    linkElements: wrapperLinkElements,
    headChildren: wrapperHeadChildren,
    documentTitle: wrapperDocumentTitle,
    ...nextAppWrapperProps
  } = NextAppWrapperProps || {}
  const documentTitle = useMemo(
    () => wrapperDocumentTitle || APP_TENANT.META_TITLE,
    [wrapperDocumentTitle],
  )
  const headChildren = useMemo(
    () => (
      <Fragment>
        {!IS_PRODUCTION ? null : <Fragment></Fragment>}
        {wrapperHeadChildren}
      </Fragment>
    ),
    [wrapperHeadChildren],
  )
  const metaElements: any = useMemo(
    () => [
      ['viewport', 'width=device-width, initial-scale=1'],
      ['description', APP_TENANT.META_DESCRIPTION],
      ...(wrapperMetaElements || []),
    ],
    [wrapperMetaElements],
  )
  const linkElements = useMemo(() => [...(wrapperLinkElements || [])], [wrapperLinkElements])

  useEffect(() => {}, [])

  return (
    <NextEmotionAppComponent
      NextAppWrapperProps={{
        documentTitle,
        headChildren,
        metaElements,
        linkElements,
        ...nextAppWrapperProps,
      }}
      {...rest}
    />
  )
}
_App.displayName = '_App'
export default _App
