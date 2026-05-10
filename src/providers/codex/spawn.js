/**
 * Codex provider spawn descriptor builder.
 *
 * Phase 17 Plan 17-02 (CDX-07 spawn half).
 *
 * Pure function that builds the SpawnDescriptor pty-manager uses to launch
 * the Codex CLI. Mirrors the shape established by src/providers/claude/spawn.js
 * so the existing pty-manager pass-through plumbing (Plan 14-04) needs no
 * Codex-specific code path.
 *
 * Phase 17 ships the minimum surface: a `resume <id>` invocation when
 * providerSessionId is set, a fresh-session invocation when it is not. No
 * --model, --verbose, --workdir, or other flags are passed today; Phase 19
 * (Codex Live PTY End-to-End) will add them once the live terminal plumbing
 * exists. Keeping the surface narrow now avoids exposing flags that may be
 * renamed by upstream Codex before they are tested.
 *
 * CODEX_HOME env scoping: process.env.CODEX_HOME is propagated through the
 * descriptor so a user with a non-default $CODEX_HOME survives a Myrlin pane
 * spawn (the spawned `codex` process otherwise inherits the parent's env,
 * which works in the common case, but explicit propagation is the
 * documentation-friendly form: the descriptor advertises which env keys
 * matter). When the parent env does NOT set CODEX_HOME, env.CODEX_HOME is
 * set to undefined which pty-manager treats as DELETE-this-key. Net effect
 * for the unset case is identical to leaving the env alone; the explicit
 * assign documents the contract.
 *
 * Validation: the providerSessionId is checked against /^[a-zA-Z0-9_-]+$/
 * before being placed in args. Shell unsafe characters (semicolons,
 * backticks, spaces, etc.) trigger an Error. This matches the pattern in
 * claude/spawn.js verbatim so any input that passes the SHELL_UNSAFE gate
 * for Claude also passes for Codex.
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * @module src/providers/codex/spawn
 */

'use strict';

// The literal 'codex' below is the CLI binary name (the npm-published Codex
// CLI installs a `codex` executable). This file lives inside src/providers/codex/,
// which the grep gate (Plan 14-05) skips, so the marker is defensive (extra
// signal for future readers) rather than required.
const CODEX_BINARY = 'codex'; // gsd:provider-literal-allowed (Codex provider CLI binary)

/**
 * Validate providerSessionId against the same shell-safe regex Claude uses.
 * UUIDs (with or without hyphens) and slug-style identifiers pass; anything
 * with spaces, quotes, semicolons, backticks, or other shell-special bytes
 * trips the gate.
 *
 * @param {string} id - candidate providerSessionId
 * @returns {boolean} true when id is safe to interpolate into argv tokens
 */
function isSafeProviderSessionId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Build a SpawnDescriptor for the Codex CLI.
 *
 * Pure function. Does NOT touch the filesystem, the network, or any state.
 * Does NOT mutate process.env. Throws on invalid input. Returns a descriptor
 * that pty-manager joins, shell-wraps, and runs through node-pty.
 *
 * Phase 17 minimum surface:
 *   - providerSessionId set    -> ['resume', '<id>']
 *   - providerSessionId unset  -> []
 *
 * Phase 19 (Codex Live PTY) will extend this with --model, --verbose, and
 * the equivalent of Claude's initialPrompt argument once the live PTY
 * plumbing has shipped and the Codex flag surface is locked.
 *
 * @param {Object} [init] - spawn input bundle
 * @param {string|null} [init.providerSessionId] - Codex session UUID for `resume`.
 *   Validated against /^[a-zA-Z0-9_-]+$/. Throws on unsafe input.
 * @param {string|null} [init.cwd] - Working directory; passes through.
 *   pty-manager validates and falls back to homedir if missing.
 * @returns {{cmd: string, args: string[], cwd: (string|null), env: Object<string,(string|undefined)>}} SpawnDescriptor.
 * @throws {Error} when providerSessionId fails the safety regex.
 */
function spawnCommand({ providerSessionId = null, cwd = null } = {}) {
  // Validate first so we never produce an unsafe argv even partially.
  if (providerSessionId && !isSafeProviderSessionId(providerSessionId)) {
    throw new Error('unsafe providerSessionId: ' + providerSessionId);
  }

  const args = [];
  if (providerSessionId) {
    // Codex's resume subcommand takes the session UUID as a positional arg.
    // The exact CLI invocation is:  codex resume <uuid>
    args.push('resume');
    args.push(providerSessionId);
  }
  // Phase 17 deliberately stops here. Additional flags belong in Phase 19.

  // CODEX_HOME scoping: read process.env at call time so a test that
  // mutates the env in a try/finally sees the change reflected here.
  // We DO NOT cache the value at module load. The undefined-means-delete
  // semantic is honored by pty-manager (see pty-manager.js: any env value
  // that is `=== undefined` is removed from the spawn env via delete).
  const codexHomeFromEnv = process.env.CODEX_HOME;
  const envOverride = {
    CODEX_HOME: typeof codexHomeFromEnv === 'string' && codexHomeFromEnv.length > 0
      ? codexHomeFromEnv
      : undefined,
  };

  return {
    cmd: CODEX_BINARY,
    args: args,
    cwd: cwd || null,
    env: envOverride,
  };
}

module.exports = { spawnCommand };
