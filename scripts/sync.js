import fs from 'fs';
console.log('=== SYNC SCRIPT LOADED ===');
import matter from 'gray-matter';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';


// SEO 摘要生成：截取前300字，保持句子完整
function generateExcerpt(content, maxLength = 300) {
  const plainText = content.replace(/<[^>]+>/g, '').trim();
  if (plainText.length <= maxLength) return plainText;
  const sentences = plainText.split(/[。！？.!?]/);
  let excerpt = '';
  for (let sentence of sentences) {
    const candidate = excerpt + sentence + '。';
    if (candidate.length <= maxLength) {
      excerpt = candidate;
    } else {
      break;
    }
  }
  if (excerpt.length >= 100 && excerpt.length <= maxLength) {
    return excerpt + '...';
  }
  return plainText.substring(0, maxLength) + '...';
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DIRECTUS_URL = process.env.DIRECTUS_URL?.replace(/\/$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN;
const CANONICAL_URL = (process.env.CANONICAL_URL || 'https://panma.site').replace(/\/$/, '');
const SOURCE_URL = (process.env.SOURCE_URL || 'https://panming-dev.github.io/qimen-mingfa-blog').replace(/\/$/, '');
const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET;
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || '082f2e4ff50ed232be5038cf2d1844fa';
const REQUIRE_SEARCH_NOTIFICATIONS = process.env.REQUIRE_SEARCH_NOTIFICATIONS === 'true';

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
  // 确保使用绝对 URL（拼接 DIRECTUS_URL）
  const baseUrl = DIRECTUS_URL?.replace(/\/$/, '');
  const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
  const resp = await fetch(fullUrl, {
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

async function postWebhook(path, secretHeader, secret, body) {
  if (!secret) {
    console.warn(`[WARN] Skipping ${path}: webhook secret is not configured`);
    return;
  }

  const response = await fetch(`${CANONICAL_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [secretHeader]: secret,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${await response.text()}`);
  }
}

async function submitIndexNow(urls) {
  const response = await fetch('https://www.bing.com/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host: new URL(CANONICAL_URL).host,
      key: INDEXNOW_KEY,
      keyLocation: `${CANONICAL_URL}/indexnow-key/`,
      urlList: urls,
    }),
  });

  if (!response.ok) {
    throw new Error(`IndexNow returned HTTP ${response.status}: ${await response.text()}`);
  }
}

async function notifyPublishedPosts(slugs) {
  const paths = ['/blog/', '/sitemap.xml', ...slugs.map((slug) => `/blog/${slug}/`)];
  for (const path of paths) {
    await postWebhook('/api/revalidate', 'x-revalidate-secret', REVALIDATION_SECRET, { path });
  }

  await submitIndexNow(paths.map((path) => new URL(path, `${CANONICAL_URL}/`).toString()));
}

/**
 * Main sync function
 */
