/**
 * Page root. The route entrance is owned by the `<ViewTransition>` in
 * `shared/Layout.tsx` (slide + fade keyed by navigation direction), so this
 * wrapper adds no motion of its own — a second entrance on top of the route
 * transition would double what the user sees.
 */
export function PageWrapper({ children }: { children: React.ReactNode }) {
  return <div data-page-wrapper>{children}</div>;
}
