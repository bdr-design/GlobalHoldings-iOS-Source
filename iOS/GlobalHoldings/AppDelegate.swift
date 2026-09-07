import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    private weak var gameViewController: GameViewController?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let controller = GameViewController()
        gameViewController = controller

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window

        if let url = launchOptions?[.url] as? URL {
            DispatchQueue.main.async { [weak self] in self?.openUpdate(url) }
        }
        return true
    }

    func application(
        _ app: UIApplication,
        open url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        guard GlobalGameStorage.shared.isSupportedUpdate(url) else { return false }
        openUpdate(url)
        return true
    }

    private func openUpdate(_ url: URL) {
        gameViewController?.importUpdate(from: url)
    }
}
