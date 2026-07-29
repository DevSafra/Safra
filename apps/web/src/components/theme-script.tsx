/**
 * Applies the saved theme BEFORE first paint.
 *
 * This has to be a blocking inline script. Doing it in an effect would render the
 * dark default first and then repaint to light — a visible flash on every load for
 * anyone who chose the light theme. Small enough to be worth the inline script.
 */
export function ThemeScript() {
  const script = `
    try {
      var saved = localStorage.getItem('safra-theme');
      if (saved === 'light' || saved === 'dark') {
        document.documentElement.dataset.theme = saved;
      }
    } catch (e) {
      // Private browsing can throw on localStorage access; the dark default stands.
    }
  `;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
