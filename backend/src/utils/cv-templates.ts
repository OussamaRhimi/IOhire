export type CvTemplateKey =
  | 'standard'
  | 'experience_first'
  | 'skills_first'
  | 'compact'
  | 'education_first'
  | 'project_focus'
  | 'sidebar_photo'
  | 'accent_pink'
  | 'teal_circle'
  | 'navy_gold'
  | 'sunset';

export type ResumeContent = {
  summary?: string | null;
  skills?: string[] | null;
  languages?: string[] | null;
  interests?: string[] | null;
  qualities?: string[] | null;
  experience?: Array<{
    company?: string | null;
    title?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    highlights?: string[] | null;
  }> | null;
  education?: Array<{
    school?: string | null;
    degree?: string | null;
    startDate?: string | null;
    endDate?: string | null;
  }> | null;
  projects?: Array<{
    name?: string | null;
    description?: string | null;
    links?: string[] | null;
  }> | null;
  certifications?: string[] | null;
};

export type ResumeContact = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  links?: string[] | null;
  photoUrl?: string | null;
};

export type CvTemplateMeta = {
  key: CvTemplateKey;
  name: string;
  description: string;
};

const TEMPLATES: CvTemplateMeta[] = [
  {
    key: 'standard',
    name: 'Standard (Blue)',
    description: 'Clean single-column with blue accents and section rules.',
  },
  {
    key: 'experience_first',
    name: 'Modern (Accent Header)',
    description: 'Gradient header band + crisp sections.',
  },
  {
    key: 'skills_first',
    name: 'Two Column',
    description: 'Two-column layout with skill meters in sidebar.',
  },
  {
    key: 'compact',
    name: 'Compact',
    description: 'Denser spacing for longer resumes.',
  },
  {
    key: 'education_first',
    name: 'Minimal',
    description: 'Minimal, monochrome, very ATS-friendly.',
  },
  {
    key: 'project_focus',
    name: 'Project Focus',
    description: 'Projects highlighted early with accent headers.',
  },
  {
    key: 'sidebar_photo',
    name: 'Sidebar + Photo',
    description: 'Dark sidebar with photo + tag chips.',
  },
  {
    key: 'teal_circle',
    name: 'Teal Circle',
    description: 'Circular photo header + teal dividers.',
  },
  {
    key: 'accent_pink',
    name: 'Pink Accent',
    description: 'Pink accent with right contact card.',
  },
  {
    key: 'navy_gold',
    name: 'Navy & Gold',
    description: 'Premium look: navy blocks + gold accents.',
  },
  {
    key: 'sunset',
    name: 'Sunset',
    description: 'Warm gradient header + soft section cards.',
  },
];

export function listCvTemplates(): CvTemplateMeta[] {
  return [...TEMPLATES];
}

