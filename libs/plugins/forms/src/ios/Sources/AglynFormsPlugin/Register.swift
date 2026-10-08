// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynPluginHost
import SwiftUI

public let formsListScreen = "forms.list"
public let formsFormScreen = "forms.form"

/// The submissions screen the Inbox plugin contributes; opened by id, never imported.
let inboxSubmissionsScreen = "inbox.submissions"

/// The Forms plugin's native registration: the same ids its
/// `mobile.contributes` declares in plugins.config.json (the Kotlin registrar
/// names the same ones). The site's forms beside the picked one, a quick
/// action, and the console's Forms pages opening natively. A form's
/// submissions are the Inbox plugin's screens.
@MainActor
public func registerFormsNative(_ r: NativePluginRegistrar) {
  r.screen(formsListScreen, title: "Forms", requiresSite: true, icon: FormsSymbols.form) { context, params in
    FormsScreen(context: context, initialFormID: params["form"])
  }
  r.screen(formsFormScreen, title: "Form", requiresSite: true, icon: FormsSymbols.form) { context, params in
    FormsScreen(context: context, initialFormID: params["form"] ?? params["formId"])
  }
  r.quickAction(
    "forms.open", title: "Forms", icon: FormsSymbols.form, order: 30, screen: formsListScreen, requiresSite: true)
  r.deepLink("forms.page", path: "/forms", screen: formsListScreen)
  r.deepLink("forms.record", path: "/forms/:formId", screen: formsFormScreen)
}

enum FormsSymbols {
  static let form = "list.bullet.clipboard"
  static let question = "textformat"
  static let version = "clock.arrow.circlepath"
  static let besigner = "paintbrush.pointed"
  static let submissions = "tray.full"
}
