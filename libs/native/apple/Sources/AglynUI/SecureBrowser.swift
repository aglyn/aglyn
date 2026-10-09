// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AuthenticationServices
import SwiftUI

extension WebAuthenticationSession {
  /// Opens a page someone else hosts (Stripe Checkout, Stripe's Customer
  /// Portal) in the platform's secure in-app browser sheet, never a web view
  /// of ours, and returns once the person closes it or the page hands back
  /// to `aglyn://`. The console opens the same pages in a browser tab.
  @MainActor
  public func openHostedPage(_ url: URL) async {
    _ = try? await authenticate(using: url, callbackURLScheme: "aglyn", preferredBrowserSession: .shared)
  }
}
