import { useEffect, useState } from "react";

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // the query may already have changed between render and effect
    mql.addEventListener("change", onChange);
    // A MediaQueryList "change" event doesn't arrive for every way a
    // viewport can change size (programmatic resizes, some in-app webviews,
    // a rotation that lands on the same breakpoint bucket), and a layout
    // stuck on the wrong side of the breakpoint is unrecoverable without a
    // reload — so re-read `matches` on resize/rotate too. Re-rendering only
    // happens when the boolean actually flips.
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, [query]);
  return matches;
}

// A phone held sideways is the target (≈844×390), but the same compact
// layout is the right call for any viewport too small for the three-column
// desktop grid — including a short desktop window. Kept in sync with the
// `.game-compact` rules in styles.css.
const COMPACT_QUERY = "(max-width: 900px), (max-height: 560px)";

/** True when the game screen should use its single-board compact layout. */
export function useCompactLayout(): boolean {
  return useMediaQuery(COMPACT_QUERY);
}

/** A phone held upright: the compact layout still works, but a hex board in
 * a 390px-wide column is a squint, so the top bar offers a rotate nudge. */
export function useNarrowPortrait(): boolean {
  return useMediaQuery("(orientation: portrait) and (max-width: 620px)");
}

/** Too narrow for the dock's quick-action shortcuts beside its panel
 * buttons. They fold into the Actions sheet rather than scrolling off the
 * right edge, where a primary action would be half-hidden. */
export function useNarrowDock(): boolean {
  return useMediaQuery("(max-width: 600px)");
}
