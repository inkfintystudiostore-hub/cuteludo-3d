/**
 * Portal build target flags.
 * Set `VITE_PORTAL=poki` (or `vite build --mode poki`) for Poki submissions.
 */
export const IS_POKI_BUILD = import.meta.env.VITE_PORTAL === 'poki';
