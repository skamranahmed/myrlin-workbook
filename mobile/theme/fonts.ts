/**
 * fonts.ts - Font family constants and loading configuration.
 *
 * Defines font family names for Plus Jakarta Sans and JetBrains Mono,
 * matching the weight variants available in the asset bundles.
 */

/**
 * Font family map with weight-specific font names.
 * These names must match what is registered via expo-font / useFonts.
 */
export const fonts = {
  sans: {
    regular: 'PlusJakartaSans-Regular',
    medium: 'PlusJakartaSans-Medium',
    semibold: 'PlusJakartaSans-SemiBold',
    bold: 'PlusJakartaSans-Bold',
  },
  mono: {
    regular: 'JetBrainsMono-Regular',
    medium: 'JetBrainsMono-Medium',
    bold: 'JetBrainsMono-Bold',
  },
} as const;

/**
 * Font asset map for expo-font useFonts hook.
 * Keys are the font names, values are require() paths to the TTF files.
 *
 * Usage:
 * ```ts
 * import { fontAssets } from '@/theme/fonts';
 * const [loaded] = useFonts(fontAssets);
 * ```
 */
export const fontAssets = {
  [fonts.mono.regular]: require('../assets/fonts/JetBrainsMono-Regular.ttf'),
  [fonts.mono.medium]: require('../assets/fonts/JetBrainsMono-Medium.ttf'),
  [fonts.mono.bold]: require('../assets/fonts/JetBrainsMono-Bold.ttf'),
} as const;
