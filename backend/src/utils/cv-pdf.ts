import PDFDocument from 'pdfkit';

type ContactInfo = {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: string[];
};

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

function stripMarkdownInline(text: string): string {
  let out = text;

  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1'); // images
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)'); // links
  out = out.replace(/`([^`]+)`/g, '$1'); // inline code
  out = out.replace(/(?<!\w)\*\*([^*]+)\*\*(?!\w)/g, '$1'); // bold
  out = out.replace(/(?<!\w)__([^_]+)__(?!\w)/g, '$1'); // bold
  out = out.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1'); // italic
  out = out.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1'); // italic
  out = out.replace(/~~([^~]+)~~/g, '$1'); // strikethrough

  // common cleanups
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = String(markdown ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const blocks: MarkdownBlock[] = [];

  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flushParagraph = () => {
    const text = stripMarkdownInline(paragraph.join(' ').trim());
    if (text) blocks.push({ type: 'paragraph', text });
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.map((item) => stripMarkdownInline(item)).filter(Boolean);
    if (items.length) blocks.push({ type: 'list', items });
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, '');
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: stripMarkdownInline(headingMatch[2]),
      });
      continue;
    }

    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    const listMatch = /^([-*+]|[0-9]+\.)\s+(.*)$/.exec(trimmed);
    if (listMatch) {
      flushParagraph();
      if (!list) list = [];
      list.push(listMatch[2]);
      continue;
    }

    const isListContinuation = !!list && (/^\s{2,}\S/.test(line) || /^\t+\S/.test(rawLine));
    if (isListContinuation) {
      list![list!.length - 1] = `${list![list!.length - 1]} ${trimmed}`;
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function buildContactLine(contact: ContactInfo): string {
  const parts: string[] = [];
  if (contact.email) parts.push(contact.email);
  if (contact.phone) parts.push(contact.phone);
  if (contact.location) parts.push(contact.location);
  for (const link of contact.links) parts.push(link);
  return parts.join(' · ');
}

export async function renderCvMarkdownToPdf(options: {
  markdown: string;
  title?: string | null;
  contact?: Partial<ContactInfo> | null;
}): Promise<Buffer> {
  const contact: ContactInfo = {
    fullName: toStringOrNull(options.contact?.fullName) ?? null,
    email: toStringOrNull(options.contact?.email) ?? null,
    phone: toStringOrNull(options.contact?.phone) ?? null,
    location: toStringOrNull(options.contact?.location) ?? null,
    links: toStringArray(options.contact?.links),
  };

  const title = toStringOrNull(options.title) ?? contact.fullName ?? 'Standardized CV';

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: { Title: title },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));
  });

  const pageWidth = doc.page.width;
  const left = doc.page.margins.left;
  const right = doc.page.margins.right;
  const contentWidth = pageWidth - left - right;

  const name = contact.fullName ?? 'Candidate';

  doc.fillColor('#111827');
  doc.font('Helvetica-Bold').fontSize(24).text(name, left, doc.y, { width: contentWidth });

  const contactLine = buildContactLine(contact);
  if (contactLine) {
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(contactLine, left, doc.y, {
      width: contentWidth,
    });
  }

  doc.moveDown(0.6);
  const yLine = doc.y;
  doc
    .moveTo(left, yLine)
    .lineTo(pageWidth - right, yLine)
    .lineWidth(1)
    .strokeColor('#e5e7eb')
    .stroke();
  doc.moveDown(1);

  const blocks = parseMarkdownBlocks(options.markdown);

  const renderHeading = (text: string) => {
    if (!text) return;
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(text.toUpperCase(), left, doc.y, {
      width: contentWidth,
    });
    doc.moveDown(0.35);
  };

  const renderParagraph = (text: string) => {
    if (!text) return;
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827').text(text, left, doc.y, {
      width: contentWidth,
      lineGap: 2,
    });
    doc.moveDown(0.35);
  };

  const renderList = (items: string[]) => {
    const bulletIndent = 14;
    const itemWidth = contentWidth - bulletIndent;
    doc.font('Helvetica').fontSize(10.5).fillColor('#111827');
    for (const item of items) {
      if (!item) continue;
      const y = doc.y;
      doc.text('•', left, y, { width: bulletIndent });
      doc.text(item, left + bulletIndent, y, { width: itemWidth, lineGap: 2 });
      doc.moveDown(0.15);
    }
    doc.moveDown(0.25);
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (block.level <= 1) continue; // header is already rendered above
      renderHeading(block.text);
      continue;
    }
    if (block.type === 'paragraph') {
      renderParagraph(block.text);
      continue;
    }
    if (block.type === 'list') {
      renderList(block.items);
    }
  }

  doc.end();
  return done;
}
