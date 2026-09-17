import React, { useEffect, useMemo, useState } from "react";
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
import { shortName } from "../abbreviations";
import { HUMAN_ICONS } from "../board/icons";
import { CopyRejoinLinkButton } from "../components/CopyRejoinLinkButton";
import { useCompactLayout, useNarrowDock, useNarrowPortrait } from "../mobile/useCompactLayout";
import { CompactTopBar } from "../mobile/CompactTopBar";
import { CompactDock, SheetKey } from "../mobile/CompactDock";
import { CompactHandPanel } from "../mobile/CompactHandPanel";
import { CompactAbilityPanel } from "../mobile/CompactAbilityPanel";
import { BoardLegend } from "../mobile/BoardLegend";
import { Sheet } from "../mobile/Sheet";
import { InfoPopup } from "../mobile/InfoPopup";

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
  // Compact layout only: which dock sheet is open, and whether the truncated
  // one-line prompt has been tapped open to its full text.
  const [openSheet, setOpenSheet] = useState<SheetKey | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  // A full board fitted to a phone's short side renders every hex at about
  // 20px — legible, but not comfortably tappable. Rather than gesture
  // handling, the dock cycles a plain scale factor and the board area
  // scrolls; tap targets grow with it.
  const [boardZoom, setBoardZoom] = useState(1);
  const boardScrollRef = React.useRef<HTMLDivElement | null>(null);
  const compact = useCompactLayout();
  const narrowPortrait = useNarrowPortrait();
  const narrowDock = useNarrowDock();

  const colors = useMemo(() => computePlayerColors(view), [view]);
  const domainAbilitiesUsed = useMemo(
    () => Object.fromEntries((view?.players ?? []).map((p) => [p.id, p.abilitiesUsed])),
    [view]
  );

  // Compact layout: a response window is answered from your hand, so open
  // that sheet for the player instead of making them hunt for it under a
  // timer. Conversely, anything that needs board taps closes every sheet —
  // the board is the thing they need to see.
  const instantResponsePending =
    view?.pendingInteraction?.kind === "chooseInstantResponse" &&
    view.pendingInteraction.forPlayerIds.includes(view.yourPlayerId ?? "");
  const boardTargetingActive = Boolean(targeting) || placingLure;
  useEffect(() => {
    if (compact && instantResponsePending) setOpenSheet("hand");
  }, [compact, instantResponsePending]);
  useEffect(() => {
    if (compact && boardTargetingActive) setOpenSheet(null);
  }, [compact, boardTargetingActive]);
  // Zooming in should keep you looking at the middle of the board — the
  // Portal and the action — not at whatever corner the scroll box starts in.
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [boardZoom]);

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
  // An in-progress targeting script's own step is the most specific
  // instruction there is, so it outranks the interaction that started it —
  // otherwise a starting ability or response window keeps showing its
  // opening prompt while the player is midway through picking targets, which
  // in the compact layout is the only guidance on screen.
  if (targeting && currentStep) prompt = currentStep.prompt;
  else if (myInteraction) prompt = myInteraction.prompt;
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

  // ---------------------------------------------------------------------------
  // Panel bodies, built once and placed by whichever layout is active. The
  // desktop grid stacks them all down the right rail at once; the compact
  // layout files each one behind a dock button, and pins whichever one the
  // game is actually waiting on over the bottom of the board.
  // ---------------------------------------------------------------------------

  type PanelDef = { title: string; body: React.ReactNode; stacked?: boolean };

  const playerNames = Object.fromEntries(view.players.map((p) => [p.id, p.name]));

  const handMode =
    myInteraction?.kind === "chooseInstantResponse"
      ? "pickInstant"
      : myTurn && !targeting && !placingLure && !confirmingDiscardDraw
      ? "pickAny"
      : "disabled";

  function pickHandCard(id: string) {
    if (myInteraction?.kind === "chooseInstantResponse") beginInstantResponseTargeting(id);
    else beginCardTargeting(id);
  }

  const handPanel: PanelDef = {
    title: "Enchantments",
    stacked: true,
    body: (
      <>
        {compact ? (
          <CompactHandPanel hand={view.yourHand ?? []} mode={handMode} onPick={pickHandCard} />
        ) : (
          <HandPanel
            hand={view.yourHand ?? []}
            mode={handMode}
            selectedCardId={targeting?.cardId ?? null}
            onPick={pickHandCard}
          />
        )}
        {myInteraction?.kind === "chooseInstantResponse" && (
          <>
            {/* Compact points at the Powers sheet instead of repeating every
                Instant ability here — it already lists them, gated to the
                ones this response window allows. */}
            {compact
              ? ((myInteraction.legalOptions as any)?.instantAbilityIndices ?? []).length > 0 && (
                  <div className="small text-dim">Or answer with an Instant ability — open ✨ Powers.</div>
                )
              : domain &&
                ((myInteraction.legalOptions as any)?.instantAbilityIndices ?? []).map((index: number) => {
                  const a = domain.abilities[index];
                  return (
                    <button
                      key={a.key}
                      className="secondary"
                      style={{ display: "block", width: "100%" }}
                      title={a.rulesText}
                      onClick={() => beginInstantAbilityResponseTargeting(index, a.key)}
                    >
                      Use {a.name} ⚡
                    </button>
                  );
                })}
            <button className="secondary" onClick={() => respond({ pass: true })}>
              Pass
            </button>
          </>
        )}
      </>
    ),
  };

  const mainAbility = domain?.mainAbility?.implementationStatus === "implemented" ? domain.mainAbility : null;
  const mainAbilityBlocked =
    !myTurn ||
    Boolean(targeting) ||
    placingLure ||
    confirmingDiscardDraw ||
    view.actionsRemaining === null ||
    view.actionsRemaining < (mainAbility?.actionCost ?? 0);

  const canUseAbility = myTurn && !targeting && !placingLure && !confirmingDiscardDraw && Boolean(abilityAction?.available);

  const abilitiesPanel: PanelDef = {
    title: compact ? domain?.name ?? "Domain Abilities" : "Domain Abilities",
    body: compact ? (
      <CompactAbilityPanel
        domainId={me?.domainId ?? null}
        abilitiesUsed={me?.abilitiesUsed ?? [false, false, false]}
        canUse={canUseAbility}
        allowedIndices={
          myInteraction?.kind === "chooseInstantResponse"
            ? ((myInteraction.legalOptions as any)?.instantAbilityIndices ?? [])
            : undefined
        }
        onUse={(index) => {
          if (!me?.domainId) return;
          const key = DOMAIN_DEFINITIONS_BY_ID[me.domainId].abilities[index].key;
          if (myInteraction?.kind === "chooseInstantResponse") beginInstantAbilityResponseTargeting(index, key);
          else beginAbilityTargeting(index, key);
          setOpenSheet(null);
        }}
        mainAbilityBlocked={mainAbilityBlocked}
        onUseMainAbility={() => {
          if (!mainAbility) return;
          beginMainAbilityTargeting(mainAbility.key);
          setOpenSheet(null);
        }}
      />
    ) : (
      <>
        <DomainAbilityPanel
          domainId={me?.domainId ?? null}
          abilitiesUsed={me?.abilitiesUsed ?? [false, false, false]}
          canUse={canUseAbility}
          onUse={(index) => {
            if (!me?.domainId) return;
            const key = DOMAIN_DEFINITIONS_BY_ID[me.domainId].abilities[index].key;
            beginAbilityTargeting(index, key);
          }}
        />
        {mainAbility && (
          <div className="main-ability-block">
            <div className="spread">
              {/* Every Domain's repeatable ability is literally named "Main
                  Ability" in the data, so prefixing it would read "Main:
                  Main Ability" — the tag on the right carries that instead. */}
              <strong>{mainAbility.name}</strong>
              <span className="small text-dim">
                {mainAbility.actionCost} action{mainAbility.actionCost === 1 ? "" : "s"} · repeatable
              </span>
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              {mainAbility.rulesText}
            </div>
            <button
              className="secondary"
              style={{ marginTop: 8, width: "100%" }}
              disabled={mainAbilityBlocked}
              onClick={() => {
                beginMainAbilityTargeting(mainAbility.key);
                setOpenSheet(null);
              }}
            >
              Use Main Ability
            </button>
          </div>
        )}
      </>
    ),
  };

  const effectsPanel: PanelDef = {
    title: "Pending Effects",
    body: (
      <ResponseStackPanel
        items={view.responseStack}
        playerNames={playerNames}
        selectable={currentStep?.picks === "responseStackItem"}
        onSelect={(id) => {
          onResponseStackSelect(id);
          setOpenSheet(null);
        }}
      />
    ),
  };

  const logPanel: PanelDef = { title: "Game Log", body: <GameLog log={view.log} /> };

  const actionsPanel: PanelDef | null =
    myTurn && !targeting && !placingLure && myInteraction?.kind !== "mandatoryDiscard"
      ? {
          title: "Choose your action",
          stacked: true,
          body: (
            <>
              <button
                disabled={!placeLureAction?.available}
                title={placeLureAction?.reason}
                onClick={() => {
                  setPlacingLure(true);
                  setOpenSheet(null);
                }}
              >
                Place a Lure
              </button>
              {!placeLureAction?.available && <div className="small text-dim">{placeLureAction?.reason}</div>}
              <div className="small text-dim">
                {playCardAction?.available
                  ? compact
                    ? "Open Hand to play a card."
                    : "Pick a card below to play it."
                  : playCardAction?.reason}
              </div>
              <button
                disabled={!drawCardAction?.available}
                title={drawCardAction?.reason}
                onClick={() => {
                  submitAction("drawCard", {});
                  setOpenSheet(null);
                }}
              >
                Draw a Card
              </button>
              {!drawCardAction?.available && <div className="small text-dim">{drawCardAction?.reason}</div>}
              {confirmingDiscardDraw ? (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="small">
                    Discard your entire hand ({view.yourHand?.length ?? 0} card
                    {(view.yourHand?.length ?? 0) === 1 ? "" : "s"}) and draw 4 new ones?
                  </div>
                  <div className="row">
                    <button
                      onClick={() => {
                        submitAction("discardDraw", {});
                        setConfirmingDiscardDraw(false);
                        setOpenSheet(null);
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
                <button
                  disabled={!discardDrawAction?.available}
                  title={discardDrawAction?.reason}
                  onClick={() => setConfirmingDiscardDraw(true)}
                >
                  Discard &amp; Draw (discard hand, draw 4)
                </button>
              )}
              {!discardDrawAction?.available && <div className="small text-dim">{discardDrawAction?.reason}</div>}
              <button
                className="secondary"
                onClick={() => {
                  submitAction("endTurn", {});
                  setOpenSheet(null);
                }}
              >
                End Turn (skip remaining actions)
              </button>
            </>
          ),
        }
      : null;

  const startingAbilityPanel: PanelDef | null =
    myStartingAbilityPrompt && !targeting
      ? {
          title: "Resolve Your Starting Ability",
          stacked: true,
          body: (
            <>
              <div className="small">{myStartingAbilityPrompt.rulesText}</div>
              <button onClick={() => beginStartingAbilityTargeting(myStartingAbilityPrompt.key)}>
                Resolve: {myStartingAbilityPrompt.name}
              </button>
            </>
          ),
        }
      : null;

  const mandatoryDiscardPanel: PanelDef | null =
    myInteraction?.kind === "mandatoryDiscard"
      ? {
          title: `Hand over the max — discard ${(myInteraction.legalOptions as any)?.mustDiscardCount} card(s)`,
          stacked: true,
          body: (
            <>
              <p className="small text-dim" style={{ margin: 0 }}>
                Your hand has more than the {(myInteraction.legalOptions as any)?.handSizeMax}-card max. Choose exactly{" "}
                {(myInteraction.legalOptions as any)?.mustDiscardCount} to discard before play continues.
              </p>
              {compact ? (
                <CompactHandPanel
                  hand={view.yourHand ?? []}
                  mode="pickAny"
                  actionLabel="Discard"
                  selectedIds={mandatoryDiscardSelection}
                  onPick={(id) =>
                    setMandatoryDiscardSelection((sel) =>
                      sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
                    )
                  }
                />
              ) : (
                <HandPanel
                  hand={view.yourHand ?? []}
                  mode="pickAny"
                  selectedCardId={null}
                  onPick={(id) =>
                    setMandatoryDiscardSelection((sel) =>
                      sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
                    )
                  }
                />
              )}
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
            </>
          ),
        }
      : null;

  // The one-off "pick something that isn't on the board" prompts. Only ever
  // one is active at a time, so they share a slot.
  let choicePanel: PanelDef | null = null;
  if (currentStep?.picks === "direction") {
    choicePanel = {
      title: "Choose a neighbor",
      body: (
        <div className="row">
          <button onClick={() => onDirectionSelect("left")}>Left neighbor</button>
          <button onClick={() => onDirectionSelect("right")}>Right neighbor</button>
        </div>
      ),
    };
  } else if (currentStep?.picks === "otherPlayer") {
    choicePanel = {
      title: "Choose a player",
      body: (
        <div className="row">
          {view.players
            .filter((p) => p.id !== view.yourPlayerId)
            .map((p) => (
              <button key={p.id} className="secondary" onClick={() => onOtherPlayerSelect(p.id)}>
                {p.name}
              </button>
            ))}
        </div>
      ),
    };
  } else if (currentStep?.picks === "humanType") {
    choicePanel = {
      title: "Choose a Human type",
      body: (
        <div className="row">
          {HUMAN_DEFINITIONS.map((h) => (
            <button key={h.id} className="secondary" onClick={() => onHumanTypeSelect(h.id)}>
              {HUMAN_ICONS[h.id] ?? ""} {h.name}
            </button>
          ))}
        </div>
      ),
    };
  } else if (currentStep?.picks === "discardedCard") {
    choicePanel = {
      title: "Discard Pile",
      body: (
        <>
          {view.discardPile.length === 0 && <div className="text-dim small">Empty.</div>}
          <div className={compact ? "chip-wrap" : "hand-grid"}>
            {view.discardPile.map((cardId, i) => {
              const def = ENCHANTMENT_DEFINITIONS_BY_ID[cardId];
              return compact ? (
                <button key={`${cardId}-${i}`} className="chip chip-card" title={def?.rulesText} onClick={() => onDiscardPileSelect(cardId)}>
                  {shortName(def?.name ?? cardId, 14)}
                </button>
              ) : (
                <div key={`${cardId}-${i}`} className="hand-card" onClick={() => onDiscardPileSelect(cardId)}>
                  <strong>{def?.name ?? cardId}</strong>
                </div>
              );
            })}
          </div>
        </>
      ),
    };
  }

  const deckPeekPanel: PanelDef | null =
    view.deckPeek && view.deckPeek.length > 0
      ? {
          title: "Top of the Deck",
          body: (
            <>
              <div className="small text-dim" style={{ marginBottom: 6 }}>
                Only you can see this.
              </div>
              <div className={compact ? "chip-wrap" : "hand-grid"}>
                {view.deckPeek.map((cardId, i) => {
                  const name = ENCHANTMENT_DEFINITIONS_BY_ID[cardId]?.name ?? cardId;
                  return compact ? (
                    <span key={`${cardId}-${i}`} className="chip" title={name}>
                      {shortName(name, 14)}
                    </span>
                  ) : (
                    <div key={`${cardId}-${i}`} className="hand-card">
                      <strong>{name}</strong>
                    </div>
                  );
                })}
              </div>
            </>
          ),
        }
      : null;

  const revealedHandsPanel: PanelDef | null =
    view.revealedHands.length > 0
      ? {
          title: "Revealed Hands",
          body: (
            <>
              {view.revealedHands.map((r) => (
                <div key={r.revealedPlayerId} className="small">
                  <strong>{view.players.find((p) => p.id === r.revealedPlayerId)?.name ?? r.revealedPlayerId}:</strong>{" "}
                  {r.hand.map((cardId) => ENCHANTMENT_DEFINITIONS_BY_ID[cardId]?.name ?? cardId).join(", ") ||
                    "(empty hand)"}
                </div>
              ))}
            </>
          ),
        }
      : null;

  const boardNode = (
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
      playerNames={playerNames}
      legalHexes={legalHexes}
      onHexClick={onHexClick}
      onHumanClick={onHumanClick}
      onLureClick={onLureClick}
      onObstacleClick={onObstacleClick}
      onAccelMarkerClick={onAccelMarkerClick}
      onDomainMatClick={setViewingMatDomainId}
      compactMats={compact}
    />
  );

  const matModal = viewingMatDomainId ? (
    <DomainMatModal
      domainId={viewingMatDomainId}
      abilitiesUsed={view.players.find((p) => p.domainId === viewingMatDomainId)?.abilitiesUsed}
      onClose={() => setViewingMatDomainId(null)}
    />
  ) : null;

  const cancelTargeting = () => {
    setTargeting(null);
    setPlacingLure(false);
  };

  // ---------------------------------------------------------------------------
  // Compact layout: board edge-to-edge, one truncated prompt line, everything
  // else behind the dock.
  // ---------------------------------------------------------------------------
  if (compact) {
    const pinnedPanel = startingAbilityPanel ?? mandatoryDiscardPanel ?? choicePanel;
    const unusedAbilities = (me?.abilitiesUsed ?? []).filter((u) => !u).length;
    const extrasCount = (deckPeekPanel ? 1 : 0) + (revealedHandsPanel ? 1 : 0);

    const morePanel: PanelDef = {
      title: "More",
      stacked: true,
      body: (
        <>
          {me?.domainId && (
            <button className="secondary" onClick={() => setViewingMatDomainId(me.domainId!)}>
              View my full player mat
            </button>
          )}
          <CopyRejoinLinkButton className="secondary" />
          {deckPeekPanel && (
            <details open>
              <summary>{deckPeekPanel.title}</summary>
              <div className="details-body">{deckPeekPanel.body}</div>
            </details>
          )}
          {revealedHandsPanel && (
            <details open>
              <summary>{revealedHandsPanel.title}</summary>
              <div className="details-body">{revealedHandsPanel.body}</div>
            </details>
          )}
          <details>
            <summary>Discard pile ({view.discardPile.length})</summary>
            <div className="details-body">
              {view.discardPile.length === 0 ? (
                <div className="text-dim small">Empty.</div>
              ) : (
                <div className="chip-wrap">
                  {view.discardPile.map((cardId, i) => {
                    const name = ENCHANTMENT_DEFINITIONS_BY_ID[cardId]?.name ?? cardId;
                    return (
                      <span key={`${cardId}-${i}`} className="chip" title={name}>
                        {shortName(name, 14)}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </details>
          <details>
            <summary>What the board symbols mean</summary>
            <div className="details-body">
              <BoardLegend />
            </div>
          </details>
          {iAmHost && <HostPanel view={view} />}
        </>
      ),
    };

    const sheets: Record<SheetKey, PanelDef> = {
      hand: handPanel,
      abilities: abilitiesPanel,
      effects: effectsPanel,
      log: logPanel,
      more: morePanel,
      actions: actionsPanel ?? { title: "Your turn", body: <div className="text-dim small">Waiting for your turn.</div> },
    };
    const activeSheet = openSheet ? sheets[openSheet] : null;

    return (
      <div className="game-compact">
        <CompactTopBar
          view={view}
          playerColors={colors}
          onViewDomainMat={setViewingMatDomainId}
          showRotateNudge={narrowPortrait}
        />

        <button className="compact-prompt" onClick={() => setPromptExpanded(true)} title="Tap for the full prompt">
          <span className="compact-prompt-text">{prompt}</span>
          <span className="compact-prompt-more" aria-hidden="true">
            ⓘ
          </span>
        </button>

        <div className={`compact-board${boardZoom > 1 ? " zoomed" : ""}`} ref={boardScrollRef}>
          <div className="compact-board-inner" style={{ width: `${boardZoom * 100}%`, height: `${boardZoom * 100}%` }}>
            {boardNode}
          </div>
        </div>

        {currentStep?.picks === "obstacle" && currentStep.alt && (
          <div className="compact-subprompt small">Or: {currentStep.alt.prompt}</div>
        )}

        <CompactDock
          buttons={[
            {
              key: "hand",
              glyph: "🃏",
              label: "Hand",
              badge: view.yourHand?.length ?? 0,
              urgent: myInteraction?.kind === "chooseInstantResponse",
            },
            { key: "abilities", glyph: "✨", label: "Powers", badge: unusedAbilities },
            {
              key: "effects",
              glyph: "⏳",
              label: "Effects",
              badge: view.responseStack.length,
              urgent: view.responseStack.length > 0,
            },
            { key: "log", glyph: "📜", label: "Log" },
            { key: "more", glyph: "☰", label: "More", badge: extrasCount, urgent: extrasCount > 0 },
          ]}
          openSheet={openSheet}
          onToggleSheet={setOpenSheet}
          leading={
            <button
              className="dock-btn"
              onClick={() => setBoardZoom((z) => (z >= 2.5 ? 1 : z + 0.5))}
              title="Zoom the board — the area scrolls when it's larger than the screen"
            >
              {/* The factor is the glyph, not the label — labels are hidden
                  on the shortest screens, and the current zoom is exactly
                  what you need to see there. */}
              <span className="dock-glyph dock-glyph-text">{boardZoom}×</span>
              <span className="dock-label">Zoom</span>
            </button>
          }
          actions={
            boardTargetingActive ? (
              <button className="danger dock-action" onClick={cancelTargeting}>
                ✕ Cancel
              </button>
            ) : myTurn ? (
              <>
                {!narrowDock && (
                  <>
                    <span className="chip chip-strong dock-count">{view.actionsRemaining ?? 0} act</span>
                    <button
                      className="dock-action"
                      disabled={!placeLureAction?.available}
                      title={placeLureAction?.reason}
                      onClick={() => setPlacingLure(true)}
                    >
                      Lure
                    </button>
                    <button
                      className="dock-action"
                      disabled={!drawCardAction?.available}
                      title={drawCardAction?.reason}
                      onClick={() => submitAction("drawCard", {})}
                    >
                      Draw
                    </button>
                  </>
                )}
                <button
                  className={`dock-action${narrowDock ? "" : " secondary"}${openSheet === "actions" ? " active" : ""}`}
                  title="All turn actions"
                  onClick={() => setOpenSheet(openSheet === "actions" ? null : "actions")}
                >
                  {narrowDock ? `Act ${view.actionsRemaining ?? 0}` : "⋯"}
                </button>
              </>
            ) : null
          }
        />

        {pinnedPanel ? (
          <Sheet title={pinnedPanel.title} pinned>
            <div className={pinnedPanel.stacked ? "stack" : ""}>{pinnedPanel.body}</div>
          </Sheet>
        ) : (
          activeSheet && (
            <Sheet title={activeSheet.title} onClose={() => setOpenSheet(null)}>
              <div className={activeSheet.stacked ? "stack" : ""}>{activeSheet.body}</div>
            </Sheet>
          )
        )}

        {promptExpanded && (
          <InfoPopup title="What to do now" onClose={() => setPromptExpanded(false)}>
            <p className="small" style={{ margin: 0 }}>
              {prompt}
            </p>
            {currentStep?.picks === "obstacle" && currentStep.alt && (
              <p className="small text-dim">Or: {currentStep.alt.prompt}</p>
            )}
          </InfoPopup>
        )}

        {matModal}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Desktop / wide layout: sidebar, board, and the full right rail.
  // ---------------------------------------------------------------------------
  function railPanel(panel: PanelDef | null) {
    if (!panel) return null;
    return (
      <div className={`card-panel${panel.stacked ? " stack" : ""}`}>
        <h3>{panel.title}</h3>
        {panel.body}
      </div>
    );
  }

  return (
    <div className="stack">
      <PromptBanner text={prompt} />

      <div className="game-layout">
        <PlayerSidebar view={view} playerColors={colors} onViewDomainMat={setViewingMatDomainId} />

        <div className="card-panel board-frame">
          {boardNode}
          {currentStep?.picks === "obstacle" && currentStep.alt && (
            <div className="small text-dim" style={{ marginTop: 6 }}>
              {currentStep.prompt} Or: {currentStep.alt.prompt}
            </div>
          )}
          {(targeting || placingLure) && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="secondary" onClick={cancelTargeting}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="stack">
          {railPanel(startingAbilityPanel)}
          {railPanel(mandatoryDiscardPanel)}
          {railPanel(actionsPanel)}
          {railPanel(handPanel)}
          <div className="card-panel">
            <div className="spread">
              <h3>Domain Abilities</h3>
              {me?.domainId && (
                <button className="secondary small" onClick={() => setViewingMatDomainId(me.domainId)}>
                  View full mat
                </button>
              )}
            </div>
            {abilitiesPanel.body}
          </div>
          {railPanel(effectsPanel)}
          {railPanel(choicePanel)}
          {railPanel(deckPeekPanel)}
          {railPanel(revealedHandsPanel)}
          {railPanel(logPanel)}
          {iAmHost && <HostPanel view={view} />}
        </div>
      </div>

      {matModal}
    </div>
  );
}
