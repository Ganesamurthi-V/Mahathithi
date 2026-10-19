import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Scale off the short/long side rather than width/height so the result does not
// depend on which way the device was held when the app launched. These values are
// read once at startup (theme styles are static), so they must be orientation-free.
const shortSide = Math.min(width, height);
const longSide = Math.max(width, height);

// Guideline sizes are based on a standard ~5" screen mobile device (e.g. iPhone X / iPhone 11 Pro)
const guidelineBaseWidth = 375;
const guidelineBaseHeight = 812;

// Linear scaling would render a ~800dp tablet at over 2x. Past this cap, extra
// screen space goes to layout (see layout.screenColumn) instead of bigger UI.
const MAX_SCALE = 1.3;
const widthRatio = Math.min(shortSide / guidelineBaseWidth, MAX_SCALE);
const heightRatio = Math.min(longSide / guidelineBaseHeight, MAX_SCALE);

/**
 * Scale relative to screen width.
 * Useful for horizontal padding, margins, and widths.
 */
export const horizontalScale = (size: number) => widthRatio * size;

/**
 * Scale relative to screen height.
 * Useful for vertical padding, margins, and heights.
 */
export const verticalScale = (size: number) => heightRatio * size;

/**
 * Scale with a moderate factor.
 * Useful for fonts and borders where you don't want them to scale linearly
 * (otherwise fonts would look massive on an iPad).
 *
 * @param size The original size from the design
 * @param factor The strength of the scaling (default: 0.5)
 */
export const moderateScale = (size: number, factor = 0.5) => size + (horizontalScale(size) - size) * factor;

/**
 * Export device dimension booleans if needed for conditional rendering
 */
export const isSmallDevice = shortSide < 375;
// 600dp smallest width is Android's standard tablet threshold (sw600dp).
export const isTablet = shortSide >= 600;
