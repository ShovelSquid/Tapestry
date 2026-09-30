import SwiftUI

// The desktop's tool buttons — A (select), H (hand), Z (zoom), the brush, S
// (settings) — plus a new-note button, since phones have no N key.
struct ToolPalette: View {
    @EnvironmentObject var workspace: Workspace
    let buttonSize: CGFloat

    var body: some View {
        HStack(spacing: 6) {
            tool(.select) { Glyph(text: "A") }
            tool(.hand) { Glyph(text: "H") }
            tool(.zoom) { Glyph(text: "Z") }
            tool(.brush) { BrushGlyph() }

            Rectangle()
                .fill(Theme.panelEdge)
                .frame(width: 1, height: buttonSize * 0.6)
                .padding(.horizontal, 2)

            action(label: "New note") { workspace.createNoteInView() } content: {
                Glyph(text: "+", size: 18)
            }
            action(label: "Settings") { workspace.revealSettings() } content: {
                Glyph(text: "S", size: 14)
            }
        }
    }

    private func tool<Content: View>(_ tool: Workspace.Tool,
                                     @ViewBuilder content: () -> Content) -> some View {
        let active = workspace.tool == tool
        return Button {
            workspace.tool = tool
        } label: {
            content()
                .frame(width: buttonSize, height: buttonSize)
                .background(active ? Theme.toolActive : Theme.toolIdle,
                            in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Self.name(tool))
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    private func action<Content: View>(label: String, perform: @escaping () -> Void,
                                       @ViewBuilder content: () -> Content) -> some View {
        Button(action: perform) {
            content()
                .frame(width: buttonSize, height: buttonSize)
                .background(Theme.toolIdle, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private static func name(_ tool: Workspace.Tool) -> String {
        switch tool {
        case .select: return "Select"
        case .hand: return "Hand"
        case .zoom: return "Zoom"
        case .brush: return "Brush"
        }
    }
}

private struct Glyph: View {
    let text: String
    var size: CGFloat = 13

    var body: some View {
        Text(text)
            .font(.system(size: size, weight: .bold))
            .foregroundStyle(Theme.toolGlyph)
    }
}

// The desktop's brush mark: a short hooked stroke, drawn as a path.
private struct BrushGlyph: View {
    var body: some View {
        Canvas { context, size in
            let cx = size.width / 2
            let cy = size.height / 2
            var path = Path()
            path.move(to: CGPoint(x: cx - 7, y: cy + 7))
            path.addCurve(to: CGPoint(x: cx - 2, y: cy + 3),
                          control1: CGPoint(x: cx - 8, y: cy + 2),
                          control2: CGPoint(x: cx - 4, y: cy + 1))
            path.addLine(to: CGPoint(x: cx + 8, y: cy - 7))
            context.stroke(path, with: .color(Theme.toolGlyph),
                           style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
        }
        .frame(width: 24, height: 24)
    }
}
