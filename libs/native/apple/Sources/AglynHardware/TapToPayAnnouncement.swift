// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/*
 * THE TAP TO PAY ON IPHONE ANNOUNCEMENT (Apple's review items 3.1 to 3.3 and 6.2): a full-screen splash after Apple's
 * "Hero" 9x16 in-app tile, in Apple's approved words, shown once to every signed-in person on each device the first
 * time the register is reached, and never during a sale. Its rules live here so they are tested without a screen:
 *
 * - Only a build that offers Tap to Pay on iPhone shows it (`TapToPayIPhone.offered`, `DeviceCardReaders.offersTapToPay`).
 * - Once per person per device, for this edition of the announcement: a later edition shows again.
 * - Never while a sale is in progress (a basket, checkout, or a sheet over the register).
 *
 * The words are Apple's, copied from Apple's Tap to Pay on iPhone marketing copy and legal disclaimers (US), and are
 * never reworded: Apple's review compares them. "Not now" is the app's own.
 */

/// Apple's approved words for the announcement, verbatim.
public enum TapToPayAnnouncementCopy {
  /// Apple's headline: the capability's name, first.
  public static let headline = TapToPayIPhone.title
  /// Apple's subheadline (value proposition).
  public static let subheadline =
    "Accept physical debit and credit cards as well as Apple Pay and other digital wallets. Right on your iPhone."
  /// Apple's call to action, one of its approved ones.
  public static let enable = "Enable now"
  /// Apple's short disclaimer, which leads to the full one.
  public static let termsApply = "Terms apply."
  /// Apple's full disclaimer.
  public static let fullDisclaimer =
    "Tap to Pay on iPhone requires a supported payment app and the latest version of iOS. Update to the latest version by going to Settings > General > Software Update. Some contactless cards may not be accepted by your payment app. Transaction limits may apply. Tap to Pay on iPhone is not available in all markets. For Tap to Pay on iPhone countries and regions, see https://developer.apple.com/tap-to-pay/regions/."
  /// Apple's disclaimer for a communication that mentions Apple Pay (the subheadline does).
  public static let applePayDisclaimer =
    "Apple Pay is a service provided by Apple Payments Services LLC, a subsidiary of Apple Inc. Neither Apple Inc. nor Apple Payments Services LLC is a bank. Any card used in Apple Pay is offered by the card issuer."
  /// Apple's disclaimer for a communication that shows the Contactless Indicator mark (the card in Apple's visual does).
  public static let contactlessIndicatorDisclaimer =
    "The Contactless Indicator mark, consisting of four graduating arcs, is a trademark owned by and used with permission of EMVCo, LLC."
  /// Every disclaimer the terms sheet shows, in Apple's order.
  public static let disclaimers = [fullDisclaimer, applePayDisclaimer, contactlessIndicatorDisclaimer]

  /// The app's own words: closing the announcement.
  public static let notNow = "Not now"
  /// The app's own words: the terms sheet's title and its close button.
  public static let termsTitle = "Terms"
  public static let done = "Done"
  /// The app's own words: Settings › Help's row that opens the announcement again.
  public static let helpRowSubtitle = "Accept cards and digital wallets on this iPhone"
  /// The image slot's description for VoiceOver (the visual's own content, not a claim).
  public static let visualDescription = "A card held to an iPhone to pay"

  /// The name of Apple's core visual in the app's asset catalog. Apple's image is not kept in the public repository;
  /// a build without it lays the screen out with the slot empty.
  public static let visualAsset = "TapToPayHero"
  /// The visual's width over its height, as exported from Apple's template (2160 x 2009, transparent rows trimmed).
  public static let visualAspect: Double = 2160.0 / 2009.0
}

/// Where the announcement remembers who on this device has seen it.
public protocol TapToPayAnnouncementStore: AnyObject {
  func seen(_ key: String) -> Bool
  func markSeen(_ key: String)
}

/// This device's own memory of it.
public final class UserDefaultsAnnouncementStore: TapToPayAnnouncementStore {
  private let defaults: UserDefaults

  public init(_ defaults: UserDefaults = .standard) { self.defaults = defaults }

  public func seen(_ key: String) -> Bool { defaults.bool(forKey: key) }
  public func markSeen(_ key: String) { defaults.set(true, forKey: key) }
}

/// The show-once rule.
public struct TapToPayAnnouncement {
  /// This edition of the announcement. A new edition (new words or visual Apple asks to show) is shown to everyone again.
  public static let edition = "2026-11"

  private let store: TapToPayAnnouncementStore

  public init(store: TapToPayAnnouncementStore = UserDefaultsAnnouncementStore()) { self.store = store }

  /// The device's memory key for one signed-in person and this edition.
  public static func key(uid: String) -> String { "aglyn.tapToPayAnnouncement.\(edition).\(uid)" }

  /// Whether the register shows it now: a build that offers Tap to Pay on iPhone, a signed-in person who has not seen
  /// this edition on this device, and no sale in progress.
  public func shouldShow(offered: Bool, uid: String?, saleInProgress: Bool) -> Bool {
    guard offered, !saleInProgress, let uid, !uid.isEmpty else { return false }
    return !store.seen(Self.key(uid: uid))
  }

  /// Records that this person has seen it on this device (when it opens, so a closed app never shows it twice).
  public func markShown(uid: String) {
    guard !uid.isEmpty else { return }
    store.markSeen(Self.key(uid: uid))
  }
}

/// The screen that sets Tap to Pay on iPhone up, named by the plugin that owns it (Commerce's Card readers), so a
/// screen outside the plugin (Settings › Help) can send "Enable now" there. Nil where no plugin provides one.
@MainActor
public enum TapToPaySetUpScreen {
  public static var id: String?
  /// The parameters that start the setup on arrival, as the Set up Tap to Pay on iPhone row does.
  public static let params: [String: String] = ["setUp": "tapToPay"]
  /// Whether a screen was opened with `params`.
  public static func startsSetUp(_ params: [String: String]) -> Bool { params["setUp"] == "tapToPay" }
}
