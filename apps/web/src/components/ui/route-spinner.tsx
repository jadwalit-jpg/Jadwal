/**
 * Lightweight centered spinner for App Router `loading.tsx` boundaries and
 * client-side gates. Preferred over full-page skeletons for route transitions:
 * the spinner renders in < 1KB of DOM, feels instant, and avoids competing
 * with in-page skeletons that the destination renders for its data queries.
 *
 * Use this at the route level (loading.tsx, RoleGuard), and keep granular
 * `animate-pulse` placeholders inside pages for individual useQuery blocks.
 */
export function RouteSpinner({
  label = 'Loading',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={`min-h-[60vh] flex flex-col items-center justify-center gap-3 ${className ?? ''}`}
    >
      <div
        aria-hidden="true"
        className="h-10 w-10 rounded-full border-[3px] border-jadwal-primary/20 border-t-jadwal-primary animate-spin"
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
