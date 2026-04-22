import fs from 'fs';
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
 * Simple front matter parser (no gray-matter dependency)
 * Returns { data: {...}, content: "..." }
 */
function parseFrontMatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { data: {}, content: text };
  const frontMatter = {};
  for (const line of match[1].split('\n')) ...[truncated]