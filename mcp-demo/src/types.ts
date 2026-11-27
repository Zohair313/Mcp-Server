/**
 * Represents a file or directory entry returned by the GitHub Contents API.
 */
export interface GitHubContentItem {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
  content?: string;
  encoding?: string;
}

/**
 * Configuration options for GitHub API requests.
 */
export interface GitHubClientOptions {
  token?: string | undefined;
  timeoutMs?: number | undefined;
  maxFileBytes?: number | undefined;
  fetchImpl?: typeof fetch | undefined;
  /** Git ref to read contents from (defaults to the repository's default branch). */
  ref?: string | undefined;
  /** Cache JSON responses in memory; disabled automatically when fetchImpl is injected. */
  cache?: boolean | undefined;
  /** Cache lifetime in milliseconds (defaults to 60s). */
  cacheTtlMs?: number | undefined;
}

/**
 * Result of reading a file from GitHub, including truncation metadata.
 */
export interface GitHubFileResult {
  path: string;
  text: string;
  byteLength: number;
  truncated: boolean;
}

/**
 * Summary of a GitHub commit entry.
 */
export interface GitHubCommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string;
}

/**
 * Repository metadata & health analysis summary.
 */
export interface GitHubRepoAnalysis {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  rootEntries: string[];
  scannedPaths: string[];
  checks: {
    hasReadme: boolean;
    hasGitignore: boolean;
    hasLicense: boolean;
    hasTestsDir: boolean;
    hasCiWorkflows: boolean;
    hasPackageJson: boolean;
  };
  scripts: string[];
  dependencies: string[];
  devDependencies: string[];
}

/**
 * Structured error for GitHub API and content-handling failures.
 */
export class GitHubClientError extends Error {
  readonly status?: number | undefined;
  readonly code:
    | "INVALID_INPUT"
    | "NOT_FOUND"
    | "RATE_LIMITED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "TIMEOUT"
    | "BINARY_FILE"
    | "NOT_A_FILE"
    | "TOO_LARGE"
    | "API_ERROR";

  constructor(
    message: string,
    code: GitHubClientError["code"],
    status?: number
  ) {
    super(message);
    this.name = "GitHubClientError";
    this.code = code;
    this.status = status;
  }
}
