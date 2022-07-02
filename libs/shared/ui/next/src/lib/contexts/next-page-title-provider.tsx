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

import { useSubscribable } from '@aglyn/shared-ui-jsx'
import {
  $pageTitle,
  type PageTitleObject,
  setScreenName,
  setScreenNumber,
  setScreenSeparator,
  setScreenSuffix,
  setScreenTitle,
} from '@aglyn/shared-util-dom'
import Head from 'next/head'
import { createContext, useContext, useEffect, useMemo } from 'react'

export interface NextPageTitleContextValue {
  title: JSX.Node
  setScreenNumber(value?: number): void
  setScreenName(value: JSX.Node, page?: number): void
  setScreenSuffix(value: JSX.Node): void
  setScreenSeparator(value: string): void
  setScreenTitle(values: PageTitleObject)
}

export const NextPageTitleContext = createContext<NextPageTitleContextValue>({
  title: 'Aglyn App',
  setScreenName,
  setScreenSeparator,
  setScreenSuffix,
  setScreenNumber,
  setScreenTitle,
})

export const useNextPageTitleContext = () => {
  return useContext(NextPageTitleContext)
}

export const useNextPageTitle = (values: PageTitleObject) => {
  const { title, setScreenTitle } = useNextPageTitleContext()

  useEffect(() => {
    setScreenTitle(values)
  }, [values, setScreenTitle])

  return title
}

export interface NextPageTitleProps extends PageTitleObject {
  children?: JSX.Children
}

export const NextPageTitle = (props: NextPageTitleProps) => {
  const { children, ...rest } = props

  useNextPageTitle(rest)

  return <>{children}</>
}

export interface NextPageTitleContextProps {
  children?: JSX.Children
}

const NextPageTitleProvider = (props: NextPageTitleContextProps) => {
  const { children } = props

  const title = useSubscribable($pageTitle)
  const state = useMemo(
    () => ({
      title,
      setScreenName,
      setScreenSeparator,
      setScreenSuffix,
      setScreenNumber,
      setScreenTitle,
    }),
    [title],
  )

  return (
    <NextPageTitleContext.Provider value={state}>
      <Head>
        <title>{title}</title>
      </Head>
      {children}
    </NextPageTitleContext.Provider>
  )
}
NextPageTitleProvider.displayName = 'NextPageTitleComponent'
NextPageTitleProvider.aglyn = true
NextPageTitleProvider.defaultProps = {
  initialScreen: 'Welcome',
  initialSuffix: 'My App',
  initialSeparator: ' – ',
}

export { NextPageTitleProvider }
export default NextPageTitleProvider
