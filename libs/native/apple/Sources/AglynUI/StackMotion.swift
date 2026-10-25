// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The content area's push and pop on the Mac (AGL-4009; Figma Motion 121:6714). On iPhone and iPad a navigation stack
// slides its screens itself, with the edge swipe back; on the Mac it swaps them with no motion, so a screen opened from a
// list (Automation → Edit workflow) snapped in. The shell's stack keeps a ledger of its depth; the screen that appears
// reads from it whether it was pushed (it comes in from the trailing side) or uncovered by a pop (from the leading side),
// and slides that way while it fades. Reduce Motion keeps the fade alone, at the same duration.

/// What brought a stack to the screen now appearing.
public enum AglynStackMove: Equatable, Sendable {
  /// Nothing moved: the stack's first screen with its section, a tab or a window coming back.
  case none
  /// A screen was pushed: it comes in from the trailing side.
  case push
  /// One or more screens were popped: the one uncovered comes in from the leading side.
  case pop

  /// The side the screen comes in from, as a sign on the x axis: +1 trailing, -1 leading, 0 not at all.
  public var direction: CGFloat {
    switch self {
    case .none: 0
    case .push: 1
    case .pop: -1
    }
  }
}

/// A stack's depth as its screens last saw it, so the screen appearing knows how the stack moved. A reference, kept by
/// the stack, so reading it redraws nothing.
@MainActor
public final class AglynStackLedger {
  private var depth: Int

  /// `depth` is the stack's depth when it is drawn: a section opened again on the screen it was left on starts there,
  /// and that screen does not slide.
  public init(depth: Int = 0) { self.depth = depth }

  /// The move that brought the stack to `next` screens above its root, and remembers `next`.
  public func move(to next: Int) -> AglynStackMove {
    defer { depth = next }
    return next > depth ? .push : next < depth ? .pop : .none
  }
}

/// The shell's stack motion handed to its screens: the ledger and the stack's depth now.
public struct AglynStackMotion {
  let ledger: AglynStackLedger
  let depth: @MainActor () -> Int

  public init(ledger: AglynStackLedger, depth: @escaping @MainActor () -> Int) {
    self.ledger = ledger
    self.depth = depth
  }

  @MainActor func move() -> AglynStackMove { ledger.move(to: depth()) }
}

private struct AglynStackMotionKey: EnvironmentKey {
  static let defaultValue: AglynStackMotion? = nil
}

extension EnvironmentValues {
  /// The stack motion of the stack a screen is on: nil where the platform's stack moves its screens itself.
  public var aglynStackMotion: AglynStackMotion? {
    get { self[AglynStackMotionKey.self] }
    set { self[AglynStackMotionKey.self] = newValue }
  }
}

extension View {
  /// Slides and fades this screen in as it appears on a stack that hands it `aglynStackMotion` (the Mac's): from the
  /// trailing side when it was pushed, from the leading side when a pop uncovered it. Nothing where no motion is handed
  /// down, and only the fade under Reduce Motion.
  public func aglynStackEntrance() -> some View { modifier(AglynStackEntrance()) }
}

/// The values a stack entrance animates: the slide and the fade.
struct AglynStackEntranceFrame: Equatable {
  var x: CGFloat = 0
  var opacity: Double = 1
}

private struct AglynStackEntrance: ViewModifier {
  @Environment(\.aglynStackMotion) private var motion
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  /// Counts the entrances, to start one.
  @State private var entrances = 0
  @State private var from: CGFloat = 0

  func body(content: Content) -> some View {
    if motion == nil {
      content
    } else {
      content
        .keyframeAnimator(initialValue: AglynStackEntranceFrame(), trigger: entrances) { view, frame in
          view.offset(x: frame.x).opacity(frame.opacity)
        } keyframes: { _ in
          KeyframeTrack(\.x) {
            MoveKeyframe(reduceMotion ? 0 : from * AglynShellMotion.pushDistance)
            SpringKeyframe(0, duration: AglynShellMotion.pushDuration, spring: AglynShellMotion.pushSpring)
          }
          KeyframeTrack(\.opacity) {
            MoveKeyframe(0)
            CubicKeyframe(1, duration: reduceMotion ? AglynShellMotion.pushDuration : AglynShellMotion.pushFade)
          }
        }
        .onAppear {
          guard let move = motion?.move(), move != .none else { return }
          from = move.direction
          entrances += 1
        }
    }
  }
}
