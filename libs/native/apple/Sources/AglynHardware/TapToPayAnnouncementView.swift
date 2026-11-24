// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynUI
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// The Tap to Pay on iPhone announcement, laid out as Apple's Hero 9x16 in-app tile: the headline, Apple's core visual
/// edge to edge and unaltered, the subheadline, the call to action in the app's own button, and "Terms apply.", which
/// opens Apple's full disclaimers. Background, fonts and button are the app's theme (Apple allows those, and nothing
/// else, to change). "Not now" closes it.
public struct TapToPayAnnouncementView: View {
  let enable: (() -> Void)?
  let close: () -> Void
  @State private var showTerms = false

  /// `enable` opens Set up Tap to Pay on iPhone; nil hides the call to action (no screen can set it up here).
  public init(enable: (() -> Void)?, close: @escaping () -> Void) {
    self.enable = enable
    self.close = close
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        Text(TapToPayAnnouncementCopy.headline)
          .font(AglynFont.largeTitle)
          .foregroundStyle(AglynColor.textPrimary)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityAddTraits(.isHeader)
          .padding(.horizontal, AglynSpace.four)
          .padding(.top, AglynSpace.two)
        TapToPayAnnouncementVisual()
          .padding(.vertical, AglynSpace.two)
        VStack(alignment: .leading, spacing: AglynSpace.three) {
          Text(TapToPayAnnouncementCopy.subheadline)
            .font(AglynFont.title3)
            .foregroundStyle(AglynColor.textPrimary)
            .fixedSize(horizontal: false, vertical: true)
          if let enable {
            Button(TapToPayAnnouncementCopy.enable, action: enable)
              .buttonStyle(.aglynProminent)
              .controlSize(.large)
              .accessibilityIdentifier("tap-to-pay-announcement-enable")
          }
          Button(TapToPayAnnouncementCopy.termsApply) { showTerms = true }
            .font(AglynFont.subheadline)
            .foregroundStyle(.secondary)
            .buttonStyle(.plain)
            .padding(.top, AglynSpace.three)
            .accessibilityIdentifier("tap-to-pay-announcement-terms")
        }
        .padding(.horizontal, AglynSpace.four)
        .padding(.bottom, AglynSpace.four)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(AglynColor.paper.ignoresSafeArea())
    .safeAreaInset(edge: .top, spacing: 0) {
      HStack {
        Spacer()
        Button(TapToPayAnnouncementCopy.notNow, action: close)
          .font(AglynFont.button)
          .buttonStyle(.plain)
          .foregroundStyle(.tint)
          .padding(.horizontal, AglynSpace.two)
          .padding(.vertical, AglynSpace.one)
          .accessibilityIdentifier("tap-to-pay-announcement-not-now")
      }
      .background(AglynColor.paper)
    }
    .sheet(isPresented: $showTerms) { TapToPayTermsSheet { showTerms = false } }
    .accessibilityIdentifier("tap-to-pay-announcement")
  }
}

/// Apple's core visual (the card held to an iPhone), shown edge to edge at its own proportions and never cropped,
/// recolored or redrawn. A build without the image keeps its place empty.
struct TapToPayAnnouncementVisual: View {
  var body: some View {
    Group {
      if let image = Self.image {
        image
          .resizable()
          .aspectRatio(contentMode: .fit)
          .accessibilityLabel(TapToPayAnnouncementCopy.visualDescription)
      } else {
        Color.clear
          .aspectRatio(TapToPayAnnouncementCopy.visualAspect, contentMode: .fit)
          .accessibilityHidden(true)
      }
    }
    .frame(maxWidth: .infinity)
  }

  /// The app's own copy of Apple's visual, when the build carries it.
  static var image: Image? {
    #if canImport(UIKit)
      UIImage(named: TapToPayAnnouncementCopy.visualAsset).map(Image.init(uiImage:))
    #else
      nil
    #endif
  }
}

/// "Terms apply." in full: Apple's disclaimers, word for word.
struct TapToPayTermsSheet: View {
  let done: () -> Void

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: AglynSpace.two) {
          ForEach(TapToPayAnnouncementCopy.disclaimers, id: \.self) { words in
            Text(words)
              .font(AglynFont.body)
              .foregroundStyle(AglynColor.textPrimary)
              .textSelection(.enabled)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        .padding(AglynSpace.three)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(AglynColor.paper)
      .navigationTitle(TapToPayAnnouncementCopy.termsTitle)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(TapToPayAnnouncementCopy.done, action: done)
        }
      }
    }
    .presentationDetents([.medium, .large])
    .accessibilityIdentifier("tap-to-pay-terms")
  }
}
