// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// How the app's web view enters and leaves the Besigner (AGL-3850).
///
/// The web view never loads a Besigner page directly. It opens the console's
/// `/auth/besigner?continue=<path>`, which signs the web view in from the
/// session cookie the app minted and only then moves on to the editor; a
/// Besigner page loaded straight from the cookie met a signed-out web view
/// and was sent to the web sign-in page first.
///
/// Leaving goes the other way: whatever the Besigner navigates to that is not
/// the editor (its back arrow, its logo, a console link) returns the person to
/// the app's own screens instead of showing a console page in the web view.
public enum BesignerEntry {
  /// The console page that signs the web view in, then opens the Besigner.
  public static let path = "/auth/besigner"

  /// The sign-in wall's pages: the web view reaching one means the session it was opened with has ended.
  static let authWall = ["/signin", "/signup", "/sso", "/signout", "/verify-email", "/account-recovery", "/reset-password"]

  /// The entry page for a Besigner `path`, or nil when `path` is not a Besigner page.
  public static func url(origin: String, besignerPath: String) -> URL? {
    guard DeepLinks.isBesignerPath(besignerPath) else { return nil }
    var components = URLComponents()
    components.path = path
    components.queryItems = [URLQueryItem(name: "continue", value: besignerPath)]
    // `URLComponents` leaves `/` and `?` bare inside a query value; the console reads either form.
    guard let query = components.percentEncodedQuery?
      .replacingOccurrences(of: "/", with: "%2F").replacingOccurrences(of: "?", with: "%3F")
    else { return nil }
    var base = origin
    while base.hasSuffix("/") { base.removeLast() }
    return URL(string: "\(base)\(path)?\(query)")
  }

  /// Where a main-frame navigation from the editor at `current` to `next` leaves the person.
  public enum Exit: Equatable, Sendable {
    /// Another Besigner page, or the entry page: it shows in the web view.
    case stay
    /// Back to the app's screen the Besigner was opened from.
    case leave
    /// Back to the app, then to the app's own screen for this console path.
    case open(String)
    /// The web view reached the sign-in wall: its session ended.
    case sessionEnded
  }

  /// Decides a navigation inside the web view. `current` and `next` are whole console paths.
  public static func exit(from current: String, to next: String) -> Exit {
    let bare = bareOf(next)
    if bare == path { return .stay }
    if authWall.contains(where: { bare == $0 || bare.hasPrefix($0 + "/") }) { return .sessionEnded }
    guard DeepLinks.isBesignerPath(next) else { return .open(next) }
    // The editor's own back arrow goes to the page's read-only view: in the app that is the screen it came from.
    let editor = bareOf(current)
    if editor.hasSuffix("/besigner") {
      let document = String(editor.dropLast("/besigner".count))
      if bare == document + "/view" { return .leave }
    }
    return .stay
  }

  /// The product token the web view adds to its user agent (AGL-3894).
  ///
  /// The console reads `AglynApp/<version> (<platform>)` to leave out what a
  /// browser tab needs and an app screen does not: the web notification
  /// prompt, the editor's back arrow, the unread count and brand in the page
  /// title. It is there from the first request, whichever page the view opens
  /// first. Presentation only: the console never grants anything on it.
  public static let userAgentProduct = "AglynApp"

  /// `AglynApp/<version> (<platform>)`.
  public static func userAgentMarker(version: String, platform: String) -> String {
    let shown = version.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "")
    return "\(userAgentProduct)/\(shown.isEmpty ? "0" : shown) (\(platform))"
  }

  /// The web view's `applicationNameForUserAgent`: WebKit's own (`Mobile/15E148`
  /// on iOS, which pages read as "a phone") kept, the marker after it.
  public static func applicationNameForUserAgent(base: String?, version: String, platform: String) -> String {
    let marker = userAgentMarker(version: version, platform: platform)
    let kept = (base ?? "").trimmingCharacters(in: .whitespaces)
    if kept.contains("\(userAgentProduct)/") { return kept }
    return kept.isEmpty ? marker : "\(kept) \(marker)"
  }

  /// This build's marker platform.
  public static var userAgentPlatform: String {
    #if os(macOS)
      "macos"
    #else
      "ios"
    #endif
  }

  /// This build's version, for the marker.
  public static var appVersion: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
  }

  private static func bareOf(_ path: String) -> String {
    let noFragment = path.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    return String(noFragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
  }
}
