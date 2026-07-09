const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mobileSharedDir = path.join(root, "mobile", "shared");

fs.mkdirSync(mobileSharedDir, { recursive: true });
fs.copyFileSync(
  path.join(root, "shared", "queue-panel-shared.js"),
  path.join(mobileSharedDir, "queue-panel-shared.js")
);

console.log("Prepared Capacitor web assets.");
