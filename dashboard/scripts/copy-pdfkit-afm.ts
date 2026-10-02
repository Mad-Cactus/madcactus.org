// nitro externalizes pdfkit (+png-js) to .output/server/_libs/, but its
// standard fonts (Helvetica/Courier/Times) load AFM metrics at runtime via
// readFileSync(__dirname + '/data/…') — __dirname is _libs/ in the build, so
// the data dir must sit next to the chunk. Without this copy any
// renderDocx/renderPdf 500s with ENOENT Helvetica.afm. Run after `vite build`.
export {};

const chunk = ".output/server/_libs/pdfkit+png-js.mjs";
if (!(await Bun.file(chunk).exists())) {
	console.log("no pdfkit in server externals — afm copy skipped");
	process.exit(0);
}

await Bun.$`mkdir -p .output/server/_libs/data`;
await Bun.$`cp node_modules/pdfkit/js/data/*.afm .output/server/_libs/data/`;
console.log("copied pdfkit afm fonts → .output/server/_libs/data/");
