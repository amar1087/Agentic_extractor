// src/agent/nodes/parse.ts
// PURPOSE: Turns the raw input (PDF file, image file, or plain text from an
// email body / API call) into clean plain text ready for the AI to read.

import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { AgentStateType } from "../state.js";

export async function parseNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  try {
    let rawContent: string;

    if (state.sourceType === "EMAIL_PDF") {
      if (!state.filePath) throw new Error("EMAIL_PDF job has no stored file");
      const parser = new PDFParse({ data: await fs.readFile(state.filePath) });
      try {
        rawContent = (await parser.getText()).text.trim();
      } finally {
        await parser.destroy();
      }
      if (rawContent.length < 10) {
        throw new Error("PDF has no text layer (scanned document) — OCR not yet supported for PDFs; send it as an image");
      }
    } else if (state.sourceType === "EMAIL_IMAGE") {
      // Images are read directly by the vision model in EXTRACT
      if (!state.filePath) throw new Error("EMAIL_IMAGE job has no stored file");
      return {
        status: "PARSED",
        errors: [],
        note: "Image attachment — handing off to the vision model",
      };
    } else {
      rawContent = state.text.trim();
    }

    if (!rawContent || rawContent.length < 10) {
      throw new Error("Parsed content is empty or too short to be a valid invoice");
    }

    return {
      text: rawContent,
      status: "PARSED",
      errors: [],
      note: `Read ${rawContent.length.toLocaleString()} characters of ${state.sourceType === "EMAIL_PDF" ? "PDF" : "text"}`,
    };
  } catch (err: any) {
    return {
      status: "PARSE_FAILED",
      errors: [`PARSE error: ${err.message}`],
      note: err.message,
    };
  }
}
