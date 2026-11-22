// Every shipped face: `registerFonts(...allFonts)` when bundle size does not matter (Node, tests).
                                                      
import { dejavuSans } from './dejavu-sans.js';
import { dejavuSansBold } from './dejavu-sans-bold.js';
import { dejavuSerif } from './dejavu-serif.js';
import { dejavuSerifBold } from './dejavu-serif-bold.js';
import { interRegular } from './inter-regular.js';
import { interMedium } from './inter-medium.js';
import { interSemibold } from './inter-semibold.js';
import { interBold } from './inter-bold.js';

export { dejavuSans, dejavuSansBold, dejavuSerif, dejavuSerifBold, interRegular, interMedium, interSemibold, interBold };
export const allFonts                       = [dejavuSans, dejavuSansBold, dejavuSerif, dejavuSerifBold, interRegular, interMedium, interSemibold, interBold];
