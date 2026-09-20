/* build.js -- bundle the SPA. One IIFE, React inlined, minified for prod.
     node build.js           # production build -> public/bundle.js
     node build.js --watch   # rebuild on change                              */
"use strict";
const esbuild = require("esbuild");
const path = require("path");
const watch = process.argv.includes("--watch");
const opts = {
  entryPoints: [path.join(__dirname, "src/app.jsx")],
  bundle: true,
  outfile: path.join(__dirname, "public/bundle.js"),
  jsx: "automatic",
  loader: { ".jsx": "jsx", ".js": "jsx" },
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  target: ["es2019"],
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
};
if (watch) esbuild.context(opts).then((c) => c.watch());
else esbuild.build(opts).then(() => { const fs = require("fs"); console.log("Built public/bundle.js (" + fs.statSync(opts.outfile).size + " bytes)"); }).catch(() => process.exit(1));
