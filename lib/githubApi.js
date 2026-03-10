const GH_OWNER = process.env.GH_OWNER || "lzs20030114-wq";
const GH_REPO = process.env.GH_REPO || "toefl_writing";

function ghHeaders() {
  const pat = process.env.GH_PAT;
  if (!pat) throw new Error("GH_PAT 未配置");
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

/**
 * Read a file from the repo. Returns { content (parsed JSON), sha } or null if not found.
 */
async function getRepoFile(path) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status} reading ${path}`);
  const data = await res.json();
  const text = Buffer.from(data.content, "base64").toString("utf8");
  return { content: JSON.parse(text), sha: data.sha };
}

/**
 * Create or update a file in the repo.
 */
async function putRepoFile(path, content, sha, message) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const body = {
    message,
    content: Buffer.from(`${JSON.stringify(content, null, 2)}\n`).toString("base64"),
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} writing ${path}: ${text}`);
  }
  return res.json();
}

/**
 * Delete a file from the repo.
 */
async function deleteRepoFile(path, sha, message) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: ghHeaders(),
    body: JSON.stringify({ message, sha }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status} deleting ${path}: ${text}`);
  }
  return res.json();
}

module.exports = { getRepoFile, putRepoFile, deleteRepoFile };
