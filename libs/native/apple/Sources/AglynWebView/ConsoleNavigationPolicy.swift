// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// What the console web view does with a navigation (AGL-4002).
///
/// The console's own pages load in the web view, and a path the app refuses (anything but the Besigner) goes back to
/// the app's own screen. A page off the console goes to the system browser only when a person activated a link to
/// it: a page script or a redirect that leaves the console is dropped. The console's once-a-day editor-hint bounce
/// (`window.location.assign` to `console.aglyn.app`) had opened the person's browser beside the in-app Besigner.
public enum ConsoleNavigationPolicy {
  public enum Decision: Equatable, Sendable {
    /// Load it in the web view.
    case allow
    /// A console path the app shows natively: hand it back and stay put.
    case handBack(String)
    /// A link the person clicked that leaves the console: the system browser.
    case systemBrowser(URL)
    /// A page script or redirect leaving the console: dropped, never the system browser.
    case ignore(URL)
  }

  /// The schemes the system may open for a link the person clicked.
  static let systemSchemes: Set<String> = ["http", "https", "mailto", "tel"]

  /// Decides a navigation the web view is about to make.
  /// - Parameters:
  ///   - mainFrame: whether it replaces the page (a frame inside the page loads what it likes).
  ///   - linkActivated: whether a person clicked a link to it (`WKNavigationType.linkActivated`).
  ///   - allowsPath: the console paths the main frame may show; nil allows every console path.
  @MainActor
  public static func decide(
    _ url: URL?, trustedOrigins: [String], mainFrame: Bool, linkActivated: Bool,
    allowsPath: (@MainActor (String) -> Bool)?
  ) -> Decision {
    guard let url else { return .ignore(URL(string: "about:blank")!) }
    if url.scheme == "about" { return .allow }
    if BridgeProtocol.isTrusted(url.absoluteString, trustedOrigins: trustedOrigins) {
      if mainFrame, let allowsPath {
        let path = consolePath(url)
        if !allowsPath(path) { return .handBack(path) }
      }
      return .allow
    }
    guard mainFrame, systemSchemes.contains(url.scheme?.lowercased() ?? "") else { return .allow }
    return linkActivated ? .systemBrowser(url) : .ignore(url)
  }

  /// Decides a new window the page asked for (`target=_blank`, `window.open`), which WebKit raises only on a gesture:
  /// a console page loads in this web view, a page off the console opens in the system browser.
  public static func decideNewWindow(_ url: URL?, trustedOrigins: [String]) -> Decision {
    guard let url else { return .ignore(URL(string: "about:blank")!) }
    if BridgeProtocol.isTrusted(url.absoluteString, trustedOrigins: trustedOrigins) { return .allow }
    return systemSchemes.contains(url.scheme?.lowercased() ?? "") ? .systemBrowser(url) : .ignore(url)
  }

  /// The path part of a console URL, with its query.
  public static func consolePath(_ url: URL) -> String {
    (url.path.isEmpty ? "/" : url.path) + (url.query.map { "?\($0)" } ?? "")
  }
}
