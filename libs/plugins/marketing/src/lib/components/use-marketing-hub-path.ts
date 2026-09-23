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
/**
 * The Marketing console's URL, re-exported under the name the cards import.
 *
 * One implementation lives beside the Emails hub's in `use-emails-hub-path`;
 * this module is the address the Marketing cards have always imported it
 * from, kept so neither name can drift into a second copy of the rule.
 */
export { useMarketingHubPath, useMarketingHubPath as default } from './use-emails-hub-path'
