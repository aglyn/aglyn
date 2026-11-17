package com.aglyn.shell

import android.content.Context
import android.content.Intent
import com.aglyn.pluginhost.DeepLinks

/**
 * Hands a console page the app has no screen for straight back to the browser (AGL-4059): the manifest's App Link filter
 * claims every console page and refuses the web-only ones (sign-in, SSO, `/api`, a site's photo link, …), but only
 * Android 15 and later read those refusals, so on an older phone one can still reach the app. True when [intent] was such
 * a link and the browser now has it.
 */
fun Context.handBackWebOnlyLink(intent: Intent?): Boolean {
  val uri = intent?.data ?: return false
  if (intent.action != Intent.ACTION_VIEW) return false
  if (uri.scheme?.lowercase() != "https" && uri.scheme?.lowercase() != "http") return false
  if (DeepLinks.opensInApp(uri.toString())) return false
  // The browser chosen by the person, not whichever app claims the link (this one): resolved through the browser
  // category, so the link cannot come back here.
  val browser = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  browser.selector = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)
  runCatching { startActivity(browser) }
  return true
}
