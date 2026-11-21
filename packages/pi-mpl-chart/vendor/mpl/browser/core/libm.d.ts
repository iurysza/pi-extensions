/** Correctly rounded log10 for x > 0 (numpy's np.log10); NaN, 0, negatives and ∞ as Math.log10. */
export declare function log10(x: number): number;
/** Correctly rounded exp (np.exp); non-finite and overflowing arguments go to Math.exp. */
export declare function exp(x: number): number;
/** Correctly rounded sin (glibc's, np.sin's); huge or non-finite arguments go to Math.sin. */
export declare function sin(x: number): number;
/** Correctly rounded cos (glibc's, np.cos's); huge or non-finite arguments go to Math.cos. */
export declare function cos(x: number): number;
/** Correctly rounded tan (glibc's, np.tan's); huge or non-finite arguments go to Math.tan. */
export declare function tan(x: number): number;
