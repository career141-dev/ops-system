/**
 * How deep the client's shortlist is (15, Phase 4 steps 14 and 15).
 *
 * Two of the owner's rules are really one piece of counting, done after every
 * client decision and every stage move TA tells us about:
 *
 *   - **Five shortlisted in total → hold at five.** We stop sending CVs; the
 *     TA monitors rather than searches, and LinkedIn closes. Sending a sixth
 *     CV to a client sitting on five is how a client stops reading them.
 *   - **Three or fewer waiting to be interviewed → search again.** The TA
 *     goes back to the add-on search, thirty to sixty minutes a day, instead
 *     of waiting for a client who has nearly run out of people to see.
 *
 * Order matters: hold at five is checked first, because a client with five
 * shortlisted and two left to interview must not be told to search more.
 *
 * Nothing here touches a database or sends anything.
 */

/** The TA stages that mean the client has said yes to somebody. */
export const SHORTLISTED_STAGES = ["client_shortlist", "interview", "offer"] as const;

/** Shortlisted, but not yet interviewed: the ones the client still owes us. */
export const PENDING_STAGES = ["client_shortlist"] as const;

export const HOLD_AT = 5;
export const SEARCH_AGAIN_AT = 3;

export interface PipelineApplication {
  id: string;
  currentStage: string;
}

export interface Depth {
  shortlistedTotal: number;
  pending: number;
}

export function countDepth(applications: PipelineApplication[]): Depth {
  const total = applications.filter((a) => (SHORTLISTED_STAGES as readonly string[]).includes(a.currentStage)).length;
  const pending = applications.filter((a) => (PENDING_STAGES as readonly string[]).includes(a.currentStage)).length;
  return { shortlistedTotal: total, pending };
}

export type DepthStage = "hold_at_five" | "add_on" | "follow_up";

export const DEPTH_MEANINGS: Record<DepthStage, string> = {
  hold_at_five: "Held at five shortlisted — the TA monitors, we send no more CVs",
  add_on: "Searching again — three or fewer are waiting to be interviewed",
  follow_up: "Following up — enough in front of the client",
};

export interface DepthVerdict {
  stage: DepthStage;
  /** What a person reads, and what TA is told. */
  because: string;
  /** The working stage TA should be put into, if any. */
  taWorkingStage: string | null;
  /** True while a new set must not be sent. */
  sendingBlocked: boolean;
}

export function depthVerdict(depth: Depth, holdAt = HOLD_AT, searchAgainAt = SEARCH_AGAIN_AT): DepthVerdict {
  if (depth.shortlistedTotal >= holdAt) {
    return {
      stage: "hold_at_five",
      because:
        depth.shortlistedTotal +
        " shortlisted in total, so the search holds at " +
        holdAt +
        ". No more CVs go out until the client interviews some of them.",
      taWorkingStage: "monitor",
      sendingBlocked: true,
    };
  }
  if (depth.pending <= searchAgainAt) {
    return {
      stage: "add_on",
      because:
        "Only " +
        depth.pending +
        (depth.pending === 1 ? " candidate is" : " candidates are") +
        " waiting to be interviewed, so the TA searches again rather than waiting on the client.",
      taWorkingStage: "add_on",
      sendingBlocked: false,
    };
  }
  return {
    stage: "follow_up",
    because: depth.pending + " are waiting to be interviewed, which is enough in front of the client.",
    taWorkingStage: "follow_up",
    sendingBlocked: false,
  };
}

/** Why a new set cannot go out: the hold at five, said in words. */
export function problemWithAnotherSet(stage: string | null, holdAt = HOLD_AT): string | null {
  if (stage !== "hold_at_five") return null;
  return (
    "This client already has " +
    holdAt +
    " shortlisted, so the search is held at " +
    holdAt +
    ". Sending more now is how a client stops reading them. The ops lead can override this."
  );
}

/** One line for the position: where the depth stands. */
export function depthInWords(
  position: { depthStage: string | null; shortlistedTotal: number | null; pendingCount: number | null },
): string {
  if (!position.depthStage) return "Not counted yet: it is counted after the client's first decision.";
  return (
    (DEPTH_MEANINGS[position.depthStage as DepthStage] ?? position.depthStage) +
    " · " +
    (position.shortlistedTotal ?? 0) +
    " shortlisted, " +
    (position.pendingCount ?? 0) +
    " waiting to be interviewed"
  );
}
