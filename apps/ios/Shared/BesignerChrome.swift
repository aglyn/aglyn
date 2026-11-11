// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import SwiftUI

/// The in-app Besigner's chrome (AGL-4056): focus mode on the Mac and iPad, and one way back.
///
/// The editor has no native head: its own bars sit right under the window chrome, and its own back control is the
/// way out. The title bar's Back and ⌘[ press that control (as Esc and the back gesture do), so whatever it does first
/// runs for each of them; anywhere else they walk the window's history as before.
extension ShellNavigation {
  /// Back from the title bar or ⌘[: the Besigner's own back control while it is on screen, else the window's history.
  func back() {
    if besignerOnScreen, let besignerBack {
      besignerBack()
    } else {
      goBack()
    }
  }

  /// Whether Back has anywhere to go: always over the Besigner, which it leaves.
  var canGoBackOrLeave: Bool { besignerOnScreen || canGoBack }

  /// The Besigner opens on a wide window: the rail and the sidebar fold away, remembered as they were.
  func enterBesignerFocus() {
    let next = besignerFocus.enter(columns)
    apply(next)
  }

  /// The Besigner closes: the rail and the sidebar come back exactly as they were before it opened.
  func leaveBesignerFocus() {
    guard let before = besignerFocus.leave() else { return }
    apply(before)
  }

  /// The title bar's switcher toggle (or ⌃⌘S) while the Besigner is open: the sidebar follows the rail, so the one
  /// toggle brings both back, and folds both again.
  func followRailInBesignerFocus() {
    let next = besignerFocus.toggled(columns)
    if next != columns { apply(next) }
  }

  private var columns: BesignerFocus.Columns {
    BesignerFocus.Columns(railHidden: railHidden, sidebarHidden: sidebarHidden)
  }

  private func apply(_ next: BesignerFocus.Columns) {
    if railHidden != next.railHidden { railHidden = next.railHidden }
    if sidebarHidden != next.sidebarHidden { sidebarHidden = next.sidebarHidden }
  }
}

extension Route {
  /// The in-app Besigner, which draws no native head of its own (AGL-4056).
  var isBesigner: Bool {
    if case .besigner = self { return true }
    return false
  }
}
