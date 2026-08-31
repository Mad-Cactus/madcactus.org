import type { ScoreData, ContentBlock } from "./types";
import { CATEGORY_CONTENT } from "./types";
import { join } from "path";

const FONT_DIR = join(import.meta.dirname, "fonts");
const FONT_REGULAR = join(FONT_DIR, "PlayfairDisplay.ttf");
const FONT_ITALIC = join(FONT_DIR, "PlayfairDisplay-Italic.ttf");
const LOGO = join(import.meta.dirname, "cactus-seal.png");

const C = {
    vellum: "#f6f6f6",
    gold: "#bc9c5c",
    black: "#0a0a0a",
    silver: "#b3b3b3",
    lightSilver: "#e8e8e8",
    codeBg: "#1a1a1a",
    codeText: "#d4d4d4",
    tierColors: {
        critical: "#c0392b",
        urgent: "#bc9c5c",
        ready: "#2c3e50",
        mature: "#27ae60",
    } as Record<string, string>,
} as const;

const W = 612;
const H = 792;
const m = 56; // margin
const cw = W - m * 2; // content width
const codePad = 12;
const codeInnerW = cw - codePad * 2;
const CODE_FONT_SIZE = 7.5;
const CODE_LINE_HEIGHT = 10;

function tierColor(tier: string): string {
    if (tier === "AI Critical") return C.tierColors.critical;
    if (tier === "AI Urgent") return C.tierColors.urgent;
    if (tier === "AI Ready") return C.tierColors.ready;
    return C.tierColors.mature;
}

type Doc = any;

// Stateful page renderer for category pages
class PageState {
    doc: Doc;
    y: number;
    tc: string;
    totalPages: number;
    pageIndex: number;
    catIndex: number;
    catLabel: string;

    constructor(doc: Doc, tc: string, totalPages: number) {
        this.doc = doc;
        this.tc = tc;
        this.totalPages = totalPages;
        this.y = 0;
        this.pageIndex = 0;
        this.catIndex = 0;
        this.catLabel = "";
    }

    newPage() {
        this.doc.addPage();
        fillVellum(this.doc);
        this.pageIndex++;

        // Header
        this.doc.image(LOGO, m, m - 8, { width: 28 });
        this.doc.font("Helvetica-Bold").fontSize(9).fillColor(C.gold)
            .text(
                `${this.catIndex.toString().padStart(2, "0")} / ${this.totalPages.toString().padStart(2, "0")}`,
                m + 40, m, { lineBreak: false },
            );
        goldLine(this.doc, m, m + 28, W - m);
        this.y = m + 48;
    }

    ensureSpace(needed: number) {
        if (this.y + needed > H - m - 20) {
            this.newPage();
        }
    }

    drawTitle(label: string, catPct: number) {
        this.doc.font(FONT_REGULAR).fontSize(28).fillColor(C.black)
            .text(label, m, this.y, { lineBreak: false });
        this.doc.font("Helvetica-Bold").fontSize(11).fillColor(this.tc)
            .text(`${catPct}% WASTE`, W - m - 80, this.y + 8, { width: 80, align: "right", lineBreak: false });
        this.y += 50;
    }

    drawWhatIs(text: string) {
        this.doc.font("Helvetica-Bold").fontSize(8).fillColor(C.gold)
            .text("WHAT IS HAPPENING", m, this.y, { lineBreak: false });
        this.y += 16;
        this.doc.font(FONT_REGULAR).fontSize(11).fillColor(C.black)
            .text(text, m, this.y, { width: cw, lineGap: 3 });
        this.y += this.doc.heightOfString(text, { width: cw, font: FONT_REGULAR, fontSize: 11 }) + 24;
    }

    drawText(content: string) {
        this.ensureSpace(40);
        this.doc.font(FONT_REGULAR).fontSize(11).fillColor(C.black)
            .text(content, m, this.y, { width: cw, lineGap: 3 });
        this.y += this.doc.heightOfString(content, { width: cw, font: FONT_REGULAR, fontSize: 11 }) + 14;
    }

