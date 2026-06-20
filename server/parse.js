import { readFile } from "fs/promises";
import { basename, extname } from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { logger } from "./log.js";

const log = logger("parse");

// Extract plain text from a resume / JD file based on its extension.
export async function extractText(filePath) {
  const ext = extname(filePath).toLowerCase();
  const done = log.step("extractText", { file: basename(filePath), type: ext.replace(".", "") || "txt" });
  try {
    let text;
    if (ext === ".pdf") {
      // pure-JS PDF text extraction (no external binary required)
      const data = await readFile(filePath);
      const parser = new PDFParse({ data });
      try {
        text = clean((await parser.getText()).text);
      } finally {
        await parser.destroy();
      }
    } else if (ext === ".docx") {
      const { value } = await mammoth.extractRawText({ path: filePath });
      text = clean(value);
    } else {
      // .txt and anything else: read as utf-8
      text = clean(await readFile(filePath, "utf-8"));
    }
    done({ chars: text.length });
    return text;
  } catch (e) {
    log.error("extractText failed", { file: basename(filePath), error: String(e.message || e) });
    throw e;
  }
}

function clean(s) {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
