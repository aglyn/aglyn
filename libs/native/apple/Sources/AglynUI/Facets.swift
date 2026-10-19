// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The Facets ground's geometry on a canvas (Figma "Auth/Background", Style=Facets; tools/scripts/lib/native-auth-theme.mjs
/// draws the iOS launch art from the same rules): a soft light at the top and four planes cut at the mark's own angles,
/// each filled with the brand gradient.
public struct AglynFacetsLayout: Equatable {
  public struct Plane: Equatable {
    public let name: String
    public let points: [CGPoint]
    public let opacity: CGFloat
  }

  public let planes: [Plane]
  /// The soft light's box, its blur radius (the Figma layer blur) and its opacity.
  public let softLight: CGRect
  public let softLightBlur: CGFloat
  public let softLightOpacity: CGFloat

  /// `settle` runs from 0 (the intro's first frame: each plane `settleDistance` out from rest, at `settleOpacity` of its
  /// strength) to 1 (rest).
  public init(size: CGSize, dark: Bool, settle: CGFloat = 1) {
    typealias F = AglynAuthTokens.Facets
    let width = size.width
    let height = size.height
    let short = min(width, height)
    let pen = tan(F.penDegrees * .pi / 180)
    let complement = tan(F.complementDegrees * .pi / 180)
    let strength = dark ? F.darkOpacity : F.lightOpacity
    let bandRise = (F.bandRightX - F.bandLeftX) * width * pen
    let bandTop = F.bandStartY * height
    let accentThickness = F.accentThickness * short
    let accentTop = height - (1 - F.accentStartX) * width * pen
    let rest: [(String, [CGPoint], CGFloat)] = [
      (
        "top",
        [
          CGPoint(x: F.topStartX * width, y: 0), CGPoint(x: width, y: 0),
          CGPoint(x: width, y: (1 - F.topStartX) * width * complement),
        ], strength.top
      ),
      (
        "band",
        [
          CGPoint(x: F.bandLeftX * width, y: bandTop), CGPoint(x: F.bandRightX * width, y: bandTop - bandRise),
          CGPoint(x: F.bandRightX * width, y: bandTop - bandRise + F.bandThickness * height),
          CGPoint(x: F.bandLeftX * width, y: bandTop + F.bandThickness * height),
        ], strength.band
      ),
      (
        "corner",
        [
          CGPoint(x: F.cornerStartX * width, y: height),
          CGPoint(x: width, y: height - (1 - F.cornerStartX) * width * pen), CGPoint(x: width, y: height),
        ], strength.corner
      ),
      (
        "accent",
        [
          CGPoint(x: F.accentStartX * width, y: height), CGPoint(x: width, y: accentTop),
          CGPoint(x: width, y: accentTop + accentThickness),
          CGPoint(x: F.accentStartX * width + accentThickness / pen, y: height),
        ], strength.accent
      ),
    ]
    let center = CGPoint(x: width / 2, y: height / 2)
    let out = F.settleDistance * (1 - settle)
    planes = rest.map { name, points, opacity in
      let mid = CGPoint(
        x: points.map(\.x).reduce(0, +) / CGFloat(points.count),
        y: points.map(\.y).reduce(0, +) / CGFloat(points.count))
      let length = max(hypot(mid.x - center.x, mid.y - center.y), 1)
      let dx = (mid.x - center.x) / length * out
      let dy = (mid.y - center.y) / length * out
      return Plane(
        name: name, points: points.map { CGPoint(x: $0.x + dx, y: $0.y + dy) },
        opacity: opacity * (F.settleOpacity + (1 - F.settleOpacity) * settle))
    }
    softLight = CGRect(
      x: F.softLightX * width, y: F.softLightY * height, width: F.softLightWidth * width,
      height: F.softLightHeight * height)
    softLightBlur = F.softLightBlur * short
    softLightOpacity = strength.softLight
  }

  /// The brand gradient's line across a box: in the box's unit square it runs toward the last stop along
  /// (sin, cos) of the gradient's angle, y down, centered on the box (as the Figma boards draw it).
  public static func gradientLine(in box: CGRect) -> (start: CGPoint, end: CGPoint) {
    let angle = AglynAuthTokens.gradientDegrees * .pi / 180
    let gx = sin(angle) / max(box.width, 1)
    let gy = cos(angle) / max(box.height, 1)
    let g2 = gx * gx + gy * gy
    let dx = gx / g2
    let dy = gy / g2
    return (
      CGPoint(x: box.midX - dx / 2, y: box.midY - dy / 2), CGPoint(x: box.midX + dx / 2, y: box.midY + dy / 2)
    )
  }

  /// The canvas the planes are laid out on: the view itself, or on iPad a square of its longer side centered on it, so
  /// the planes hold in both orientations and match the launch art the storyboard aspect-fills.
  public static func canvas(for size: CGSize, square: Bool) -> CGRect {
    guard square else { return CGRect(origin: .zero, size: size) }
    let side = max(size.width, size.height)
    return CGRect(x: (size.width - side) / 2, y: (size.height - side) / 2, width: side, height: side)
  }
}

/// The Facets ground behind the sign-in screens, the launch screen and the intro. Animatable: `settle` (0 = the launch
/// frame, 1 = rest) and `light` (the soft light's share of its strength, which the intro breathes while it waits).
public struct AglynFacetsBackground: View, Animatable {
  public var settle: CGFloat
  public var light: CGFloat
  @Environment(\.colorScheme) private var colorScheme

  public init(settle: CGFloat = 1, light: CGFloat = 1) {
    self.settle = settle
    self.light = light
  }

  public var animatableData: AnimatablePair<CGFloat, CGFloat> {
    get { AnimatablePair(settle, light) }
    set {
      settle = newValue.first
      light = newValue.second
    }
  }

  /// iPad lays the planes on a square (see `AglynFacetsLayout.canvas`).
  private var square: Bool {
    #if os(iOS)
      UIDevice.current.userInterfaceIdiom == .pad
    #else
      false
    #endif
  }

  public var body: some View {
    let dark = colorScheme == .dark
    Canvas { context, size in
      context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(AglynAuthTokens.Colors.canvas.resolved(dark: dark)))
      let frame = AglynFacetsLayout.canvas(for: size, square: square)
      let layout = AglynFacetsLayout(size: frame.size, dark: dark, settle: settle)
      context.translateBy(x: frame.minX, y: frame.minY)
      context.drawLayer { layer in
        // The Figma layer blur is twice the Gaussian's deviation, as SwiftUI's radius reads it.
        layer.addFilter(.blur(radius: layout.softLightBlur / 2))
        layer.fill(
          Path(ellipseIn: layout.softLight),
          with: .color(
            AglynAuthTokens.Colors.softLight.resolved(dark: dark).opacity(layout.softLightOpacity * light)))
      }
      let stops = AglynAuthTokens.Colors.gradientStops
      for plane in layout.planes {
        var path = Path()
        path.addLines(plane.points)
        path.closeSubpath()
        let line = AglynFacetsLayout.gradientLine(in: path.boundingRect)
        context.drawLayer { layer in
          layer.opacity = plane.opacity
          layer.fill(path, with: .linearGradient(Gradient(stops: stops), startPoint: line.start, endPoint: line.end))
        }
      }
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}
