const fs = require("fs");

const files = [
  "main.js",
  "renderer.js",
  "preload.js",
  "config.js",
  "scripts/publish.js"
];

const commentToken = "//";

files.forEach((fname) => {
  if (!fs.existsSync(fname)) {
    console.log(`X File not found: ${fname}`);
    return;
  }

  const content = fs.readFileSync(fname, "utf-8");
  const lines = content.split("\n");
  const cleaned = [];

  lines.forEach((line) => {
    let trimmed = line.trimEnd();
    const idx = trimmed.indexOf(commentToken);

    if (idx >= 0) {
      const before = trimmed.substring(0, idx);
      const sq = (before.match(/'/g) || []).length;
      const dq = (before.match(/"/g) || []).length;
      const inString = (sq % 2 === 1) || (dq % 2 === 1);
      if (!inString) {
        trimmed = before.trimEnd();
      }
    }

    if (trimmed || !line.trim()) {
      cleaned.push(trimmed);
    }
  });

  fs.writeFileSync(fname, cleaned.join("\n"), "utf-8");
  console.log(`OK Cleaned ${fname}`);
});
