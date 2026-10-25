// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

#if os(iOS) && canImport(ProximityReader)
  import ProximityReader
  import UIKit

  /// Apple's own merchant education for Tap to Pay on iPhone (iOS 18's
  /// `ProximityReaderDiscovery`): how to take contactless cards, phones and
  /// watches, and PIN entry, kept current and localized by Apple. It needs no
  /// reader SDK, so any screen can open it: after Apple's terms are accepted,
  /// and from the readers screen at any time (Apple 4.1 to 4.3).
  @MainActor
  public enum TapToPayEducation {
    /// Opens it over the app's front screen; the words of what went wrong, or nil once it was shown.
    @discardableResult
    public static func present() async -> String? {
      guard #available(iOS 18.0, *) else { return TapToPayNotice.needsUpdate.message }
      guard let front = frontViewController() else { return "Apple’s guide could not open. Try again." }
      do {
        let discovery = ProximityReaderDiscovery()
        let content = try await discovery.content(for: .payment(.howToTap))
        try await discovery.presentContent(content, from: front)
        return nil
      } catch {
        return "Apple’s guide could not open. Check the connection and try again."
      }
    }

    private static func frontViewController() -> UIViewController? {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      let window =
        scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
      var front = window?.rootViewController
      while let presented = front?.presentedViewController { front = presented }
      return front
    }
  }
#endif
