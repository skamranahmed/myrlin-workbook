/**
 * Global constants for Myrlin Workbook.
 * Single source of truth for all hardcoded magic values that could
 * reasonably change in one place rather than being scattered across files.
 */

/**
 * Default CLI command when launching a new session.
 * This is the CLI binary name (e.g. 'claude', 'claude-code', 'github-copilot').
 * Can be overridden per-session via session.command.
 */
const DEFAULT_COMMAND = "claude --dangerously-skip-permissions";

/**
 * Bypass permissions flag for the Claude CLI.
 * @see https://docs.anthropic.com/en/docs/claude-code/permissions
 */
const CLAUDE_BYPASS_FLAG = "--dangerously-skip-permissions";

/**
 * Bypass permissions flag for the Codex CLI.
 * @see https://github.com/github/copilot-cli
 */
const CODEX_BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";

module.exports = {
  DEFAULT_COMMAND,
  CLAUDE_BYPASS_FLAG,
  CODEX_BYPASS_FLAG,
};
