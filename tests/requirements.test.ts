/**
 * The requirement, and handing it to the TA System (15, Phase 3).
 *
 * One fault on the owner's board is the reason this phase exists, in his own
 * words: "the requirement was in the TA lead's head". So the tests here are
 * about two refusals - no opening before the agreement is signed, and no
 * opening from a half-written requirement - and about the brief that TA reads.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIREMENT_FIELDS,
  STAGE_MEANINGS,
  briefText,
  handoverInWords,
  missingFields,
  problemWithHandover,
  problemWithImpractical,
  problemWithRequirement,
} from "@/lib/requirements";

const filled = (): Record<string, string> => ({
  title: "Head of finance",
  level: "Head",
  salary: "Rs. 450,000 to 550,000 a month",
  locations: "Colombo",
  headcount: "1",
  jdNotes: "Replacing somebody who left in September. Must have manufacturing experience.",
  insights: "They will not consider anybody without a recognised accounting qualification.",
  reportsTo: "The Managing Director",
});

test("the fields TA needs are required; the rest are not", () => {
  assert.equal(problemWithRequirement(filled()), null);

  const required = REQUIREMENT_FIELDS.filter((f) => f.required).map((f) => f.key);
  assert.deepEqual(required, ["title", "level", "salary", "locations", "headcount", "jdNotes"]);

  // The extras are worth having and never block the hand-over.
  assert.equal(problemWithRequirement({ ...filled(), insights: "", reportsTo: "" }), null);

  const thin = { ...filled(), salary: "  ", locations: "" };
  assert.deepEqual(missingFields(thin).map((f) => f.key), ["salary", "locations"]);
  assert.match(problemWithRequirement(thin) ?? "", /still blank: package, where/i);
});

test("the brief reads as the desk writes one, with the client's own words kept", () => {
  const text = briefText(filled());
  assert.match(text, /^Position: Head of finance$/m);
  assert.match(text, /^Level: Head$/m);
  assert.match(text, /^Headcount: 1$/m);
  assert.match(text, /^Location: Colombo$/m);
  assert.match(text, /^Package: Rs\. 450,000 to 550,000 a month$/m);
  assert.match(text, /^Brief:$/m);
  assert.match(text, /manufacturing experience/);
  assert.match(text, /^From the meeting:$/m);
  assert.match(text, /recognised accounting qualification/);

  // A blank optional field leaves no empty label behind.
  const bare = briefText({ title: "Driver", level: "Executive", headcount: "2" });
  assert.doesNotMatch(bare, /Package:/);
  assert.doesNotMatch(bare, /From the meeting:/);
});

test("no opening before the agreement is signed, and none from a thin requirement", () => {
  // The owner's rule: the search is blocked until they have signed.
  assert.match(problemWithHandover("sent", filled()) ?? "", /not signed yet/i);
  assert.match(problemWithHandover("sent", filled()) ?? "", /blocked/i);
  assert.match(problemWithHandover("chasing", filled()) ?? "", /not signed yet/i);
  assert.match(problemWithHandover("declined", filled()) ?? "", /not signed yet/i);
  assert.match(problemWithHandover(null, filled()) ?? "", /no agreement on our side/i);

  // Signed is enough: the Director's countersignature follows, and the search
  // starts when the client has signed.
  assert.equal(problemWithHandover("signed", filled()), null);
  assert.equal(problemWithHandover("countersigned", filled()), null);

  // Signed, but the requirement is half written: still refused, and it says which.
  assert.match(problemWithHandover("signed", { ...filled(), jdNotes: "" }) ?? "", /still blank: the brief/i);
});

test("a role we cannot fill needs a reason and a date to ask again", () => {
  const now = Date.UTC(2026, 10, 3);
  const day = 86_400_000;
  assert.match(problemWithImpractical("too low", now + 30 * day, now) ?? "", /write why/i);
  assert.match(problemWithImpractical("The package is far below the market for that level.", null, now) ?? "", /pick a date/i);
  assert.match(
    problemWithImpractical("The package is far below the market for that level.", now - day, now) ?? "",
    /has passed/i,
  );
  assert.equal(problemWithImpractical("The package is far below the market for that level.", now + 90 * day, now), null);
});

test("the hand-over says plainly whether TA has confirmed the opening", () => {
  const waiting = { stage: "handed_over", openingTaId: null, primaryTaId: null, hundredPercentDay: null };
  assert.match(handoverInWords(waiting, true), /queued for the TA System/);
  // Queued for nobody is a fault worth saying out loud, not hiding.
  assert.match(handoverInWords(waiting, false), /somebody must look at why/);

  const live = { stage: "searching", openingTaId: "ta_j1", primaryTaId: "ta_u2", hundredPercentDay: "2026-11-05" };
  const said = handoverInWords(live, false);
  assert.match(said, new RegExp(STAGE_MEANINGS.searching));
  assert.match(said, /opening ta_j1/);
  assert.match(said, /primary TA set/);
  assert.match(said, /100% day 2026-11-05/);
});

test("TA's own event is what gives a position its opening id", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.OPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ops-handover-"));
  process.env.OPS_STORE = "json";
  process.env.OPS_TA_FAKE = "on";
  const { repo } = await import("@/data/store");
  const desk = await import("@/data/desk");
  repo.reset();

  const now = Date.now();
  const client = repo.addClient({
    leadId: null,
    taClientId: "ta_c1",
    name: "SAMPLE CLIENT",
    nameKey: "sample client",
    stage: "active",
    billingName: "",
    billingEmail: "",
    groupName: "",
    notes: "",
    reason: null,
    ownerId: "m_owner",
  });
  const handed = repo.addPosition({
    requirementId: null,
    clientId: client.id,
    clientTaId: "ta_c1",
    openingTaId: null,
    title: "Head of finance",
    stage: "handed_over",
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
    handedOverAt: now,
    closedAt: null,
    ownerId: "m_owner",
  });

  // TA confirms it: our own position gains the id rather than a second one
  // being made.
  await desk.takeOpeningCreated({ openingId: "ta_j1", clientId: "ta_c1", title: "Head of finance" }, now);
  assert.equal(repo.all().positions.length, 1);
  const confirmed = repo.positionIn(handed.id);
  assert.equal(confirmed?.openingTaId, "ta_j1");
  assert.equal(confirmed?.stage, "searching");

  // The same event twice changes nothing.
  await desk.takeOpeningCreated({ openingId: "ta_j1", clientId: "ta_c1" }, now);
  assert.equal(repo.all().positions.length, 1);

  // A TA opening one by hand for a client of ours: a position appears, with
  // somebody asked to write the requirement down.
  await desk.takeOpeningCreated({ openingId: "ta_j9", clientId: "ta_c1", title: "Storekeeper" }, now);
  const theirs = repo.all().positions.find((p) => p.openingTaId === "ta_j9");
  assert(theirs, "the opening is on the client's page");
  assert.equal(theirs.requirementId, null);
  const task = repo.openTasksFor("m_owner").find((t) => t.subjectId === theirs.id);
  assert.match(task?.title ?? "", /link a requirement/i);

  // What TA says afterwards is kept: the JD, the stage, the closing.
  await desk.takeOpeningUpdate("opening.jd_approved", { openingId: "ta_j1" }, now);
  assert(repo.positionIn(handed.id)?.jdApprovedAt, "the JD is marked approved");
  await desk.takeOpeningUpdate("opening.closed", { openingId: "ta_j1", reason: "placed" }, now);
  assert.equal(repo.positionIn(handed.id)?.stage, "closed");
  // An opening nobody in Ops holds is ignored rather than invented.
  await desk.takeOpeningUpdate("opening.closed", { openingId: "ta_nobody" }, now);
  assert.equal(repo.all().positions.length, 2);
});
