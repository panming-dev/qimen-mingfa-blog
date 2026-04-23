import fs from 'fs';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.error('❌ Missing DIRECTUS_URL or DIRECTUS_TOKEN environment variables');
  process.exit(1);
}

/**
 * Generate slug from Chinese title using pinyin
 */
function generateSlug(title, fallback = 'untitled') {
  if (!title) return fallback;

  try {
    // Dynamic import to avoid requiring pinyin in GitHub Actions if not needed
    const pinyin = require('pinyin');

    // Remove chapter prefix: "第一章 xxx" → "xxx"
    const cleanTitle = title.replace(/^第[零一二三四五六七八九十百]+[章节篇部]/u, '').trim();

    const pinyinArray = pinyin(cleanTitle, {
      style: pinyin.STYLE_NORMAL,
      heteronym: false,
    });

    const slugPart = pinyinArray
      .flat()
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return slugPart || fallback;
  } catch (err) {
    console.warn('⚠️  pinyin not available, using ASCII fallback');
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || fallback;
  }
}

/**
 * Fetch JSON with error handling
 */
async function fetchJSON(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${DIRECTUS_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }

  return resp.json();
}

/**
 * Main sync function
 */
export async function syncPosts() {
  const postsDir = join(__dirname, '..', '..', 'content', 'posts');  // Hugo source posts
  console.log(`📁 Scanning: ${postsDir}`);

  if (!fs.existsSync(postsDir)) {
    console.error('❌ Posts directory not found:', postsDir);
    console.log('   Create a "content/posts" folder with your .md files');
    process.exit(1);
  }

  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
  console.log(`📝 Found ${files.length} markdown files`);

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const file of files) {
    const filePath = join(postsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = matter(content);
    console.log(`[DEBUG] ${file} → slug:${data.slug} title:${data.title?.slice(0,20)}`);

    // 优先使用 frontmatter slug；如含中文则使用文件名
    const baseName = file.replace('.md', '');
    let slug = data.slug;
    if (!slug || /[\u4e00-\u9fa5]/.test(slug)) {
      slug = baseName;
    }

    try {
      // Check if post exists
      const existing = await fetchJSON(
        `${DIRECTUS_URL}/items/blog_posts?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`
      );

      const excerpt = data.description || body.substring(0, 300).trim();
      const payload = {
        title: data.title || 'Untitled',
        slug,
        excerpt,
        content: `${excerptText}<p><a href="${readMoreUrl}" class="read-more">阅读全文 →</a></p>`,
        seo_title: data.seo_title || data.title,
        seo_description: data.description || '',
        seo_keywords: Array.isArray(data.keywords) ? data.keywords : (data.keywords ? data.keywords.split(',').map((k: string) => k.trim()) : []),
        status: data.status || 'published',
        date: data.date || new Date().toISOString(),
      };

      if (existing.data && existing.data.length > 0) {
        const postId = existing.data[0].id;
        await fetchJSON(`${DIRECTUS_URL}/items/blog_posts/${postId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        console.log(`✅ Updated: ${slug}`);
        updated++;
      } else {
        const result = await fetchJSON(`${DIRECTUS_URL}/items/blog_posts`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        console.log(`✅ Created: ${slug} (id: ${result.data.id})`);
        created++;
      }
    } catch (err) {
      console.error(`❌ Failed: ${slug} — ${err.message}`);
      failed++;
    }
  }

  console.log('\n📊 Sync complete:');
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Failed:  ${failed}`);
}

syncPosts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
