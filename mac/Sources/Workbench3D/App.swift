import SwiftUI
import Workbench3DKit

// Temporary shell while the app is being built; CI checks that the package compiles.
@main
struct Workbench3DApp: App {
    var body: some Scene {
        WindowGroup { Text(Units.format(1.5)) }
    }
}
