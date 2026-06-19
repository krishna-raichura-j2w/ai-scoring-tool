import { readFile } from "fs/promises";
import { extname } from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

// Extract plain text from a resume / JD file based on its extension.
export async function extractText(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    // pure-JS PDF text extraction (no external binary required)
    const data = await readFile(filePath);
    const parser = new PDFParse({ data });
    try {
      const { text } = await parser.getText();
      return clean(text);
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ path: filePath });
    return clean(value);
  }
  // .txt and anything else: read as utf-8
  const buf = await readFile(filePath, "utf-8");
  return clean(buf);
}

function clean(s) {
  return (s || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
