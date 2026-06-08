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

// export type LinkElementProps = LinkHTMLAttributes<HTMLLinkElement>
export type LinkElementProps = JSX.IntrinsicElements['link']
export type MakeLinkElementsConfig = Array<[
  rel?: LinkElementProps['rel'],
  href?: LinkElementProps['href'],
  other?: Partial<LinkElementProps>
]>

export function makeLinkElements(items: MakeLinkElementsConfig): JSX.Element[] {
  return items.map((item, key) => {
    const [rel, href, other] = item
    const {...rest} = {...other}
    return (
      <link
        key={rest.key ?? rest.id ?? key}
        rel={rel}
        href={href}
        {...rest}
      />
    )
  })
}
export default makeLinkElements
