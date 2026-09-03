/**
 * A section card, matching the dashboard's panels so the console reads as one surface.
 *
 * ## Why it lives in its own module
 *
 * It used to sit in `console-shell.tsx`, beside `ConsoleShell` — which is an async server
 * component that imports `readerSections()` and therefore reads cookies at module scope. A CLIENT
 * component importing the panel from there pulls that into the browser bundle, and the build fails
 * on the server-only import rather than on the panel.
 *
 * `settings-board.tsx` is the first client component that needed to draw a panel. Moving the panel
 * to a module of its own is the smaller half of the fix; `console-shell.tsx` re-exports it, so all
 * thirty-five existing importers are unchanged.
 */
export function ConsolePanel({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      {title ? (
        <h2 className="mb-3 text-[14.5px] font-extrabold text-gold-ink">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}
