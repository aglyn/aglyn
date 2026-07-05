/**
 * @license
 * Copyright 2021 Aglyn LLC
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

export type Transform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

export interface Transition {
  property: string;
  easing: string;
  duration: number;
}

export const CSS = Object.freeze({
  Translate: {
    toString(transform: Transform | null): string | undefined {
      if (!transform) {
        return undefined;
      }

      const x = transform.x ? Math.round(transform.x) : 0
      const y = transform.y ? Math.round(transform.y) : 0

      return `translate3d(${x}px, ${y}px, 0)`;
    },
  },
  Scale: {
    toString(transform: Transform | null): string | undefined {
      if (!transform) {
        return undefined;
      }

      const {scaleX, scaleY} = transform;

      return `scaleX(${scaleX}) scaleY(${scaleY})`;
    },
  },
  Transform: {
    toString(transform: Transform | null): string | undefined {
      if (!transform) {
        return undefined;
      }

      return [
        CSS.Translate.toString(transform),
        CSS.Scale.toString(transform),
      ].join(' ');
    },
  },
  Transition: {
    toString({property, duration, easing}: Transition) {
      return `${property} ${duration}ms ${easing}`;
    },
  },
})
