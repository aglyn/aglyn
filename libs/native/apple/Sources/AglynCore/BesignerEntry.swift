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

  private static func bareOf(_ path: String) -> String {
    let noFragment = path.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    return String(noFragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
  }
}