export function isCvTemplateKey(value: unknown): value is CvTemplateKey {
  return typeof value === 'string' && (TEMPLATES as any[]).some((t) => t.key === value);
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

function stableScore(text: string): number {
  const s = String(text ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatExperienceItem(item: NonNullable<ResumeContent['experience']>[number]): string[] {
  const title = toStringOrNull(item.title);
  const company = toStringOrNull(item.company);
  const startDate = toStringOrNull(item.startDate);
  const endDate = toStringOrNull(item.endDate);

  const headerParts: string[] = [];
  if (title) headerParts.push(title);
  if (company) headerParts.push(company);
  const header = headerParts.join(' — ');

  const dateParts: string[] = [];
  if (startDate) dateParts.push(startDate);
  if (endDate) dateParts.push(endDate);
  const dates = dateParts.join(' – ');

  const lines: string[] = [];
  if (header && dates) lines.push(`**${header}** (${dates})`);
  else if (header) lines.push(`**${header}**`);
  else if (dates) lines.push(`**${dates}**`);

  for (const h of toStringArray(item.highlights)) lines.push(h);
  return lines;
}

function renderSections(order: Array<keyof Required<ResumeContent>>, content: ResumeContent): string {
  const md: string[] = [];

  for (const section of order) {
    if (section === 'summary') {
      const summary = toStringOrNull(content.summary);
      if (!summary) continue;
      md.push('## Summary', '', summary, '');
      continue;
    }

    if (section === 'skills') {
      const skills = toStringArray(content.skills);
      if (!skills.length) continue;
      md.push('## Skills', '', ...skills.map((s) => `- ${s}`), '');
      continue;
    }

    if (section === 'experience') {
      const experience = Array.isArray(content.experience) ? content.experience : [];
      const anyLines = experience.flatMap((item) => formatExperienceItem(item));
      if (!anyLines.length) continue;
      md.push('## Experience', '');

      // Group each experience entry as: bold header line + bullets.
      for (const item of experience) {
        const lines = formatExperienceItem(item);
        if (!lines.length) continue;
        const [head, ...rest] = lines;
        const hasHeader = typeof head === 'string' && head.trim().startsWith('**');

        if (hasHeader) {
          md.push(head);
          for (const h of rest) md.push(`- ${h}`);
        } else {
          for (const h of lines) md.push(`- ${h}`);
        }
        md.push('');
      }
      continue;
    }

    if (section === 'education') {
      const education = Array.isArray(content.education) ? content.education : [];
      const lines: string[] = [];
      for (const e of education) {
        const school = toStringOrNull(e.school);
        const degree = toStringOrNull(e.degree);
        const start = toStringOrNull(e.startDate);
        const end = toStringOrNull(e.endDate);

        const left = [degree, school].filter(Boolean).join(' — ');
        const right = [start, end].filter(Boolean).join(' – ');
        const row = right ? `${left} (${right})` : left;
        if (row) lines.push(row);
      }
      if (!lines.length) continue;
      md.push('## Education', '', ...lines.map((l) => `- ${l}`), '');
      continue;
    }

    if (section === 'projects') {
      const projects = Array.isArray(content.projects) ? content.projects : [];
      const blocks: string[] = [];
      for (const p of projects) {
        const name = toStringOrNull(p.name);
        const desc = toStringOrNull(p.description);
        const links = toStringArray(p.links);
        const head = name ? `**${name}**` : null;
        if (head) blocks.push(head);
        if (desc) blocks.push(`- ${desc}`);
        for (const link of links) blocks.push(`- ${link}`);
        if (head || desc || links.length) blocks.push('');
      }
      if (!blocks.length) continue;
      md.push('## Projects', '', ...blocks);
      continue;
    }

    if (section === 'certifications') {
      const certs = toStringArray(content.certifications);
      if (!certs.length) continue;
      md.push('## Certifications', '', ...certs.map((c) => `- ${c}`), '');
      continue;
    }
  }

  return md.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export function renderCvMarkdownFromTemplate(templateKey: CvTemplateKey, content: ResumeContent): string {
  const normalizedKey: CvTemplateKey = isCvTemplateKey(templateKey) ? templateKey : 'standard';

  if (normalizedKey === 'experience_first') {
    return renderSections(['experience', 'summary', 'skills', 'education', 'projects', 'certifications'], content);
  }
  if (normalizedKey === 'skills_first') {
    return renderSections(['skills', 'summary', 'experience', 'education', 'projects', 'certifications'], content);
  }
  if (normalizedKey === 'education_first') {
    return renderSections(['summary', 'skills', 'education', 'experience', 'projects', 'certifications'], content);
  }
  if (normalizedKey === 'project_focus') {
    return renderSections(['summary', 'projects', 'skills', 'experience', 'education', 'certifications'], content);
  }
  if (normalizedKey === 'compact') {
    const out = renderSections(['summary', 'skills', 'experience', 'projects', 'education', 'certifications'], content);
    return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  return renderSections(['summary', 'skills', 'experience', 'education', 'projects', 'certifications'], content);
}

function formatContactLine(contact: ResumeContact): string {
  const parts: string[] = [];
  const email = toStringOrNull(contact.email);
  const phone = toStringOrNull(contact.phone);
  const location = toStringOrNull(contact.location);
  if (email) parts.push(email);
  if (phone) parts.push(phone);
  if (location) parts.push(location);
  for (const link of toStringArray(contact.links)) parts.push(link);
  return parts.join(' • ');
}

function chips(items: string[]): string {
  const html = items.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  return `<div class="chips">${html}</div>`;
}

function dotsForSkill(skill: string): string {
  const level = (stableScore(skill) % 4) + 2; // 2..5
  const dots = new Array(5)
    .fill(0)
    .map((_, i) => `<span class="dot ${i < level ? 'dot--on' : ''}"></span>`)
    .join('');
  return `<div class="dots">${dots}</div>`;
}

function section(title: string, innerHtml: string): string {
  if (!innerHtml.trim()) return '';
  return `<section class="sec"><h2 class="sec__title">${escapeHtml(title)}</h2>${innerHtml}</section>`;
}

function ul(items: string[]): string {
  const li = items.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  return `<ul class="list">${li}</ul>`;
}

function renderCoreHtml(content: ResumeContent, opts?: { order?: Array<keyof Required<ResumeContent>> }): string {
  const order = opts?.order ?? ['summary', 'skills', 'experience', 'education', 'projects', 'certifications'];

  const out: string[] = [];
  for (const sec of order) {
    if (sec === 'summary') {
      const summary = toStringOrNull(content.summary);
      if (!summary) continue;
      out.push(section('Summary', `<p class="p">${escapeHtml(summary)}</p>`));
      continue;
    }
    if (sec === 'skills') {
      const skills = toStringArray(content.skills);
      if (!skills.length) continue;
      out.push(section('Skills', ul(skills)));
      continue;
    }

    if (sec === 'languages') {
      const languages = toStringArray(content.languages);
      if (!languages.length) continue;
      out.push(section('Languages', ul(languages)));
      continue;
    }

    if (sec === 'qualities') {
      const qualities = toStringArray(content.qualities);
      if (!qualities.length) continue;
      out.push(section('Qualities', ul(qualities)));
      continue;
    }

    if (sec === 'interests') {
      const interests = toStringArray(content.interests);
      if (!interests.length) continue;
      out.push(section('Interests', ul(interests)));
      continue;
    }
    if (sec === 'experience') {
      const experience = Array.isArray(content.experience) ? content.experience : [];
      const blocks: string[] = [];
      for (const e of experience) {
        const title = toStringOrNull(e.title);
        const company = toStringOrNull(e.company);
        const start = toStringOrNull(e.startDate);
        const end = toStringOrNull(e.endDate);
        const header = [title, company].filter(Boolean).join(' — ');
        const dates = [start, end].filter(Boolean).join(' – ');
        const h = header ? `<div class="item__title">${escapeHtml(header)}</div>` : '';
        const d = dates ? `<div class="item__meta">${escapeHtml(dates)}</div>` : '';
        const highlights = toStringArray(e.highlights);
        const list = highlights.length ? ul(highlights) : '';
        if (!h && !d && !list) continue;
        blocks.push(`<div class="item">${h}${d}${list}</div>`);
      }
      if (!blocks.length) continue;
      out.push(section('Experience', blocks.join('')));
      continue;
    }
    if (sec === 'education') {
      const education = Array.isArray(content.education) ? content.education : [];
      const items: string[] = [];
      for (const e of education) {
        const school = toStringOrNull(e.school);
        const degree = toStringOrNull(e.degree);
        const start = toStringOrNull(e.startDate);
        const end = toStringOrNull(e.endDate);
        const left = [degree, school].filter(Boolean).join(' — ');
        const right = [start, end].filter(Boolean).join(' – ');
        const row = right ? `${left} (${right})` : left;
        if (row) items.push(row);
      }
      if (!items.length) continue;
      out.push(section('Education', ul(items)));
      continue;
    }
    if (sec === 'projects') {
      const projects = Array.isArray(content.projects) ? content.projects : [];
      const blocks: string[] = [];
      for (const p of projects) {
        const name = toStringOrNull(p.name);
        const desc = toStringOrNull(p.description);
        const links = toStringArray(p.links);
        const head = name ? `<div class="item__title">${escapeHtml(name)}</div>` : '';
        const body = desc ? `<p class="p">${escapeHtml(desc)}</p>` : '';
        const list = links.length ? ul(links) : '';
        if (!head && !body && !list) continue;
        blocks.push(`<div class="item">${head}${body}${list}</div>`);
      }
      if (!blocks.length) continue;
      out.push(section('Projects', blocks.join('')));
      continue;
    }
    if (sec === 'certifications') {
      const certs = toStringArray(content.certifications);
      if (!certs.length) continue;
      out.push(section('Certifications', ul(certs)));
    }
  }

  return out.join('');
}

export function renderCvHtmlFromTemplate(templateKey: CvTemplateKey, data: { contact: ResumeContact; content: ResumeContent }): string {
  const key: CvTemplateKey = isCvTemplateKey(templateKey) ? templateKey : 'standard';
  const name = toStringOrNull(data.contact.fullName) ?? 'Candidate';
  const contactLine = formatContactLine(data.contact);
  const photoUrl = toStringOrNull(data.contact.photoUrl);

  const baseCss = `
    :root { --fg: #111827; --muted: #6b7280; --border: #e5e7eb; --accent: #2563eb; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: var(--fg); font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
    .page { padding: 36px 44px; }
    .hdr { margin-bottom: 14px; }
    .name { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
    .contact { margin-top: 6px; font-size: 11px; color: var(--muted); }
    .rule { height: 1px; background: var(--border); margin: 14px 0 18px; }
    .sec { margin: 0 0 14px; }
    .sec__title { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--fg); }
    .p { margin: 0 0 8px; font-size: 11.2px; line-height: 1.55; color: var(--fg); }
    .list { margin: 0; padding-left: 18px; }
    .list > li { font-size: 11.2px; line-height: 1.5; margin: 0 0 4px; }
    .item { margin: 0 0 10px; }
    .item__title { font-size: 11.5px; font-weight: 700; margin: 0 0 2px; }
    .item__meta { font-size: 10.5px; color: var(--muted); margin: 0 0 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; padding: 4px 8px; font-size: 10.5px; color: var(--fg); background: #fff; }
    .dots { display: inline-flex; gap: 4px; vertical-align: middle; margin-left: 8px; }
    .dot { width: 6px; height: 6px; border-radius: 999px; background: #d1d5db; display: inline-block; }
    .dot--on { background: var(--accent); }
    .photo { width: 86px; height: 86px; border-radius: 999px; border: 3px solid rgba(255,255,255,0.85); object-fit: cover; background: #f3f4f6; }
    @page { size: Letter; margin: 0; }
  `;

  const classicBody = renderCoreHtml(data.content);

  if (key === 'standard') {
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #1d4ed8; }
      .name { color: #0b1220; }
      .rule { background: rgba(29,78,216,0.18); height: 2px; border-radius: 999px; }
      .sec__title { color: var(--accent); }
      .item { padding-left: 10px; border-left: 2px solid rgba(29,78,216,0.18); }
    </style></head><body>
      <div class="page">
        <header class="hdr">
          <h1 class="name">${escapeHtml(name)}</h1>
          ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
        </header>
        <div class="rule"></div>
        ${classicBody}
      </div>
    </body></html>`;
  }

  if (key === 'compact') {
    const html = renderCoreHtml(data.content);
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      .page { padding: 30px 38px; }
      .sec { margin-bottom: 10px; }
      .list > li { margin-bottom: 2px; }
      .sec__title { color: #0f172a; border-bottom: 1px solid rgba(15,23,42,0.14); padding-bottom: 6px; }
    </style></head><body>
      <div class="page">
        <header class="hdr">
          <h1 class="name">${escapeHtml(name)}</h1>
          ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
        </header>
        <div class="rule"></div>
        ${html}
      </div>
    </body></html>`;
  }

  if (key === 'experience_first') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'experience', 'skills', 'projects', 'education', 'certifications'] });
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #0f766e; }
      .band { background: linear-gradient(90deg, #0ea5e9, #22c55e); color: #fff; padding: 28px 44px; }
      .band .name { color: #fff; }
      .band .contact { color: rgba(255,255,255,0.86); }
      .page { padding: 0; }
      .inner { padding: 18px 44px 28px; }
      .rule { margin: 0 0 18px; }
      .sec__title { color: #0f172a; }
      .sec__title { position: relative; padding-left: 12px; }
      .sec__title::before { content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 4px; border-radius: 999px; background: linear-gradient(180deg, #0ea5e9, #22c55e); }
    </style></head><body>
      <div class="page">
        <div class="band">
          <h1 class="name">${escapeHtml(name)}</h1>
          ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
        </div>
        <div class="inner">
          <div class="rule"></div>
          ${html}
        </div>
      </div>
    </body></html>`;
  }

  if (key === 'skills_first') {
    const mainHtml = renderCoreHtml(data.content, { order: ['summary', 'experience', 'projects', 'education', 'certifications'] });
    const skills = toStringArray(data.content.skills);
    const sidebar = `
      <div class="side__box">
        <div class="side__title">Skills</div>
        ${skills.length ? `<ul class="side__list">${skills.map((s) => `<li><span>${escapeHtml(s)}</span>${dotsForSkill(s)}</li>`).join('')}</ul>` : `<div class="side__muted">(Not provided)</div>`}
      </div>
    `;

    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #7c3aed; }
      .page { padding: 30px 36px; }
      .grid { display: grid; grid-template-columns: 210px 1fr; gap: 18px; }
      .side { border: 1px solid rgba(124,58,237,0.22); border-radius: 14px; padding: 12px; background: linear-gradient(180deg, rgba(124,58,237,0.08), rgba(14,165,233,0.05)); }
      .side__title { font-size: 12px; font-weight: 800; margin-bottom: 8px; color: var(--fg); }
      .side__muted { font-size: 10.5px; color: var(--muted); }
      .side__list { margin: 0; padding-left: 16px; }
      .side__list > li { font-size: 11px; margin-bottom: 3px; line-height: 1.35; }
      .name { font-size: 24px; }
      .sec__title { color: var(--accent); }
    </style></head><body>
      <div class="page">
        <header class="hdr">
          <h1 class="name">${escapeHtml(name)}</h1>
          ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
        </header>
        <div class="rule"></div>
        <div class="grid">
          <aside class="side">${sidebar}</aside>
          <main>${mainHtml}</main>
        </div>
      </div>
    </body></html>`;
  }

  if (key === 'education_first') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'education', 'skills', 'projects', 'experience', 'certifications'] });
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #111827; }
      .sec__title { border-left: 3px solid rgba(17,24,39,0.22); padding-left: 10px; color: #0f172a; }
      .name { font-weight: 900; }
      .rule { background: rgba(17,24,39,0.14); }
      .chip { background: #fff; }
    </style></head><body>
      <div class="page">
        <header class="hdr">
          <h1 class="name">${escapeHtml(name)}</h1>
          ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
        </header>
        <div class="rule"></div>
        ${html}
      </div>
    </body></html>`;
  }

  if (key === 'project_focus') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'projects', 'skills', 'experience', 'education', 'certifications'] });
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #1d4ed8; }
      .sec__title { color: var(--accent); }
      .rule { background: rgba(29,78,216,0.18); height: 2px; border-radius: 999px; }
      .item { border: 1px solid rgba(29,78,216,0.14); border-radius: 12px; padding: 10px 12px; }
    </style></head><body>
      <div class="page">
        <header class="hdr">
          <h1 class="name">${escapeHtml(name)}</h1>
          ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
        </header>
        <div class="rule"></div>
        ${html}
      </div>
    </body></html>`;
  }

  if (key === 'sidebar_photo') {
    const skills = toStringArray(data.content.skills);
    const languages = toStringArray(data.content.languages);
    const interests = toStringArray(data.content.interests);
    const qualities = toStringArray(data.content.qualities);
    const mainHtml = renderCoreHtml(data.content, { order: ['summary', 'experience', 'education', 'projects', 'certifications'] });

    const contactBits = [
      toStringOrNull(data.contact.email),
      toStringOrNull(data.contact.phone),
      toStringOrNull(data.contact.location),
      ...toStringArray(data.contact.links),
    ].filter(Boolean) as string[];

    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #0ea5e9; }
      body { background: #ffffff; }
      .page { padding: 0; }
      .wrap { display: grid; grid-template-columns: 250px 1fr; min-height: 1056px; }
      .side { background: #0b1220; color: rgba(255,255,255,0.92); padding: 28px 22px; }
      .side .muted { color: rgba(255,255,255,0.72); }
      .side h2 { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 18px 0 10px; color: rgba(255,255,255,0.95); }
      .side ul { margin: 0; padding-left: 18px; }
      .side li { font-size: 11px; line-height: 1.5; margin: 0 0 4px; }
      .main { padding: 34px 44px; }
      .name { font-size: 24px; color: #ffffff; margin-top: 14px; }
      .photoWrap { display: grid; place-items: start; }
      .photo { border-color: rgba(255,255,255,0.45); }
      .contactLine { margin-top: 10px; font-size: 10.5px; color: rgba(255,255,255,0.78); }
      .sec__title { color: #0f172a; }
      .rule { background: rgba(15,23,42,0.10); }
      .chip { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.18); color: rgba(255,255,255,0.92); }
      .chips { margin-top: 10px; }
      .side::before { content: ''; display: block; height: 6px; width: 100%; border-radius: 999px; background: linear-gradient(90deg, #0ea5e9, #22c55e, #f59e0b); margin-bottom: 18px; }
      .main .sec__title { color: #0ea5e9; }
      .main .sec__title { position: relative; padding-bottom: 6px; border-bottom: 1px solid rgba(14,165,233,0.18); }
    </style></head><body>
      <div class="page">
        <div class="wrap">
          <aside class="side">
            <div class="photoWrap">
              ${photoUrl ? `<img class="photo" src="${escapeHtml(photoUrl)}" alt="Photo" />` : `<div class="photo" style="display:grid;place-items:center;color:rgba(255,255,255,0.55);font-weight:700;">CV</div>`}
            </div>
            <div class="name">${escapeHtml(name)}</div>
            ${contactBits.length ? `<div class="contactLine">${escapeHtml(contactBits.join(' • '))}</div>` : ''}

            ${skills.length ? `<h2>Skills</h2>${chips(skills.slice(0, 18))}` : ''}
            ${languages.length ? `<h2>Languages</h2>${ul(languages)}` : ''}
            ${qualities.length ? `<h2>Qualities</h2>${ul(qualities)}` : ''}
            ${interests.length ? `<h2>Interests</h2>${ul(interests)}` : ''}
          </aside>
          <main class="main">
            ${mainHtml}
          </main>
        </div>
      </div>
    </body></html>`;
  }

  if (key === 'teal_circle') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'experience', 'skills', 'education', 'projects', 'certifications', 'languages', 'interests'] });
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #14b8a6; --fg: #0f172a; --muted: #475569; --border: rgba(15,23,42,0.14); }
      .page { padding: 0; }
      .top { background: linear-gradient(90deg, #0f172a, #0b1220); color: #fff; padding: 28px 44px 24px; display: grid; grid-template-columns: 110px 1fr; gap: 16px; align-items: center; }
      .name { color: #fff; margin: 0; font-size: 24px; }
      .contact { color: rgba(255,255,255,0.85); }
      .rule { display: none; }
      .body { padding: 22px 44px 30px; }
      .sec__title { color: var(--accent); }
      .photo { border-color: rgba(255,255,255,0.40); }
      .sec__title { border-bottom: 1px solid rgba(20,184,166,0.20); padding-bottom: 6px; }
    </style></head><body>
      <div class="page">
        <div class="top">
          <div>
            ${photoUrl ? `<img class="photo" src="${escapeHtml(photoUrl)}" alt="Photo" />` : `<div class="photo" style="display:grid;place-items:center;color:rgba(255,255,255,0.6);font-weight:700;">CV</div>`}
          </div>
          <div>
            <h1 class="name">${escapeHtml(name)}</h1>
            ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
          </div>
        </div>
        <div class="body">${html}</div>
      </div>
    </body></html>`;
  }

  if (key === 'accent_pink') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'skills', 'experience', 'education', 'projects', 'certifications', 'languages', 'qualities', 'interests'] });
    const email = toStringOrNull(data.contact.email);
    const phone = toStringOrNull(data.contact.phone);
    const location = toStringOrNull(data.contact.location);

    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #db2777; --fg: #111827; --muted: #6b7280; --border: rgba(17,24,39,0.14); }
      .hdr { display: grid; grid-template-columns: 1fr 240px; gap: 16px; align-items: start; }
      .box { border: 1px solid var(--border); border-radius: 14px; padding: 12px 14px; }
      .box .k { font-size: 10.5px; color: var(--accent); margin: 0 0 4px; }
      .box .v { font-size: 11px; color: var(--fg); margin: 0 0 8px; }
      .name { color: var(--accent); font-size: 26px; }
      .rule { background: rgba(219,39,119,0.18); height: 2px; border-radius: 999px; }
      .sec__title { color: var(--accent); }
      .page { position: relative; }
      .page::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 18px; background: linear-gradient(180deg, rgba(219,39,119,0.32), rgba(219,39,119,0.06)); }
      .page { padding-left: 62px; }
    </style></head><body>
      <div class="page">
        <header class="hdr">
          <div>
            <h1 class="name">${escapeHtml(name)}</h1>
            ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
          </div>
          <div class="box">
            ${email ? `<div class="k">Email</div><div class="v">${escapeHtml(email)}</div>` : ''}
            ${phone ? `<div class="k">Phone</div><div class="v">${escapeHtml(phone)}</div>` : ''}
            ${location ? `<div class="k">Address</div><div class="v">${escapeHtml(location)}</div>` : ''}
          </div>
        </header>
        <div class="rule"></div>
        ${html}
      </div>
    </body></html>`;
  }

  if (key === 'navy_gold') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'languages', 'qualities', 'interests'] });
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #d4af37; --fg: #0b1220; --muted: rgba(255,255,255,0.78); --border: rgba(212,175,55,0.24); }
      .page { padding: 0; }
      .frame { padding: 34px 40px; background: #0b1220; min-height: 1056px; }
      .card { background: #ffffff; border-radius: 18px; padding: 26px 28px; }
      .name { color: #0b1220; font-size: 26px; }
      .contact { color: rgba(11,18,32,0.72); }
      .rule { height: 2px; border-radius: 999px; background: linear-gradient(90deg, rgba(212,175,55,0.55), rgba(212,175,55,0.12)); }
      .sec__title { color: #0b1220; }
      .sec__title { position: relative; padding-left: 12px; }
      .sec__title::before { content: ''; position: absolute; left: 0; top: 2px; bottom: 2px; width: 4px; border-radius: 999px; background: rgba(212,175,55,0.95); }
    </style></head><body>
      <div class="page">
        <div class="frame">
          <div class="card">
            <header class="hdr">
              <h1 class="name">${escapeHtml(name)}</h1>
              ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
            </header>
            <div class="rule"></div>
            ${html}
          </div>
        </div>
      </div>
    </body></html>`;
  }

  if (key === 'sunset') {
    const html = renderCoreHtml(data.content, { order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'languages', 'qualities', 'interests'] });
    return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>
      ${baseCss}
      :root { --accent: #f97316; --fg: #0f172a; --muted: #475569; --border: rgba(15,23,42,0.14); }
      .page { padding: 0; background: #fff7ed; min-height: 1056px; }
      .top { background: linear-gradient(90deg, #fb7185, #f97316, #f59e0b); padding: 26px 44px; color: #fff; display: grid; grid-template-columns: 110px 1fr; gap: 16px; align-items: center; }
      .name { color: #fff; margin: 0; font-size: 24px; }
      .contact { color: rgba(255,255,255,0.9); }
      .body { padding: 18px 44px 30px; }
      .sec { background: #ffffff; border: 1px solid rgba(15,23,42,0.08); border-radius: 14px; padding: 12px 14px; }
      .sec__title { color: #0f172a; }
      .sec__title { border-bottom: 1px solid rgba(249,115,22,0.22); padding-bottom: 6px; }
      .rule { display: none; }
      .photo { border-color: rgba(255,255,255,0.55); }
    </style></head><body>
      <div class="page">
        <div class="top">
          <div>
            ${photoUrl ? `<img class="photo" src="${escapeHtml(photoUrl)}" alt="Photo" />` : `<div class="photo" style="display:grid;place-items:center;color:rgba(255,255,255,0.7);font-weight:700;">CV</div>`}
          </div>
          <div>
            <h1 class="name">${escapeHtml(name)}</h1>
            ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
          </div>
        </div>
        <div class="body">${html}</div>
      </div>
    </body></html>`;
  }

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(name)}</title><style>${baseCss}</style></head><body>
    <div class="page">
      <header class="hdr">
        <h1 class="name">${escapeHtml(name)}</h1>
        ${contactLine ? `<div class="contact">${escapeHtml(contactLine)}</div>` : ''}
      </header>
      <div class="rule"></div>
      ${classicBody}
    </div>
  </body></html>`;
}
