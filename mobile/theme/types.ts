/**
 * MyrlinTheme - Complete theme contract for the Myrlin Mobile design system.
 *
 * Defines colors (Catppuccin base, accent palette, semantic aliases, UI semantic),
 * spacing, border radius, typography, shadows, and animation tokens.
 *
 * All 13 themes implement this interface with pixel-perfect color parity
 * to the web CSS custom properties.
 */

/** Shadow definition for React Native */
export interface ThemeShadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

/** Complete theme contract */
export interface MyrlinTheme {
  /** Unique theme identifier (e.g. 'mocha', 'latte', 'tokyoNight') */
  id: string;
  /** Human-readable theme name */
  name: string;
  /** Whether this is a dark theme */
  isDark: boolean;

  colors: {
    // Catppuccin base palette (13 colors)
    base: string;
    mantle: string;
    crust: string;
    surface0: string;
    surface1: string;
    surface2: string;
    overlay0: string;
    overlay1: string;
    text: string;
    subtext0: string;
    subtext1: string;

    // Accent palette (13 colors)
    mauve: string;
    blue: string;
    green: string;
    yellow: string;
    red: string;
    peach: string;
    teal: string;
    sky: string;
    pink: string;
    lavender: string;
    flamingo: string;
    rosewater: string;
    sapphire: string;

    // Semantic aliases (5)
    accent: string;
    success: string;
    warning: string;
    error: string;
    info: string;

    // UI semantic (10)
    bgPrimary: string;
    bgSecondary: string;
    bgTertiary: string;
    bgElevated: string;
    borderSubtle: string;
    borderDefault: string;
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    textMuted: string;
  };

  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };

  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    full: number;
  };

  typography: {
    fontSans: string;
    fontMono: string;
    sizes: {
      xs: number;
      sm: number;
      md: number;
      lg: number;
      xl: number;
      xxl: number;
    };
    weights: {
      regular: string;
      medium: string;
      semibold: string;
      bold: string;
    };
  };

  shadows: {
    sm: ThemeShadow;
    md: ThemeShadow;
    lg: ThemeShadow;
  };

  animation: {
    fast: number;
    normal: number;
    slow: number;
    easing: readonly number[];
  };
}

/** All available theme IDs */
export type ThemeId =
  | 'mocha'
  | 'latte'
  | 'frappe'
  | 'macchiato'
  | 'cherry'
  | 'ocean'
  | 'amber'
  | 'mint'
  | 'nord'
  | 'dracula'
  | 'tokyoNight'
  | 'rosePineDawn'
  | 'gruvboxLight';
