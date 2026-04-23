import fs from 'fs';
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
  }

syncPosts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
