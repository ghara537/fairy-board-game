import React, { useMemo, useState } from "react";
import { eligibleDeckDefinitions, VictoryCondition } from "@fairy/shared";
import { useAppStore } from "../state/store";
import { loadGameOptions, saveGameOptions } from "../state/gameOptions";

export function Options() {
  const setScreen = useAppStore((s) => s.setScreen);
  const pushToast = useAppStore((s) => s.pushToast);
  const initial = useMemo(loadGameOptions, []);

  const [disabledCardIds, setDisabledCardIds] = useState<Set<string>>(() => new Set(initial.disabledCardIds));
  const [victoryCondition, setVictoryCondition] = useState<VictoryCondition>(initial.victoryCondition);
  const [pushPullSidewaysAllowed, setPushPullSidewaysAllowed] = useState<boolean>(initial.pushPullSidewaysAllowed);

  const cards = useMemo(() => eligibleDeckDefinitions(), []);
  const enchantments = cards.filter((c) => c.cardType === "Enchantment");
  const landscapes = cards.filter((c) => c.cardType === "Landscape");

  function toggleCard(id: string) {
    setDisabledCardIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(ids: string[], enabled: boolean) {
    setDisabledCardIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (enabled) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function save() {
    saveGameOptions({ disabledCardIds: [...disabledCardIds], victoryCondition, pushPullSidewaysAllowed });
    pushToast("Saved — these apply to the next room you create.");
    setScreen("home");
  }

  const targetScore = victoryCondition.kind === "points" ? victoryCondition.targetScore : 8;

  return (
    <div className="stack" style={{ maxWidth: 760, margin: "20px auto" }}>
      <div className="card-panel stack">
        <h2>Options</h2>
        <p className="text-dim small">
          Choose which cards can appear in the deck and how the game ends. These are saved in this browser and applied
          the next time you create a room.
        </p>
      </div>

      <div className="card-panel stack">
        <h3>Victory Condition</h3>
        <label className="row" style={{ alignItems: "flex-start" }}>
          <input
            type="radio"
            checked={victoryCondition.kind === "points"}
            onChange={() => setVictoryCondition({ kind: "points", targetScore })}
          />
          <span>
            <strong>Points</strong> — the first player to reach the target score wins immediately.
            {victoryCondition.kind === "points" && (
              <div className="row" style={{ marginTop: 6 }}>
                Target score:
                <input
                  type="number"
                  min={1}
                  value={victoryCondition.targetScore}
                  onChange={(e) => setVictoryCondition({ kind: "points", targetScore: Math.max(1, Number(e.target.value) || 1) })}
                  style={{ width: 80 }}
                />
              </div>
            )}
          </span>
        </label>
        <label className="row" style={{ alignItems: "flex-start" }}>
          <input
            type="radio"
            checked={victoryCondition.kind === "turns"}
            onChange={() => setVictoryCondition({ kind: "turns", turnLimit: 10, tieExtensionLimit: 12 })}
          />
          <span>
            <strong>Turns</strong> — play ends after round 10; highest score wins. A tie extends play to round 12, then
            falls back to whichever tied player's Domain is closest to the nearest remaining townsfolk (next-closest
            breaks a further tie); if that's also even, the game ends in a draw.
          </span>
        </label>
      </div>

      <div className="card-panel stack">
        <h3>Push / Pull Direction</h3>
        <p className="text-dim small">
          Push and pull abilities/cards (Wild Gale, Zephyr's Kiss, Gust, Wind Djinn's Main Ability, Ocean Sirens' starting
          ability, Siren's Call, Siren's Lure, Nymph's Embrace, Ocean Sirens' Main Ability) only move a Human relative to the
          acting player's own Domain: pull toward it, push away from it — never the other way around.
        </p>
        <label className="row" style={{ alignItems: "flex-start" }}>
          <input type="checkbox" checked={pushPullSidewaysAllowed} onChange={(e) => setPushPullSidewaysAllowed(e.target.checked)} />
          <span>
            <strong>Allow sideways directions</strong> — when checked, pull also allows the 2 directions that neither approach
            nor retreat from your Domain (4 legal directions total); push likewise gains those 2 sideways directions. When
            unchecked, pull only works in the 2 directions strictly toward your Domain and push only in the 2 directions
            strictly away from it.
          </span>
        </label>
      </div>

      <div className="card-panel stack">
        <div className="spread">
          <h3>Enchantment Cards</h3>
          <div className="row">
            <button className="secondary" onClick={() => setAll(enchantments.map((c) => c.id), true)}>
              Enable all
            </button>
            <button className="secondary" onClick={() => setAll(enchantments.map((c) => c.id), false)}>
              Disable all
            </button>
          </div>
        </div>
        <div className="hand-grid">
          {enchantments.map((c) => (
            <label key={c.id} className={`hand-card${disabledCardIds.has(c.id) ? "" : " selected"}`} style={{ cursor: "pointer" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{c.name}</strong>
                <input type="checkbox" checked={!disabledCardIds.has(c.id)} onChange={() => toggleCard(c.id)} />
              </div>
              <div className="text-dim" style={{ marginTop: 4 }}>
                {c.rulesText}
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="card-panel stack">
        <div className="spread">
          <h3>Landscape Cards</h3>
          <div className="row">
            <button className="secondary" onClick={() => setAll(landscapes.map((c) => c.id), true)}>
              Enable all
            </button>
            <button className="secondary" onClick={() => setAll(landscapes.map((c) => c.id), false)}>
              Disable all
            </button>
          </div>
        </div>
        <div className="hand-grid">
          {landscapes.map((c) => (
            <label key={c.id} className={`hand-card${disabledCardIds.has(c.id) ? "" : " selected"}`} style={{ cursor: "pointer" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <strong>{c.name}</strong>
                <input type="checkbox" checked={!disabledCardIds.has(c.id)} onChange={() => toggleCard(c.id)} />
              </div>
              <div className="text-dim" style={{ marginTop: 4 }}>
                {c.rulesText}
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="row">
        <button onClick={save}>Save Options</button>
        <button className="secondary" onClick={() => setScreen("home")}>
          Back
        </button>
      </div>
    </div>
  );
}
