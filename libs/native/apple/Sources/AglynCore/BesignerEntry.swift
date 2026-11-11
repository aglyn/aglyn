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
    // Each editor's own back control (AGL-4056): a page's goes to its `/view`, a plugin document's to the
    // document (`…/forms/f1`), a layout's, component's, template's or email's to its list. In the app every one of them
    // is the screen the Besigner was opened from.
    if isBackDestination(bare, of: bareOf(current)) { return .leave }
    guard DeepLinks.isBesignerPath(next) else { return .open(next) }
    return .stay
  }

  /// The DOM id of the editor's own back control (AGL-4056). In the app the editor has no native head and no Done: that
  /// control is the one way out, and Esc, ⌘[, the title bar's Back and the back gesture all press it, so whatever it
  /// does first runs for every one of them. It goes to the document's `/view`, which `exit` reads as `.leave`.
  public static let backControlID = "aglyn-besigner-back"

  /// Presses the editor's back control; the page answers whether it had one.
  public static let backScript =
    "(function(){var b=document.getElementById('\(backControlID)');if(!b)return false;b.click();return true})()"

  /// Where leaving the editor returns to (AGL-4056). After the document switcher moved the web view from the editor it
  /// `opened` to another document's (`current`), the place the current one's back control went (`back`), for the app
  /// to open as its own screen; nil while it is still the document it opened, which returns to the screen that opened
  /// it. A `back` the app has no screen for falls back to that screen too.
  public static func returnPath(opened: String, current: String, back: String) -> String? {
    guard let now = documentOf(current), now != documentOf(opened) else { return nil }
    return back
  }

  /// The document an editor path edits: the path without its `/besigner` (and a version, which the switcher may move
  /// between), or nil for a path that is not an editor.
  private static func documentOf(_ path: String) -> String? {
    var parts = segments(bareOf(path))
    guard parts.last == "besigner" else { return nil }
    parts.removeLast()
    if parts.count >= 2, parts[parts.count - 2] == "versions" { parts.removeLast(2) }
    return "/" + parts.joined(separator: "/")
  }

  /// Whether `path` is where the back control of the editor at `editor` goes: the document's `/view`, or a page above
  /// the editor inside its site (or the staff console), never the workspace or site home the logo opens.
  static func isBackDestination(_ path: String, of editor: String) -> Bool {
    let mine = segments(editor)
    guard mine.last == "besigner" else { return false }
    if path == "/" + mine.dropLast().joined(separator: "/") + "/view" { return true }
    let theirs = segments(path)
    guard theirs.count >= 2, theirs.count < mine.count, Array(mine.prefix(theirs.count)) == theirs else { return false }
    // `/<org>/hosts` and `/<org>/hosts/<site>` are the site's home, never an editor's way back.
    if theirs.count <= 3, theirs[1] == "hosts" { return false }
    return true
  }

  private static func segments(_ path: String) -> [String] {
    path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
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
    AppVersion.current
  }

  private static func bareOf(_ path: String) -> String {
    let noFragment = path.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first ?? ""
    return String(noFragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")
  }
}
