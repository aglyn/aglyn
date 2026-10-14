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
import * as m5 from "../app-utils/screen-link-context-value"
import * as m6 from "../app-utils/site-context"
import * as m7 from "../app-utils/variables"
import * as m8 from "../foundation/constants/components"
import * as m9 from "../foundation/constants/shared"
import * as m10 from "../foundation/definitions/components.types"
import * as m11 from "./feature-plugins"
import * as m12 from "../types/nodes"

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
  ScreenLinkContext: m5.ScreenLinkContext,
  PREVIEW_REFUSED_STATUS: m6.PREVIEW_REFUSED_STATUS,
  PREVIEW_WRITE_BLOCKED_EVENT: m6.PREVIEW_WRITE_BLOCKED_EVENT,
  SiteContext: m6.SiteContext,
  isPreviewRefusal: m6.isPreviewRefusal,
  useSite: m6.useSite,
  useSiteFetch: m6.useSiteFetch,
  HOST_VARIABLE_TYPE_LABELS: m7.HOST_VARIABLE_TYPE_LABELS,
  VARIABLE_NAME_PATTERN: m7.VARIABLE_NAME_PATTERN,
  attachFunctionDefinitions: m7.attachFunctionDefinitions,
  formatVariableValue: m7.formatVariableValue,
  functionGlobals: m7.functionGlobals,
  hasBindings: m7.hasBindings,
  isVariableName: m7.isVariableName,
  resolveBindings: m7.resolveBindings,
  resolveNodesBindings: m7.resolveNodesBindings,
  COMPONENT_CATEGORY_ORDER: m8.COMPONENT_CATEGORY_ORDER,
  ComponentCategory: m8.ComponentCategory,
  REUSABLE_COMPONENT_CATEGORY: m8.REUSABLE_COMPONENT_CATEGORY,
  REUSABLE_EMAIL_BLOCK_CATEGORY: m8.REUSABLE_EMAIL_BLOCK_CATEGORY,
  FEATURE_FLAG: m9.FEATURE_FLAG,
  RICH_TEXT_COMMANDS: m9.RICH_TEXT_COMMANDS,
  FieldComponentType: m10.FieldComponentType,
  FieldValidatorType: m10.FieldValidatorType,
  LinealDirectiveFlag: m10.LinealDirectiveFlag,
  CONSOLE_HOST_GATED_WIDGET_SLOTS: m11.CONSOLE_HOST_GATED_WIDGET_SLOTS,
  CONSOLE_SEARCH_LOAD_POINT: m11.CONSOLE_SEARCH_LOAD_POINT,
  CONSOLE_STAFF_WIDGET_SLOTS: m11.CONSOLE_STAFF_WIDGET_SLOTS,
  CONSOLE_WIDGET_SLOTS: m11.CONSOLE_WIDGET_SLOTS,
  MUI_BUNDLE_ID: m11.MUI_BUNDLE_ID,
  THEME_PRESETS_LOAD_POINT: m11.THEME_PRESETS_LOAD_POINT,
  defineUiFeatureBundle: m11.defineUiFeatureBundle,
  isConsoleHostGatedWidgetSlot: m11.isConsoleHostGatedWidgetSlot,
  isConsoleStaffWidgetSlot: m11.isConsoleStaffWidgetSlot,
  listConsoleExtensions: m11.listConsoleExtensions,
  listConsoleNavItems: m11.listConsoleNavItems,
  listConsoleOrgNavItems: m11.listConsoleOrgNavItems,
  listConsoleProviders: m11.listConsoleProviders,
  listConsolePublicPages: m11.listConsolePublicPages,
  listConsoleSearchSources: m11.listConsoleSearchSources,
  listConsoleStaffPages: m11.listConsoleStaffPages,
  listConsoleThemePresets: m11.listConsoleThemePresets,
  listConsoleWidgets: m11.listConsoleWidgets,
  normalizeConsolePublicPath: m11.normalizeConsolePublicPath,
  registerConsoleExtension: m11.registerConsoleExtension,
  resolveConsoleOrgPluginPage: m11.resolveConsoleOrgPluginPage,
  resolveConsolePluginPage: m11.resolveConsolePluginPage,
  resolveConsolePublicPage: m11.resolveConsolePublicPage,
  resolveConsoleStaffPage: m11.resolveConsoleStaffPage,
  unregisterConsoleExtension: m11.unregisterConsoleExtension,
  NodeType: m12.NodeType,
})
