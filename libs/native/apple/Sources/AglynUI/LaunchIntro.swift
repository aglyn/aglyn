// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The launch intro's clock (Figma "Intro timeline", spec 53:1638). Frame 1 equals the static launch screen: the Facets
/// ground a step out from rest with the mark centered. The planes settle (0–240 ms), the mark travels to the lockup's
/// place and cross-fades into the lockup (360–600 ms), and the destination rises in (220 ms) once the app is ready.
/// Never a fixed wait: an app that is not ready at 600 ms holds there while the soft light breathes, and one that is
/// ready sooner still finishes the 600 ms of motion, so the whole intro stays under a second. Reduce Motion is a 200 ms
/// cross-fade from the launch frame to the destination. It plays once per process: a warm start, a second window and a
/// sign-out skip it.
@MainActor
@Observable
public final class AglynLaunchIntro {
  /// The planes are at rest.
  public private(set) var settled = false
  /// The mark has travelled to the lockup's place.
  public private(set) var markAtLockup = false
  /// The lockup has cross-faded in over the mark.
  public private(set) var lockupVisible = false
  /// The soft light is at its low point while the intro waits for the app.
  public private(set) var dimmed = false
  /// The destination is shown.
  public private(set) var revealed = false
  /// The intro's own layer (the travelling mark) is gone.
  public private(set) var finished = false
  /// Reduce Motion was on when the intro played: the ground and mark cross-fade instead of moving.
  public private(set) var crossFades = false

  private static var played = false

  public init() {
    if Self.played { skip() }
    Self.played = true
  }

  /// Everything at its end state, without motion.
  private func skip() {
    settled = true
    markAtLockup = true
    lockupVisible = true
    revealed = true
    finished = true
  }

  /// Plays the intro until `isReady` answers true; `reduceMotion` makes it the cross-fade.
  public func run(reduceMotion: Bool, isReady: @escaping @MainActor () -> Bool) async {
    guard !finished else { return }
    typealias T = AglynAuthTokens.Intro
    if reduceMotion {
      crossFades = true
      await wait(until: isReady)
      withAnimation(.easeInOut(duration: T.reduceMotionFadeMs / 1000)) {
        settled = true
        lockupVisible = true
        revealed = true
      }
      await pause(T.reduceMotionFadeMs)
      finished = true
      return
    }
    withAnimation(.timingCurve(0.2, 0, 0, 1, duration: T.settleMs / 1000)) { settled = true }
    await pause(T.lockupStartMs)
    withAnimation(.spring(response: T.springResponse, dampingFraction: T.springDamping)) { markAtLockup = true }
    await pause(T.lockupEndMs - T.crossFadeMs - T.lockupStartMs)
    withAnimation(.easeInOut(duration: T.crossFadeMs / 1000)) { lockupVisible = true }
    await pause(T.crossFadeMs)
    if !isReady() {
      // Hold frame 4; the soft light breathes between its low point and full until the app is ready.
      withAnimation(.easeInOut(duration: T.breathePeriodMs / 2000).repeatForever(autoreverses: true)) { dimmed = true }
      await wait(until: isReady)
      withAnimation(.easeInOut(duration: 0.2)) { dimmed = false }
    }
    withAnimation(.easeOut(duration: T.destinationMs / 1000)) { revealed = true }
    await pause(T.destinationMs)
    finished = true
  }

  /// The ground's settle (0 = the launch frame, 1 = rest) and the soft light's share of its strength.
  public var settle: CGFloat { settled ? 1 : 0 }
  public var light: CGFloat { dimmed ? AglynAuthTokens.Intro.breatheLow : 1 }

  /// How far below its place the destination's card sits, and how visible it is.
  public var destinationOffset: CGFloat { revealed || crossFades ? 0 : AglynAuthTokens.Intro.destinationRise }
  public var destinationOpacity: Double { revealed ? 1 : 0 }

  private func pause(_ milliseconds: CGFloat) async {
    try? await Task.sleep(for: .milliseconds(Int(milliseconds)))
  }

  private func wait(until isReady: @MainActor () -> Bool) async {
    while !isReady() && !Task.isCancelled {
      try? await Task.sleep(for: .milliseconds(16))
    }
  }
}

/// Where the sign-in screens put the logo-kit lockup (and the intro sends the mark): 28 points tall, its clear space
/// around it, top-left under the status bar on a phone and top-left of the window on iPad and the Mac.
public enum AglynAuthLayout {
  /// A phone-width layout: the card spans the screen less its margins.
  public static func isCompact(width: CGFloat) -> Bool { width < 600 }

  public static func lockupLeading(compact: Bool) -> CGFloat {
    compact ? AglynAuthTokens.Metrics.lockupLeadingCompact : AglynAuthTokens.Metrics.lockupLeadingRegular
  }

  /// The lockup's top, below the safe area's top edge.
  public static func lockupTop(compact: Bool) -> CGFloat {
    compact ? AglynAuthTokens.Metrics.lockupTopCompact : AglynAuthTokens.Metrics.lockupClearSpace
  }

  /// The card's width outside a phone: 440 on iPad, 420 on the Mac.
  public static var cardWidth: CGFloat {
    #if os(macOS)
      AglynAuthTokens.Metrics.cardWidthDesktop
    #else
      AglynAuthTokens.Metrics.cardWidthTablet
    #endif
  }

  /// The launch mark's size: 96 on a phone, 120 on iPad (and the Mac's first window uses the phone's).
  public static func launchMark(compact: Bool) -> CGFloat {
    #if os(iOS)
      UIDevice.current.userInterfaceIdiom == .pad
        ? AglynAuthTokens.Metrics.launchMarkRegular : AglynAuthTokens.Metrics.launchMarkCompact
    #else
      AglynAuthTokens.Metrics.launchMarkCompact
    #endif
  }
}

/// The intro's travelling mark over the Facets ground: centered at the launch screen's size, then at the lockup's place
/// and height, where the logo-kit lockup cross-fades in over it.
public struct AglynLaunchMark: View {
  let intro: AglynLaunchIntro
  let name: String

  public init(_ intro: AglynLaunchIntro, name: String) {
    self.intro = intro
    self.name = name
  }

  public var body: some View {
    GeometryReader { proxy in
      let compact = AglynAuthLayout.isCompact(width: proxy.size.width)
      let height = AglynAuthTokens.Metrics.lockupHeight
      let launch = AglynAuthLayout.launchMark(compact: compact)
      let leading = AglynAuthLayout.lockupLeading(compact: compact)
      let top = AglynAuthLayout.lockupTop(compact: compact)
      // The launch screen centers the mark on the whole screen, safe area included.
      let insets = proxy.safeAreaInsets
      let center = CGPoint(
        x: (proxy.size.width + insets.trailing - insets.leading) / 2,
        y: (proxy.size.height + insets.bottom - insets.top) / 2)
      let markSize = intro.markAtLockup ? height : launch
      ZStack(alignment: .topLeading) {
        AglynArtwork.mark
          .resizable()
          .scaledToFit()
          .frame(width: markSize, height: markSize)
          .position(intro.markAtLockup ? CGPoint(x: leading + height / 2, y: top + height / 2) : center)
          .opacity(intro.lockupVisible ? 0 : 1)
        AglynArtwork.logo
          .resizable()
          .scaledToFit()
          .frame(height: height)
          .fixedSize()
          .offset(x: leading, y: top)
          .opacity(intro.lockupVisible ? 1 : 0)
      }
      .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
    }
    .accessibilityElement()
    .accessibilityLabel(name)
    .accessibilityIdentifier("launch-intro")
  }
}
