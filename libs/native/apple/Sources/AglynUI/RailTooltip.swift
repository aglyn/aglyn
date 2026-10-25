// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The rail's name bubbles (AGL-3996, Figma Rail/Tooltip): a tile on the rail is a logo or one letter, so pointing at it
// says whose it is, fast. The system's help tag waits about a second and re-waits on every tile; this one shows after
// `AglynRailTooltipTiming.delay`, glides from tile to tile without waiting again, and goes when the pointer leaves the
// rail. A touch screen has no pointer: there a long press names the workspace as the title of the tile's menu.

extension AglynShellMetrics {
  /// The bubble's text (Figma Rail/Tooltip).
  public static let tooltipText: CGFloat = 12
  /// The bubble's corner radius.
  public static let tooltipRadius: CGFloat = 6
  /// From the tile's trailing edge to the bubble.
  public static let tooltipGap: CGFloat = 8
  /// Inside the bubble, round its text.
  public static let tooltipPadding = EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8)
}

extension AglynColor {
  /// The bubble's ground: the inverse of the page (the theme's primary text color), as Material's inverse surface is.
  public static let tooltip = themed { AglynThemeRuntime.shared.surfaces(dark: $0).textPrimary }
  /// The bubble's text: the page's own ground on the inverse.
  public static let tooltipText = themed { AglynThemeRuntime.shared.surfaces(dark: $0).canvas }
}

/// When a bubble shows and goes: pure, so the rules can be tested without a clock.
public enum AglynRailTooltipTiming {
  /// How long the pointer rests on a tile before its name shows.
  public static let delay: Duration = .milliseconds(150)
  /// How long a bubble outlives the pointer leaving its tile, so moving to the next tile glides it there instead of
  /// hiding and re-waiting.
  public static let glide: Duration = .milliseconds(120)
  /// How long the bubble takes to move to the next tile (none under Reduce Motion).
  public static let move: Double = 0.12

  /// The wait before showing a tile's name: none while another name is showing (the bubble glides), else `delay`.
  public static func wait(showing: String?) -> Duration { showing == nil ? delay : .zero }
}

/// Which tile's name is showing, for one rail.
@MainActor
@Observable
public final class AglynRailTooltipState {
  /// The tile whose bubble is drawn.
  public private(set) var shown: String?
  private var hovered: String?
  private var pending: Task<Void, Never>?

  public init() {}

  /// The pointer moved onto (`inside`) or off a tile.
  public func hover(_ id: String, inside: Bool) {
    pending?.cancel()
    if inside {
      hovered = id
      let wait = AglynRailTooltipTiming.wait(showing: shown)
      if wait == .zero {
        shown = id
        return
      }
      pending = Task { [weak self] in
        try? await Task.sleep(for: wait)
        guard !Task.isCancelled, let self, self.hovered == id else { return }
        self.shown = id
      }
    } else {
      guard hovered == id else { return }
      hovered = nil
      pending = Task { [weak self] in
        try? await Task.sleep(for: AglynRailTooltipTiming.glide)
        guard !Task.isCancelled, let self, self.hovered == nil else { return }
        self.shown = nil
      }
    }
  }

  /// Hides the bubble at once (the rail went away).
  public func dismiss() {
    pending?.cancel()
    hovered = nil
    shown = nil
  }
}

/// One tile's place on the rail and the name its bubble reads.
public struct AglynRailTooltipItem: Equatable {
  public let id: String
  public let label: String
  public let bounds: Anchor<CGRect>
}

struct AglynRailTooltipKey: PreferenceKey {
  static let defaultValue: [AglynRailTooltipItem] = []
  static func reduce(value: inout [AglynRailTooltipItem], nextValue: () -> [AglynRailTooltipItem]) {
    value.append(contentsOf: nextValue())
  }
}

/// The bubble: the name in 12-point text on the inverse ground, one line.
public struct AglynTooltipBubble: View {
  let text: String

  public init(_ text: String) { self.text = text }

  public var body: some View {
    Text(text)
      .font(.system(size: AglynShellMetrics.tooltipText, weight: .medium))
      .foregroundStyle(AglynColor.tooltipText)
      .lineLimit(1)
      .padding(AglynShellMetrics.tooltipPadding)
      .background(
        RoundedRectangle(cornerRadius: AglynShellMetrics.tooltipRadius, style: .continuous).fill(AglynColor.tooltip))
      .fixedSize()
  }
}

extension View {
  /// Names this rail tile in the rail's bubble while the pointer is on it. `label` is the full name; the tile's
  /// accessibility label should read the same.
  public func aglynRailTooltip(_ label: String, id: String, state: AglynRailTooltipState) -> some View {
    anchorPreference(key: AglynRailTooltipKey.self, value: .bounds) { [AglynRailTooltipItem(id: id, label: label, bounds: $0)] }
      .onHover { state.hover(id, inside: $0) }
  }

  /// Draws the rail's bubble beside the tile it names. Put it on the rail outside its scroll view, so the bubble is
  /// not clipped, and raise the rail above the column beside it (`zIndex`), which the bubble overlaps.
  public func aglynRailTooltipHost(_ state: AglynRailTooltipState) -> some View {
    modifier(AglynRailTooltipHost(state: state))
  }
}

struct AglynRailTooltipHost: ViewModifier {
  let state: AglynRailTooltipState
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  func body(content: Content) -> some View {
    content.overlayPreferenceValue(AglynRailTooltipKey.self) { items in
      GeometryReader { proxy in
        if let id = state.shown, let item = items.last(where: { $0.id == id }) {
          let rect = proxy[item.bounds]
          // A point at the tile's trailing edge plus the gap, level with its middle; the bubble hangs off it.
          Color.clear.frame(width: 0, height: 0)
            .overlay(alignment: .leading) { AglynTooltipBubble(item.label) }
            .position(x: rect.maxX + AglynShellMetrics.tooltipGap, y: rect.midY)
            .transition(.opacity)
        }
      }
      .allowsHitTesting(false)
      .accessibilityHidden(true)
      .animation(reduceMotion ? nil : .easeOut(duration: AglynRailTooltipTiming.move), value: state.shown)
    }
  }
}
