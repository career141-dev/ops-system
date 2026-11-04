/**
 * How deep the client's shortlist is (15, Phase 4 steps 14 and 15).
 *
 * The counting is TA's, so these tests prove two things: that the owner's two
 * rules are read off a count in the right order, and that a position really is
 * re-counted against the stand-in TA System rather than remembered.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPTH_MEANINGS,
  HOLD_AT,
  SEARCH_AGAIN_AT,
  countDepth,
  depthInWords,
  depthVerdict,
  problemWithAnotherSet,
} from "@/lib/depth";

const stage = (...stages: string[]) => stages.map((currentStage, i) => ({ id: "ta_a" + i, currentStage }));

test("shortlisted means the client said yes, whatever stage they are at now", () => {
  const depth = countDepth(
    stage("client_shortlist", "client_shortlist", "interview", "offer", "rejected_by_client", "follow_up"),
  );
  // Four were shortlisted; only the two nobody has interviewed are pending.
  assert.deepEqual(depth, { shortlistedTotal: 4, pending: 2 });
  assert.deepEqual(countDepth([]), { shortlistedTotal: 0, pending: 0 });
});

test("hold at five is read before search again, or a full client is told to search", () => {
  // Five shortlisted and only two left to interview: both rules match, and the
  // hold must win, or we would send CVs to a client sitting on five.
  const held = depthVerdict({ shortlistedTotal: 5, pending: 2 });
  assert.equal(held.stage, "hold_at_five");
  assert.equal(held.taWorkingStage, "monitor");
  assert.equal(held.sendingBlocked, true);
  assert.match(held.because, /holds at 5/);

  const thin = depthVerdict({ shortlistedTotal: 3, pending: 1 });
  assert.equal(thin.stage, "add_on");
  assert.equal(thin.taWorkingStage, "add_on");
  assert.equal(thin.sendingBlocked, false);
  assert.match(thin.because, /1 candidate is/, "one candidate, not 1 candidates are");

  const enough = depthVerdict({ shortlistedTotal: 4, pending: 4 });
  assert.equal(enough.stage, "follow_up");
  assert.equal(enough.sendingBlocked, false);

  // The numbers are settings, so a desk that changes them changes the verdict.
  assert.equal(depthVerdict({ shortlistedTotal: 4, pending: 4 }, 4).stage, "hold_at_five");
  assert.equal(HOLD_AT, 5);
  assert.equal(SEARCH_AGAIN_AT, 3);
});

test("only the hold stops another set, and it says the lead can override it", () => {
  assert.equal(problemWithAnotherSet(null), null);
  assert.equal(problemWithAnotherSet("add_on"), null);
  assert.equal(problemWithAnotherSet("follow_up"), null);
  const held = problemWithAnotherSet("hold_at_five") ?? "";
  assert.match(held, /already has 5 shortlisted/);
  assert.match(held, /ops lead can override/i);
});

test("a position that has never been counted says so, rather than showing zero", () => {
  assert.match(depthInWords({ depthStage: null, shortlistedTotal: null, pendingCount: null }), /Not counted yet/);
  const words = depthInWords({ depthStage: "hold_at_five", shortlistedTotal: 5, pendingCount: 2 });
  assert.match(words, new RegExp(DEPTH_MEANINGS.hold_at_five));
  assert.match(words, /5 shortlisted, 2 waiting/);
});

test("counting a position reads TA's pipeline, tells TA, and leaves a task", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.OPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ops-depth-"));
  process.env.OPS_STORE = "json";
  process.env.OPS_TA_FAKE = "on";
  const { repo } = await import("@/data/store");
  const desk = await import("@/data/desk");
  repo.reset();

  const now = Date.now();
  const position = repo.addPosition({
    requirementId: null,
    clientId: null,
    clientTaId: "ta_c1",
    openingTaId: "ta_j1",
    title: "Head of finance",
    stage: "searching",
    primaryTaId: "ta_u2",
    hundredPercentDay: null,
    taStatus: "open",
    jdApprovedAt: null,
    linkedInUrl: null,
    linkedInPostedAt: null,
    depthStage: null,
    shortlistedTotal: null,
    pendingCount: null,
    depthCheckedAt: null,
    handedOverAt: now,
    closedAt: null,
    ownerId: "m_owner",
  });

  // The stand-in has four shortlisted and two waiting: thin, so search again.
  const first = await desk.evaluateDepth(position.id, now);
  assert.equal(first.ok, true);
  assert.equal(first.stage, "add_on");
  let saved = repo.all().positions.find((p) => p.id === position.id);
  assert.equal(saved?.shortlistedTotal, 4);
  assert.equal(saved?.pendingCount, 2);
  assert.equal(saved?.depthCheckedAt, now);

  // TA is told how to work, never set from here, and somebody has it to read.
  const told = repo.all().outbox.map((o) => o.path);
  assert(
    told.some((p) => p.endsWith("/openings/ta_j1/working-stage")),
    "the working stage went to TA",
  );
  assert.match(repo.all().tasks.find((t) => t.subjectId === position.id)?.title ?? "", /Searching again/);

  // Counting again with nothing changed adds no second task and no second write.
  const outboxWas = repo.all().outbox.length;
  const tasksWere = repo.all().tasks.length;
  await desk.evaluateDepth(position.id, now + 1000);
  assert.equal(repo.all().outbox.length, outboxWas, "nothing new told while nothing changed");
  assert.equal(repo.all().tasks.length, tasksWere);

  // Drop the hold to four and the same pipeline is now a hold: the opening
  // goes on hold in TA as well as the working stage.
  repo.setSetting("depth.holdAt", 4, "m_lead", "Testing the hold.");
  const second = await desk.evaluateDepth(position.id, now + 2000);
  assert.equal(second.stage, "hold_at_five");
  saved = repo.all().positions.find((p) => p.id === position.id);
  assert.equal(saved?.depthStage, "hold_at_five");
  const after = repo.all().outbox.map((o) => o.path);
  assert(after.some((p) => p.endsWith("/openings/ta_j1/status")), "TA is asked to hold the opening");
});

test("a position TA has not confirmed is not counted, and says why", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.OPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ops-depth2-"));
  process.env.OPS_STORE = "json";
  const { repo } = await import("@/data/store");
  const desk = await import("@/data/desk");
  repo.reset();

  const queued = repo.addPosition({
    requirementId: null,
    clientId: null,
    clientTaId: "ta_c1",
    openingTaId: "",
    title: "Storekeeper",
    stage: "queued",
    primaryTaId: null,
    hundredPercentDay: null,
    taStatus: null,
    jdApprovedAt: null,
    linkedInUrl: null,
    linkedInPostedAt: null,
    depthStage: null,
    shortlistedTotal: null,
    pendingCount: null,
    depthCheckedAt: null,
    handedOverAt: Date.now(),
    closedAt: null,
    ownerId: "m_owner",
  });
  const answer = await desk.evaluateDepth(queued.id);
  assert.equal(answer.ok, false);
  assert.match(answer.what, /not confirmed the opening/i);
});

test("below five again lifts the hold in TA, without anybody asking", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.OPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ops-depth3-"));
  process.env.OPS_STORE = "json";
  process.env.OPS_TA_FAKE = "on";
  const { repo } = await import("@/data/store");
  const desk = await import("@/data/desk");
  repo.reset();

  const now = Date.now();
  const position = repo.addPosition({
    requirementId: null,
    clientId: null,
    clientTaId: "ta_c1",
    openingTaId: "ta_j1",
    title: "Head of finance",
    stage: "searching",
    primaryTaId: "ta_u2",
    hundredPercentDay: null,
    taStatus: "open",
    jdApprovedAt: null,
    linkedInUrl: null,
    linkedInPostedAt: null,
    // It was held, at a number that made the stand-in's four a hold.
    depthStage: "hold_at_five",
    shortlistedTotal: 4,
    pendingCount: 2,
    depthCheckedAt: now - 1000,
    handedOverAt: now,
    closedAt: null,
    ownerId: "m_owner",
  });

  // The hold is back at five, so the same four are no longer a hold.
  const answer = await desk.evaluateDepth(position.id, now);
  assert.equal(answer.stage, "add_on");
  const open = repo
    .all()
    .outbox.find((o) => o.path.endsWith("/openings/ta_j1/status"));
  assert.equal((open?.body as { status?: string } | undefined)?.status, "open", "TA is asked to open it again");
});
