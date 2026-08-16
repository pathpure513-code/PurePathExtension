const fs = require("fs");
const path = require("path");
require("dotenv").config();
const esbuild = require("esbuild");

const define = {
  __API_BASE_URL__: JSON.stringify(process.env.API_BASE_URL || ""),
  __API_AUTH_TOKEN__: JSON.stringify(process.env.API_AUTH_TOKEN || ""),
};

const jsEntries = [
  { in: "src/background.ts", out: "dist/background.js" },
  { in: "pages/block.ts", out: "dist/pages/block.js" },
  { in: "pages/testing-block.ts", out: "dist/pages/testing-block.js" },
  { in: "pages/popup.ts", out: "dist/pages/popup.js" },
];

const htmlCopies = [
  { in: "pages/block.html", out: "dist/pages/block.html" },
  { in: "pages/testing-block.html", out: "dist/pages/testing-block.html" },
  { in: "pages/popup.html", out: "dist/pages/popup.html" },
];

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function build() {
  for (const entry of jsEntries) {
    ensureDir(entry.out);
    await esbuild.build({
      entryPoints: [entry.in],
      bundle: true,
      outfile: entry.out,
      target: "chrome110",
      define,
    });
    console.log(`✅ Built ${entry.out}`);
  }

  for (const file of htmlCopies) {
    ensureDir(file.out);
    fs.copyFileSync(file.in, file.out);
    console.log(`📄 Copied ${file.out}`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});