import React from "react";
import { useAppStore } from "../state/store";
import { buildRejoinUrl } from "../state/session";

/** "Copy my rejoin link", shared by the wide layout's header row and the
 * compact layout's More sheet — it's the only way back into a seat from
 * another device, so it can't be a wide-screen-only affordance. */
export function CopyRejoinLinkButton({ className = "secondary small" }: { className?: string }) {
  const seat = useAppStore((s) => s.seat);
  const pushToast = useAppStore((s) => s.pushToast);
  if (!seat) return null;

  function copy() {
    const url = buildRejoinUrl(seat!);
    navigator.clipboard?.writeText(url).then(
      () => pushToast("Rejoin link copied — save it somewhere private. Anyone with it can control your seat."),
      () => pushToast(url)
    );
  }

  return (
    <button
      className={className}
      onClick={copy}
      title="A private link that reclaims this exact seat, even from another device."
    >
      🔗 Copy my rejoin link
    </button>
  );
}
