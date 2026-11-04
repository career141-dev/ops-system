/**
 * Where a job is advertised (15, Phase 3 steps 14 to 16).
 *
 * Ops does not advertise — a TA posts on LinkedIn, marketing posts the
 * newsletter — so these rules are about remembering: the right link, the right
 * Tuesday, and never a role in the newsletter with nothing said about it.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  type IssueLine,
  ISSUE_MEANINGS,
  issueInWords,
  nextTuesdayNineAm,
  problemWithIssue,
  problemWithLinkedIn,
  tidyLinkedIn,
  weekOf,
} from "@/lib/adverts";

const DAY = 86_400_000;
// 09:30 Colombo on Tuesday 3 November 2026.
const TUESDAY_HALF_NINE = Date.UTC(2026, 10, 3, 4, 0);

test("only a real LinkedIn post is taken, because a wrong link looks done", () => {
  assert.equal(problemWithLinkedIn("https://www.linkedin.com/jobs/view/4123456789/"), null);
  assert.equal(problemWithLinkedIn("https://linkedin.com/posts/career141_abc"), null);

  assert.match(problemWithLinkedIn("") ?? "", /paste the link/i);
  assert.match(problemWithLinkedIn("the post is up") ?? "", /not a web address/i);
  assert.match(problemWithLinkedIn("http://www.linkedin.com/jobs/view/1") ?? "", /start with https/i);
  assert.match(problemWithLinkedIn("https://www.facebook.com/something") ?? "", /not a LinkedIn address/i);
  // The near-miss that matters: a lookalike domain must not pass.
  assert.match(problemWithLinkedIn("https://linkedin.com.example.test/jobs/1") ?? "", /not a LinkedIn address/i);
  assert.match(problemWithLinkedIn("https://www.linkedin.com") ?? "", /front page, not the post/i);
});

test("the link is kept without the share button's tail", () => {
  assert.equal(
    tidyLinkedIn("https://www.linkedin.com/jobs/view/4123456789/?refId=abc&trackingId=xyz"),
    "https://www.linkedin.com/jobs/view/4123456789",
  );
  assert.equal(
    tidyLinkedIn("  https://www.linkedin.com/posts/career141_hiring  "),
    "https://www.linkedin.com/posts/career141_hiring",
  );
});

test("the next Tuesday at nine, Colombo, and never today once nine has gone", () => {
  // Tuesday 09:30 → next Tuesday, not this morning.
  const next = nextTuesdayNineAm(TUESDAY_HALF_NINE);
  assert.equal(next, Date.UTC(2026, 10, 10, 3, 30), "10 November, 09:00 Colombo");

  // Tuesday 07:00 Colombo → nine o'clock the same morning.
  const earlyTuesday = Date.UTC(2026, 10, 3, 1, 30);
  assert.equal(nextTuesdayNineAm(earlyTuesday), Date.UTC(2026, 10, 3, 3, 30));

  // A Friday → the Tuesday after it.
  const friday = Date.UTC(2026, 10, 6, 6, 0);
  assert.equal(nextTuesdayNineAm(friday), Date.UTC(2026, 10, 10, 3, 30));
});

test("an issue belongs to its Tuesday, whatever day it is looked at", () => {
  assert.equal(weekOf(TUESDAY_HALF_NINE), "2026-11-03");
  // Thursday of the same week, and the Monday after it.
  assert.equal(weekOf(TUESDAY_HALF_NINE + 2 * DAY), "2026-11-03");
  assert.equal(weekOf(TUESDAY_HALF_NINE + 6 * DAY), "2026-11-03");
  assert.equal(weekOf(TUESDAY_HALF_NINE + 7 * DAY), "2026-11-10");
});

const lines = (): IssueLine[] => [
  {
    positionId: "pos_1",
    openingTaId: "ta_j1",
    title: "Head of finance",
    client: "SAMPLE CLIENT",
    note: "A manufacturer in Colombo wants a qualified head of finance.",
    applyAddress: "apply-finance@example.test",
  },
];

test("a role with nothing said about it keeps the issue in", () => {
  assert.equal(problemWithIssue(lines()), null);
  assert.match(problemWithIssue([]) ?? "", /no open positions/i);

  const quiet = [...lines(), { ...lines()[0], positionId: "pos_2", title: "Storekeeper", note: "  " }];
  const said = problemWithIssue(quiet) ?? "";
  assert.match(said, /no line yet for Storekeeper/i);
  assert.match(said, /ask the TA/i);
});

test("the issue says where it stands, including what is still missing", () => {
  const ready = { state: "compiling", weekOf: "2026-11-03", lines: lines(), postedAt: null };
  assert.match(issueInWords(ready), new RegExp(ISSUE_MEANINGS.compiling));
  assert.match(issueInWords(ready), /1 position/);

  const quiet = { ...ready, lines: [...lines(), { ...lines()[0], positionId: "pos_2", note: "" }] };
  assert.match(issueInWords(quiet), /2 positions/);
  assert.match(issueInWords(quiet), /1 still with no line/);

  assert.match(issueInWords({ ...ready, state: "posted", postedAt: 1 }), /^Posted/);
});

test("Tuesday compiles one issue a week, and sets the next Tuesday's clock", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  process.env.OPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ops-tp-"));
  process.env.OPS_STORE = "json";
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
  const searching = repo.addPosition({
    requirementId: null,
    clientId: client.id,
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
  // A closed position is not advertised again.
  repo.addPosition({
    requirementId: null,
    clientId: client.id,
    clientTaId: "ta_c1",
    openingTaId: "ta_j2",
    title: "Storekeeper",
    stage: "closed",
    primaryTaId: null,
    hundredPercentDay: null,
    taStatus: "closed",
    jdApprovedAt: null,
    linkedInUrl: null,
    linkedInPostedAt: null,
    depthStage: null,
    shortlistedTotal: null,
    pendingCount: null,
    depthCheckedAt: null,
    handedOverAt: now,
    closedAt: now,
    ownerId: "m_owner",
  });

  const issue = await desk.compileTalentPulse("m_lead", now);
  assert(issue, "an issue was compiled");
  assert.equal(issue.weekOf, weekOf(now));
  assert.equal(issue.lines.length, 1, "only what is being searched");
  assert.equal(issue.lines[0].positionId, searching.id);
  assert.equal(issue.lines[0].client, "SAMPLE CLIENT", "the client's name, not their TA id");
  assert.equal(issue.lines[0].note, "", "the TA's line is asked for, never invented");

  // Somebody has it to do, and next Tuesday is already set.
  const task = repo.all().tasks.find((t) => t.subjectId === issue.id);
  assert.match(task?.title ?? "", /Talent Pulse for /);
  const clock = repo.liveTimers().find((t) => t.kind === "talentpulse.compile");
  assert.equal(clock?.dueAt, nextTuesdayNineAm(now));

  // Asking twice in one week gives the same issue, so the clock and the button
  // cannot make two.
  const again = await desk.compileTalentPulse("m_lead", now + 2 * DAY);
  assert.equal(again?.id, issue.id);
  assert.equal(repo.all().talentPulse.length, 1);
});
