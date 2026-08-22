import React, { useMemo, useState } from "react";
import type { Axial, DomainId } from "@fairy/shared";
import { ENCHANTMENT_DEFINITIONS_BY_ID, DOMAIN_DEFINITIONS_BY_ID, HUMAN_DEFINITIONS } from "@fairy/shared";
import { useAppStore } from "../state/store";
import { socket, newActionId } from "../socket";
import { HexBoard } from "../board/HexBoard";
import { PromptBanner } from "../components/PromptBanner";
import { GameLog } from "../components/GameLog";
import { HandPanel } from "../components/HandPanel";
import { DomainAbilityPanel } from "../components/DomainAbilityPanel";
import { ResponseStackPanel } from "../components/ResponseStackPanel";
import { PlayerSidebar } from "../components/PlayerSidebar";
import { HostPanel } from "../components/HostPanel";
import { DomainMatModal } from "../components/DomainMatModal";
import { computePlayerColors } from "../playerColors";
import { legalBoardSpacesForStep, legalLurePlacementSpaces, upcomingSpawnSpaces } from "../legality";
import { CARD_TARGETING, ABILITY_TARGETING, TargetStep } from "../targetingScripts";

type Targeting = {
  origin: "card" | "ability" | "instantResponse" | "instantAbilityResponse" | "mainAbility" | "startingAbility";
  cardId?: string;
  abilityIndex?: number;
  abilityKey?: string;
  steps: TargetStep[];
  stepIndex: number;
  collected: Record<string, unknown>;
};

/** Toadstool-placing effects (Toadstool card, Earth Gnomes' Main Ability and starting ability) all need the same "switch to relocate-flow once 2 already exist on the board" check. */
function resolveToadstoolSteps(baseKey: string, toadstoolCount: number): TargetStep[] {
  if (toadstoolCount >= 2) return CARD_TARGETING[`${baseKey}_relocate`] ?? ABILITY_TARGETING[`${baseKey}_relocate`] ?? [];
  return CARD_TARGETING[baseKey] ?? ABILITY_TARGETING[baseKey] ?? [];
}

