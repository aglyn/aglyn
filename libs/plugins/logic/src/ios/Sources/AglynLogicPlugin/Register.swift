// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

/// The Logic plugin's native registration: the same ids its `mobile.contributes` declares in plugins.config.json (the Kotlin
/// registrar names the same ones). The site's Functions & Variables page (`/logic`), a function's editor, and a quick action.
@MainActor
public func registerLogicNative(_ r: NativePluginRegistrar) {
  r.screen(logicPageScreen, title: "Functions & Variables", requiresSite: true, icon: "function") { context, params in
    LogicScreen(context: context, initialTab: params["tab"])
  }
  r.screen(logicFunctionScreen, title: "Function", requiresSite: true, icon: "function") { context, params in
    FunctionEditorScreen(context: context, functionID: params["function"] ?? params["functionId"])
  }
  r.quickAction("logic.open", title: "Logic", icon: "function", order: 45, screen: logicPageScreen, requiresSite: true)
  r.deepLink("logic.page", path: "/logic", screen: logicPageScreen)
}
