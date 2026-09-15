import fs from 'fs';
import path from 'path';

const publicDir = path.resolve('public');
const githubPagesBase = 'https://panming-dev.github.io/qimen-mingfa-blog';
const canonicalBase = 'https://panma.site';

function findHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? findHtmlFiles(entryPath) : entryPath.endsWith('.html') ? [entryPath] : [];
  });
}

if (!fs.existsSync(publicDir)) {
  console.error('Missing public directory. Run the Hugo build first.');
  process.exit(1);
}

const failures = [];
const htmlFiles = findHtmlFiles(publicDir);

for (const requiredFile of ['index.xml', 'llms.txt']) {
  if (!fs.existsSync(path.join(publicDir, requiredFile))) {
    failures.push(`missing discovery file: ${requiredFile}`);
  }
}

for (const draftPath of [
  'blog/faq/index.html',
  'blog/di-shi-qi-zhang-zong-he-an-li-jing-jie/index.html',
]) {
  if (fs.existsSync(path.join(publicDir, draftPath))) {
    failures.push(`${draftPath}: draft page leaked into generated output`);
  }
}

if (fs.existsSync(path.join(publicDir, 'index.xml'))) {
  const rss = fs.readFileSync(path.join(publicDir, 'index.xml'), 'utf8');
  if (!rss.includes(`<link>${canonicalBase}/</link>`)) {
    failures.push('index.xml: canonical channel link is missing');
  }
  if (new RegExp(`<item>[\\s\\S]*?<link>${githubPagesBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(rss)) {
    failures.push('index.xml: item links must not use the GitHub Pages host');
  }
  if (!rss.includes(`<item><title>`) || !rss.includes(`<link>${canonicalBase}/blog/`)) {
    failures.push('index.xml: canonical article items are missing');
  }
  if (rss.includes(`${canonicalBase}/qimen-mingfa-blog/`)) {
    failures.push('index.xml: canonical URLs contain the GitHub project path');
  }
}

if (fs.existsSync(path.join(publicDir, 'llms.txt'))) {
  const llms = fs.readFileSync(path.join(publicDir, 'llms.txt'), 'utf8');
  if (!llms.includes(`${canonicalBase}/blog/`) || llms.includes(`${githubPagesBase}/blog/`)) {
    failures.push('llms.txt: article URLs must use the canonical host');
  }
  if (llms.includes(`${canonicalBase}/qimen-mingfa-blog/`)) {
    failures.push('llms.txt: canonical URLs contain the GitHub project path');
  }
}

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');

  if (html.includes(`${canonicalBase}/qimen-mingfa-blog/blog/`)) {
    failures.push(`${path.relative(publicDir, file)}: canonical metadata contains the GitHub project path`);
  }

  for (const match of html.matchAll(/<script[^>]+type=(?:["']?)application\/ld\+json(?:["']?)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(match[1]);
    } catch (error) {
      failures.push(`${path.relative(publicDir, file)}: invalid JSON-LD (${error.message})`);
    }
  }

  if (file.includes(`${path.sep}blog${path.sep}`) && !html.includes(`rel=canonical href=${canonicalBase}/blog/`)) {
    failures.push(`${path.relative(publicDir, file)}: missing canonical article URL`);
  }

  if (/href=(?:["'])?\/blog\//i.test(html)) {
    failures.push(`${path.relative(publicDir, file)}: root-relative /blog/ link`);
  }

  const postsLinkPattern = new RegExp(
    `href=(?:["'])?${githubPagesBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\/posts\/([^"'\\s<>]+)`,
    'gi',
  );
  for (const match of html.matchAll(postsLinkPattern)) {
    const linkedPath = match[1].replace(/[?#].*$/, '').replace(/\/$/, '');
    const matchingArticle = path.join(publicDir, 'blog', linkedPath, 'index.html');
    if (fs.existsSync(matchingArticle)) {
      failures.push(`${path.relative(publicDir, file)}: article incorrectly linked under /posts/${linkedPath}/`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Generated link check failed (${failures.length}):`);
  console.error(failures.slice(0, 20).join('\n'));
  process.exit(1);
}

console.log(`Generated link check passed (${htmlFiles.length} HTML files).`);