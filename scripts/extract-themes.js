#!/usr/bin/env node

/**
 * extract-themes.js
 *
 * Reads src/web/public/styles.css and extracts all 13 Catppuccin theme
 * color definitions as CSS custom properties, then generates
 * mobile/theme/tokens.ts with fully typed MyrlinTheme objects.
 *
 * Usage: node scripts/extract-themes.js
 * Output: mobile/theme/tokens.ts
 */

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'src', 'web', 'public', 'styles.css');
const OUTPUT_PATH = path.join(__dirname, '..', 'mobile', 'theme', 'tokens.ts');

/**
 * Theme definitions: CSS selector identifier mapped to mobile theme metadata.
 * The CSS ID is the data-theme attribute value (or 'root' for the default :root).
 */
const THEME_DEFS = [
  { cssId: 'root',            mobileId: 'mocha',         name: 'Mocha',           isDark: true },
  { cssId: 'latte',           mobileId: 'latte',         name: 'Latte',           isDark: false },
  { cssId: 'frappe',          mobileId: 'frappe',        name: 'Frappe',          isDark: true },
  { cssId: 'macchiato',       mobileId: 'macchiato',     name: 'Macchiato',       isDark: true },
  { cssId: 'cherry',          mobileId: 'cherry',        name: 'Cherry',          isDark: true },
  { cssId: 'ocean',           mobileId: 'ocean',         name: 'Ocean',           isDark: true },
  { cssId: 'amber',           mobileId: 'amber',         name: 'Amber',           isDark: true },
  { cssId: 'mint',            mobileId: 'mint',          name: 'Mint',            isDark: true },
  { cssId: 'nord',            mobileId: 'nord',          name: 'Nord',            isDark: true },
  { cssId: 'dracula',         mobileId: 'dracula',       name: 'Dracula',         isDark: true },
  { cssId: 'tokyo-night',     mobileId: 'tokyoNight',    name: 'Tokyo Night',     isDark: true },
  { cssId: 'rose-pine-dawn',  mobileId: 'rosePineDawn',  name: 'Rose Pine Dawn',  isDark: false },
  { cssId: 'gruvbox-light',   mobileId: 'gruvboxLight',  name: 'Gruvbox Light',   isDark: false },
];

/**
 * CSS custom property names to extract (the direct color tokens).
 * Each maps to a key in MyrlinTheme.colors.
 */
const COLOR_PROPS = [
  'base', 'mantle', 'crust',
  'surface0', 'surface1', 'surface2',
  'overlay0', 'overlay1',
  'text', 'subtext0', 'subtext1',
  'mauve', 'blue', 'green', 'yellow', 'red', 'peach',
  'teal', 'sky', 'pink', 'lavender', 'flamingo', 'rosewater', 'sapphire',
];

/**
 * Extracts the CSS block for a given theme from the full CSS content.
 * For 'root', extracts the top-level :root { ... } block.
 * For others, extracts :root[data-theme="<id>"] { ... } block.
 *
 * @param {string} css - Full CSS file content
 * @param {string} cssId - Theme CSS identifier
 * @returns {string} The CSS declarations inside the block
 */
function extractThemeBlock(css, cssId) {
  let pattern;
  if (cssId === 'root') {
    // Match the first :root { ... } block (not one with data-theme)
    pattern = /^:root\s*\{([^}]+)\}/m;
  } else {
    // Match :root[data-theme="<id>"] { ... }
    const escaped = cssId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    pattern = new RegExp(`:root\\[data-theme="${escaped}"\\]\\s*\\{([^}]+)\\}`, 'm');
  }

  const match = css.match(pattern);
  if (!match) {
    throw new Error(`Could not find theme block for cssId="${cssId}"`);
  }
  return match[1];
}

/**
 * Parses CSS custom property declarations from a block of CSS text.
 * Returns a map of property name (without --) to value.
 *
 * @param {string} block - CSS declarations text
 * @returns {Record<string, string>} Property name to value map
 */
function parseProperties(block) {
  const props = {};
  const regex = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = regex.exec(block)) !== null) {
    props[m[1]] = m[2].trim();
  }
  return props;
}

/**
 * Extracts color values for a single theme from the CSS.
 *
 * @param {string} css - Full CSS content
 * @param {object} def - Theme definition object
 * @returns {object} Colors object with all required color keys
 */
