import type { APIEvent } from "@solidjs/start/server";
import { getAuthedClient } from "~/lib/session";
import { getDoc } from "~/lib/docs";
import { renderDocx, renderPdf } from "~/lib/doc-export";

/** Doc export — admin-session guarded.
 *  GET /api/docs/:id/export?format=docx|pdf → file download.
 *  Markdown tables become real tables; `<!-- pagebreak -->` becomes a real
 *  page break in both formats. */
export const GET = async (event: APIEvent) => {
	if (!(await getAuthedClient())) return new Response("Unauthorized", { status: 401 });
	const format = new URL(event.request.url).searchParams.get("format") ?? "";
	const doc = await getDoc(event.params.id);
	if (!doc) return new Response("Not found", { status: 404 });
	const name = (doc.title || "doc").replace(/[^\w-]+/g, "-");

	if (format === "docx") {
		const buf = await renderDocx(doc.title, doc.markdown);
		return new Response(buf, {
			headers: {
				"Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"Content-Disposition": `attachment; filename="${name}.docx"`,
			},
		});
	}
	if (format === "pdf") {
		const buf = await renderPdf(doc.title, doc.markdown);
		return new Response(buf, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${name}.pdf"`,
			},
		});
	}
	return new Response("Bad format — use docx or pdf", { status: 400 });
};
