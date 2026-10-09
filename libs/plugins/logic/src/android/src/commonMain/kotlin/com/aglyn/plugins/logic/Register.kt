package com.aglyn.plugins.logic

import com.aglyn.pluginhost.NativePluginRegistrar

/**
 * The Logic plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The site's
 * Functions & Variables page (`/logic`), a function's editor, and a quick
 * action.
 */
fun registerLogicNative(r: NativePluginRegistrar) {
  r.screen(LOGIC_PAGE_SCREEN, title = "Functions & Variables", requiresSite = true, icon = "functions") { context, params ->
    LogicScreen(context, initialTab = params["tab"])
  }
  r.screen(LOGIC_FUNCTION_SCREEN, title = "Function", requiresSite = true, icon = "functions") { context, params ->
    FunctionEditorScreen(context, functionId = params["function"] ?: params["functionId"])
  }
  r.quickAction("logic.open", title = "Logic", icon = "functions", order = 45, requiresSite = true, screen = LOGIC_PAGE_SCREEN)
  r.deepLink("logic.page", path = "/logic", screen = LOGIC_PAGE_SCREEN)
}
