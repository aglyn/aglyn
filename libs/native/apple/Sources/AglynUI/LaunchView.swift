// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// What an app shows from launch until it knows who is signed in: the brand
/// logo centered on the system background the launch screen draws, so the
/// hand-off from the launch screen reads as one screen. A spinner appears
/// only when the wait is long enough to notice.
public struct AglynLaunchView: View {
  let name: String
  let caption: String?
  @State private var shown = false
  @State private var slow = false

  /// `name` is the product name read aloud for the logo; `caption` names
  /// the app under it ("POS"), nil for none.
  public init(name: String, caption: String? = nil) {
    self.name = name
    self.caption = caption
  }

  public var body: some View {
    VStack(spacing: AglynSpace.two) {
      AglynArtwork.logo
        .resizable()
        .scaledToFit()
        .frame(maxWidth: 200, maxHeight: 56)
        .accessibilityLabel(name)
      if let caption {
        Text(caption).font(AglynFont.title).foregroundStyle(AglynColor.tint)
      }
      ProgressView()
        .controlSize(.regular)
        .opacity(slow ? 1 : 0)
        .accessibilityHidden(!slow)
    }
    .opacity(shown ? 1 : 0)
    .scaleEffect(shown ? 1 : 0.96)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.background)
    .task {
      withAnimation(.easeOut(duration: 0.25)) { shown = true }
      try? await Task.sleep(for: .milliseconds(800))
      withAnimation(.easeIn(duration: 0.2)) { slow = true }
    }
  }
}

