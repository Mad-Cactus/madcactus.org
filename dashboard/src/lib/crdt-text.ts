// Tracked-text core — PURE: Loro + diff helpers only, no db, no node builtins.
// Safe to import from client code. Version persistence lives in
// crdt-text-db.ts (server-only).
//
// ponytail: single-text Loro doc + diff-hunk deltas replaces macro's 2.8k-line
// @loro-mirror/core tree mirror — our surfaces are one text each. If any
// surface ever becomes a multi-writer tree, vendor
// ~/GitHub/macro/packages/loro-mirror instead.
import { LoroDoc, type LoroText } from "loro-crdt";
import { diffWordsWithSpace } from "diff";

export type TrackedEntity = "doc" | "email_draft";

// base64 without Node Buffer — atob/btoa exist in browsers AND Bun.
function bytesToBase64(bytes: Uint8Array): string {
	let bin = "";
	const chunk = 0x8000; // avoid arg-limit on large snapshots
	for (let i = 0; i < bytes.length; i += chunk) {
		bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

export function loroFromSnapshot(snapshotB64: string | null | undefined): { doc: LoroDoc; text: LoroText } {
	const doc = new LoroDoc();
	if (snapshotB64) {
		try {
			doc.import(base64ToBytes(snapshotB64));
		} catch {
			// corrupt/absent snapshot — start fresh; the content column stays truth
		}
	}
	return { doc, text: doc.getText("content") };
}

export function loroSnapshotB64(doc: LoroDoc): string {
	return bytesToBase64(doc.export({ mode: "snapshot" }));
}

/**
 * Apply full-content replacement as diff hunks so the Loro history records
 * what actually changed instead of a delete-all + insert-all clobber (which
 * also defeats concurrent agent writes). Returns true if anything changed.
 */
export function applyTextHunks(text: LoroText, next: string): boolean {
	const current = text.toString();
	if (current === next) return false;
	let pos = 0;
	for (const part of diffWordsWithSpace(current, next)) {
		if (part.added) {
			text.insert(pos, part.value);
			pos += part.value.length;
		} else if (part.removed) {
			text.delete(pos, part.value.length);
		} else {
			pos += part.value.length;
		}
	}
	return true;
}
