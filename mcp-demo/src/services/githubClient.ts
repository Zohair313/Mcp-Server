import {
  GitHubClientError,
  type GitHubClientOptions,
  type GitHubCommitSummary,
  type GitHubContentItem,
  type GitHubFileResult,
  type GitHubRepoAnalysis,
} from "../types.js";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_FILE_BYTES = 100 * 1024; // 100 KB

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Validates a GitHub owner or repository name segment.
 */
export function validateGitHubIdentifier(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || !IDENTIFIER_PATTERN.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new GitHubClientError(
      `Invalid ${label}: "${value}". Use only letters, numbers, '.', '_', or '-'.`,
      "INVALID_INPUT"
    );
  }
  return trimmed;
}

/**
 * Normalizes a repository path and rejects path-traversal or null-byte inputs.
 */
export function normalizeRepoPath(rawPath = ""): string {
  const trimmed = rawPath.trim().replace(/\\/g, "/");
  if (trimmed.includes("\0")) {
    throw new GitHubClientError("Invalid path: null bytes are not allowed.", "INVALID_INPUT");
  }

  const stripped = trimmed.replace(/^\/+|\/+$/g, "");
  if (!stripped) {
    return "";
  }

  const segments = stripped.split("/").filter(Boolean);
  if (segments.some((seg) => seg === "." || seg === "..")) {
    throw new GitHubClientError(
      `Invalid path "${rawPath}": '.' and '..' segments are not allowed.`,
      "INVALID_INPUT"
    );
  }

  return segments.join("/");
}

/**
 * Checks whether a decoded buffer appears to contain binary (non-UTF-8 text) data.
 */
function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) {
    return true;
  }
  const decoded = sample.toString("utf-8");
  // Replacement char (U+FFFD) indicates invalid UTF-8 byte sequences.
  return decoded.includes("\uFFFD");
}

/**
 * Decodes UTF-8 text within a byte budget without splitting a multibyte sequence.
 */
function decodeUtf8WithinByteBudget(buffer: Buffer, maxBytes: number): string {
  if (buffer.byteLength <= maxBytes) {
    return buffer.toString("utf-8");
  }

  let end = maxBytes;
  // UTF-8 continuation bytes have the bit pattern 10xxxxxx; back off to a character boundary.
  while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) {
    end -= 1;
  }
  return buffer.subarray(0, end).toString("utf-8");
}

function buildApiError(status: number, headers: Headers, bodyText: string): GitHubClientError {
  if (status === 404) {
    return new GitHubClientError(
      "Repository or path not found (404). Verify owner, repo, and path, or set GITHUB_TOKEN if the repository is private.",
      "NOT_FOUND",
      404
    );
  }

  if (status === 401) {
    return new GitHubClientError(
      "GitHub authentication failed (401). Check that GITHUB_TOKEN is valid and not expired.",
      "UNAUTHORIZED",
      401
    );
  }

  if (status === 403 || status === 429) {
    const remaining = headers.get("x-ratelimit-remaining");
    const resetEpoch = headers.get("x-ratelimit-reset");
    const isRateLimit =
      status === 429 ||
      remaining === "0" ||
      bodyText.toLowerCase().includes("rate limit");

    if (isRateLimit) {
      const resetHint = resetEpoch
        ? ` Rate limit resets at ${new Date(Number(resetEpoch) * 1000).toISOString()}.`
        : "";
      return new GitHubClientError(
        `GitHub API rate limit exceeded (${status}).${resetHint} Set GITHUB_TOKEN to increase your rate limit.`,
        "RATE_LIMITED",
        status
      );
    }

    return new GitHubClientError(
      `Access forbidden by GitHub API (${status}). Ensure your GITHUB_TOKEN has read access to this repository.`,
      "FORBIDDEN",
      status
    );
  }

  return new GitHubClientError(
    `GitHub API request failed with status ${status}.`,
    "API_ERROR",
    status
  );
}

async function requestGitHubJson<T>(url: string, options: GitHubClientOptions = {}): Promise<T> {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchFn = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "local-demo-mcp",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetchFn(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new GitHubClientError(
        `GitHub API request timed out after ${timeoutMs}ms.`,
        "TIMEOUT"
      );
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new GitHubClientError(`Network error while contacting GitHub API: ${reason}`, "API_ERROR");
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw buildApiError(response.status, response.headers, bodyText);
  }

  return (await response.json()) as T;
}

/**
 * Fetches directory or file metadata from the GitHub Contents API.
 */
export async function fetchGitHubContents(
  owner: string,
  repo: string,
  path = "",
  options: GitHubClientOptions = {}
): Promise<GitHubContentItem | GitHubContentItem[]> {
  const safeOwner = validateGitHubIdentifier(owner, "owner");
  const safeRepo = validateGitHubIdentifier(repo, "repo");
  const safePath = normalizeRepoPath(path);

  const encodedPath = safePath
    ? safePath.split("/").map(encodeURIComponent).join("/")
    : "";
  const url = `https://api.github.com/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/contents/${encodedPath}`;

  return requestGitHubJson<GitHubContentItem | GitHubContentItem[]>(url, options);
}

/**
 * Lists files and directories at a given repository path.
 */
export async function listGitHubFiles(
  owner: string,
  repo: string,
  path = "",
  options: GitHubClientOptions = {}
): Promise<GitHubContentItem[]> {
  const data = await fetchGitHubContents(owner, repo, path, options);
  return Array.isArray(data) ? data : [data];
}

