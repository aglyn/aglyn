/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-realm-host-exports.mjs
 *
 * The realm plugin surface of `@aglyn/aglyn` (AGL-3392): what a signed
 * bundle reads from core. Imported only by the lazily loaded host module.
 */
/* eslint-disable */

import * as m0 from "../aglyn"
import * as m1 from "../app-utils/binding-tokens"
import * as m2 from "../app-utils/enabled-plugins-context"
import * as m3 from "../app-utils/functions"
import * as m4 from "../app-utils/node-identity"
import * as m5 from "../app-utils/plugin-connection-record"
import * as m6 from "../app-utils/screen-link-context-value"
import * as m7 from "../app-utils/site-context"
import * as m8 from "../app-utils/variables"
import * as m9 from "../foundation/constants/components"
import * as m10 from "../foundation/constants/shared"
import * as m11 from "../foundation/definitions/components.types"
import * as m12 from "./feature-plugins"
import * as m13 from "../types/nodes"

export const AGLYN_HOST_SURFACE: Readonly<Record<string, unknown>> = Object.freeze({
  Aglyn: m0.Aglyn,
  aglyn: m0.aglyn,
  canvas: m0.canvas,
  components: m0.components,
  emitter: m0.emitter,
  logger: m0.logger,
  plugins: m0.plugins,
  FUNCTION_TOKEN_PATTERN: m1.FUNCTION_TOKEN_PATTERN,
  MISSING_BINDING_LABEL: m1.MISSING_BINDING_LABEL,
  NAME_TOKEN_PATTERN: m1.NAME_TOKEN_PATTERN,
  VARIABLE_ID_TOKEN_PATTERN: m1.VARIABLE_ID_TOKEN_PATTERN,
  bindingTokenNeedsDeep: m1.bindingTokenNeedsDeep,
  displayBindingTokens: m1.displayBindingTokens,
  editableBindingTokens: m1.editableBindingTokens,
  formatFunctionIdToken: m1.formatFunctionIdToken,
  formatVariableIdToken: m1.formatVariableIdToken,
  keyById: m1.keyById,
  nodesReferenceBinding: m1.nodesReferenceBinding,
  normalizeBindingTokens: m1.normalizeBindingTokens,
  rewriteBindingTokensDeep: m1.rewriteBindingTokensDeep,
  textReferencesBinding: m1.textReferencesBinding,
  CATEGORY_REQUIRED_CAPABILITY: m2.CATEGORY_REQUIRED_CAPABILITY,
  EnabledPluginsContext: m2.EnabledPluginsContext,
  isCategoryCapabilityEnabled: m2.isCategoryCapabilityEnabled,
  isFromEnabledPlugin: m2.isFromEnabledPlugin,
  isSwitchedOffForRenderedSite: m2.isSwitchedOffForRenderedSite,
  useEnabledPlugins: m2.useEnabledPlugins,
  FUNCTION_BUILTIN_NAMES: m3.FUNCTION_BUILTIN_NAMES,
  FUNCTION_MAX_OPERATIONS: m3.FUNCTION_MAX_OPERATIONS,
  evaluateExpression: m3.evaluateExpression,
  evaluateHostFunction: m3.evaluateHostFunction,
  expressionIdentifiers: m3.expressionIdentifiers,
  expressionSyntaxError: m3.expressionSyntaxError,
  formatFunctionParameterOptions: m3.formatFunctionParameterOptions,
  functionReferencedNames: m3.functionReferencedNames,
  parseFunctionParameterOptions: m3.parseFunctionParameterOptions,
  NodeIdentityContext: m4.NodeIdentityContext,
  useNodeId: m4.useNodeId,
  usePluginConnectionRecord: m5.usePluginConnectionRecord,
  ScreenLinkContext: m6.ScreenLinkContext,
  PREVIEW_REFUSED_STATUS: m7.PREVIEW_REFUSED_STATUS,
  PREVIEW_WRITE_BLOCKED_EVENT: m7.PREVIEW_WRITE_BLOCKED_EVENT,
  SiteContext: m7.SiteContext,
  isPreviewRefusal: m7.isPreviewRefusal,
  useSite: m7.useSite,
  useSiteFetch: m7.useSiteFetch,
  HOST_VARIABLE_TYPE_LABELS: m8.HOST_VARIABLE_TYPE_LABELS,
  VARIABLE_NAME_PATTERN: m8.VARIABLE_NAME_PATTERN,
  attachFunctionDefinitions: m8.attachFunctionDefinitions,
  formatVariableValue: m8.formatVariableValue,
  functionGlobals: m8.functionGlobals,
  hasBindings: m8.hasBindings,
  isVariableName: m8.isVariableName,
  resolveBindings: m8.resolveBindings,
  resolveNodesBindings: m8.resolveNodesBindings,
  COMPONENT_CATEGORY_ORDER: m9.COMPONENT_CATEGORY_ORDER,
  ComponentCategory: m9.ComponentCategory,
  REUSABLE_COMPONENT_CATEGORY: m9.REUSABLE_COMPONENT_CATEGORY,
  REUSABLE_EMAIL_BLOCK_CATEGORY: m9.REUSABLE_EMAIL_BLOCK_CATEGORY,
  FEATURE_FLAG: m10.FEATURE_FLAG,
  RICH_TEXT_COMMANDS: m10.RICH_TEXT_COMMANDS,
  FieldComponentType: m11.FieldComponentType,
  FieldValidatorType: m11.FieldValidatorType,
  LinealDirectiveFlag: m11.LinealDirectiveFlag,
  CONSOLE_HOST_GATED_WIDGET_SLOTS: m12.CONSOLE_HOST_GATED_WIDGET_SLOTS,
  CONSOLE_SEARCH_LOAD_POINT: m12.CONSOLE_SEARCH_LOAD_POINT,
  CONSOLE_STAFF_WIDGET_SLOTS: m12.CONSOLE_STAFF_WIDGET_SLOTS,
  CONSOLE_WIDGET_SLOTS: m12.CONSOLE_WIDGET_SLOTS,
  MUI_BUNDLE_ID: m12.MUI_BUNDLE_ID,
  THEME_PRESETS_LOAD_POINT: m12.THEME_PRESETS_LOAD_POINT,
  defineUiFeatureBundle: m12.defineUiFeatureBundle,
  isConsoleHostGatedWidgetSlot: m12.isConsoleHostGatedWidgetSlot,
  isConsoleStaffWidgetSlot: m12.isConsoleStaffWidgetSlot,
  listConsoleExtensions: m12.listConsoleExtensions,
  listConsoleNavItems: m12.listConsoleNavItems,
  listConsoleOrgNavItems: m12.listConsoleOrgNavItems,
  listConsoleProviders: m12.listConsoleProviders,
  listConsolePublicPages: m12.listConsolePublicPages,
  listConsoleSearchSources: m12.listConsoleSearchSources,
  listConsoleStaffPages: m12.listConsoleStaffPages,
  listConsoleThemePresets: m12.listConsoleThemePresets,
  listConsoleWidgets: m12.listConsoleWidgets,
  normalizeConsolePublicPath: m12.normalizeConsolePublicPath,
  registerConsoleExtension: m12.registerConsoleExtension,
  resolveConsoleOrgPluginPage: m12.resolveConsoleOrgPluginPage,
  resolveConsolePluginPage: m12.resolveConsolePluginPage,
  resolveConsolePublicPage: m12.resolveConsolePublicPage,
  resolveConsoleStaffPage: m12.resolveConsoleStaffPage,
  unregisterConsoleExtension: m12.unregisterConsoleExtension,
  NodeType: m13.NodeType,
})
