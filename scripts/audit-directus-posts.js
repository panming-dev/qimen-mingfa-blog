import fs from 'fs';
import matter from 'gray-matter';
import { join } from 'path';

const directusUrl = (process.env.DIRECTUS_URL || 'https://qimendunjia.onrender.com').replace(/\/$/, '');
const directusToken = process.env.DIRECTUS_TOKEN;
const applyChanges = process.argv.includes('--apply');
const postsDir = join(process.cwd(), 'content', 'posts');

function getSourceSlugs() {
  return new Set(
    fs.readdirSync(postsDir)
      .filter((name) => name.endsWith('.md'))
      .map((name) => {
        const parsed = matter(fs.readFileSync(join(postsDir, name), 'utf8'));
        return String(parsed.data.slug || name.replace(/\.md$/, ''));
      }),
  );
}

function getReasons(post) {
  const searchableContent = `${post.source_url || ''}\n${post.content || ''}`;
  const reasons = [];
  if (/panming-dev\.github\.io\/qimen-mingfa-blog/i.test(searchableContent)) {
    reasons.push('stale-github-mirror');
  }
  if (/正在整理中|待集成|placeholder/i.test(post.content || '')) {
    reasons.push('placeholder-content');
  }
  if (/……|^第.+章\s*第|unnamed/i.test(post.title || '')) {
    reasons.push('weak-title');
  }
  return reasons;
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${directusUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(directusToken ? { Authorization: `Bearer ${directusToken}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Directus HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function main() {
  if (applyChanges && !directusToken) {
    throw new Error('DIRECTUS_TOKEN is required with --apply');
  }

  const sourceSlugs = getSourceSlugs();
  const fields = 'id,slug,title,status,source_url,content';
  const { data: posts } = await fetchJson(`/items/blog_posts?limit=-1&fields=${fields}`);
  const candidates = posts
    .filter((post) => post.status === 'published' && !sourceSlugs.has(post.slug))
    .map((post) => ({ ...post, reasons: getReasons(post) }))
    .filter((post) => post.reasons.length > 0);

  console.log(JSON.stringify({
    mode: applyChanges ? 'apply' : 'audit',
    sourcePosts: sourceSlugs.size,
    publishedPosts: posts.filter((post) => post.status === 'published').length,
    candidates: candidates.map(({ id, slug, title, reasons }) => ({ id, slug, title, reasons })),
  }, null, 2));

  if (!applyChanges) {
    console.log(`\nAudit only: ${candidates.length} candidate(s). Re-run with --apply to set them to draft.`);
    return;
  }

  for (const post of candidates) {
    await fetchJson(`/items/blog_posts/${post.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
    });
    console.log(`Drafted ${post.slug}: ${post.reasons.join(', ')}`);
  }
  console.log(`Drafted ${candidates.length} stale post(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});