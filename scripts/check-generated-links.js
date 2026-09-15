import fs from 'fs';
import path from 'path';

const publicDir = path.resolve('public');
const githubPagesBase = 'https://panming-dev.github.io/qimen-mingfa-blog';

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

for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');

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