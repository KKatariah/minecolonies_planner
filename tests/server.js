// Tiny zero-dependency static file server for the test suite. The real site
// is served as-is from the repo root (GitHub Pages, no build step), so this
// just mirrors that: every path maps straight onto a file under the root.
// Also usable by hand: `npm run serve`, then open http://localhost:4173.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 4173;

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".svg": "image/svg+xml",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".dat": "application/octet-stream",
	".mca": "application/octet-stream",
};

const server = http.createServer((req, res) => {
	const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
	let filePath = path.normalize(path.join(ROOT, urlPath));
	if (!filePath.startsWith(ROOT)) {
		res.writeHead(403).end("Forbidden");
		return;
	}
	if (urlPath.endsWith("/")) filePath = path.join(filePath, "index.html");
	fs.readFile(filePath, (err, data) => {
		if (err) {
			res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
			return;
		}
		const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
		res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
		res.end(data);
	});
});

server.listen(PORT, () => {
	console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
});
