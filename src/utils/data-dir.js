/**
 * Canonical data directory for Myrlin Workbook.
 *
 * All persistent state (workspaces.json, layout.json, docs/, backups/) lives
 * under ~/.myrlin/ so that every launch method (npm run gui, npx myrlin-workbook,
 * global install) reads and writes the same data.
 *
 * Override with CWM_DATA_DIR env var for development or custom installs.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

/** Resolve the canonical data directory, creating it if needed. */
function getDataDir() {
  if (process.env.CWM_DATA_DIR) {
    const custom = process.env.CWM_DATA_DIR;
    if (!fs.existsSync(custom)) {
      fs.mkdirSync(custom, { recursive: true });
    }
    return custom;
  }
  const dir = path.join(os.homedir(), '.myrlin');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Migrate state files from old __dirname-relative ./state/ to ~/.myrlin/.
 * Only runs once: skips if the target already has a valid workspaces.json.
 * @param {string} legacyDir - The old state directory (project-local ./state/)
 */
function migrateFromLegacy(legacyDir) {
  const dataDir = getDataDir();
  const targetState = path.join(dataDir, 'workspaces.json');

  // If ~/.myrlin/workspaces.json already exists and is valid, skip migration
  if (fs.existsSync(targetState)) {
    try {
      const raw = fs.readFileSync(targetState, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.workspaces) return; // Already migrated
    } catch (_) {
      // Target exists but is invalid; try migrating over it
    }
  }

  if (!legacyDir || !fs.existsSync(legacyDir)) return;

  // Files to migrate
  const filesToMigrate = ['workspaces.json', 'workspaces.backup.json', 'layout.json', 'config.json'];

  for (const file of filesToMigrate) {
    const src = path.join(legacyDir, file);
    const dest = path.join(dataDir, file);
    if (!fs.existsSync(src)) continue;
    // Only migrate if source has real content (not all zeros)
    try {
      const buf = fs.readFileSync(src);
      const hasContent = buf.some(b => b !== 0);
      if (hasContent) {
        fs.copyFileSync(src, dest);
        console.log(`[Migration] Copied ${file} to ~/.myrlin/`);
      }
    } catch (_) {
      // Skip files that can't be read
    }
  }

  // Migrate docs/ subdirectory
  const legacyDocs = path.join(legacyDir, 'docs');
  const targetDocs = path.join(dataDir, 'docs');
  if (fs.existsSync(legacyDocs)) {
    if (!fs.existsSync(targetDocs)) {
      fs.mkdirSync(targetDocs, { recursive: true });
    }
    try {
      const docFiles = fs.readdirSync(legacyDocs);
      for (const file of docFiles) {
        const src = path.join(legacyDocs, file);
        const dest = path.join(targetDocs, file);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
          console.log(`[Migration] Copied docs/${file} to ~/.myrlin/docs/`);
        }
      }
    } catch (_) {}
  }

  // Migrate backups/ subdirectory
  const legacyBackups = path.join(legacyDir, 'backups');
  const targetBackups = path.join(dataDir, 'backups');
  if (fs.existsSync(legacyBackups)) {
    if (!fs.existsSync(targetBackups)) {
      fs.mkdirSync(targetBackups, { recursive: true });
    }
    try {
      const backupFiles = fs.readdirSync(legacyBackups);
      for (const file of backupFiles) {
        const src = path.join(legacyBackups, file);
        const dest = path.join(targetBackups, file);
        if (!fs.existsSync(dest)) {
          const buf = fs.readFileSync(src);
          if (buf.some(b => b !== 0)) {
            fs.copyFileSync(src, dest);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = { getDataDir, migrateFromLegacy };
