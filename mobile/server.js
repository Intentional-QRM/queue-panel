const http = require("http");
const fs = require("fs");
const path = require("path");

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8000;
const HOST = process.env.QUEUE_PANEL_HOST || DEFAULT_HOST;
const configuredPort = Number(process.env.QUEUE_PANEL_PORT);
const PORT = Number.isInteger(configuredPort) &&
  configuredPort >= 1 &&
  configuredPort <= 65535
  ? configuredPort
  : DEFAULT_PORT;

const mimeTypes = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript"
};

const server = http.createServer(async (req, res) => {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);

  if (req.url === "/api/parks") {
    try {
      const response = await fetch("https://queue-times.com/parks.json");
      const data = await response.text();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Failed to fetch parks");
    }

    return;
  }
  
  if (requestPath.startsWith("/api/park/")) {
    const parkId = requestPath.split("/").pop();

    try {
      const response = await fetch(`https://queue-times.com/parks/${parkId}/queue_times.json`);
      const data = await response.text();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Failed to fetch wait times");
    }

    return;
  }

  if (requestPath.startsWith("/api/park-page/")) {
    const parkId = requestPath.split("/").pop();

    try {
      const response = await fetch(`https://queue-times.com/parks/${parkId}/queue_times`);
      const data = await response.text();

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Failed to fetch park page");
    }

    return;
  }

  const isSharedAsset = requestPath.startsWith("/shared/");
  const rootDir = isSharedAsset
    ? path.resolve(__dirname, "..", "shared")
    : __dirname;
  const assetPath = isSharedAsset
    ? requestPath.replace(/^\/shared\//, "/")
    : requestPath;

  const filePath = requestPath === "/"
    ? path.join(__dirname, "index.html")
    : path.resolve(rootDir, `.${assetPath}`);

  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "text/plain"
    });

    res.end(content);
  });
});

server.listen(PORT, HOST, () => {
  console.log(
    `Queue Panel mobile development server listening on ${HOST}:${PORT} ` +
    "(intended for local-network device testing only)."
  );
});