    drawCode(label: string | undefined, content: string) {
        // Calculate height
        const lines = content.split("\n");
        const wrappedLines: string[] = [];
        const maxChars = Math.floor(codeInnerW / 4.3); // Courier char width at 7.5pt
        for (const line of lines) {
            if (line.length <= maxChars) {
                wrappedLines.push(line);
            } else {
                // Wrap long lines
                let remaining = line;
                while (remaining.length > maxChars) {
                    wrappedLines.push(remaining.slice(0, maxChars));
                    remaining = remaining.slice(maxChars);
                }
                wrappedLines.push(remaining);
            }
        }

        const labelH = label ? 14 : 0;
        const codeH = wrappedLines.length * CODE_LINE_HEIGHT;
        const totalH = labelH + codeH + codePad * 2 + 8;

        this.ensureSpace(totalH + 10);

        // Label
        if (label) {
            this.doc.font("Helvetica-Bold").fontSize(7).fillColor(C.gold)
                .text(label.toUpperCase(), m, this.y, { lineBreak: false });
            this.y += labelH + 2;
        }

        // Dark background
        this.doc.fillColor(C.codeBg).rect(m, this.y, cw, codeH + codePad * 2).fill();

        // Code text
        let ty = this.y + codePad + CODE_FONT_SIZE + 2;
        for (const line of wrappedLines) {
            this.doc.font("Courier").fontSize(CODE_FONT_SIZE).fillColor(C.codeText)
                .text(line, m + codePad, ty, { lineBreak: false });
            ty += CODE_LINE_HEIGHT;
        }

        this.y += codeH + codePad * 2 + 14;
    }

    drawMcp(name: string, url: string) {
        this.ensureSpace(50);

        this.doc.font("Helvetica-Bold").fontSize(8).fillColor(C.gold)
            .text("MCP SERVER", m, this.y, { lineBreak: false });
        this.y += 16;

        this.doc.font(FONT_REGULAR).fontSize(11).fillColor(C.black)
            .text(name, m, this.y, { lineBreak: false });
        this.y += 16;

        this.doc.font(FONT_ITALIC).fontSize(10).fillColor(C.gold)
            .text(url, m, this.y, { width: cw, link: `https://${url}`, lineBreak: false });
        this.y += 20;
    }

    drawFirstStep(content: string) {
        const boxH = 80;
        this.ensureSpace(boxH + 20);
        // If barely fits, push to new page for clean look
        if (this.y + boxH + 20 > H - m - 10) {
            this.newPage();
        }

        const boxY = this.y + 10;
        goldLine(this.doc, m, boxY, W - m);

        this.doc.font("Helvetica-Bold").fontSize(8).fillColor(C.gold)
            .text("YOUR FIRST STEP", m, boxY + 12, { lineBreak: false });

        this.doc.font(FONT_ITALIC).fontSize(11).fillColor(C.black)
            .text(content, m, boxY + 28, { width: cw, lineGap: 3 });

        goldLine(this.doc, m, boxY + 70, W - m);
        this.y = boxY + 80;
    }
}

