/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { type GridProps as MuiGridProps } from '@mui/material/Grid';
import { type ComponentType, type ElementType, type ForwardRefExoticComponent, type PropsWithoutRef, type RefAttributes } from 'react';
export interface GridWrappedMergeProps {
    FieldGridProps?: Partial<MuiGridProps>;
}
export type GridWrappedComponentProps<D extends ElementType = any, P = EmptyObj> = PropsWithoutRef<P & GridWrappedMergeProps> & RefAttributes<D>;
export interface GridWrappedExoticComponent<D extends ElementType = any, P = EmptyObj> extends ForwardRefExoticComponent<GridWrappedComponentProps<D, P>> {
}
export declare function withGridItem<P>(WrappedComponent: ComponentType<P>): GridWrappedExoticComponent<any, P>;
