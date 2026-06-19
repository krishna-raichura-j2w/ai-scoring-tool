import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";
import { extname } from "path";
import mammoth from "mammoth";

const execFileP = promisify(execFile);

// Extract plain text from a resume / JD file based on its extension.
export async function extractText(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".pdf") {
    // pdftotext (poppler) -> stdout
    const { stdout } = await execFileP("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 1024 * 1024 * 20,
    });
    return clean(stdout);
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
