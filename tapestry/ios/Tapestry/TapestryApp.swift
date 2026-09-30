import SwiftUI

@main
struct TapestryApp: App {
    @StateObject private var workspace = Workspace()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(workspace)
        }
    }
}