export async function syncPosts() {
  if (REQUIRE_SEARCH_NOTIFICATIONS) {
    const missingSecrets = [
      !REVALIDATION_SECRET && 'REVALIDATION_SECRET',
    ].filter(Boolean);
    if (missingSecrets.length > 0) {
      throw new Error(`Missing required search notification secrets: ${missingSecrets.join(', ')}`);
    }
  }

  // 确保 "奇门" 分类存在，获取其 UUID
  let defaultCategoryId = process.env.DEFAULT_CATEGORY_ID;
  console.log('[DEBUG] DEFAULT_CATEGORY_ID env:', process.env.DEFAULT_CATEGORY_ID);
  
  // 硬编码兜底：如果 env 未设置或无效，使用已知的"奇门"分类 UUID
  const FALLBACK_CATEGORY_ID = '4e0321d7-fdaf-4220-858b-ccad4b6d4908';
  if (!defaultCategoryId || defaultCategoryId === '00000000-0000-0000-0000-000000000000') {
    defaultCategoryId = FALLBACK_CATEGORY_ID;
    console.log('[INFO] Using fallback category UUID:', FALLBACK_CATEGORY_ID);
  }
  
  if (!defaultCategoryId) {
    try {
      // 策略1: 从已有 blog_posts 推断 category UUID（无需 categories 权限）
      console.log('[INFO] Attempting to infer category from existing blog_posts...');
      try {
        const knownSlug = 'di-er-zhang-4-6-3';
        const existing = await fetchJSON(`/items/blog_posts?filter[slug][_eq]=${knownSlug}&limit=1&fields=id,category`);
        if (existing.data && existing.data.length > 0 && existing.data[0].category) {
          defaultCategoryId = existing.data[0].category;
          console.log(`[INFO] Inferred category UUID from existing post: ${defaultCategoryId}`);
        }
      } catch (e) {
        console.log('[WARN] Could not infer from blog_posts:', e.message);
      }

      // 策略2: 如果仍未获取，尝试直接查询/创建 categories
      if (!defaultCategoryId) {
        console.log('[INFO] Attempting to query/create category directly...');
        // 查询是否存在 "奇门" 分类
        const cats = await fetchJSON('/items/categories?filter[name][_eq]=奇门&limit=1');
      if (cats.data && cats.data.length > 0) {
        defaultCategoryId = cats.data[0].id;
        console.log(`[INFO] Found existing category: 奇门 (${defaultCategoryId})`);
      } else {
        // 创建 "奇门" 分类
        const newCat = await fetchJSON('/items/categories', {
          method: 'POST',
          body: JSON.stringify({ name: '奇门', slug: 'qi-men' })
        });
        defaultCategoryId = newCat.data.id;
        console.log(`[INFO] Created category: 奇门 (${defaultCategoryId})`);
      }
    }  // close if (!defaultCategoryId) for strategy 2
  } catch (err) {
      console.error('[ERROR] Failed to get/create category:', err.message);
      // 如果失败，使用一个占位符（会导致错误）
      defaultCategoryId = '00000000-0000-0000-0000-000000000000';
    }
  }
  console.log('[DEBUG] Final defaultCategoryId:', defaultCategoryId);
  console.log('[DEBUG] Final defaultCategoryId JSON:', JSON.stringify(defaultCategoryId));
  console.log('[DEBUG] Type:', typeof defaultCategoryId, 'Length:', String(defaultCategoryId).length);

  // 获取默认作者 ID

  // 定位 content/posts 目录（兼容本地和 GitHub Actions）
  function findPostsDir() {
    const bases = [];

    // 策略1：当前工作目录（npm run sync 时通常是项目根）
    bases.push(process.cwd());

    // 策略2：从脚本目录向上查找（最多3级）
    let dir = __dirname;
    for (let i = 0; i < 4; i++) {
      bases.push(dir);
      dir = join(dir, '..');
    }

    for (const base of bases) {
      const candidate = join(base, 'content', 'posts');
      console.log(`[DEBUG] Trying posts dir: ${candidate}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  const postsDir = findPostsDir();
  console.log(`📁 Scanning: ${postsDir}`);

  if (!postsDir) {
    console.error('❌ Posts directory not found.');
    console.error('   Searched in: content/posts (relative to cwd and script location)');
    console.error('   Current cwd:', process.cwd());
    console.error('   __dirname:', __dirname);
    process.exit(1);
  }

  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));
  console.log(`📝 Found ${files.length} markdown files`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  const syncedSlugs = [];

  for (const file of files) {
    const filePath = join(postsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data, content: body } = matter(content);

    console.log(`[DEBUG] data.slug type: ${typeof data.slug}, value: ${data.slug}`);
    console.log(`[DEBUG] data.title: ${data.title}`);
    // 优先使用 frontmatter slug；如果包含中文字符则使用文件名（避免解析错误）
    const baseName = file.replace('.md', '');
    let slug = data.slug;
    if (!slug || /[\u4e00-\u9fa5]/.test(slug)) {
      slug = baseName;
    }
    console.log(`[DEBUG] baseName: ${baseName}, using slug: ${slug}`);



    try {
    console.log(`[INFO] Processing file: ${file}`);
    console.log(`[INFO]   title: ${data.title}`);
    console.log(`[INFO]   frontmatter.slug: ${data.slug}`);
    console.log(`[INFO]   resolved slug: ${slug}`);
      // Check if post exists
      const existing = await fetchJSON(
        `${DIRECTUS_URL}/items/blog_posts?filter[slug][_eq]=${encodeURIComponent(slug)}&limit=1`
      );

      const excerpt = generateExcerpt(body, 300);
      const postStatus = data.draft ? 'draft' : (data.status || 'published');
      const payload = {
        title: data.title || 'Untitled',
        slug,
        author: 'e51ecbce-e34f-45d6-b863-030511108267',
        // category 仅在 UUID 有效时添加
        excerpt,
        // category 字段：仅当 UUID 有效时才添加
        ...( (defaultCategoryId && defaultCategoryId !== '00000000-0000-0000-0000-000000000000')
          ? { category: defaultCategoryId }
          : {}),
        content: body.trim(),
        source_url: `${SOURCE_URL}/blog/${slug}/`,
        seo_title: data.seo_title || data.title,
        seo_description: data.description || '',
        seo_keywords: Array.isArray(data.keywords) ? data.keywords : (data.keywords ? data.keywords.split(',').map((k) => k.trim()) : []),
        status: postStatus,
        // Directus blog_posts 使用 published_at 字段，不使用 date
        published_at: data.date || new Date().toISOString(),
      };
      console.log('[DEBUG] Payload category field:', JSON.stringify(payload.category));
      console.log('[DEBUG] defaultCategoryId at payload time:', JSON.stringify(defaultCategoryId));

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
      syncedSlugs.push(slug);
    } catch (err) {
      console.error(`❌ Failed: ${slug} — ${err.message}`);
      failed++;
    }
  }

  console.log('\n📊 Sync complete:');
  console.log(`   Created: ${created}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Failed:  ${failed}`);

  if (failed > 0) {
    throw new Error(`Sync failed for ${failed} post(s); search notifications were not sent`);
  }

  await notifyPublishedPosts(syncedSlugs);
  console.log(`   Notified: ${syncedSlugs.length} canonical article URLs`);
}

syncPosts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