function extractThemeColors(css, def) {
  const block = extractThemeBlock(css, def.cssId);
  const props = parseProperties(block);

  const colors = {};

  // Extract direct color tokens
  for (const prop of COLOR_PROPS) {
    const val = props[prop];
    if (!val) {
      throw new Error(`Missing --${prop} in theme "${def.cssId}"`);
    }
    colors[prop] = val;
  }

  // Extract border-subtle (has its own override in most themes)
  colors.borderSubtle = props['border-subtle'] || `rgba(${hexToRgb(colors.surface1)}, 0.5)`;

  // Semantic aliases (same mapping for all themes)
  colors.accent = colors.mauve;
  colors.success = colors.green;
  colors.warning = colors.yellow;
  colors.error = colors.red;
  colors.info = colors.blue;

  // UI semantic colors
  colors.bgPrimary = colors.base;
  colors.bgSecondary = colors.mantle;
  colors.bgTertiary = colors.crust;
  colors.bgElevated = colors.surface0;
  colors.borderDefault = colors.surface1;
  colors.textPrimary = colors.text;
  colors.textSecondary = colors.subtext1;
  colors.textTertiary = colors.subtext0;
  colors.textMuted = colors.overlay1;

  return colors;
}

/**
 * Converts a hex color string to comma-separated RGB values.
 *
 * @param {string} hex - Hex color (e.g. '#1e1e2e')
 * @returns {string} RGB values (e.g. '30, 30, 46')
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/**
 * Generates a single theme object as a TypeScript string.
 *
 * @param {object} def - Theme definition
 * @param {object} colors - Extracted colors object
 * @returns {string} TypeScript code for the theme constant
 */
function generateThemeObject(def, colors) {
  const colorEntries = Object.entries(colors)
    .map(([key, val]) => `    ${key}: '${val}',`)
    .join('\n');

  return `export const ${def.mobileId}: MyrlinTheme = {
  id: '${def.mobileId}',
  name: '${def.name}',
  isDark: ${def.isDark},
  colors: {
${colorEntries}
  },
  ...sharedTokens,
};`;
}

/**
 * Main: reads CSS, extracts all 13 themes, writes tokens.ts.
 */
function main() {
  const css = fs.readFileSync(CSS_PATH, 'utf-8');

  const themeObjects = [];

  for (const def of THEME_DEFS) {
    const colors = extractThemeColors(css, def);
    themeObjects.push(generateThemeObject(def, colors));
    console.log(`  Extracted: ${def.name} (${def.mobileId}) - ${Object.keys(colors).length} color tokens`);
  }

  const output = `/**
 * tokens.ts - Auto-generated theme tokens from web CSS.
 *
 * DO NOT EDIT MANUALLY. Regenerate with: node scripts/extract-themes.js
 * Source: src/web/public/styles.css
 *
 * Generated: ${new Date().toISOString()}
 */

import type { MyrlinTheme, ThemeId } from './types';

/**
 * Shared design tokens used by all themes.
 * Spacing, radius, typography, shadows, and animation are consistent
 * across themes; only colors vary.
 */
const sharedTokens = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 18,
    full: 9999,
  },
  typography: {
    fontSans: 'PlusJakartaSans',
    fontMono: 'JetBrainsMono',
    sizes: {
      xs: 11,
      sm: 13,
      md: 15,
      lg: 17,
      xl: 22,
      xxl: 28,
    },
    weights: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  shadows: {
    sm: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.15,
      shadowRadius: 2,
      elevation: 2,
    },
    md: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    },
    lg: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 8,
    },
  },
  animation: {
    fast: 150,
    normal: 200,
    slow: 300,
    easing: [0.16, 1, 0.3, 1],
  },
} as const;

${themeObjects.join('\n\n')}

/**
 * Record of all available themes, keyed by ThemeId.
 * Used by the theme store for lookup.
 */
export const themes: Record<ThemeId, MyrlinTheme> = {
${THEME_DEFS.map((d) => `  ${d.mobileId},`).join('\n')}
};

/**
 * Default theme ID.
 */
export const DEFAULT_THEME_ID: ThemeId = 'mocha';

/**
 * Ordered list of all theme IDs for UI display.
 */
export const themeIds: ThemeId[] = [
${THEME_DEFS.map((d) => `  '${d.mobileId}',`).join('\n')}
];
`;

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, output, 'utf-8');
  console.log(`\nGenerated ${OUTPUT_PATH} with ${THEME_DEFS.length} themes.`);
}

main();
