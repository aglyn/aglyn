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

import {APP_WWW, IS_PRODUCTION} from '@aglyn/shared-data-enums'
import type {MakeLinkElementsConfig, MakeMetaElementsConfig} from '@aglyn/shared-ui-jsx'
import {NextEmotionAppComponent, type NextEmotionAppComponentProps} from '@aglyn/shared-ui-next'
import {Fragment, useEffect, useMemo} from 'react'
import HsEmbedScript from '../components/hs-embed-script'
import VisitorQueueScript from '../components/visitor-queue-script'
import {withAppController} from '../lib/aglyn-deprecated/lib/controllers/app-controller'


let app
if (!app) {
  const previewProduction = true
  app = withAppController(IS_PRODUCTION || previewProduction ? {} : {
    authEmulator: 'http://localhost:9099/',
    firestoreEmulator: {host: 'localhost', port: 8080},
  })
}

export interface _AppProps<Props, InitialProps> extends NextEmotionAppComponentProps<Props, InitialProps> {}


function _App<Props, InitialProps>(props: _AppProps<Props, InitialProps>) {
  const {NextAppWrapperProps, ...rest} = props
  const {
    metaElements: wrapperMetaElements,
    linkElements: wrapperLinkElements,
    headChildren: wrapperHeadChildren,
    documentTitle: wrapperDocumentTitle,
    ...nextAppWrapperProps
  } = NextAppWrapperProps || {}
  const documentTitle = useMemo(() => (
    wrapperDocumentTitle || APP_WWW.META_TITLE
  ), [wrapperDocumentTitle])
  const headChildren = useMemo(() => (
    <Fragment>
      {!IS_PRODUCTION ? null : (
        <Fragment>
          <HsEmbedScript />
          <VisitorQueueScript />
        </Fragment>
      )}
      {wrapperHeadChildren}
    </Fragment>
  ), [wrapperHeadChildren])
  const metaElements: MakeMetaElementsConfig = useMemo(() => ([
    ['viewport', 'width=device-width, initial-scale=1'],
    ['description', APP_WWW.META_DESCRIPTION],
    ...wrapperMetaElements || [],
  ]), [wrapperMetaElements])
  const linkElements: MakeLinkElementsConfig = useMemo(() => ([
    ...wrapperLinkElements || [],
  ]), [wrapperLinkElements])

  useEffect(() => {
    if (IS_PRODUCTION) app?.getAnalytics()
  }, [])


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
