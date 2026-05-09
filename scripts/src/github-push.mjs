import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "mandarin99999-sudo";
const REPO = "axis-mini-bot";
const BRANCH = "main";
const BASE = process.cwd();

if (!TOKEN) {
  console.error("GITHUB_TOKEN not set");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
  "User-Agent": "axis-mini-bot-push",
};

async function ghFetch(path, options = {}) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`GitHub API error ${res.status} for ${url}:`, JSON.stringify(body).slice(0, 300));
    throw new Error(`GitHub ${res.status}: ${body.message ?? "unknown"}`);
  }
  return body;
}

const IGNORE_PATTERNS = [
  /node_modules/,
  /\/dist\//,
  /\/\.git\//,
  /\/\.local\//,
  /\/\.cache\//,
  /attached_assets/,
  /\.tsbuildinfo$/,
  /\.map$/,
  /\/\.vite\//,
  /\.bin\//,
];

function shouldIgnore(filePath) {
  const rel = filePath.replace(BASE + "/", "");
  return IGNORE_PATTERNS.some((p) => p.test(rel) || p.test(filePath));
}

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (shouldIgnore(full)) continue;
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

async function createBlob(content, encoding) {
  const body = await ghFetch(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding }),
  });
  return body.sha;
}

async function getBaseSha() {
  try {
    const ref = await ghFetch(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
    return ref.object.sha;
  } catch {
    return null;
  }
}

async function main() {
  console.log("Collecting files...");
  const allFiles = collectFiles(BASE);
  console.log(`Found ${allFiles.length} files`);

  console.log("Getting base SHA...");
  const baseSha = await getBaseSha();
  console.log(`Base SHA: ${baseSha ?? "(empty repo)"}`);

  console.log("Creating blobs...");
  const treeItems = [];
  let done = 0;
  for (const filePath of allFiles) {
    const rel = filePath.replace(BASE + "/", "");
    let content, encoding;
    try {
      const buf = fs.readFileSync(filePath);
      // Try UTF-8 first; fall back to base64 for binary
      const text = buf.toString("utf8");
      if (text.includes("\uFFFD")) {
        content = buf.toString("base64");
        encoding = "base64";
      } else {
        content = text;
        encoding = "utf-8";
      }
    } catch (e) {
      console.warn(`  skip (read error): ${rel}`);
      continue;
    }

    try {
      const sha = await createBlob(content, encoding);
      treeItems.push({ path: rel, mode: "100644", type: "blob", sha });
      done++;
      if (done % 10 === 0) process.stdout.write(`  ${done}/${allFiles.length} blobs\r`);
    } catch (e) {
      console.warn(`  skip (blob error): ${rel} — ${e.message}`);
    }
  }
  console.log(`\n${done} blobs created`);

  // Make shell scripts executable
  for (const item of treeItems) {
    if (item.path.endsWith(".sh")) item.mode = "100755";
  }

  console.log("Creating tree...");
  const treeBody = await ghFetch(`/repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      tree: treeItems,
      ...(baseSha ? { base_tree: baseSha } : {}),
    }),
  });
  console.log(`Tree SHA: ${treeBody.sha}`);

  console.log("Creating commit...");
  const commitBody = await ghFetch(`/repos/${OWNER}/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Add full AXIS Mini source",
      tree: treeBody.sha,
      ...(baseSha ? { parents: [baseSha] } : { parents: [] }),
    }),
  });
  console.log(`Commit SHA: ${commitBody.sha}`);

  console.log("Updating branch ref...");
  try {
    await ghFetch(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitBody.sha, force: true }),
    });
  } catch {
    // Branch might not exist yet
    await ghFetch(`/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commitBody.sha }),
    });
  }

  console.log(`\nDone! https://github.com/${OWNER}/${REPO}/tree/${BRANCH}`);
}

main().catch((e) => {
  console.error("Push failed:", e.message);
  process.exit(1);
});
