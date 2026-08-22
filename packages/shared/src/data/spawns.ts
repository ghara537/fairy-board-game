import { SpawnDataFile } from "../types";
import { hexRing } from "../hex/coordinates";

// Confirmed against the "5x5_Hexboard_V2" reference art: the Portal sits at
// the board's exact center hex {0,0}, ring 1 (its 6 immediate neighbors)
// alternates set A / set B / set A / ... around the Portal (3 hexes each),
// and that whole ring is bordered with toadstools in the art — rendered by
// the client, see HexBoard.tsx. Both sets' Hunter is placed on the Portal
// center hex itself, per "place the Hunter on the center Portal position".
const PORTAL_CENTER = { q: 0, r: 0 };
const RING1 = hexRing(PORTAL_CENTER, 1); // 6 hexes, in rotational order
const RING1_A = RING1.filter((_, i) => i % 2 === 0); // 3 alternating hexes
const RING1_B = RING1.filter((_, i) => i % 2 === 1); // the other 3

// TODO_RULE_CONFIRMATION: exact starting Human roster/quantities per spawn
// are not supplied. Placeholder: each spawn introduces 2 Adults, 1 Child,
// 1 Baby, plus its Hunter (Hunter is placed separately, at the center
// position, not counted among the 6 ring positions).
export const SPAWN_DATA: SpawnDataFile = {
  initialSet: "A",
  portalCenter: PORTAL_CENTER,
  sets: {
    A: {
      setName: "A",
      positions: RING1_A,
      hunterCenterPosition: PORTAL_CENTER,
      humans: [
        { definitionId: "adult", count: 2 },
        { definitionId: "child", count: 1 },
        { definitionId: "baby", count: 1 },
      ],
    },
    B: {
      setName: "B",
      positions: RING1_B,
      hunterCenterPosition: PORTAL_CENTER,
      humans: [
        { definitionId: "adult", count: 2 },
        { definitionId: "child", count: 1 },
        { definitionId: "baby", count: 1 },
      ],
    },
  },
};
