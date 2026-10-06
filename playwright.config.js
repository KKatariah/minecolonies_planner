// End-to-end tests: drive the real pages in a real browser against a local
// static server (tests/server.js), the same way GitHub Pages serves them.
const { defineConfig, devices } = require("@playwright/test");

const PORT = Number(process.env.PORT) || 4173;

module.exports = defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never", outputFolder: "test-results/html" }]],
	outputDir: "test-results/artifacts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		viewport: { width: 1600, height: 1000 },
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } } }],
	webServer: {
		command: "node tests/server.js",
		url: `http://localhost:${PORT}/index.html`,
		reuseExistingServer: !process.env.CI,
		env: { PORT: String(PORT) },
	},
});
