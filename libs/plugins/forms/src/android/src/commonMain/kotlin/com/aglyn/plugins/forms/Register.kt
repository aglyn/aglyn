package com.aglyn.plugins.forms

import com.aglyn.pluginhost.NativePluginRegistrar
import com.aglyn.pluginhost.ScreenLayout

/**
 * The Forms plugin's native registration: the same ids its
 * `mobile.contributes` declares in plugins.config.json. The site's forms
 * beside the picked one, a quick action, and the console's Forms pages
 * opening natively. A form's submissions are the Inbox plugin's screens.
 */
fun registerFormsNative(r: NativePluginRegistrar) {
  r.screen(FORMS_LIST_SCREEN, title = "Forms", requiresSite = true, icon = "dynamic_form", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    FormsScreen(context, initialFormId = params["form"])
  }
  r.screen(FORMS_FORM_SCREEN, title = "Form", requiresSite = true, icon = "dynamic_form", layout = ScreenLayout.LIST_DETAIL) { context, params ->
    FormsScreen(context, initialFormId = params["form"] ?: params["formId"])
  }
  r.quickAction("forms.open", title = "Forms", icon = "dynamic_form", order = 30, requiresSite = true, screen = FORMS_LIST_SCREEN)
  r.deepLink("forms.page", path = "/forms", screen = FORMS_LIST_SCREEN)
  r.deepLink("forms.record", path = "/forms/:formId", screen = FORMS_FORM_SCREEN)
}
