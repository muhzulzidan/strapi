import type { Core } from '@strapi/strapi';

// Render Strapi blocks (rich text) to HTML
function renderBlocks(blocks: any[]): string {
  if (!blocks || !Array.isArray(blocks)) return '';

  return blocks.map((block) => {
    if (!block) return '';

    switch (block.type) {
      case 'paragraph':
        return `<p>${renderInline(block.children)}</p>`;
      case 'heading': {
        const level = block.level || 2;
        return `<h${level}>${renderInline(block.children)}</h${level}>`;
      }
      case 'list': {
        const tag = block.format === 'ordered' ? 'ol' : 'ul';
        const items = (block.children || [])
          .map((item: any) => `<li>${renderInline(item.children)}</li>`)
          .join('');
        return `<${tag}>${items}</${tag}>`;
      }
      case 'quote':
        return `<blockquote>${renderInline(block.children)}</blockquote>`;
      case 'code':
        return `<pre><code>${escapeHtml(block.children?.[0]?.text || '')}</code></pre>`;
      case 'image': {
        const src = block.image?.url || '';
        const alt = block.image?.alternativeText || '';
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" style="max-width:100%;border-radius:6px;" />`;
      }
      default:
        return '';
    }
  }).join('\n');
}

function renderInline(children: any[]): string {
  if (!children) return '';
  return children.map((child) => {
    if (!child) return '';
    if (child.type === 'link') {
      return `<a href="${escapeHtml(child.url || '')}" target="_blank" rel="noopener">${renderInline(child.children)}</a>`;
    }
    let text = escapeHtml(child.text || '');
    if (child.bold) text = `<strong>${text}</strong>`;
    if (child.italic) text = `<em>${text}</em>`;
    if (child.underline) text = `<u>${text}</u>`;
    if (child.strikethrough) text = `<s>${text}</s>`;
    if (child.code) text = `<code>${text}</code>`;
    return text;
  }).join('');
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDocument(uid: string, doc: any): string {
  const fields: string[] = [];

  // Cover image
  const img = doc.image?.url || doc.coverImage?.url;
  if (img) {
    fields.push(`<img src="${escapeHtml(img)}" alt="${escapeHtml(doc.title || '')}" class="cover-img" />`);
  }

  // Title
  if (doc.title) {
    fields.push(`<h1 class="doc-title">${escapeHtml(doc.title)}</h1>`);
  }

  // Meta row (date, category, author, etc.)
  const meta: string[] = [];
  if (doc.date) meta.push(`<span>📅 ${new Date(doc.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>`);
  if (doc.author?.name) meta.push(`<span>✍️ ${escapeHtml(doc.author.name)}</span>`);
  if (doc.category?.name) meta.push(`<span>🏷️ ${escapeHtml(doc.category.name)}</span>`);
  if (doc.department) meta.push(`<span>🏢 ${escapeHtml(doc.department)}</span>`);
  if (doc.location) meta.push(`<span>📍 ${escapeHtml(typeof doc.location === 'string' ? doc.location : doc.locationText || '')}</span>`);
  if (doc.workType) meta.push(`<span>⏱️ ${escapeHtml(doc.workType)}</span>`);
  if (meta.length) {
    fields.push(`<div class="meta-row">${meta.join('')}</div>`);
  }

  // Description / short summary
  const description = doc.description || doc.shortSummary;
  if (description) {
    if (Array.isArray(description)) {
      fields.push(`<div class="description">${renderBlocks(description)}</div>`);
    } else {
      fields.push(`<p class="description">${escapeHtml(description)}</p>`);
    }
  }

  // Main content
  if (doc.content) {
    if (Array.isArray(doc.content)) {
      // Blocks
      fields.push(`<div class="content">${renderBlocks(doc.content)}</div>`);
    } else {
      // Plain text / richtext
      fields.push(`<div class="content"><pre class="plaintext">${escapeHtml(doc.content)}</pre></div>`);
    }
  }

  // Rich text (legal, job)
  if (doc.body && typeof doc.body === 'string') {
    fields.push(`<div class="content"><pre class="plaintext">${escapeHtml(doc.body)}</pre></div>`);
  }

  return fields.join('\n');
}

export default {
  async render(ctx: any) {
    const { uid, documentId, status = 'draft', secret } = ctx.query as Record<string, string>;

    // Validate secret
    const expectedSecret = process.env.PREVIEW_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      ctx.status = 401;
      ctx.body = 'Unauthorized';
      return;
    }

    if (!uid || !documentId) {
      ctx.status = 400;
      ctx.body = 'Missing uid or documentId';
      return;
    }

    let doc: any;
    try {
      doc = await strapi.documents(uid as any).findOne({
        documentId,
        status: status as any,
        populate: '*',
      });
    } catch (e: any) {
      strapi.log.error(`[preview-render] findOne failed uid=${uid} docId=${documentId} status=${status}: ${e?.message}`);
      ctx.status = 500;
      ctx.body = `Error: ${e?.message}`;
      return;
    }

    if (!doc) {
      ctx.status = 404;
      ctx.body = 'Document not found';
      return;
    }

    const isDraft = status === 'draft';
    const statusBadge = isDraft
      ? `<span class="badge draft">DRAFT</span>`
      : `<span class="badge published">PUBLISHED</span>`;

    const bodyContent = renderDocument(uid, doc);

    ctx.set('Content-Type', 'text/html; charset=utf-8');
    // Allow embedding in Strapi admin iframe
    ctx.set('X-Frame-Options', 'SAMEORIGIN');
    ctx.set('Content-Security-Policy', "frame-ancestors 'self'");

    ctx.body = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title || 'Preview')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8f9fa;
      color: #2d3748;
      min-height: 100vh;
    }
    .preview-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: #1a1f2e;
      color: #fff;
      padding: 10px 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      border-bottom: 2px solid ${isDraft ? '#f59e0b' : '#10b981'};
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .badge.draft { background: #f59e0b; color: #1a1f2e; }
    .badge.published { background: #10b981; color: #fff; }
    .preview-label { opacity: .6; font-size: 12px; }
    .uid-label { opacity: .4; font-size: 11px; margin-left: auto; }
    .container {
      max-width: 800px;
      margin: 40px auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,.08);
      overflow: hidden;
    }
    .content-body { padding: 40px 48px; }
    .cover-img { width: 100%; max-height: 400px; object-fit: cover; display: block; }
    .doc-title {
      font-size: 2rem;
      font-weight: 800;
      line-height: 1.2;
      margin: 24px 0 12px;
      color: #1a202c;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 13px;
      color: #718096;
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid #e2e8f0;
    }
    .description {
      font-size: 1.1rem;
      color: #4a5568;
      line-height: 1.7;
      margin-bottom: 28px;
      padding: 16px 20px;
      background: #f7fafc;
      border-left: 4px solid #4299e1;
      border-radius: 0 6px 6px 0;
    }
    .content { line-height: 1.8; color: #2d3748; }
    .content h1, .content h2, .content h3, .content h4 {
      margin: 28px 0 12px;
      color: #1a202c;
      font-weight: 700;
    }
    .content h1 { font-size: 1.6rem; }
    .content h2 { font-size: 1.35rem; }
    .content h3 { font-size: 1.15rem; }
    .content p { margin-bottom: 14px; }
    .content ul, .content ol { padding-left: 24px; margin-bottom: 14px; }
    .content li { margin-bottom: 6px; }
    .content blockquote {
      border-left: 4px solid #805ad5;
      padding: 12px 20px;
      margin: 20px 0;
      background: #faf5ff;
      border-radius: 0 6px 6px 0;
      color: #553c9a;
      font-style: italic;
    }
    .content pre {
      background: #1a202c;
      color: #e2e8f0;
      padding: 16px 20px;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 14px;
      margin-bottom: 14px;
    }
    .content pre.plaintext { white-space: pre-wrap; word-break: break-word; }
    .content code {
      background: #edf2f7;
      color: #c53030;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .content pre code { background: none; color: inherit; padding: 0; }
    .content a { color: #3182ce; text-decoration: underline; }
    .content img { max-width: 100%; border-radius: 6px; margin: 12px 0; }
    @media (max-width: 600px) {
      .content-body { padding: 24px 20px; }
      .doc-title { font-size: 1.5rem; }
    }
  </style>
</head>
<body>
  <div class="preview-bar">
    ${statusBadge}
    <span class="preview-label">Content Preview — Strapi CMS</span>
    <span class="uid-label">${escapeHtml(uid)}</span>
  </div>
  <div class="container">
    <div class="content-body">
      ${bodyContent}
    </div>
  </div>
</body>
</html>`;
  },
};
