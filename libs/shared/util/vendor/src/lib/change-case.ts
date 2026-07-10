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

export {
  /**
   * camelCase("string"); //=> "string"
   * camelCase("dot.case"); //=> "dotCase"
   * camelCase("PascalCase"); //=> "pascalCase"
   * camelCase("version 1.2.10"); //=> "version_1_2_10"
   * camelCase("version 12", { mergeAmbiguousCharacters: true }); //=> "version12"
   */
  camelCase,
  /**
   * capitalCase("string"); //=> "String"
   * capitalCase("dot.case"); //=> "Dot Case"
   * capitalCase("PascalCase"); //=> "Pascal Case"
   * capitalCase("version 1.2.10"); //=> "Version 1 2 10"
   */
  capitalCase,
  /**
   * dotCase("string"); //=> "string"
   * dotCase("dot.case"); //=> "dot.case"
   * dotCase("PascalCase"); //=> "pascal.case"
   * dotCase("version 1.2.10"); //=> "version.1.2.10"
   */
  dotCase,
  /**
   * constantCase("string"); //=> "STRING"
   * constantCase("dot.case"); //=> "DOT_CASE"
   * constantCase("PascalCase"); //=> "PASCAL_CASE"
   * constantCase("version 1.2.10"); //=> "VERSION_1_2_10"
   */
  constantCase,
  /**
   * kebabCase("string"); //=> "string"
   * kebabCase("dot.case"); //=> "dot-case"
   * kebabCase("PascalCase"); //=> "pascal-case"
   * kebabCase("version 1.2.10"); //=> "version-1-2-10"
   */
  kebabCase,
  /**
   * noCase("string"); //=> "string"
   * noCase("dot.case"); //=> "dot case"
   * noCase("PascalCase"); //=> "pascal case"
   * noCase("version 1.2.10"); //=> "version 1 2 10"
   */
  noCase,
  /**
   * pascalCase("string"); //=> "String"
   * pascalCase("dot.case"); //=> "DotCase"
   * pascalCase("PascalCase"); //=> "PascalCase"
   * pascalCase("version 1.2.10"); //=> "Version_1_2_10"
   * pascalCase("version 12", { mergeAmbiguousCharacters: true }); //=> "Version12"
   */
  pascalCase,
  /**
   * pascalSnakeCase("string"); //=> "String"
   * pascalSnakeCase("dot.case"); //=> "Dot_Case"
   * pascalSnakeCase("version 1.2.10"); //=> "Version_1_2_10"
   */
  pascalSnakeCase,
  /**
   * pathCase("string"); //=> "string"
   * pathCase("dot.case"); //=> "dot/case"
   * pathCase("PascalCase"); //=> "pascal/case"
   * pathCase("version 1.2.10"); //=> "version/1/2/10"
   */
  pathCase,
  /**
   * sentenceCase("string"); //=> "String"
   * sentenceCase("dot.case"); //=> "Dot case"
   * sentenceCase("PascalCase"); //=> "Pascal case"
   * sentenceCase("version 1.2.10"); //=> "Version 1 2 10"
   */
  sentenceCase,
  /**
   * snakeCase("string"); //=> "string"
   * snakeCase("dot.case"); //=> "dot_case"
   * snakeCase("PascalCase"); //=> "pascal_case"
   * snakeCase("version 1.2.10"); //=> "version_1_2_10"
   */
  snakeCase,
  /**
   * trainCase("string"); //=> "String"
   * trainCase("dot.case"); //=> "Dot-Case"
   * trainCase("PascalCase"); //=> "Pascal-Case"
   * trainCase("version 1.2.10"); //=> "Version-1-2-10"
   */
  trainCase,
  split,
  splitSeparateNumbers,
  type Options as ChangeCaseOptions,
} from 'change-case'

// change-case v5 renamed paramCase -> kebabCase and headerCase -> trainCase;
// re-export the old names for existing consumers of this wrapper.
export { kebabCase as paramCase, trainCase as headerCase } from 'change-case'

export * as ChangeCase from 'change-case'