export function generateScorecardPDF(data: ScoreData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
        try {
            const PDFDocument = (await import("pdfkit")).default;
            const doc: Doc = new PDFDocument({
                size: "LETTER",
                margins: { top: 0, bottom: 0, left: 0, right: 0 },
            });

            const chunks: Buffer[] = [];
            doc.on("data", (c: Buffer) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));

            const tc = tierColor(data.tier);

            // ══════ PAGE 1: COVER ══════
            fillVellum(doc);
            doc.image(LOGO, m, m - 8, { width: 36 });
            doc.font("Helvetica-Bold").fontSize(9).fillColor(C.silver)
                .text("AI READINESS ASSESSMENT", m + 48, m, { lineBreak: false });
            goldLine(doc, m, m + 36, W - m);

            doc.font("Helvetica-Bold").fontSize(11).fillColor(tc)
                .text(data.tier.toUpperCase(), m, m + 56, { lineBreak: false });

            doc.font(FONT_REGULAR).fontSize(80).fillColor(C.black)
                .text(`${data.pct}%`, m, m + 78, { lineBreak: false });

            doc.font(FONT_REGULAR).fontSize(12).fillColor(C.silver)
                .text(data.tierDesc, m, m + 175, { width: cw, lineGap: 4 });

            goldLine(doc, m, m + 240, W - m);

            doc.font("Helvetica-Bold").fontSize(9).fillColor(C.silver)
                .text("ESTIMATED ANNUAL COST OF MANUAL WORK", m, m + 258, { lineBreak: false });

            doc.font(FONT_REGULAR).fontSize(38).fillColor(C.black)
                .text(`$${data.annualCost.toLocaleString()}`, m, m + 274, { lineBreak: false });

            doc.font(FONT_ITALIC).fontSize(10).fillColor(C.silver)
                .text(
                    `Based on ${data.employeeCount} employees at ~${data.wastePct}% time wasted on manual tasks`,
                    m, m + 318, { width: cw, lineBreak: false },
                );

            goldLine(doc, m, m + 345, W - m);

            doc.font("Helvetica-Bold").fontSize(9).fillColor(C.black)
                .text("WHERE YOUR FIRM IS BLEEDING TIME", m, m + 362, { lineBreak: false });

            let y = m + 385;
            const barX = m + 170;
            const barEnd = W - m - 40;
            const barW = barEnd - barX;

            for (const [cat, score, max] of data.categories) {
                const catPct = Math.round((score / max) * 100);
                const content = CATEGORY_CONTENT[cat];
                const label = content?.label || cat;

                doc.font(FONT_REGULAR).fontSize(10).fillColor(C.black)
                    .text(label, m, y, { lineBreak: false });

                doc.fillColor(C.lightSilver).rect(barX, y + 2, barW, 10).fill();
                doc.fillColor(tc).rect(barX, y + 2, Math.max((barW * catPct) / 100, 2), 10).fill();

                doc.font("Helvetica-Bold").fontSize(10).fillColor(C.black)
                    .text(`${catPct}%`, W - m - 30, y, { width: 30, align: "right", lineBreak: false });

                y += 22;
            }

            // ══════ CATEGORY PAGES ══════
            const sorted = [...data.categories].sort(
                (a, b) => b[1] / b[2] - a[1] / a[2],
            );

            const ps = new PageState(doc, tc, sorted.length);

            for (let i = 0; i < sorted.length; i++) {
                const [cat] = sorted[i];
                const content = CATEGORY_CONTENT[cat];
                if (!content) continue;

                const catPct = Math.round((sorted[i][1] / sorted[i][2]) * 100);

                ps.catIndex = i + 1;
                ps.newPage();

                // On first page of category, draw title
                ps.drawTitle(content.label, catPct);
                ps.drawWhatIs(content.whatIs);

                for (const block of content.blocks) {
                    switch (block.type) {
                        case "text":
                            ps.drawText(block.content);
                            break;
                        case "code":
                            ps.drawCode(block.label, block.content);
                            break;
                        case "mcp":
                            ps.drawMcp(block.name, block.url);
                            break;
                    }
                }

                ps.drawFirstStep(content.firstStep);
            }

            // ══════ FINAL CTA PAGE ══════
            doc.addPage();
            fillVellum(doc);
            doc.image(LOGO, m, m - 8, { width: 28 });
            goldLine(doc, m, m + 28, W - m);

            const ctaY = H / 2 - 100;

            doc.font(FONT_REGULAR).fontSize(28).fillColor(C.black)
                .text("Want all of this done for you?", m, ctaY, { width: cw, align: "center", lineBreak: false });

            doc.font(FONT_REGULAR).fontSize(13).fillColor(C.silver)
                .text(
                    "Book a free audit. We'll run a full workflow discovery across your team, map every recurring task, and give you a concrete 90-day plan to go from where you are now to AI-native operations.",
                    m, ctaY + 50, { width: cw, align: "center", lineGap: 4 },
                );

            const btnY = ctaY + 170;
            const btnText = "{ BOOK A FREE AUDIT }";
            doc.font("Helvetica-Bold").fontSize(13).fillColor(C.gold);
            doc.text(btnText, m, btnY, { width: cw, align: "center", lineBreak: false });

            doc.font(FONT_REGULAR).fontSize(11).fillColor(C.silver)
                .text("cal.com/cpfeifer/info-meeting", m, btnY + 28, { width: cw, align: "center", link: "https://cal.com/cpfeifer/info-meeting", lineBreak: false });

            goldLine(doc, m, H - m - 20, W - m);
            doc.font(FONT_REGULAR).fontSize(10).fillColor(C.silver)
                .text("Mad Cactus LLC", m, H - m - 10, { width: cw, align: "center", lineBreak: false });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

function fillVellum(doc: Doc) {
    doc.fillColor(C.vellum).rect(0, 0, W, H).fill();
}

function goldLine(doc: Doc, x1: number, y: number, x2: number) {
    doc.moveTo(x1, y).lineTo(x2, y).strokeColor(C.gold).lineWidth(1).stroke();
}
