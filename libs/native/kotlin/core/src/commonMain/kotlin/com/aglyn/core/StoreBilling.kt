package com.aglyn.core

import com.aglyn.contracts.Contracts

/**
 * Whether this build may take or start a payment to Aglyn, and what it shows where it may not (the owner's decision of
 * 2026-11-19). Google Play takes payment for subscriptions and business software only through Play Billing, and the
 * apps take them through Stripe, so a store build (the release build type) leaves out every control that charges or
 * starts a charge, and debug builds keep them all. The Apple kit's `StoreBilling.swift` answers the same two questions.
 *
 * 1. [buying]: may this build take or start a payment to Aglyn? It comes from the build alone (`IN_APP_BILLING`, read
 *    into [AglynConfig.inAppBilling]): nothing remote (Remote Config, Firestore, a route's answer) may turn it on, since
 *    buying switched on after review would be a hidden feature.
 * 2. [webBillingLink]: where buying is off, may the screen link to the console's billing page? Never, for now: Play
 *    allows a link to another way to pay only once the app is enrolled in its external offers program (Play Console ›
 *    Settings › External payments program), which the owner has not decided. Until [WEB_BILLING_LINK_ALLOWED] is flipped
 *    the screen says [noBillingNote], which names no address and no other place to buy.
 *
 * Debug builds only: `adb shell am start … --ez storeBuild true` draws the store build's screens (buying off), through
 * [overrideForDebug]. A release build never applies it, and it can only turn buying off.
 */
object StoreBilling {
  /** The intent extra that draws a store build's screens in a debug build. */
  const val STORE_BUILD_EXTRA = "storeBuild"

  /** Whether a store build may link to web billing: not until the Play Console enrolment is decided. */
  const val WEB_BILLING_LINK_ALLOWED = false

  private var configured = false
  private var storeBuildOverride = false

  /** Whether this build may take or start a payment to Aglyn. Off until the app configures it. */
  var buying: Boolean = false
    private set

  /** Where buying is off, whether the screen may link to the console's billing page. */
  val webBillingLink: Boolean get() = WEB_BILLING_LINK_ALLOWED

  /** The link's label, one wording for both apps (the contracts' `NATIVE_WEB_BILLING_LINK_LABEL`). */
  val webBillingLinkLabel: String get() = Contracts.nativeWebBillingLinkLabel

  /** The sentence shown where no link is allowed (the contracts' `NATIVE_NO_IN_APP_BILLING_NOTE`). */
  val noBillingNote: String get() = Contracts.nativeNoInAppBillingNote

  /** Whether a build may buy: the build's own setting, turned off by the store-build override; never turned on by it. */
  fun decide(configured: Boolean, storeBuildOverride: Boolean): Boolean = configured && !storeBuildOverride

  /** Sets [buying] from the build, when the app's services start. */
  fun configure(config: AglynConfig) {
    configured = config.inAppBilling
    buying = decide(configured, storeBuildOverride)
  }

  /** Debug builds only ([debuggable] is `BuildConfig.DEBUG`): draws the store build's screens while [storeBuild] holds. */
  fun overrideForDebug(storeBuild: Boolean, debuggable: Boolean) {
    if (!debuggable) return
    storeBuildOverride = storeBuild
    buying = decide(configured, storeBuildOverride)
  }

  /**
   * The console page the link opens in the device's browser: the workspace's billing page, through `/signin`, which the
   * apps never claim as an App Link (`NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS`), so the browser keeps it. A browser that is
   * signed in goes straight on to billing (`?continue=`); one that is not signs in first.
   */
  fun webBillingUrl(consoleOrigin: String, orgSlug: String): String? {
    val slug = orgSlug.trim()
    if (!Regex("^[A-Za-z0-9_-]+$").matches(slug)) return null
    return "${consoleOrigin.trimEnd('/')}/signin?continue=/$slug/billing"
  }

  /** For tests: back to an unconfigured build. */
  internal fun reset() {
    configured = false
    storeBuildOverride = false
    buying = false
  }
}
