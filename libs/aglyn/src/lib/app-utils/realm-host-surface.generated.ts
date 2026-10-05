/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-realm-host-exports.mjs
 *
 * The names each realm host module holds (AGL-3392), for the bundle
 * verifier: a bundle reading any other name from the host is refused,
 * because it would read `undefined` on every site.
 */
/* eslint-disable */

export const REALM_HOST_SURFACE_NAMES: Readonly<
  Record<'aglyn' | 'mui' | 'muiStyles', ReadonlySet<string>>
> = {
  aglyn: new Set(["Aglyn","CATEGORY_REQUIRED_CAPABILITY","COMPONENT_CATEGORY_ORDER","CONSOLE_HOST_GATED_WIDGET_SLOTS","CONSOLE_SEARCH_LOAD_POINT","CONSOLE_STAFF_WIDGET_SLOTS","CONSOLE_WIDGET_SLOTS","ComponentCategory","EnabledPluginsContext","FEATURE_FLAG","FUNCTION_BUILTIN_NAMES","FUNCTION_MAX_OPERATIONS","FUNCTION_TOKEN_PATTERN","FieldComponentType","FieldValidatorType","HOST_VARIABLE_TYPE_LABELS","LinealDirectiveFlag","MISSING_BINDING_LABEL","MUI_BUNDLE_ID","NAME_TOKEN_PATTERN","NodeIdentityContext","NodeType","PREVIEW_REFUSED_STATUS","PREVIEW_WRITE_BLOCKED_EVENT","REUSABLE_COMPONENT_CATEGORY","REUSABLE_EMAIL_BLOCK_CATEGORY","RICH_TEXT_COMMANDS","ScreenLinkContext","SiteContext","THEME_PRESETS_LOAD_POINT","VARIABLE_ID_TOKEN_PATTERN","VARIABLE_NAME_PATTERN","aglyn","attachFunctionDefinitions","bindingTokenNeedsDeep","canvas","components","defineUiFeatureBundle","displayBindingTokens","editableBindingTokens","emitter","evaluateExpression","evaluateHostFunction","expressionIdentifiers","expressionSyntaxError","formatFunctionIdToken","formatFunctionParameterOptions","formatVariableIdToken","formatVariableValue","functionGlobals","functionReferencedNames","hasBindings","isCategoryCapabilityEnabled","isConsoleHostGatedWidgetSlot","isConsoleStaffWidgetSlot","isFromEnabledPlugin","isPreviewRefusal","isSwitchedOffForRenderedSite","keyById","listConsoleExtensions","listConsoleNavItems","listConsoleOrgNavItems","listConsoleProviders","listConsoleSearchSources","listConsoleStaffPages","listConsoleThemePresets","listConsoleWidgets","logger","nodesReferenceBinding","normalizeBindingTokens","parseFunctionParameterOptions","plugins","registerConsoleExtension","resolveBindings","resolveConsoleOrgPluginPage","resolveConsolePluginPage","resolveConsoleStaffPage","resolveNodesBindings","rewriteBindingTokensDeep","textReferencesBinding","unregisterConsoleExtension","useEnabledPlugins","useNodeId","useSite","useSiteFetch"]),
  mui: new Set(["Alert","Box","Button","Card","CardContent","Checkbox","Chip","CircularProgress","Collapse","Divider","FormControl","FormControlLabel","FormHelperText","IconButton","InputAdornment","InputLabel","Link","List","ListItem","ListItemText","MenuItem","Paper","Radio","RadioGroup","Select","Stack","SvgIcon","Switch","Table","TableBody","TableCell","TableHead","TableRow","TextField","Tooltip","Typography","createSvgIcon","useMediaQuery"]),
  muiStyles: new Set(["alpha","css","darken","emphasize","getContrastRatio","keyframes","lighten","styled","useColorScheme","useTheme"]),
}