/**
 * Reads and decodes a UTF-8 text file from a GitHub repository with size and binary guards.
 */
export async function readGitHubFile(
  owner: string,
  repo: string,
  path: string,
  options: GitHubClientOptions = {}
): Promise<GitHubFileResult> {
  const safePath = normalizeRepoPath(path);
  if (!safePath) {
    throw new GitHubClientError("A non-empty file path is required.", "INVALID_INPUT");
  }

  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const data = await fetchGitHubContents(owner, repo, safePath, options);

  if (Array.isArray(data) || data.type !== "file") {
    throw new GitHubClientError(
      `Path "${safePath}" is not a file. Use list_github_files for directories.`,
      "NOT_A_FILE"
    );
  }

  // GitHub omits inline content for files above ~1 MB (encoding "none", content "").
  // A genuinely empty file has size 0 and still uses base64 encoding.
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new GitHubClientError(
      `File "${safePath}" has no inline base64 content; it likely exceeds GitHub's 1 MB contents API limit. Use the raw download URL instead.`,
      "TOO_LARGE"
    );
  }

  if (data.content.length === 0 && (data.size ?? 0) > 0) {
    throw new GitHubClientError(
      `File "${safePath}" is too large for GitHub's contents API (no inline content). Use the raw download URL instead.`,
      "TOO_LARGE"
    );
  }

  const buffer = Buffer.from(data.content, "base64");
  if (isLikelyBinary(buffer)) {
    throw new GitHubClientError(
      `File "${safePath}" appears to be binary or non-UTF-8 and cannot be displayed as text.`,
      "BINARY_FILE"
    );
  }

  if (buffer.byteLength > maxFileBytes) {
    const truncatedText = decodeUtf8WithinByteBudget(buffer, maxFileBytes);
    return {
      path: data.path,
      text: `${truncatedText}\n\n[Truncated: showing first ${maxFileBytes} of ${buffer.byteLength} bytes]`,
      byteLength: buffer.byteLength,
      truncated: true,
    };
  }

  return {
    path: data.path,
    text: buffer.toString("utf-8"),
    byteLength: buffer.byteLength,
    truncated: false,
  };
}

interface RawGitHubCommit {
  sha: string;
  commit: {
    message: string;
    author?: {
      name?: string;
      date?: string;
    };
  };
}

/**
 * Fetches recent commits for a GitHub repository.
 */
export async function getRecentCommits(
  owner: string,
  repo: string,
  limit = 5,
  options: GitHubClientOptions = {}
): Promise<GitHubCommitSummary[]> {
  const safeOwner = validateGitHubIdentifier(owner, "owner");
  const safeRepo = validateGitHubIdentifier(repo, "repo");
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 20);
  const url = `https://api.github.com/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}/commits?per_page=${safeLimit}`;

  const rawCommits = await requestGitHubJson<RawGitHubCommit[]>(url, options);
  return rawCommits.map((item) => ({
    sha: item.sha.slice(0, 7),
    message: (item.commit.message.split("\n")[0] ?? "").trim(),
    author: item.commit.author?.name ?? "unknown",
    date: item.commit.author?.date ?? "",
  }));
}

interface RawGitHubRepo {
  full_name: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
}

/**
 * Inspects a GitHub repository's metadata, root structure, health checks, and package.json stack.
 */
export async function analyzeGitHubRepo(
  owner: string,
  repo: string,
  options: GitHubClientOptions = {}
): Promise<GitHubRepoAnalysis> {
  const safeOwner = validateGitHubIdentifier(owner, "owner");
  const safeRepo = validateGitHubIdentifier(repo, "repo");
  const repoUrl = `https://api.github.com/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}`;

  const [meta, rootItems] = await Promise.all([
    requestGitHubJson<RawGitHubRepo>(repoUrl, options),
    listGitHubFiles(safeOwner, safeRepo, "", options),
  ]);

  const names = rootItems.map((item) => item.name);
  const lowerNames = new Set(names.map((n) => n.toLowerCase()));

  const hasPackageJson = lowerNames.has("package.json");
  let scripts: string[] = [];
  let dependencies: string[] = [];
  let devDependencies: string[] = [];

  if (hasPackageJson) {
    try {
      const pkgFile = await readGitHubFile(safeOwner, safeRepo, "package.json", options);
      const pkg = JSON.parse(pkgFile.text) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      scripts = Object.keys(pkg.scripts ?? {});
      dependencies = Object.keys(pkg.dependencies ?? {});
      devDependencies = Object.keys(pkg.devDependencies ?? {});
    } catch {
      // Non-fatal: package.json may be malformed or oversized.
    }
  }

  return {
    fullName: meta.full_name,
    description: meta.description,
    defaultBranch: meta.default_branch,
    language: meta.language,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    rootEntries: rootItems.map((item) => `[${item.type}] ${item.name}`),
    checks: {
      hasReadme: [...lowerNames].some((n) => n.startsWith("readme")),
      hasGitignore: lowerNames.has(".gitignore"),
      hasLicense: [...lowerNames].some((n) => n.startsWith("license")),
      hasTestsDir: lowerNames.has("tests") || lowerNames.has("test") || lowerNames.has("__tests__"),
      hasCiWorkflows: lowerNames.has(".github"),
      hasPackageJson,
    },
    scripts,
    dependencies,
    devDependencies,
  };
}
