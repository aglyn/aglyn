// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#endif

/// A share button that opens the system share sheet over whatever is in front, a sheet included.
///
/// SwiftUI's `ShareLink` inside the Aglyn POS register's sheets (checkout, the register sheet's Day totals) asked the
/// window's root view controller to present the share sheet. The root was already presenting the register's sheet, so
/// UIKit refused it ("Attempt to present UIActivityViewController … which is already presenting") and nothing opened.
/// On iOS this presents from the front-most view controller instead; the Mac keeps `ShareLink`, which has no such issue.
public struct AglynShareButton<Label: View>: View {
  private let url: URL?
  private let text: String?
  private let label: Label

  /// Shares a file (a spreadsheet, a receipt).
  public init(url: URL, @ViewBuilder label: () -> Label) {
    self.url = url
    self.text = nil
    self.label = label()
  }

  /// Shares text (a receipt as text).
  public init(text: String, @ViewBuilder label: () -> Label) {
    self.url = nil
    self.text = text
    self.label = label()
  }

  public var body: some View {
    #if os(iOS)
      Button { present() } label: { label }
    #else
      if let url {
        ShareLink(item: url) { label }
      } else {
        ShareLink(item: text ?? "") { label }
      }
    #endif
  }

  #if os(iOS)
    private func present() {
      let item: Any = url ?? text ?? ""
      guard let front = Self.frontViewController() else { return }
      let share = UIActivityViewController(activityItems: [item], applicationActivities: nil)
      // An iPad shows the share sheet as a popover, which needs somewhere to point: the middle of what is in front.
      if let popover = share.popoverPresentationController {
        popover.sourceView = front.view
        popover.sourceRect = CGRect(x: front.view.bounds.midX, y: front.view.bounds.midY, width: 0, height: 0)
        popover.permittedArrowDirections = []
      }
      front.present(share, animated: true)
    }

    /// The view controller in front: the key window's root, then whatever it presents, down to the last.
    private static func frontViewController() -> UIViewController? {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
      var front = window?.rootViewController
      while let presented = front?.presentedViewController, !presented.isBeingDismissed { front = presented }
      return front
    }
  #endif
}
