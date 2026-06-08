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
export type IconId = string;
export type IconPath = string;
export type IconTag = string;
export type IconName = string;
export type IconAliases = IconId[];
export type IconTags = IconTag[];
export type Icons = Icon[];
export type Icon = {
    id: IconId;
    name: IconName;
    path: IconPath;
    as: IconAliases;
    tags: IconTags;
};
export type IdParam = IconId[] | IconId;
export type IconResponse<T extends IdParam> = T extends any[] ? Icon[] : Icon;
