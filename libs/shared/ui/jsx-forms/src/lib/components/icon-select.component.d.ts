/**
 * @license
 * Copyright 2026 Aglyn LLC
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
import { type HTMLAttributes } from 'react';
declare const classKeys: import("@aglyn/shared-ui-theme").ClassKeyMap<"button" | "label" | "root" | "selected" | "collapse" | "icon" | "opener" | "preview" | "collapseInner" | "gridListWrapper" | "gridList", "AglynIconSelect">;
export interface IconSelectProps extends HTMLAttributes<HTMLDivElement> {
    initialValue?: string;
    classes?: Partial<typeof classKeys>;
}
declare const IconSelectComponent: import("react").ForwardRefExoticComponent<IconSelectProps & import("react").RefAttributes<any>>;
export default IconSelectComponent;
