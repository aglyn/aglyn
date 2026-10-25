// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// When the in-app Besigner's loading state steps aside for the editor (AGL-4002).
///
/// The cover lifts only on the editor's own painted signal: its app bar's wordmark mounted, the page loaded, and no
/// console loading overlay over it. A slow load never uncovers a blank or half-drawn editor. Past
/// `stillOpeningAfter` the cover says it is still opening and offers to try again, and keeps waiting for the signal.
public enum BesignerReveal {
  public enum Phase: Equatable, Sendable {
    /// The loading state, as the screen opens.
    case opening
    /// Still the loading state, now saying it is taking longer and offering to start again.
    case stillOpening
    /// The editor has painted: the web view shows.
    case shown
  }

  /// How long the plain loading state shows before it says it is still opening.
  public static let stillOpeningAfter: Duration = .seconds(12)

  /// True on the page once the editor has painted: the Besigner wordmark (`#aglyn-besigner-logo-full`, which only the
  /// editor's app bar mounts) is in the page, the document has loaded, and no console loading overlay (`LoadingModal`,
  /// its top progress bar `.progress-bar-top`) shows over it. The wordmark only has to be mounted, not visible: the
  /// editor's compact bar (an iPad split or a phone) hides it with `display: none`, and requiring it on screen held the
  /// cover over a drawn editor there.
  public static let paintedScript = """
    (() => {
      const shows = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      if (!document.getElementById('aglyn-besigner-logo-full') || document.readyState !== 'complete') return false;
      return ![...document.querySelectorAll('.progress-bar-top')].some(shows);
    })()
    """

  /// Whether `path` is an editor page: a Besigner path, not the sign-in hand-off in front of it.
  public static func onEditor(path: String) -> Bool {
    !path.hasPrefix(BesignerEntry.path) && DeepLinks.isBesignerPath(path)
  }

  /// The phase after `elapsed` since the screen started opening, given where the page is and whether it has painted.
  public static func phase(elapsed: Duration, path: String, painted: Bool) -> Phase {
    if onEditor(path: path) && painted { return .shown }
    return elapsed >= stillOpeningAfter ? .stillOpening : .opening
  }
}
