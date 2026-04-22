import fs from 'fs';
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const AUTHOR_ID = process.env.AUTHOR_ID;
const CATEGORY_ID = process.env.CATEGORY_ID;

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
// Ensure category exists (query or create default)
async function getAuthor() {
  // 如果显式指定了 AUTHOR_ID，直接返回
  if (process.env.AUTHOR_ID) {
    console.log(`✅ Using explicit AUTHOR_ID: ${process.env.AUTHOR_ID}`);
    return { id: process.env.AUTHOR_ID };
  }

  // 否则使用当前 token 对应的用户
  try {
    const me = await fetchJSON(`${DIRECTUS_URL}/users/me`);
    console.log(`✅ Using current user: ${me.data.first_name} ${me.data.last_name} (${me.data.id})`);
    return { id: me.data.id };
  } catch (err) {
    console.warn('⚠️  Could not get current user, querying first available user...');
    // 查询第一个用户
    const users = await fetchJSON(`${DIRECTUS_URL}/users?limit=1`);
    if (users.data && users.data.length > 0) {
      console.log(`✅ Using first user: ${users.data[0].id}`);
      return { id: users.data[0].id };
    }
    throw new Error('No users found in Directus');
  }
}

async function ensureCategory() {
  if (CATEGORY_ID) {
    console.log(`✅ Using category ID from CATEGORY_ID: ${CATEGORY_ID}`);
    return CATEGORY_ID;
  }

  console.log('🔍 Checking for existing category...');
  try {
    const resp = await fetchJSON(`${DIRECTUS_URL}/items/blog_categories?limit=1`);
    if (resp.data && resp.data.length > 0) {
      console.log(`✅ Found existing category: ${resp.data[0].name} (${resp.data[0].id})`);
      return resp.data[0].id;
    }
  } catch (err) {
    console.warn(`⚠️  Category query failed: ${err.message}`);
  }

  console.log('➕ Creating default category "奇门遁甲"...');
  const createResp = await fetchJSON(`${DIRECTUS_URL}/items/blog_categories`, {
    method: 'POST',
    body: JSON.stringify({ name: '奇门遁甲', slug: 'qimen-dunjia' }),
  });
  console.log(`✅ Created category: ${createResp.data.id}`);
  return createResp.data.id;
}

export async function syncPosts() {
  const postsDir = join(__dirname, '..', 'content', 'posts'); // Adjust path as needed
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

    const slug = data.slug || generateSlug(data.title, file.replace('.md', ''));

    try {
      // Check if post exists
      const existing = await fetchJSON(
        `${DIRECTUS_URL}/items/blog_posts?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`
      );
       
      // 获取完整的 category 对象
      const categoryObj = await ensureCategory();

      const payload = {
        title: data.title || 'Untitled',
        slug,
        content: body,
        excerpt: data.description || body.substring(0, 200),
        seo_title: data.seo_title || data.title,
        seo_description: data.description || '',
        seo_keywords: Array.isArray(data.keywords) ? data.keywords : (data.keywords ? data.keywords.split(',').map((k) => k.trim()) : []),
        status: data.status || 'published',
        published_at: data.date || new Date().toISOString(),
        // 获取作者对象（完整对象，确保外键有效）
        authorObj: await getAuthor(),
        // 注意：author 字段将使用对象 {id: X}，Directus 接受关联对象
        category: categoryObj,
      };

      console.log("📝 Category object:", categoryObj);
      console.log("📦 Payload:", JSON.stringify(payload, null, 2));

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
