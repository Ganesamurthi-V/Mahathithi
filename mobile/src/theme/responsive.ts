import { Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

// Guideline sizes are based on a standard ~5" screen mobile device (e.g. iPhone X / iPhone 11 Pro)
const guidelineBaseWidth = 375;
const guidelineBaseHeight = 812;

/**
 * Scale relative to screen width.
 * Useful for horizontal padding, margins, and widths.
 */
export const horizontalScale = (size: number) => (width / guidelineBaseWidth) * size;

/**
 * Scale relative to screen height.
 * Useful for vertical padding, margins, and heights.
 */
export const verticalScale = (size: number) => (height / guidelineBaseHeight) * size;

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
export const isSmallDevice = width < 375;
export const isTablet = width >= 768;
