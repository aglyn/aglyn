// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The launch intro's clock (Figma "Intro timeline", spec 53:1638), one continuous motion. Frame 1 equals the static
/// launch screen: the Facets ground a step out from rest with the mark centered. The planes settle (0–240 ms) while the
/// mark holds; then the wordmark is revealed beside it by a mask wipe from the mark's edge, the lockup recentring as it
/// grows (360–800 ms), so the mark never leaves the lockup it becomes part of. Once the app is ready the lockup hands
/// over: to the sign-in screens it docks at their lockup's place and size and the card rises in under it; to the shell
/// it fades as the shell rises in (220 ms). Nothing cross-fades two different pictures and no layer disappears while it
/// is still visible, so no frame flashes. Never a fixed wait: an app that is not ready when the wipe ends holds the
/// lockup while the soft light breathes. Reduce Motion is a 200 ms cross-fade from the launch frame to the destination.
/// It plays once per process: a warm start, a second window and a sign-out skip it.
@MainActor
@Observable
public final class AglynLaunchIntro {
  /// The planes are at rest.
  public private(set) var settled = false
  /// The wordmark has been wiped in beside the mark: the full lockup shows, centered.
  public private(set) var wiped = false
  /// The lockup has docked at the sign-in screens' lockup place (only when the destination shows its own lockup).
  public private(set) var docked = false
  /// The soft light is at its low point while the intro waits for the app.
  public private(set) var dimmed = false
  /// The destination is shown.
  public private(set) var revealed = false
  /// The intro's own layer (the lockup) is gone.
  public private(set) var finished = false
  /// Reduce Motion was on when the intro played: the ground and mark cross-fade instead of moving.
  public private(set) var crossFades = false
  /// The destination draws its own lockup where the intro docks (the sign-in screens); otherwise the lockup fades out.
  public private(set) var docks = false

  private static var played = false

  public init() {
    if Self.played { skip() }
    Self.played = true
  }

  /// Everything at its end state, without motion.
  private func skip() {
    settled = true
    wiped = true
    revealed = true
    finished = true
  }

  /// Plays the intro until `isReady` answers true; `docksToLockup` says whether the destination then shows the
  /// lockup at the sign-in screens' place; `reduceMotion` makes it the cross-fade.
  public func run(
    reduceMotion: Bool, isReady: @escaping @MainActor () -> Bool, docksToLockup: @escaping @MainActor () -> Bool = { false }
  ) async {
    guard !finished else { return }
    typealias T = AglynAuthTokens.Intro
    if reduceMotion {
      crossFades = true
      await wait(until: isReady)
      withAnimation(.easeInOut(duration: T.reduceMotionFadeMs / 1000)) {
        settled = true
        revealed = true
      }
      await pause(T.reduceMotionFadeMs)
      finished = true
      return
    }
    withAnimation(.timingCurve(0.2, 0, 0, 1, duration: T.settleMs / 1000)) { settled = true }
    await pause(T.lockupStartMs)
    let wipeMs = T.lockupEndMs - T.lockupStartMs + T.crossFadeMs
    withAnimation(.timingCurve(0.4, 0, 0.2, 1, duration: wipeMs / 1000)) { wiped = true }
    await pause(wipeMs)
    if !isReady() {
      // Hold the lockup; the soft light breathes between its low point and full until the app is ready.
      withAnimation(.easeInOut(duration: T.breathePeriodMs / 2000).repeatForever(autoreverses: true)) { dimmed = true }
      await wait(until: isReady)
      withAnimation(.easeInOut(duration: 0.2)) { dimmed = false }
    }
    docks = docksToLockup()
    if docks {
      // Travel to the sign-in lockup's place first, so the destination's own lockup appears under an identical one.
      withAnimation(.spring(response: T.springResponse, dampingFraction: T.springDamping)) { docked = true }
      await pause(T.springResponse * 1000)
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

  /// The intro lockup's own opacity: it stays while it docks (the destination's lockup appears under it) and fades as
  /// any other destination rises in.
  public var lockupOpacity: Double { docks ? 1 : (revealed ? 0 : 1) }

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

/// The intro's lockup over the Facets ground: the logo-kit lockup, masked to its mark at the launch screen's size and
/// place, then unmasked from the mark's edge while it recentres (the wipe), then docked at the sign-in lockup's place
/// or faded as the destination rises. One picture throughout, so the mark is the same pixels from frame 1 to the end.
public struct AglynLaunchMark: View {
  let intro: AglynLaunchIntro
  let name: String

  public init(_ intro: AglynLaunchIntro, name: String) {
    self.intro = intro
    self.name = name
  }

  /// The lockup's width for its height: the logo kit's 79 × 24 artboard, the mark being its first 24 × 24.
  static let lockupAspect: CGFloat = 79 / 24

  public var body: some View {
    GeometryReader { proxy in
      let compact = AglynAuthLayout.isCompact(width: proxy.size.width)
      // The launch screen centers the mark on the whole screen, safe area included.
      let insets = proxy.safeAreaInsets
      let center = CGPoint(
        x: (proxy.size.width + insets.trailing - insets.leading) / 2,
        y: (proxy.size.height + insets.bottom - insets.top) / 2)
      let launch = AglynAuthLayout.launchMark(compact: compact)
      let docked = intro.docked
      let height = docked ? AglynAuthTokens.Metrics.lockupHeight : launch
      let fullWidth = height * Self.lockupAspect
      let shown = intro.wiped || docked ? fullWidth : height
      let origin =
        docked
        ? CGPoint(x: AglynAuthLayout.lockupLeading(compact: compact), y: AglynAuthLayout.lockupTop(compact: compact))
        : CGPoint(x: center.x - shown / 2, y: center.y - height / 2)
      AglynArtwork.logo
        .resizable()
        .scaledToFit()
        .frame(width: fullWidth, height: height)
        .mask(alignment: .leading) { Rectangle().frame(width: shown, height: height) }
        .offset(x: origin.x, y: origin.y)
        .opacity(intro.crossFades ? (intro.revealed ? 0 : 1) : intro.lockupOpacity)
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
    }
    .accessibilityElement()
    .accessibilityLabel(name)
    .accessibilityIdentifier("launch-intro")
  }
}
