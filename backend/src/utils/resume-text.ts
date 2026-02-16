import fs from 'node:fs/promises';
import path from 'node:path';

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

type UploadFileLike = {
  url: string;
  mime?: string;
  ext?: string;
  name?: string;
};

async function readFileBuffer(file: UploadFileLike): Promise<Buffer> {
  if (/^https?:\/\//i.test(file.url)) {
    const res = await fetch(file.url);
    if (!res.ok) throw new Error(`Failed to fetch resume: ${res.status} ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const relativeUrl = file.url.startsWith('/') ? file.url.slice(1) : file.url;
  const filePath = path.join(process.cwd(), 'public', relativeUrl);
  return await fs.readFile(filePath);
}

export async function extractTextFromResume(file: UploadFileLike): Promise<string> {
  const mime = file.mime?.toLowerCase() ?? '';
  const ext = (file.ext ?? path.extname(file.url)).toLowerCase();
  const buffer = await readFileBuffer(file);

  if (mime.includes('pdf') || ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      return parsed.text ?? '';
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  if (
    mime.includes('officedocument') ||
    mime.includes('msword') ||
    mime.includes('wordprocessingml') ||
    ext === '.docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value ?? '';
  }

  if (mime.startsWith('text/') || ext === '.txt') {
    return buffer.toString('utf8');
  }

  throw new Error(`Unsupported resume file type (mime=${file.mime ?? 'unknown'}, ext=${file.ext ?? ext})`);
}
