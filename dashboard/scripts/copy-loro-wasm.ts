// nitro externalizes loro-crdt to .output/server/_libs/ but its tracer can't
// see the wasm (loaded at runtime via readFileSync(join(__dirname, ...)) in
// the nodejs build) — without this copy any route whose graph evals
// loro-crdt (docs, email) 500s with ENOENT. Run after `vite build`.
export {};
const src = Bun.file("node_modules/loro-crdt/nodejs/loro_wasm_bg.wasm");
const dest = ".output/server/_libs/loro_wasm_bg.wasm";

if (await Bun.file(".output/server/_libs/loro-crdt.mjs").exists()) {
	await Bun.write(dest, src);
	console.log(`copied loro wasm → ${dest} (${(src.size / 1048576).toFixed(1)}MB)`);
} else {
	console.log("no loro-crdt in server externals — wasm copy skipped");
}