export function GameScreen() {
  const view = useAppStore((s) => s.view);
  const [targeting, setTargeting] = useState<Targeting | null>(null);
  const [placingLure, setPlacingLure] = useState(false);
  const [confirmingDiscardDraw, setConfirmingDiscardDraw] = useState(false);
  const [mandatoryDiscardSelection, setMandatoryDiscardSelection] = useState<string[]>([]);
  const [viewingMatDomainId, setViewingMatDomainId] = useState<DomainId | null>(null);

  const colors = useMemo(() => computePlayerColors(view), [view]);
  const domainAbilitiesUsed = useMemo(
    () => Object.fromEntries((view?.players ?? []).map((p) => [p.id, p.abilitiesUsed])),
    [view]
  );

  if (!view || !view.board) return <div className="card-panel">Loading game…</div>;

  const me = view.players.find((p) => p.id === view.yourPlayerId);
  const myTurn = view.activePlayerId === view.yourPlayerId && view.phase === "player-turn";
  const iAmHost = view.hostPlayerId === view.yourPlayerId;
  const myInteraction = view.pendingInteraction && view.pendingInteraction.forPlayerIds.includes(view.yourPlayerId ?? "") ? view.pendingInteraction : null;
  const toadstoolCount = view.board.obstacles.filter((o) => o.type === "toadstool").length;

  function submitAction(type: string, payload: Record<string, unknown>) {
    socket.emit("action:submit", { actionId: newActionId(), stateVersion: view!.version, type: type as any, payload });
  }
  function respond(payload: Record<string, unknown>) {
    if (!myInteraction) return;
    socket.emit("interaction:respond", {
      actionId: newActionId(),
      stateVersion: view!.version,
      interactionId: myInteraction.id,
      payload,
    });
  }

  function beginCardTargeting(cardId: string) {
    const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
    if (!def) return;
    const steps = def.effectKey === "toadstoolCard" ? resolveToadstoolSteps("toadstoolCard", toadstoolCount) : CARD_TARGETING[def.effectKey] ?? [];
    if (steps.length === 0) {
      submitAction("playCard", { cardId, target: null });
      return;
    }
    setTargeting({ origin: "card", cardId, steps, stepIndex: 0, collected: {} });
  }

  function beginInstantResponseTargeting(cardId: string) {
    const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
    if (!def) return;
    const steps = CARD_TARGETING[def.effectKey] ?? [];
    if (steps.length === 0) {
      respond({ cardId, target: null });
      return;
    }
    setTargeting({ origin: "instantResponse", cardId, steps, stepIndex: 0, collected: {} });
  }

  function beginInstantAbilityResponseTargeting(index: number, key: string) {
    const steps = ABILITY_TARGETING[key] ?? [];
    if (steps.length === 0) {
      respond({ abilityIndex: index, target: null });
      return;
    }
    setTargeting({ origin: "instantAbilityResponse", abilityIndex: index, abilityKey: key, steps, stepIndex: 0, collected: {} });
  }

  function beginAbilityTargeting(index: number, key: string) {
    const steps = ABILITY_TARGETING[key] ?? [];
    if (steps.length === 0) {
      submitAction("useDomainAbility", { abilityIndex: index, target: null });
      return;
    }
    setTargeting({ origin: "ability", abilityIndex: index, abilityKey: key, steps, stepIndex: 0, collected: {} });
  }

  function beginMainAbilityTargeting(key: string) {
    const steps = key === "gnomesMain" ? resolveToadstoolSteps("gnomesMain", toadstoolCount) : ABILITY_TARGETING[key] ?? [];
    if (steps.length === 0) {
      submitAction("useMainAbility", { target: null });
      return;
    }
    setTargeting({ origin: "mainAbility", abilityKey: key, steps, stepIndex: 0, collected: {} });
  }

  function beginStartingAbilityTargeting(key: string) {
    const steps = key === "gnomes-starting" ? resolveToadstoolSteps("gnomes-starting", toadstoolCount) : ABILITY_TARGETING[key] ?? [];
    if (steps.length === 0) {
      respond({ target: null });
      return;
    }
    setTargeting({ origin: "startingAbility", abilityKey: key, steps, stepIndex: 0, collected: {} });
  }

  function advanceTargeting(field: string, value: unknown) {
    if (!targeting) return;
    const collected = { ...targeting.collected, [field]: value };
    const nextIndex = targeting.stepIndex + 1;
    if (nextIndex >= targeting.steps.length) {
      if (targeting.origin === "card") {
        submitAction("playCard", { cardId: targeting.cardId, target: collected });
      } else if (targeting.origin === "ability") {
        submitAction("useDomainAbility", { abilityIndex: targeting.abilityIndex, target: collected });
      } else if (targeting.origin === "mainAbility") {
        submitAction("useMainAbility", { target: collected });
      } else if (targeting.origin === "instantResponse") {
        respond({ cardId: targeting.cardId, target: collected });
      } else if (targeting.origin === "instantAbilityResponse") {
        respond({ abilityIndex: targeting.abilityIndex, target: collected });
      } else if (targeting.origin === "startingAbility") {
        respond({ target: collected });
      }
      setTargeting(null);
    } else {
      setTargeting({ ...targeting, stepIndex: nextIndex, collected });
    }
  }

  const currentStep = targeting?.steps[targeting.stepIndex] ?? null;

  function onHexClick(hex: Axial) {
    if (placingLure) {
      submitAction("placeLure", { position: hex });
      setPlacingLure(false);
      return;
    }
    if (myInteraction?.kind === "chooseMovementPath") {
      respond({ position: hex });
      return;
    }
    if (currentStep?.picks === "boardSpace" || currentStep?.picks === "upcomingSpawnSpace") {
      advanceTargeting(currentStep.field, hex);
    }
  }
  function onHumanClick(instanceId: string, position: Axial) {
    if (currentStep?.picks === "human") {
      advanceTargeting(currentStep.field, instanceId);
      return;
    }
    // Not picking a Human right now — the click was meant for the hex
    // underneath (e.g. placing/stacking a lure on an occupied hex).
    onHexClick(position);
  }
  function onLureClick(stackId: string, position: Axial) {
    if (currentStep?.picks === "lureStack" || currentStep?.picks === "ownLureStack") {
      advanceTargeting(currentStep.field, stackId);
      return;
    }
    onHexClick(position);
  }
  function onObstacleClick(obstacleId: string, position: Axial) {
    if (currentStep?.picks === "obstacle") {
      advanceTargeting(currentStep.field, obstacleId);
      return;
    }
    onHexClick(position);
  }
  function onAccelMarkerClick(markerId: string, position: Axial) {
    if (currentStep?.picks === "obstacle" && currentStep.alt) {
      advanceTargeting(currentStep.alt.field, markerId);
      return;
    }
    onHexClick(position);
  }
  function onResponseStackSelect(effectId: string) {
    if (currentStep?.picks === "responseStackItem") advanceTargeting(currentStep.field, effectId);
  }
  function onDiscardPileSelect(cardId: string) {
    if (currentStep?.picks === "discardedCard") advanceTargeting(currentStep.field, cardId);
  }
  function onDirectionSelect(direction: "left" | "right") {
    if (currentStep?.picks === "direction") advanceTargeting(currentStep.field, direction);
  }
  function onHumanTypeSelect(definitionId: string) {
    if (currentStep?.picks === "humanType") advanceTargeting(currentStep.field, definitionId);
  }
  function onOtherPlayerSelect(playerId: string) {
    if (currentStep?.picks === "otherPlayer") advanceTargeting(currentStep.field, playerId);
  }

  let legalHexes: Axial[] = [];
  if (placingLure && view.yourPlayerId) legalHexes = legalLurePlacementSpaces(view, view.yourPlayerId);
  else if (myInteraction?.kind === "chooseMovementPath") legalHexes = (myInteraction.legalOptions as any)?.positions ?? [];
  else if (currentStep?.picks === "boardSpace" && targeting) legalHexes = legalBoardSpacesForStep(view, currentStep, targeting.steps, targeting.collected);
  else if (currentStep?.picks === "upcomingSpawnSpace") legalHexes = upcomingSpawnSpaces(view);

  // Contextual instruction panel (spec section 25) — never leave the player guessing.
  let prompt = "";
  if (myInteraction) prompt = myInteraction.prompt;
  else if (targeting && currentStep) prompt = currentStep.prompt;
  else if (view.pendingInteraction) prompt = view.pendingInteraction.prompt;
  else if (view.phase === "starting-abilities") prompt = "Waiting for a Domain's starting ability to resolve.";
  else if (view.phase === "human-movement") prompt = "The Humans are moving…";
  else if (view.phase === "human-spawn" || view.phase === "round-cleanup") prompt = "Spawning new Humans and starting the next round…";
  else if (myTurn) prompt = `Your turn — actions remaining: ${view.actionsRemaining}. Choose an action.`;
  else prompt = `Waiting for ${view.players.find((p) => p.id === view.activePlayerId)?.name ?? "the other player"}'s turn.`;

  const placeLureAction = view.availableActions.find((a) => a.type === "placeLure");
  const playCardAction = view.availableActions.find((a) => a.type === "playCard");
  const abilityAction = view.availableActions.find((a) => a.type === "useDomainAbility");
  const drawCardAction = view.availableActions.find((a) => a.type === "drawCard");
  const discardDrawAction = view.availableActions.find((a) => a.type === "discardDraw");

  const domain = me?.domainId ? DOMAIN_DEFINITIONS_BY_ID[me.domainId] : null;
  const myStartingAbilityPrompt =
    view.phase === "starting-abilities" && myInteraction?.kind === "chooseDomainAbility" && domain?.startingAbility ? domain.startingAbility : null;

  return (
    <div className="stack">
      <PromptBanner text={prompt} />

      <div className="game-layout">
        <PlayerSidebar view={view} playerColors={colors} onViewDomainMat={setViewingMatDomainId} />

        <div className="card-panel board-frame">
          <HexBoard
            edgeLength={view.board.edgeLength}
            fadeMovedHumans={view.phase === "human-movement"}
            humans={view.board.humans}
            lureStacks={view.board.lureStacks}
            obstacles={view.board.obstacles}
            accelMarkers={view.board.accelMarkers}
            domainBoards={view.board.domainBoards}
            yourPlayerId={view.yourPlayerId}
            domainAbilitiesUsed={domainAbilitiesUsed}
            portalCenter={view.board.portalCenter}
            playerColors={colors}
            playerNames={Object.fromEntries(view.players.map((p) => [p.id, p.name]))}
            legalHexes={legalHexes}
            onHexClick={onHexClick}
            onHumanClick={onHumanClick}
            onLureClick={onLureClick}
            onObstacleClick={onObstacleClick}
            onAccelMarkerClick={onAccelMarkerClick}
            onDomainMatClick={setViewingMatDomainId}
          />
          {currentStep?.picks === "obstacle" && currentStep.alt && (
            <div className="small text-dim" style={{ marginTop: 6 }}>
              {currentStep.prompt} Or: {currentStep.alt.prompt}
            </div>
          )}
          {(targeting || placingLure) && (
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="secondary"
                onClick={() => {
                  setTargeting(null);
                  setPlacingLure(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="stack">
          {myStartingAbilityPrompt && !targeting && (
            <div className="card-panel stack">
              <h3>Resolve Your Starting Ability</h3>
              <div className="small">{myStartingAbilityPrompt.rulesText}</div>
              <button onClick={() => beginStartingAbilityTargeting(myStartingAbilityPrompt.key)}>
                Resolve: {myStartingAbilityPrompt.name}
              </button>
            </div>
          )}

          {myInteraction?.kind === "mandatoryDiscard" && (
            <div className="card-panel stack">
              <h3>Hand over the max — discard {(myInteraction.legalOptions as any)?.mustDiscardCount} card(s)</h3>
              <p className="small text-dim">
                Your hand has more than the {(myInteraction.legalOptions as any)?.handSizeMax}-card max. Choose exactly{" "}
                {(myInteraction.legalOptions as any)?.mustDiscardCount} to discard before play continues.
              </p>
              <HandPanel
                hand={view.yourHand ?? []}
                mode="pickAny"
                selectedCardId={null}
                onPick={(id) =>
                  setMandatoryDiscardSelection((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]))
                }
              />
              <div className="small">
                Selected: {mandatoryDiscardSelection.length} / {(myInteraction.legalOptions as any)?.mustDiscardCount}
              </div>
              <button
                disabled={mandatoryDiscardSelection.length !== (myInteraction.legalOptions as any)?.mustDiscardCount}
                onClick={() => {
                  respond({ cardIds: mandatoryDiscardSelection });
                  setMandatoryDiscardSelection([]);
                }}
              >
                Confirm Discard
              </button>
            </div>
          )}

          {myTurn && !targeting && !placingLure && myInteraction?.kind !== "mandatoryDiscard" && (
            <div className="card-panel stack">
              <h3>Choose your action</h3>
              <button disabled={!placeLureAction?.available} title={placeLureAction?.reason} onClick={() => setPlacingLure(true)}>
                Place a Lure
              </button>
              {!placeLureAction?.available && <div className="small text-dim">{placeLureAction?.reason}</div>}
              <div className="small text-dim">{playCardAction?.available ? "Pick a card below to play it." : playCardAction?.reason}</div>
              <button disabled={!drawCardAction?.available} title={drawCardAction?.reason} onClick={() => submitAction("drawCard", {})}>
                Draw a Card
              </button>
              {!drawCardAction?.available && <div className="small text-dim">{drawCardAction?.reason}</div>}
              {confirmingDiscardDraw ? (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="small">
                    Discard your entire hand ({view.yourHand?.length ?? 0} card{(view.yourHand?.length ?? 0) === 1 ? "" : "s"}) and draw 4
                    new ones?
                  </div>
                  <div className="row">
                    <button
                      onClick={() => {
                        submitAction("discardDraw", {});
                        setConfirmingDiscardDraw(false);
                      }}
                    >
                      Confirm
                    </button>
                    <button className="secondary" onClick={() => setConfirmingDiscardDraw(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button disabled={!discardDrawAction?.available} title={discardDrawAction?.reason} onClick={() => setConfirmingDiscardDraw(true)}>
                  Discard &amp; Draw (discard hand, draw 4)
                </button>
              )}
              {!discardDrawAction?.available && <div className="small text-dim">{discardDrawAction?.reason}</div>}
              <button className="secondary" onClick={() => submitAction("endTurn", {})}>
                End Turn (skip remaining actions)
              </button>
            </div>
          )}

          <div className="card-panel">
            <h3>Enchantments</h3>
            <HandPanel
              hand={view.yourHand ?? []}
              mode={
                myInteraction?.kind === "chooseInstantResponse"
                  ? "pickInstant"
                  : myTurn && !targeting && !placingLure && !confirmingDiscardDraw
                  ? "pickAny"
                  : "disabled"
              }
              selectedCardId={targeting?.cardId ?? null}
              onPick={(id) => {
                if (myInteraction?.kind === "chooseInstantResponse") {
                  beginInstantResponseTargeting(id);
                } else {
                  beginCardTargeting(id);
                }
              }}
            />
            {myInteraction?.kind === "chooseInstantResponse" &&
              domain &&
              ((myInteraction.legalOptions as any)?.instantAbilityIndices ?? []).map((index: number) => {
                const a = domain.abilities[index];
                return (
                  <button
                    key={a.key}
                    className="secondary"
                    style={{ marginTop: 8, display: "block", width: "100%" }}
                    title={a.rulesText}
                    onClick={() => beginInstantAbilityResponseTargeting(index, a.key)}
                  >
                    Use {a.name} ⚡
                  </button>
                );
              })}
            {myInteraction?.kind === "chooseInstantResponse" && (
              <button className="secondary" style={{ marginTop: 8 }} onClick={() => respond({ pass: true })}>
                Pass
              </button>
            )}
          </div>

          <div className="card-panel">
            <div className="spread">
              <h3>Domain Abilities</h3>
              {me?.domainId && (
                <button className="secondary small" onClick={() => setViewingMatDomainId(me.domainId)}>
                  View full mat
                </button>
              )}
            </div>
            <DomainAbilityPanel
              domainId={me?.domainId ?? null}
              abilitiesUsed={me?.abilitiesUsed ?? [false, false, false]}
              canUse={myTurn && !targeting && !placingLure && !confirmingDiscardDraw && Boolean(abilityAction?.available)}
              onUse={(index) => {
                if (!me?.domainId) return;
                const key = DOMAIN_DEFINITIONS_BY_ID[me.domainId].abilities[index].key;
                beginAbilityTargeting(index, key);
              }}
            />
            {domain?.mainAbility && domain.mainAbility.implementationStatus === "implemented" && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <button
                  className="secondary"
                  disabled={!myTurn || Boolean(targeting) || placingLure || confirmingDiscardDraw || view.actionsRemaining === null || view.actionsRemaining < domain.mainAbility.actionCost}
                  title={domain.mainAbility.rulesText}
                  onClick={() => beginMainAbilityTargeting(domain.mainAbility!.key)}
                >
                  Main Ability ({domain.mainAbility.actionCost} actions): {domain.mainAbility.rulesText}
                </button>
              </div>
            )}
          </div>

          <div className="card-panel">
            <h3>Pending Effects</h3>
            <ResponseStackPanel
              items={view.responseStack}
              selectable={currentStep?.picks === "responseStackItem"}
              onSelect={onResponseStackSelect}
            />
          </div>

          {currentStep?.picks === "direction" && (
            <div className="card-panel">
              <h3>Choose a neighbor</h3>
              <div className="row">
                <button onClick={() => onDirectionSelect("left")}>Left neighbor</button>
                <button onClick={() => onDirectionSelect("right")}>Right neighbor</button>
              </div>
            </div>
          )}

          {currentStep?.picks === "otherPlayer" && (
            <div className="card-panel">
              <h3>Choose a player</h3>
              <div className="row">
                {view.players
                  .filter((p) => p.id !== view.yourPlayerId)
                  .map((p) => (
                    <button key={p.id} className="secondary" onClick={() => onOtherPlayerSelect(p.id)}>
                      {p.name}
                    </button>
                  ))}
              </div>
            </div>
          )}

          {currentStep?.picks === "humanType" && (
            <div className="card-panel">
              <h3>Choose a Human type</h3>
              <div className="row">
                {HUMAN_DEFINITIONS.map((h) => (
                  <button key={h.id} className="secondary" onClick={() => onHumanTypeSelect(h.id)}>
                    {h.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentStep?.picks === "discardedCard" && (
            <div className="card-panel">
              <h3>Discard Pile</h3>
              {view.discardPile.length === 0 && <div className="text-dim small">Empty.</div>}
              <div className="hand-grid">
                {view.discardPile.map((cardId, i) => {
                  const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
                  return (
                    <div key={`${cardId}-${i}`} className="hand-card" onClick={() => onDiscardPileSelect(cardId)}>
                      <strong>{def?.name ?? cardId}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {view.deckPeek && view.deckPeek.length > 0 && (
            <div className="card-panel">
              <h3>Top of the Deck</h3>
              <div className="small text-dim" style={{ marginBottom: 6 }}>
                Only you can see this.
              </div>
              <div className="hand-grid">
                {view.deckPeek.map((cardId, i) => (
                  <div key={`${cardId}-${i}`} className="hand-card">
                    <strong>{ENCHANTMENT_DEFINITIONS_BY_ID[cardId]?.name ?? cardId}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view.revealedHands.length > 0 && (
            <div className="card-panel">
              <h3>Revealed Hands</h3>
              {view.revealedHands.map((r) => (
                <div key={r.revealedPlayerId} className="small">
                  <strong>{view.players.find((p) => p.id === r.revealedPlayerId)?.name ?? r.revealedPlayerId}:</strong>{" "}
                  {r.hand.map((cardId) => ENCHANTMENT_DEFINITIONS_BY_ID[cardId]?.name ?? cardId).join(", ") || "(empty hand)"}
                </div>
              ))}
            </div>
          )}

          <div className="card-panel">
            <h3>Game Log</h3>
            <GameLog log={view.log} />
          </div>

          {iAmHost && <HostPanel view={view} />}
        </div>
      </div>

      {viewingMatDomainId && (
        <DomainMatModal
          domainId={viewingMatDomainId}
          abilitiesUsed={view.players.find((p) => p.domainId === viewingMatDomainId)?.abilitiesUsed}
          onClose={() => setViewingMatDomainId(null)}
        />
      )}
    </div>
  );
}
