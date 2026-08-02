/**
 * The pre-paint theme script, as a single exported constant.
 *
 * Kept here rather than inline in the component so that `next.config.ts` can hash
 * THESE EXACT BYTES for the Content-Security-Policy. A hash written by hand would
 * silently stop matching the moment somebody edited the script — the browser would
 * refuse to run it, the theme would flash on every load, and nothing would say why.
 * Deriving both from one constant makes that drift impossible.
 */
export const THEME_SCRIPT = `try{var s=localStorage.getItem('safra-theme');if(s==='light'||s==='dark'){document.documentElement.dataset.theme=s}}catch(e){}`;
