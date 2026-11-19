// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

#if canImport(StoreKit)
  import StoreKit
#endif

/// Whether this build may take or start a payment to Aglyn, and what it shows where it may not (the owner's decision of
/// 2026-11-19). The App Store takes payment for plans, add-ons, credits and paid listings only through in-app purchase
/// (guideline 3.1.1), and the apps take them through Stripe, so a store build (the Release configuration: TestFlight and
/// the App Store) leaves out every control that charges or starts a charge, and Debug builds keep them all. The Kotlin
/// kit's `StoreBilling.kt` answers the same two questions.
///
/// 1. `buying`: may this build take or start a payment to Aglyn? It comes from the build alone (`AGLYN_IN_APP_BILLING`,
///    read into `AglynConfig.inAppBilling`): nothing remote (Remote Config, Firestore, a route's answer) may turn it on,
///    since buying switched on after review would be a hidden feature (guideline 2.3.1).
/// 2. `webBillingLink`: where buying is off, may the screen link to the console's billing page? Only on the App Store's
///    United States storefront (3.1.1(a)); everywhere else, and wherever the storefront is not known, the screen says
///    `noBillingNote` instead, which names no address and no other place to buy.
///
/// Debug builds only: `-AglynStoreBuild YES` on the launch arguments draws the store build's screens (buying off), and
/// `-AglynStorefront USA` (or any other country code, or `none`) stands in for the storefront StoreKit reports, so both
/// lines can be seen on a simulator. Neither is read by a Release build, and the first can only turn buying off.
public enum StoreBilling {
  /// The launch argument that draws a store build's screens in a Debug build.
  public static let storeBuildArgument = "AglynStoreBuild"
  /// The launch argument that stands in for the storefront in a Debug build.
  public static let storefrontArgument = "AglynStorefront"
  /// The one storefront whose apps may link to another way to pay (guideline 3.1.1(a)): StoreKit's country code.
  public static let linkStorefront = "USA"

  /// Whether this build may take or start a payment to Aglyn. Off until the app configures it.
  nonisolated(unsafe) public private(set) static var buying = false
  /// Where buying is off, whether the screen may link to the console's billing page. Off until the storefront is known.
  nonisolated(unsafe) public private(set) static var webBillingLink = false

  /// The link's label and the sentence shown where no link is allowed, one wording for both apps (the contracts'
  /// `NATIVE_WEB_BILLING_LINK_LABEL` and `NATIVE_NO_IN_APP_BILLING_NOTE`).
  public static var webBillingLinkLabel: String { ContractValues.shared.nativeWebBillingLinkLabel }
  public static var noBillingNote: String { ContractValues.shared.nativeNoInAppBillingNote }

  /// Whether a build may buy: the build's own setting, turned off by the store-build override. The override can only
  /// turn buying off, never on.
  public static func decide(configured: Bool, storeBuildOverride: Bool) -> Bool {
    configured && !storeBuildOverride
  }

  /// Whether a storefront (StoreKit's ISO 3166-1 alpha-3 country code) may show the web billing link: the United
  /// States only, and never an unknown one.
  public static func linkAllowed(storefrontCountry: String?) -> Bool {
    storefrontCountry?.uppercased() == linkStorefront
  }

  /// The console page the link opens in the device's browser: the workspace's billing page, through `/signin`, which the
  /// apps never claim as a universal link (`NATIVE_WEB_ONLY_TOP_LEVEL_SEGMENTS`), so the browser keeps it. A browser
  /// that is signed in goes straight on to billing (`?continue=`); one that is not signs in first.
  public static func webBillingURL(consoleOrigin: String, orgSlug: String) -> URL? {
    let slug = orgSlug.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !slug.isEmpty, slug.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else { return nil }
    let origin = consoleOrigin.hasSuffix("/") ? String(consoleOrigin.dropLast()) : consoleOrigin
    var parts = URLComponents(string: "\(origin)/signin")
    parts?.queryItems = [URLQueryItem(name: "continue", value: "/\(slug)/billing")]
    return parts?.url
  }

  /// Sets `buying` from the build at launch, then `webBillingLink` once StoreKit reports the storefront.
  @MainActor
  public static func configure(_ config: AglynConfig, defaults: UserDefaults = .standard) {
    var storeBuild = false
    #if DEBUG
      storeBuild = defaults.bool(forKey: storeBuildArgument)
    #endif
    buying = decide(configured: config.inAppBilling, storeBuildOverride: storeBuild)
    #if DEBUG
      if let stand = defaults.string(forKey: storefrontArgument) {
        webBillingLink = linkAllowed(storefrontCountry: stand)
        return
      }
    #endif
    Task { webBillingLink = linkAllowed(storefrontCountry: await currentStorefrontCountry()) }
  }

  /// The storefront's country code StoreKit reports, or nil where it reports none (a Mac or simulator with no App Store
  /// account, or no StoreKit).
  public static func currentStorefrontCountry() async -> String? {
    #if canImport(StoreKit)
      return await Storefront.current?.countryCode
    #else
      return nil
    #endif
  }

  /// For tests: sets both answers.
  static func set(buying: Bool, webBillingLink: Bool) {
    self.buying = buying
    self.webBillingLink = webBillingLink
  }
}
