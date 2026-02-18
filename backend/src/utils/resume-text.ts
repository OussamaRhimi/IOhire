import fs from 'node:fs/promises';
import path from 'node:path';

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

type UploadFileLike = {
  url?: string;
  filepath?: string;
  mime?: string;
  mimetype?: string;
  ext?: string;
  name?: string;
  originalFilename?: string;
};

async function readFileBuffer(file: UploadFileLike): Promise<Buffer> {
  const filepath = typeof file.filepath === 'string' ? file.filepath.trim() : '';
  if (filepath) return await fs.readFile(filepath);

  const url = typeof file.url === 'string' ? file.url.trim() : '';
  if (!url) throw new Error('Resume file is missing both url and filepath.');

  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch resume: ${res.status} ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const relativeUrl = url.startsWith('/') ? url.slice(1) : url;
  const filePath = path.join(process.cwd(), 'public', relativeUrl);
  return await fs.readFile(filePath);
}

export async function extractTextFromResume(file: UploadFileLike): Promise<string> {
  const mime = String(file.mime ?? file.mimetype ?? '')
    .toLowerCase()
    .trim();
  const ext =
    String(file.ext ?? '').toLowerCase().trim() ||
    path.extname(String(file.url ?? file.name ?? file.originalFilename ?? file.filepath ?? '')).toLowerCase();
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
