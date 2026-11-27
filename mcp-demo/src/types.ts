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
