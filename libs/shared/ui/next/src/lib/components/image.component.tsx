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

import {base64Encode} from '@aglyn/shared-util-tools'
import NextImage, {
  type ImageLoaderProps as NextImageLoaderProps,
  type ImageProps as NextImageProps,
} from 'next/image'


export type ImageComponentLoaderProps = NextImageLoaderProps
export type ImageComponentLoader = (resolverProps: ImageComponentLoaderProps) => string

export interface ImageComponentProps extends NextImageProps {
  loader?: ImageComponentLoader
  shimmer?: boolean
}

function ImageComponent(props: ImageComponentProps): JSX.Element {
  const {width, height, shimmer, ...rest} = props
  const blurDataURL = !shimmer ? undefined : (
    ImageComponent.shimmerBlurDataUrl(
      ImageComponent.shimmer(width, height)
    )
  )

  return (
    <NextImage
      width={width}
      height={height}
      placeholder={!shimmer ? undefined : 'blur'}
      blurDataURL={blurDataURL}
      {...rest}
    />
  )
}
ImageComponent.displayName = 'ImageComponent'
ImageComponent.aglyn = true
ImageComponent.shimmer = (w?: number | string, h?: number | string) => {
  return `
<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <linearGradient id="g">
      <stop stop-color="#333" offset="20%" />
      <stop stop-color="#222" offset="50%" />
      <stop stop-color="#333" offset="70%" />
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="#333" />
  <rect id="r" width="${w}" height="${h}" fill="url(#g)" />
  <animate xlink:href="#r" attributeName="x" from="-${w}" to="${w}" dur="1s" repeatCount="indefinite"  />
</svg>`
}
ImageComponent.shimmerBlurDataUrl = (shimmer?: string) => {
  return shimmer
    ? `data:image/svg+xml;base64,${base64Encode(shimmer)}`
    : undefined
}

export {ImageComponent, ImageComponent as Image}
export default ImageComponent
