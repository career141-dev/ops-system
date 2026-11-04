import "server-only";

import { convexMutation, convexQuery, usingConvex } from "./convexClient";
import { repo } from "./store";
import { seed } from "./seed";
import type {
  Id,
  OpsBaseline,
  OpsCallLog,
  OpsClient,
  OpsClientSet,
  OpsHold,
  OpsPosition,
  OpsRequirement,
  OpsTalentPulseIssue,
  OpsDatabase,
  OpsEsa,
  OpsEvent,
  OpsFile,
  OpsInbound,
  OpsLead,
  OpsMeeting,
  OpsMessage,
  OpsOutboxItem,
  OpsTask,
  OpsTemplate,
  OpsTimer,
} from "./types";
import { escalationFor } from "@/lib/escalation";
import { cancelledByReply } from "@/lib/timers";
import { type TickAction, tick } from "@/lib/tick";
import { chaseDraft, chaseStep, nextChaseAt } from "@/lib/esa";
import { dueFromEsa, setName } from "@/lib/clientSets";
import { nextTuesdayNineAm, weekOf } from "@/lib/adverts";
import {
  DEPTH_MEANINGS,
  HOLD_AT,
  SEARCH_AGAIN_AT,
  countDepth,
  depthVerdict,
} from "@/lib/depth";
import {
  HOLD_AFTER_DAYS,
  OWNERSHIP_WORKING_DAYS,
  holdDueAt,
  nextFeedbackStep,
  ownershipWindow,
  silentDays,
} from "@/lib/clientFeedback";
import { type InboundMail, readAllMailboxes } from "@/lib/graphMail";
import { matchInbound, stopsChasing } from "@/lib/mailMatch";
import { dueNow, keyFor as outboxKeyFor, nextTryAt, shouldGiveUp } from "@/lib/outbox";
import { cursorAfter, whatWeDoWithIt } from "@/lib/taEvents";
import {
  clientSet as taClientSet,
  eventsAfter,
  opening as taOpening,
  pipeline as taPipeline,
  write as taWrite,
} from "@/lib/ta";

/**
 * The desk, from wherever it is kept (2 Nov).
 *
 * One API for the screens, two places behind it: the JSON file that the tests
 * and the screens-only run use, and the Ops Convex backend. The records are the
 * same shape in both, so a page never knows or cares which it is reading — the
 * TA System's own arrangement, and the reason its screens could be built before
 * its backend existed.
 *
 * The rules stay in `src/lib`: this only reads and writes.
 */

export async function desk(): Promise<OpsDatabase> {
  if (!usingConvex()) return repo.all();

  const snapshot = await convexQuery<OpsDatabase>("ops/data:snapshot");
  // A brand new backend has nobody and no numbers, which would show an empty
  // screen with no way to fix it. The preview holds invented data by decision,
  // so the sample desk is put in once and never overwritten.
  if (snapshot.settings.length === 0) {
    const sample = seed();
    // The sample refers to people by id; the backend makes its own, so the
    // clocks and tasks name the role they belong to and it joins them up.
    const roleOf = (memberId: string) => sample.members.find((m) => m.id === memberId)?.role ?? "ops_owner";
    await convexMutation("ops/data:seed", {
      members: sample.members.map(({ name, email, role, active, taUserId }) => ({ name, email, role, active, taUserId })),
      settings: sample.settings.map(({ key, value }) => ({ key, value })),
      holidays: sample.holidays,
      templates: sample.templates.map(({ key, channel, name, subject, body, approvedForAuto }) => ({
        key,
        channel,
        name,
        subject,
        body,
        approvedForAuto,
      })),
      timers: sample.timers.map(({ id, ownerId, ...rest }) => ({ ...rest, ownerRole: roleOf(ownerId) })),
      tasks: sample.tasks.map(({ kind, title, body, assigneeId, dueAt, subjectType, subjectId, createdAt }) => ({
        kind,
        title,
        body,
        ownerRole: roleOf(assigneeId),
        dueAt,
        subjectType,
        subjectId,
        createdAt,
      })),
      messages: sample.messages.map(({ channel, to, subject, body, templateKey, subjectType, subjectId, createdAt }) => ({
        channel,
        to,
        subject,
        body,
        templateKey,
        subjectType,
        subjectId,
        createdAt,
      })),
    });
    return convexQuery<OpsDatabase>("ops/data:snapshot");
  }
  return snapshot;
}

/** Leaves somebody something to do. The clocks make most of these; a screen can too. */
export async function createTask(
  input: Omit<OpsTask, "id" | "state" | "outcome" | "doneBy" | "doneAt" | "createdAt">,
): Promise<void> {
  if (!usingConvex()) {
    repo.createTask(input);
    return;
  }
  await convexMutation("ops/data:createTask", input);
}

export async function startTimer(input: Omit<OpsTimer, "id" | "state" | "firedAt">): Promise<void> {
  if (!usingConvex()) {
    repo.startTimer(input);
    return;
  }
  await convexMutation("ops/data:startTimer", { ...input });
}

export async function finishTask(taskId: Id, by: Id, outcome: string): Promise<void> {
  if (!usingConvex()) {
    repo.finishTask(taskId, by, outcome);
    return;
  }
  await convexMutation("ops/data:finishTask", { taskId, by, outcome });
}

export async function editMessage(messageId: Id, patch: Pick<OpsMessage, "subject" | "body">, by: Id): Promise<void> {
  if (!usingConvex()) {
    repo.editMessage(messageId, patch, by);
    return;
  }
  await convexMutation("ops/data:editMessage", { messageId, subject: patch.subject, body: patch.body, by });
}

export async function settleMessage(
  messageId: Id,
  by: Id,
  // "approved" settles a group post: a person has it to post, and nothing
  // sent it (3 Nov).
  state: Extract<OpsMessage["state"], "sent" | "failed" | "blocked" | "queued" | "approved">,
  to: string[],
  note: string | null,
  /** What the mail server called it, once a sender knows. */
  providerMessageId?: string | null,
): Promise<void> {
  if (!usingConvex()) {
    repo.settleMessage(messageId, by, state, to, note, providerMessageId);
    return;
  }
  await convexMutation("ops/data:settleMessage", { messageId, by, state, to, note, providerMessageId });
}

export async function setSetting(key: string, value: string | number | boolean, by: Id, reason: string): Promise<void> {
  if (!usingConvex()) {
    repo.setSetting(key, value, by, reason);
    return;
  }
  await convexMutation("ops/data:setSetting", { key, value, by, reason });
}

/** Remembers the last scheduled pass, so the health screen can show it. */
export async function noteClockPass(value: string): Promise<void> {
  if (!usingConvex()) {
    repo.noteClockPass(value);
    return;
  }
  await convexMutation("ops/data:noteClockPass", { value });
}

/**
 * One pass of the clocks. The decisions are made here, by the same rules the
 * tests cover, and the backend only applies them — so what fires on the laptop
 * and what fires on the server cannot drift apart.
 */
export async function runClocks(now = Date.now()): Promise<{ warned: number; fired: number; escalated: number }> {
  // The desk is read before the pass writes anything, so we know which clocks
  // are about to fire. That is what lets a clock draft its own chase instead
  // of only leaving a task for somebody to remember (3 Nov).
  const before = await desk();
  const firing = switchedOn(before, "switch.timersEnabled")
    ? tick(before.timers, now).filter((a) => a.state === "fired")
    : [];

  if (!usingConvex()) {
    const answer = repo.runClocks(now);
    await afterFired(before.timers, firing, now);
    return answer;
  }

  const db = before;
  if (!switchedOn(db, "switch.timersEnabled")) return { warned: 0, fired: 0, escalated: 0 };

  const actions = tick(db.timers, now);
  const rules = {
    leadAfterHours: numberOf(db, "escalation.leadAfterHours", 24),
    directorAfterHours: numberOf(db, "escalation.directorAfterHours", 72),
  };
  const escalations = db.tasks
    .map((task) => {
      const move = escalationFor(task, db.members, rules, now);
      return move ? { taskId: task.id, toMemberId: move.toMemberId, note: move.note } : null;
    })
    .filter((x): x is { taskId: string; toMemberId: string; note: string } => x !== null);

  if (!actions.length && !escalations.length) return { warned: 0, fired: 0, escalated: 0 };

  const answer = await convexMutation<{ warned: number; fired: number; escalated: number }>("ops/data:applyTick", {
    warned: actions.filter((a) => a.state === "warned").map((a) => a.timerId),
    fired: actions.filter((a) => a.state === "fired").map((a) => a.timerId),
    firedAt: now,
    tasks: actions.map((a) => a.task).filter((t): t is NonNullable<typeof t> => t !== null),
    escalations,
  });
  await afterFired(db.timers, firing, now);
  return answer;
}

/**
 * What a fired clock does for you, beyond leaving a task (3 Nov).
 *
 * One line per kind of clock. Everything a clock can do by itself goes here,
 * so the clock pass stays one pass and a person is left with the thing to
 * read rather than the thing to remember. Phases 3 to 7 each add their own.
 */
const AFTER_FIRED: Record<string, (timer: OpsTimer, now: number) => Promise<void>> = {
  "esa.chase": async (timer, now) => {
    await chaseTheAgreement(timer.subjectId, timer.ownerId, now);
  },
  // The client has said nothing about a set for a day: ask once, in writing,
  // and draft it so a person only reads and approves (15, Phase 4 step 10).
  "feedback.chase": async (timer, now) => {
    await chaseTheFeedback(timer.subjectId, timer.ownerId, now);
  },
  // Two weeks of silence: the notice is drafted and a hold proposed. Nothing
  // goes on hold, and nothing is sent, until a person approves (step 12).
  "silence.hold": async (timer, now) => {
    await proposeTheHold(timer.subjectId, timer.ownerId, now);
  },
  // Tuesday morning: this week's Talent Pulse is compiled and the next
  // Tuesday's clock is set, so the rhythm keeps itself (step 14).
  "talentpulse.compile": async (timer, now) => {
    await compileTalentPulse(timer.ownerId, now);
  },
};

async function afterFired(timers: OpsTimer[], firing: TickAction[], now: number): Promise<void> {
  for (const action of firing) {
    const timer = timers.find((t) => t.id === action.timerId);
    const handler = timer ? AFTER_FIRED[timer.kind] : undefined;
    if (!timer || !handler) continue;
    try {
      await handler(timer, now);
    } catch {
      // A handler that cannot finish must not stop the rest of the pass. The
      // clock has already fired and left its task, so the work is still in
      // front of a person; it is only the drafting that did not happen.
    }
  }
}

/**
 * Draft the next chase on an agreement (15, Phase 2 step 13).
 *
 * Two doors, one road: the button on the lead page and the clock when it
 * fires. Until 3 Nov only the button existed, so a chase sat waiting for
 * somebody to remember it - which is the one thing the clocks are for.
 */
export async function chaseTheAgreement(
  esaId: Id,
  by: Id,
  now = Date.now(),
): Promise<{ ok: boolean; what: string; messageId: Id | null }> {
  const db = await desk();
  const esa = agreementIn(db, esaId);
  if (!esa) return { ok: false, what: "That agreement is gone.", messageId: null };
  // A signed, declined or expired agreement is not chased. Its clocks are
  // cancelled when it settles, but a pass already in flight must not write to
  // a finished agreement.
  if (esa.state !== "sent" && esa.state !== "chasing") {
    return { ok: false, what: "That agreement is not waiting for a signature.", messageId: null };
  }

  const plan = chaseStep(esa.chaseStep + 1);
  if (!plan) return { ok: false, what: "The chase has run out. Somebody has to call them.", messageId: null };

  if (plan.channel === "call") {
    await createTask({
      kind: "call",
      title: "Call about the agreement: " + (esa.fields.companyName ?? "a client"),
      body: "Five written chases and no signature. The owner's plan says a call now.",
      assigneeId: esa.ownerId,
      dueAt: now,
      subjectType: "esa",
      subjectId: esaId,
      link: "/leads/" + esa.leadId,
    });
    await patchAgreement(esaId, { state: "chasing", chaseStep: plan.step }, by, "esa.chaseCall", plan.what);
    return { ok: true, what: "A call task is on your list. Write down what they say.", messageId: null };
  }

  const draft = chaseDraft(
    plan,
    esa.fields,
    templateFor(db, plan.templateKey),
    leadIn(db, esa.leadId)?.contactPhone ?? null,
  );
  if ("problem" in draft) return { ok: false, what: draft.problem, messageId: null };

  const message = await draftMessage({
    channel: plan.channel,
    to: [draft.to],
    subject: draft.subject,
    body: draft.body,
    templateKey: plan.templateKey,
    subjectType: "esa",
    subjectId: esaId,
  });

  await patchAgreement(esaId, { state: "chasing", chaseStep: plan.step }, by, "esa.chaseDrafted", plan.what);
  const following = nextChaseAt(plan.step, now);
  if (following) {
    await startTimer({
      kind: "esa.chase",
      subjectType: "esa",
      subjectId: esaId,
      startsAt: now,
      dueAt: following.dueAt,
      warnAt: null,
      ownerId: esa.ownerId,
      payload: { label: String(esa.fields.companyName ?? ""), step: String(following.step) },
    });
  }
  return { ok: true, what: plan.what + " is drafted. Read it, then approve it.", messageId: message.id };
}

/** The client answered, so every chase for that subject stops. */
export async function recordReply(subjectType: string, subjectId: Id, by: Id): Promise<number> {
  if (!usingConvex()) return repo.recordReply(subjectType, subjectId, by);

  const db = await convexQuery<OpsDatabase>("ops/data:snapshot");
  const stopping = cancelledByReply(db.timers, subjectType, subjectId);
  if (!stopping.length) return 0;
  await convexMutation("ops/data:cancelTimers", { timerIds: stopping.map((t) => t.id), by });
  return stopping.length;
}

/**
 * One pass of the Ops mailbox (15, Phase 1 steps 18 and 19).
 *
 * Read, match, record, and stop the chasing for anything that was certainly a
 * reply. Everything it cannot place waits in "needs filing" rather than being
 * guessed at. Recording is keyed on the mail server's own id, so a second pass
 * over the same mailbox records nothing twice.
 */
export async function readTheMailboxes(
  by: Id,
  now = Date.now(),
): Promise<{ ok: boolean; reason?: string; read: number; already: number; filed: number; waiting: number; chasesStopped: number }> {
  // Each box carries on from the newest thing we already have from it, so a
  // pass never re-reads and never skips. A box we have never read starts from
  // the reader's own short window.
  const since: Record<string, number> = {};
  for (const i of (await desk()).inbound) {
    if (i.mailbox && i.receivedAt > (since[i.mailbox] ?? 0)) since[i.mailbox] = i.receivedAt + 1000;
  }
  const { mail, problems } = await readAllMailboxes(since);
  const taken = await takeInbound(mail, by, now);
  // Some boxes may be readable and others not; say so rather than claiming
  // either a clean run or a total failure.
  return { ...taken, ok: problems.length === 0, reason: problems.join(" ") || undefined };
}

/** The same pass over mail from anywhere, so it can be tested and demonstrated. */
export async function takeInbound(
  mail: InboundMail[],
  by: Id,
  now = Date.now(),
): Promise<{ ok: boolean; read: number; already: number; filed: number; waiting: number; chasesStopped: number }> {
  const db = await desk();
  const known = {
    // Only messages whose real server id we kept. This used to make the id up
    // from our own row id, which no mail server has ever heard of, so the rule
    // could never match a single real reply (2 Nov).
    threads: db.messages
      .filter((m) => m.subjectType && m.subjectId && m.providerMessageId)
      .map((m) => ({
        providerMessageId: m.providerMessageId as string,
        subjectType: m.subjectType as string,
        subjectId: m.subjectId as string,
      })),
    // Client contacts come from the TA System once that window opens; until
    // then nothing is matched by domain, which is the safe way round.
    contacts: [] as { email: string; clientId: string }[],
    // One entry per thing we have written about, keeping the subject line we
    // used, so a reply carrying the house form "CLIENT > ROLE > SET n" can be
    // read against it. The newest message for a thing wins, since that is the
    // wording the client is looking at.
    subjects: [
      ...new Map(
        db.messages
          .filter((m) => m.subjectType && m.subjectId)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((m) => [
            (m.subjectType as string) + "|" + (m.subjectId as string),
            {
              // The real case, not a lower-cased copy. The matcher already
              // compares case-insensitively, and a lower-cased "clientset"
              // came back out of the match and then failed to find the
              // "clientSet" clock it was supposed to stop - so a client who
              // replied was chased anyway (found by the run-through, 2 Nov).
              subjectType: m.subjectType as string,
              subjectId: m.subjectId as string,
              subject: m.subject,
            },
          ]),
      ).values(),
    ],
  };

  let read = 0;
  let already = 0;
  let filed = 0;
  let waiting = 0;
  let chasesStopped = 0;

  for (const item of mail) {
    const match = matchInbound(item, known);
    const row = {
      channel: "email" as const,
      mailbox: item.mailbox,
      from: item.from,
      fromName: item.fromName,
      receivedAt: item.receivedAt,
      subject: item.subject,
      body: item.body,
      providerId: item.providerId,
      inReplyTo: item.inReplyTo,
      matchedBy: match.method,
      subjectType: match.subjectType,
      subjectId: match.subjectId,
      clientId: match.clientId,
      note: match.note,
    };

    const saved = usingConvex()
      ? await convexMutation<{ id: string; already: boolean }>("ops/data:recordInbound", row)
      : repo.recordInbound(row);
    if (saved.already) {
      already += 1;
      continue;
    }
    read += 1;

    if (match.subjectId) filed += 1;
    else waiting += 1;

    if (stopsChasing(match) && match.subjectType && match.subjectId) {
      chasesStopped += await recordReply(match.subjectType, match.subjectId, by);
    }
  }

  // `read` is what was new, not what was handed in: the readers pass the same
  // email again whenever a window overlaps, and a screen saying "read 25" when
  // nothing arrived is a screen nobody can trust (found by the run-through).
  return { ok: true, read, already, filed, waiting, chasesStopped };
}

export async function fileInbound(inboundId: Id, subjectType: string, subjectId: Id, by: Id): Promise<number> {
  if (usingConvex()) {
    await convexMutation("ops/data:fileInbound", { inboundId, subjectType, subjectId, by });
  } else {
    repo.fileInbound(inboundId, subjectType, subjectId, by);
  }
  // Filing it by hand is still the client answering, so the chasing stops.
  return recordReply(subjectType, subjectId, by);
}

export async function markInboundActioned(inboundId: Id, by: Id): Promise<void> {
  if (usingConvex()) {
    await convexMutation("ops/data:markInboundActioned", { inboundId, by });
    return;
  }
  repo.markInboundActioned(inboundId, by);
}

export function inboundWaiting(db: OpsDatabase): OpsInbound[] {
  return db.inbound.filter((i) => i.readState === "new").sort((a, b) => b.receivedAt - a.receivedAt);
}

export function inboundRecent(db: OpsDatabase): OpsInbound[] {
  return [...db.inbound].sort((a, b) => b.receivedAt - a.receivedAt).slice(0, 20);
}

/** Save a template's wording. Refused unless the screen checked the role first. */
export async function saveTemplate(
  key: string,
  patch: { name: string; subject: string; body: string; approvedForAuto: boolean },
  by: Id,
): Promise<void> {
  if (!usingConvex()) {
    repo.saveTemplate(key, patch, by);
    return;
  }
  await convexMutation("ops/data:saveTemplate", { key, ...patch, by });
}

/** One template by its key, or nothing when the wording has not been written yet. */
export function templateFor(db: OpsDatabase, key: string): OpsTemplate | null {
  return db.templates.find((t) => t.key === key) ?? null;
}

/**
 * Records a file that is already stored. Returns the row, because the screen
 * needs its id to make a link.
 */
export async function addFile(input: Omit<OpsFile, "id" | "uploadedAt">): Promise<OpsFile> {
  if (!usingConvex()) return repo.addFile(input);
  return convexMutation<OpsFile>("ops/data:addFile", input);
}

export function fileIn(db: OpsDatabase, fileId: Id): OpsFile | null {
  return db.files.find((f) => f.id === fileId) ?? null;
}

export function filesNewestFirst(db: OpsDatabase): OpsFile[] {
  return [...db.files].sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/* ── Leads: the front door (15, Phase 2) ───────────────────────── */

export async function addLead(input: Omit<OpsLead, "id" | "createdAt" | "updatedAt">): Promise<OpsLead> {
  if (!usingConvex()) return repo.addLead(input);
  return convexMutation<OpsLead>("ops/data:addLead", input);
}

export async function patchLead(
  leadId: Id,
  patch: Partial<OpsLead>,
  by: Id,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchLead(leadId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchLead", { leadId, patch, by, what, reason });
}

export function leadIn(db: OpsDatabase, leadId: Id): OpsLead | null {
  return db.leads.find((l) => l.id === leadId) ?? null;
}

export function leadsNewestFirst(db: OpsDatabase): OpsLead[] {
  return [...db.leads].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Ask the client for their feedback (15, Phase 4 step 10).
 *
 * Drafted, never sent: it goes to the same people the set went to, and a
 * person approves it like every other client message. After the owner's stop
 * day nothing more is drafted - a silent client is left to the hold clock
 * rather than chased for ever - and the next step is a call by a person,
 * because that is what the owner's ladder says.
 */
export async function chaseTheFeedback(
  setId: Id,
  by: Id,
  now = Date.now(),
): Promise<{ ok: boolean; what: string; messageId: Id | null }> {
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) return { ok: false, what: "That set is gone.", messageId: null };
  if (set.state !== "sent") return { ok: false, what: "That set has not gone out.", messageId: null };
  if (set.receivedAt === null) return { ok: false, what: "We do not know when they received it.", messageId: null };
  // Anything the client has decided counts as having heard from them.
  const heardAt = set.candidates.reduce<number | null>((latest, c) => {
    const at = c.decidedAt ?? c.claimedAt ?? null;
    return at && (!latest || at > latest) ? at : latest;
  }, null);

  const silent = silentDays(set.receivedAt, heardAt, now);
  const step = nextFeedbackStep(silent, {
    chaseDays: numberOf(db, "feedback.chaseDays", 1),
    stopAfterSilentDays: numberOf(db, "feedback.stopAfterSilentDays", 4),
  });

  if (step.what === "wait") return { ok: false, what: step.because, messageId: null };

  if (step.what === "stop") {
    await createTask({
      kind: "check",
      title: "Stopped chasing: " + set.name,
      body: step.because + " The hold clock is still running and will propose a notice.",
      assigneeId: set.ownerId,
      dueAt: now,
      subjectType: "clientSet",
      subjectId: setId,
      link: "/sets/" + setId,
    });
    return { ok: true, what: step.because, messageId: null };
  }

  if (step.what === "call") {
    await createTask({
      kind: "call",
      title: "Ring them about the feedback: " + set.name,
      body: step.because + " Write down what they say; that is what records the feedback.",
      assigneeId: set.ownerId,
      dueAt: now,
      subjectType: "clientSet",
      subjectId: setId,
      link: "/sets/" + setId,
    });
    // One more day and the ops lead is told, which is the owner's escalation.
    await startTimer({
      kind: "feedback.call",
      subjectType: "clientSet",
      subjectId: setId,
      startsAt: now,
      dueAt: now + numberOf(db, "feedback.callAfterDays", 1) * 86_400_000,
      warnAt: null,
      ownerId: db.members.find((m) => m.active && m.role === "ops_lead")?.id ?? set.ownerId,
      payload: { label: set.name },
    });
    return { ok: true, what: step.because, messageId: null };
  }

  const wording = templateFor(db, "feedback.chase");
  const to = set.sentTo;
  if (!to.length) return { ok: false, what: "Nobody is recorded as having been sent the set.", messageId: null };
  const client = set.clientId ? clientIn(db, set.clientId) : null;
  const fill = (text: string) =>
    text
      .replace(/\{\{client\}\}/g, client?.name ?? set.name.split(" > ")[0])
      .replace(/\{\{position\}\}/g, set.role)
      .replace(/\{\{setNumber\}\}/g, String(set.setNumber))
      .replace(/\{\{contact\}\}/g, "all")
      .replace(/\{\{opsPerson\}\}/g, member(db, set.ownerId)?.name ?? "Career 141");

  const message = await draftMessage({
    channel: "email",
    to,
    subject: fill(wording?.subject ?? "{{client}} > {{position}} > SET {{setNumber}}"),
    body: fill(wording?.body ?? ["Dear all,", "", "Any feedback on the CVs we sent?", "", "Career 141"].join("\n")),
    templateKey: "feedback.chase",
    subjectType: "clientSet",
    subjectId: setId,
  });
  await createTask({
    kind: "approve",
    title: "Approve the feedback chase: " + set.name,
    body: step.because,
    assigneeId: set.ownerId,
    dueAt: now,
    subjectType: "message",
    subjectId: message.id,
    link: "/messages/" + message.id,
  });
  return { ok: true, what: step.because, messageId: message.id };
}

/**
 * Two weeks of silence (15, Phase 4 step 12).
 *
 * The notice is drafted and a hold is proposed; neither takes effect until a
 * person approves the message. The owner's decision 6: a hold never closes by
 * itself, so it also sets the thirty-day review from the start.
 */
export async function proposeTheHold(
  setId: Id,
  by: Id,
  now = Date.now(),
): Promise<{ ok: boolean; what: string; holdId: Id | null }> {
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) return { ok: false, what: "That set is gone.", holdId: null };
  if (liveHoldFor(db, set.openingTaId)) {
    return { ok: false, what: "That position is already on hold.", holdId: null };
  }
  const heard = set.candidates.some((c) => c.decidedAt || c.claimedAt);
  if (heard) return { ok: false, what: "The client has answered, so there is nothing to hold.", holdId: null };

  const hold = await addHold({
    openingTaId: set.openingTaId,
    setId,
    clientId: set.clientId,
    state: "proposed",
    reason: "Two weeks from the day they received " + set.name + " with nothing back.",
    liftedReason: null,
    noticeMessageId: null,
    proposedAt: now,
    heldAt: null,
    liftedAt: null,
    reviewAt: null,
    ownerId: set.ownerId,
  });
  await createTask({
    kind: "decide",
    title: "Put it on hold? " + set.name,
    body:
      "Two weeks since they received the set and nothing has come back. Approving the notice puts the position on hold and tells the client; it never closes by itself.",
    assigneeId: set.ownerId,
    dueAt: now,
    subjectType: "hold",
    subjectId: hold.id,
    link: "/holds/" + hold.id,
  });
  return { ok: true, what: "A hold is proposed, with its notice to approve.", holdId: hold.id };
}

/* ── Holds: a position the client has gone quiet on (step 12) ── */

export async function addHold(input: Omit<OpsHold, "id" | "createdAt" | "updatedAt">): Promise<OpsHold> {
  if (!usingConvex()) return repo.addHold(input);
  return (await convexMutation<OpsHold>("ops/data:addHold", input)) as OpsHold;
}

export async function patchHold(
  holdId: Id,
  patch: Partial<OpsHold>,
  by: Id | null,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchHold(holdId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchHold", { holdId, patch, by, what, reason });
}

export function holdIn(db: OpsDatabase, holdId: Id): OpsHold | null {
  return db.holds.find((h) => h.id === holdId) ?? null;
}

export function liveHoldFor(db: OpsDatabase, openingTaId: string): OpsHold | null {
  return db.holds.find((h) => h.openingTaId === openingTaId && h.state !== "lifted") ?? null;
}

export function holdsNewestFirst(db: OpsDatabase): OpsHold[] {
  return [...db.holds].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The clocks that start when the client receives a set (step 6).
 *
 * They all count from receipt, never from sending, and they start in one place
 * so a corrected receipt date can restart them together.
 */
export async function startReceiptClocks(db: OpsDatabase, set: OpsClientSet, receivedAt: number): Promise<void> {
  const holidays = db.holidays.map((h) => h.date);
  const window = ownershipWindow(receivedAt, holidays, numberOf(db, "set.ownershipWorkingDays", OWNERSHIP_WORKING_DAYS));
  const label = set.name;

  await startTimer({
    kind: "set.ownership",
    subjectType: "clientSet",
    subjectId: set.id,
    startsAt: receivedAt,
    dueAt: window.closesAt,
    warnAt: window.warnAt,
    ownerId: set.ownerId,
    payload: { label },
  });
  await startTimer({
    kind: "feedback.chase",
    subjectType: "clientSet",
    subjectId: set.id,
    startsAt: receivedAt,
    dueAt: receivedAt + numberOf(db, "feedback.chaseDays", 1) * 86_400_000,
    warnAt: null,
    ownerId: set.ownerId,
    payload: { label },
  });
  await startTimer({
    kind: "silence.hold",
    subjectType: "clientSet",
    subjectId: set.id,
    startsAt: receivedAt,
    dueAt: holdDueAt(receivedAt, numberOf(db, "hold.afterDays", HOLD_AFTER_DAYS)),
    warnAt: null,
    ownerId: set.ownerId,
    payload: { label },
  });
  // Three months, and the agreement's 50% surcharge if they hired from it
  // without telling us (step 18).
  await startTimer({
    kind: "hire.unreported",
    subjectType: "clientSet",
    subjectId: set.id,
    startsAt: receivedAt,
    dueAt: receivedAt + 90 * 86_400_000,
    warnAt: null,
    ownerId: set.ownerId,
    payload: { label },
  });
}

/* ── Requirements and positions (15, Phase 3) ─────────────────── */

export async function addRequirement(input: Omit<OpsRequirement, "id" | "createdAt" | "updatedAt">): Promise<OpsRequirement> {
  if (!usingConvex()) return repo.addRequirement(input);
  return (await convexMutation<OpsRequirement>("ops/data:addRequirement", input)) as OpsRequirement;
}

export async function patchRequirement(
  requirementId: Id,
  patch: Partial<OpsRequirement>,
  by: Id | null,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchRequirement(requirementId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchRequirement", { requirementId, patch, by, what, reason });
}

export function requirementIn(db: OpsDatabase, requirementId: Id): OpsRequirement | null {
  return db.requirements.find((r) => r.id === requirementId) ?? null;
}

export function requirementForLead(db: OpsDatabase, leadId: Id): OpsRequirement | null {
  return db.requirements.filter((r) => r.leadId === leadId).sort((a, b) => b.version - a.version)[0] ?? null;
}

export async function addPosition(input: Omit<OpsPosition, "id" | "createdAt" | "updatedAt">): Promise<OpsPosition> {
  if (!usingConvex()) return repo.addPosition(input);
  return (await convexMutation<OpsPosition>("ops/data:addPosition", input)) as OpsPosition;
}

export async function patchPosition(
  positionId: Id,
  patch: Partial<OpsPosition>,
  by: Id | null,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchPosition(positionId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchPosition", { positionId, patch, by, what, reason });
}

export function positionIn(db: OpsDatabase, positionId: Id): OpsPosition | null {
  return db.positions.find((p) => p.id === positionId) ?? null;
}

export function positionForOpening(db: OpsDatabase, openingTaId: string): OpsPosition | null {
  return db.positions.find((p) => p.openingTaId === openingTaId) ?? null;
}

export function positionsNewestFirst(db: OpsDatabase): OpsPosition[] {
  return [...db.positions].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * TA says an opening exists (15, Phase 3 step 7).
 *
 * Two cases, and they must not be confused. Either we handed a requirement
 * over and this is TA confirming it — then the position we already have gains
 * its opening id — or a TA created an opening by hand for a client we know,
 * and somebody has to link a requirement to it. Either way Ops never invents
 * an opening id.
 */
export async function takeOpeningCreated(data: Record<string, unknown>, now = Date.now()): Promise<OpsPosition | null> {
  const openingTaId = String(data.openingId ?? "").trim();
  const clientTaId = String(data.clientId ?? "").trim();
  if (!openingTaId) return null;

  const db = await desk();
  if (positionForOpening(db, openingTaId)) return null;

  const title = String(data.title ?? "").trim();
  // Ours, if we handed one over for this client and it is still waiting for an
  // id. The oldest waiting one, because they were handed over in order.
  const waiting = db.positions
    .filter((p) => p.openingTaId === null && p.clientTaId === clientTaId)
    .sort((a, b) => a.handedOverAt - b.handedOverAt)[0];

  if (waiting) {
    await patchPosition(
      waiting.id,
      { openingTaId, stage: "searching", taStatus: "open" },
      null,
      "position.openingConfirmed",
      "TA created opening " + openingTaId,
    );
    await createTask({
      kind: "check",
      title: "The opening is live in TA: " + (title || waiting.title),
      body: "TA has created it from our requirement. Nothing to do unless the TA asks something.",
      assigneeId: waiting.ownerId,
      dueAt: now,
      subjectType: "position",
      subjectId: waiting.id,
      link: "/positions/" + waiting.id,
    });
    return { ...waiting, openingTaId, stage: "searching" };
  }

  // Not ours: a TA opened it directly. We still want it on the client's page,
  // with somebody asked to link a requirement so the brief is not lost.
  const client = db.clients.find((c) => c.taClientId === clientTaId) ?? null;
  if (!client) return null;
  const made = await addPosition({
    requirementId: null,
    clientId: client.id,
    clientTaId,
    openingTaId,
    title: title || openingTaId,
    stage: "searching",
    primaryTaId: data.primaryRecruiterId ? String(data.primaryRecruiterId) : null,
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
    ownerId: client.ownerId,
  });
  await createTask({
    kind: "record",
    title: "Link a requirement: " + made.title,
    body:
      "A TA created this opening in the TA System for a client of ours, so Ops has no requirement behind it. Write down what the client asked for, or link the meeting it came from.",
    assigneeId: client.ownerId,
    dueAt: now,
    subjectType: "position",
    subjectId: made.id,
    link: "/positions/" + made.id,
  });
  return made;
}

/**
 * TA has told us something about an opening we hold (step 8).
 *
 * Only the facts Ops shows a client are kept: the stage, whether the JD is
 * approved, and when it closed. TA stays the owner of the opening.
 */
export async function takeOpeningUpdate(type: string, data: Record<string, unknown>, now = Date.now()): Promise<void> {
  const openingTaId = String(data.openingId ?? "").trim();
  if (!openingTaId) return;
  const db = await desk();
  const position = positionForOpening(db, openingTaId);
  if (!position) return;

  if (type === "opening.jd_approved") {
    await patchPosition(position.id, { jdApprovedAt: now }, null, "position.jdApproved", null);
    return;
  }
  if (type === "opening.closed") {
    await patchPosition(
      position.id,
      { stage: "closed", taStatus: "closed", closedAt: now },
      null,
      "position.closed",
      String(data.reason ?? "") || null,
    );
    return;
  }
  if (type === "opening.working_stage_changed") {
    const stage = String(data.workingStage ?? "");
    await patchPosition(position.id, { taStatus: stage || position.taStatus }, null, "position.workingStage", stage || null);
    return;
  }
  const status = String(data.status ?? "").trim();
  if (status) {
    await patchPosition(
      position.id,
      { taStatus: status, stage: status === "on_hold" ? "on_hold" : status === "closed" ? "closed" : "searching" },
      null,
      "position.updated",
      status,
    );
  }
}

/* ── Talent Pulse, every Tuesday (15, Phase 3 step 14) ────────── */

export async function addIssue(input: Omit<OpsTalentPulseIssue, "id" | "createdAt" | "updatedAt">): Promise<OpsTalentPulseIssue> {
  if (!usingConvex()) return repo.addIssue(input);
  return (await convexMutation<OpsTalentPulseIssue>("ops/data:addIssue", input)) as OpsTalentPulseIssue;
}

export async function patchIssue(
  issueId: Id,
  patch: Partial<OpsTalentPulseIssue>,
  by: Id | null,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchIssue(issueId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchIssue", { issueId, patch, by, what, reason });
}

export function issueIn(db: OpsDatabase, issueId: Id): OpsTalentPulseIssue | null {
  return db.talentPulse.find((i) => i.id === issueId) ?? null;
}

export function issuesNewestFirst(db: OpsDatabase): OpsTalentPulseIssue[] {
  return [...db.talentPulse].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Compile this week's Talent Pulse (step 14).
 *
 * Every position being searched goes in, with the line the TA writes about it
 * left empty on purpose: the newsletter is nothing without those lines, and
 * an empty one is a question for the TA rather than something to invent.
 *
 * One issue per Tuesday. Asking twice gives the issue that already exists, so
 * the clock and the button cannot make two.
 */
export async function compileTalentPulse(by: Id, now = Date.now()): Promise<OpsTalentPulseIssue | null> {
  const db = await desk();
  const week = weekOf(now);
  const already = db.talentPulse.find((i) => i.weekOf === week);
  if (already) return already;

  const open = db.positions.filter((p) => p.stage === "searching");
  const owner = db.members.find((m) => m.active && m.role === "ops_lead")?.id ?? by;
  const issue = await addIssue({
    weekOf: week,
    state: "compiling",
    lines: open.map((p) => ({
      positionId: p.id,
      openingTaId: p.openingTaId,
      title: p.title,
      client: (p.clientId ? clientIn(db, p.clientId)?.name : null) ?? p.clientTaId,
      note: "",
      applyAddress: "",
    })),
    postedAt: null,
    postedBy: null,
    ownerId: owner,
  });

  await createTask({
    kind: "record",
    title: "Talent Pulse for " + week + ": " + open.length + (open.length === 1 ? " position" : " positions"),
    body:
      open.length === 0
        ? "Nothing is being searched this week, so there is nothing to put in it."
        : "Each role needs one line from its TA, and an apply address so a CV knows which role it came from. Then it goes to marketing to post tomorrow.",
    assigneeId: owner,
    dueAt: now,
    subjectType: "talentPulse",
    subjectId: issue.id,
    link: "/talent-pulse",
  });

  // Next Tuesday, from this one: the rhythm keeps itself.
  await startTimer({
    kind: "talentpulse.compile",
    subjectType: "talentPulse",
    subjectId: issue.id,
    startsAt: now,
    dueAt: nextTuesdayNineAm(now),
    warnAt: null,
    ownerId: owner,
    payload: { label: "Talent Pulse" },
  });
  return issue;
}

/**
 * Count the client's shortlist, and decide (15, Phase 4 steps 14 and 15).
 *
 * Run after every client decision and every stage move TA tells us about. The
 * counting is TA's - we read their pipeline rather than keep our own tally,
 * because two tallies always disagree in the end - and the decision is the
 * owner's two rules: hold at five, or search again at three.
 *
 * It never throws: a pipeline we cannot read leaves the last count standing,
 * which is better than a wrong one.
 */
export async function evaluateDepth(
  positionId: Id,
  now = Date.now(),
): Promise<{ ok: boolean; what: string; stage: string | null }> {
  const db = await desk();
  const position = positionIn(db, positionId);
  if (!position) return { ok: false, what: "That position is gone.", stage: null };
  if (!position.openingTaId) {
    return { ok: false, what: "TA has not confirmed the opening yet, so there is no pipeline to count.", stage: null };
  }

  const answer = await taPipeline(position.openingTaId);
  if (!answer.ok) return { ok: false, what: "Could not read the pipeline: " + answer.reason, stage: position.depthStage };

  const depth = countDepth(answer.data.applications ?? []);
  const verdict = depthVerdict(depth, numberOf(db, "depth.holdAt", HOLD_AT), numberOf(db, "depth.searchAgainAt", SEARCH_AGAIN_AT));
  // Read before the patch: the store hands back the row it keeps, so after a
  // patch this object already says the new stage (the aliasing trap, 3 Nov).
  const was = position.depthStage;
  const changed = was !== verdict.stage;

  await patchPosition(
    positionId,
    {
      depthStage: verdict.stage,
      shortlistedTotal: depth.shortlistedTotal,
      pendingCount: depth.pending,
      depthCheckedAt: now,
    },
    null,
    changed ? "position.depth." + verdict.stage : "position.depthCounted",
    verdict.because,
  );

  if (!changed) return { ok: true, what: verdict.because, stage: verdict.stage };

  // TA decides how its own people work, so this is told, never set: the
  // working stage goes through the API and the TA is belled about it.
  if (verdict.taWorkingStage) {
    await queueTaWrite(
      "/integrations/v1/openings/" + position.openingTaId + "/working-stage",
      { workingStage: verdict.taWorkingStage, because: verdict.because },
      { type: "position", id: positionId },
    );
  }
  if (verdict.stage === "hold_at_five") {
    await queueTaWrite(
      "/integrations/v1/openings/" + position.openingTaId + "/status",
      { status: "on_hold", reason: "five shortlisted" },
      { type: "position", id: positionId },
    );
  } else if (was === "hold_at_five") {
    // Below five again: the hold lifts of its own accord, because the count is
    // the whole reason it was there (15, Phase 4 step 14).
    await queueTaWrite(
      "/integrations/v1/openings/" + position.openingTaId + "/status",
      { status: "open", reason: "below five shortlisted again" },
      { type: "position", id: positionId },
    );
  }
  await createTask({
    kind: "check",
    title: DEPTH_MEANINGS[verdict.stage] + ": " + position.title,
    body: verdict.because + "\n\nThe TA System has been told; nothing else to do unless the TA asks something.",
    assigneeId: position.ownerId,
    dueAt: now,
    subjectType: "position",
    subjectId: positionId,
    link: "/positions/" + positionId,
  });
  return { ok: true, what: verdict.because, stage: verdict.stage };
}

/** The position behind a set, when TA has confirmed its opening. */
export function positionForSet(db: OpsDatabase, set: OpsClientSet): OpsPosition | null {
  return db.positions.find((p) => p.openingTaId === set.openingTaId) ?? null;
}

/* ── Client sets: what the client is sent (15, Phase 4) ───────── */

export async function addClientSet(input: Omit<OpsClientSet, "id" | "createdAt" | "updatedAt">): Promise<OpsClientSet> {
  if (!usingConvex()) return repo.addClientSet(input);
  return (await convexMutation<OpsClientSet>("ops/data:addClientSet", input)) as OpsClientSet;
}

export async function patchClientSet(
  setId: Id,
  patch: Partial<OpsClientSet>,
  by: Id | null,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchClientSet(setId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchClientSet", { setId, patch, by, what, reason });
}

export function clientSetIn(db: OpsDatabase, setId: Id): OpsClientSet | null {
  return db.clientSets.find((r) => r.id === setId) ?? null;
}

export function clientSetsNewestFirst(db: OpsDatabase): OpsClientSet[] {
  return [...db.clientSets].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * TA says a round is ready (15, Phase 4 step 2).
 *
 * The round itself is read from TA, because the event carries only its
 * numbers. The due date comes from the day the agreement was signed - that is
 * what the client was promised - and a clock watches it, so a set nobody sends
 * becomes somebody's task instead of a quiet failure.
 *
 * Nothing here throws: the events reader must not stop because one set could
 * not be fetched. A second event for the same round changes nothing.
 */
export async function takeClientSetReady(data: Record<string, unknown>, now = Date.now()): Promise<OpsClientSet | null> {
  const openingTaId = String(data.openingId ?? "").trim();
  const setNumber = Number(data.setNumber ?? 0);
  if (!openingTaId || !setNumber) return null;

  const db = await desk();
  const already = db.clientSets.find((r) => r.openingTaId === openingTaId && r.setNumber === setNumber);
  if (already) return already;

  const [round, job] = await Promise.all([taClientSet(openingTaId, setNumber), taOpening(openingTaId)]);
  if (!round.ok || !job.ok) return null;

  const client = db.clients.find((c) => c.taClientId === job.data.clientId) ?? null;
  const esa = client?.leadId ? agreementForLead(db, client.leadId) : null;
  const signedAt = esa?.signedAt ?? esa?.sentAt ?? null;
  const dueAt = signedAt
    ? dueFromEsa(signedAt, setNumber, numberOf(db, "set.firstDays", 7), numberOf(db, "set.laterDays", 14))
    : null;
  // Whoever owns the client owns the set. With no client record yet - the
  // agreement may have been signed before Ops existed - it goes to the ops
  // lead rather than to nobody.
  const ownerId =
    client?.ownerId ?? db.members.find((m) => m.active && m.role === "ops_lead")?.id ?? db.members[0]?.id ?? "";

  const row = await addClientSet({
    taRoundId: round.data.id,
    openingTaId,
    setNumber,
    clientId: client?.id ?? null,
    clientTaId: job.data.clientId,
    name: setName(client?.name ?? job.data.clientId, job.data.title, setNumber),
    role: job.data.title,
    state: "ready",
    candidates: (round.data.applications ?? []).map((a) => ({
      applicationTaId: a.id,
      name: a.name,
      fileId: null,
      problem: a.preparedCv ? null : "TA has no prepared CV for this one yet.",
    })),
    dueAt,
    sentAt: null,
    sentMessageId: null,
    sentTo: [],
    receivedAt: null,
    reason: null,
    ownerId,
  });

  if (dueAt) {
    await startTimer({
      kind: "set.due",
      subjectType: "clientSet",
      subjectId: row.id,
      startsAt: now,
      dueAt,
      warnAt: dueAt - 86_400_000,
      ownerId,
      payload: { label: row.name },
    });
  }
  await createTask({
    kind: "approve",
    title: "A set is ready to go: " + row.name,
    body:
      "TA has prepared " +
      row.candidates.length +
      " CVs. Read them, then send the set to the client." +
      (dueAt ? "" : "\n\nNo due date: this client has no signed agreement on our side."),
    assigneeId: ownerId,
    dueAt: now,
    subjectType: "clientSet",
    subjectId: row.id,
    link: "/sets/" + row.id,
  });
  return row;
}

/* ── Clients: the company, once they are ours (step 19) ───────── */

export async function addClient(input: Omit<OpsClient, "id" | "createdAt" | "updatedAt">): Promise<OpsClient> {
  if (!usingConvex()) return repo.addClient(input);
  return (await convexMutation<OpsClient>("ops/data:addClient", input)) as OpsClient;
}

export async function patchClient(
  clientId: Id,
  patch: Partial<OpsClient>,
  by: Id,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchClient(clientId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchClient", { clientId, patch, by, what, reason });
}

export function clientIn(db: OpsDatabase, clientId: Id): OpsClient | null {
  return db.clients.find((c) => c.id === clientId) ?? null;
}

export function clientForLead(db: OpsDatabase, leadId: Id): OpsClient | null {
  return db.clients.find((c) => c.leadId === leadId) ?? null;
}

export function clientsNewestFirst(db: OpsDatabase): OpsClient[] {
  return [...db.clients].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * The client record, made once and then found (step 19).
 *
 * Two things make a client: an exact match against a company the TA System
 * already has, and an agreement countersigned. Both can happen to the same
 * lead, in either order, so this never makes a second record for a company we
 * already hold - two records would mean two owners and two agreements, which
 * is the fault on the board.
 */
export async function clientFromLead(
  db: OpsDatabase,
  lead: OpsLead,
  stage: string,
  by: Id,
): Promise<OpsClient> {
  const already =
    clientForLead(db, lead.id) ??
    db.clients.find((c) => c.nameKey === lead.nameKey) ??
    (lead.clientTaId ? db.clients.find((c) => c.taClientId === lead.clientTaId) : undefined) ??
    null;
  if (already) {
    // The stage only ever moves forward here; a person moves it back.
    const patch: Partial<OpsClient> = {};
    if (already.taClientId === null && lead.clientTaId) patch.taClientId = lead.clientTaId;
    if (already.leadId === null) patch.leadId = lead.id;
    if (already.stage !== stage && stage === "active") patch.stage = stage;
    if (Object.keys(patch).length) {
      // The audit says what happened, not that something did: a client turning
      // active is the countersignature, and reads that way a year later.
      await patchClient(already.id, patch, by, patch.stage ? "client.agreementDone" : "client.updated", null);
    }
    return { ...already, ...patch };
  }
  return addClient({
    leadId: lead.id,
    taClientId: lead.clientTaId,
    name: lead.company,
    nameKey: lead.nameKey,
    stage,
    billingName: "",
    billingEmail: "",
    groupName: "",
    notes: "",
    reason: null,
    ownerId: lead.ownerId,
  });
}

/* ── The client agreement ───────────────────────────────────── */

export async function addAgreement(input: Omit<OpsEsa, "id" | "createdAt" | "updatedAt">): Promise<OpsEsa> {
  if (!usingConvex()) return repo.addAgreement(input);
  return convexMutation<OpsEsa>("ops/data:addAgreement", input);
}

export async function patchAgreement(
  esaId: Id,
  patch: Partial<OpsEsa>,
  by: Id,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchAgreement(esaId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchAgreement", { esaId, patch, by, what, reason });
}

export function agreementForLead(db: OpsDatabase, leadId: Id): OpsEsa | null {
  return db.agreements.filter((e) => e.leadId === leadId).sort((a, b) => b.version - a.version)[0] ?? null;
}

export function agreementIn(db: OpsDatabase, esaId: Id): OpsEsa | null {
  return db.agreements.find((e) => e.id === esaId) ?? null;
}

/** Writes a message into the one way out, as a draft for somebody to approve. */
export async function draftMessage(
  input: Omit<
    OpsMessage,
    "id" | "state" | "approvedBy" | "approvedAt" | "sentAt" | "providerMessageId" | "note" | "createdAt" | "attachmentFileIds"
  > & { attachmentFileIds?: Id[] },
): Promise<OpsMessage> {
  if (!usingConvex()) return repo.draftMessage(input);
  return convexMutation<OpsMessage>("ops/data:draftMessage", input);
}

/* ── Meetings ──────────────────────────────────────────── */

export async function addMeeting(input: Omit<OpsMeeting, "id" | "createdAt" | "updatedAt">): Promise<OpsMeeting> {
  if (!usingConvex()) return repo.addMeeting(input);
  return convexMutation<OpsMeeting>("ops/data:addMeeting", input);
}

export async function patchMeeting(
  meetingId: Id,
  patch: Partial<OpsMeeting>,
  by: Id,
  what: string,
  reason: string | null = null,
): Promise<void> {
  if (!usingConvex()) {
    repo.patchMeeting(meetingId, patch, by, what, reason);
    return;
  }
  await convexMutation("ops/data:patchMeeting", { meetingId, patch, by, what, reason });
}

export function meetingsForLead(db: OpsDatabase, leadId: Id): OpsMeeting[] {
  return db.meetings.filter((m) => m.leadId === leadId).sort((a, b) => b.at - a.at);
}

export function meetingIn(db: OpsDatabase, meetingId: Id): OpsMeeting | null {
  return db.meetings.find((m) => m.id === meetingId) ?? null;
}

/**
 * Stops every live clock on one thing.
 *
 * A client's reply only ever stopped the chases, which is right - the CV
 * ownership window and the guarantee keep running whatever a client says. But
 * a thing that is *settled* has no clocks left worth running: a signed
 * agreement still had the two-week "nobody has signed" clock ticking, and it
 * would have fired a fortnight later on an agreement that was signed (found in
 * the browser, 2 Nov).
 */
export async function cancelClocksFor(
  db: OpsDatabase,
  subjectType: string,
  subjectId: Id,
  by: Id,
  reason: string,
  /** Only these kinds, when some clocks have to keep running. */
  kinds: string[] | null = null,
): Promise<number> {
  const live = db.timers
    .filter((t) => t.subjectType === subjectType && t.subjectId === subjectId)
    .filter((t) => !kinds || kinds.includes(t.kind))
    .filter((t) => t.state === "running" || t.state === "warned");
  if (!live.length) return 0;
  if (!usingConvex()) {
    repo.cancelTimers(
      live.map((t) => t.id),
      by,
      reason,
    );
    return live.length;
  }
  await convexMutation("ops/data:cancelTimers", { timerIds: live.map((t) => t.id), by });
  return live.length;
}

/** Stops the clocks on a meeting that is over, however it ended. */
export async function cancelMeetingClocks(db: OpsDatabase, meetingId: Id, by: Id): Promise<number> {
  const live = db.timers
    .filter((t) => t.subjectType === "meeting" && t.subjectId === meetingId)
    .filter((t) => t.state === "running" || t.state === "warned");
  if (!live.length) return 0;
  if (!usingConvex()) {
    repo.cancelTimers(
      live.map((t) => t.id),
      by,
      "The meeting is over.",
    );
    return live.length;
  }
  await convexMutation("ops/data:cancelTimers", { timerIds: live.map((t) => t.id), by });
  return live.length;
}

/* ── Calls, holidays and the baseline ─────────────────────────────── */

export async function logCall(input: Omit<OpsCallLog, "id" | "at">): Promise<void> {
  if (!usingConvex()) {
    repo.logCall(input);
    return;
  }
  await convexMutation("ops/data:logCall", input);
}

export async function addHolidays(days: { date: string; name: string }[], by: Id): Promise<number> {
  if (!usingConvex()) return repo.addHolidays(days, by);
  return convexMutation<number>("ops/data:addHolidays", { days, by });
}

export async function removeHoliday(date: string, by: Id): Promise<void> {
  if (!usingConvex()) {
    repo.removeHoliday(date, by);
    return;
  }
  await convexMutation("ops/data:removeHoliday", { date, by });
}

export async function addBaseline(input: Omit<OpsBaseline, "id" | "at">): Promise<void> {
  if (!usingConvex()) {
    repo.addBaseline(input);
    return;
  }
  await convexMutation("ops/data:addBaseline", input);
}

/* ── Writes to the TA System, through the outbox ───────────────────── */

/**
 * Queues a write. Nothing is sent from here: the sending is a separate pass,
 * so a screen is never left waiting on another machine, and a write is never
 * lost because somebody closed a tab.
 */
export async function queueTaWrite(
  path: string,
  body: Record<string, unknown>,
  subject: { type: string; id: Id } | null = null,
): Promise<OpsOutboxItem> {
  const input = {
    path,
    body,
    idempotencyKey: outboxKeyFor(path, body),
    subjectType: subject?.type ?? null,
    subjectId: subject?.id ?? null,
  };
  if (!usingConvex()) return repo.queueWrite(input);
  return convexMutation<OpsOutboxItem>("ops/data:queueWrite", input);
}

/**
 * Tries every write that is due (15, Phase 1 step 21).
 *
 * Run by the same scheduled pass as the clocks. A write that cannot go stays
 * queued with a longer wait each time; after twelve tries it stops and says a
 * person has to do it by hand, because retrying silently for ever is how
 * something gets forgotten.
 */
export async function pushOutbox(now = Date.now()): Promise<{ sent: number; waiting: number; gaveUp: number }> {
  const db = await desk();
  const due = dueNow(db.outbox, now);
  let sent = 0;
  let waiting = 0;
  let gaveUp = 0;

  for (const item of due) {
    const outcome = await taWrite(item.path, item.body, item.idempotencyKey);
    if (outcome.ok) {
      sent += 1;
      await recordOutboxTry(item.id, { ok: true });
      continue;
    }
    const attempts = item.attempts + 1;
    if (shouldGiveUp(attempts)) {
      gaveUp += 1;
      await recordOutboxTry(item.id, { ok: false, error: outcome.reason, state: "failed", nextTryAt: null });
      continue;
    }
    waiting += 1;
    await recordOutboxTry(item.id, { ok: false, error: outcome.reason, nextTryAt: nextTryAt(attempts, now) });
  }
  return { sent, waiting, gaveUp };
}

async function recordOutboxTry(
  itemId: Id,
  result: { ok: boolean; error?: string; nextTryAt?: number | null; state?: OpsOutboxItem["state"] },
): Promise<void> {
  if (!usingConvex()) {
    repo.recordOutboxTry(itemId, result);
    return;
  }
  await convexMutation("ops/data:recordOutboxTry", {
    itemId,
    ok: result.ok,
    error: result.error ?? null,
    nextTryAt: result.nextTryAt ?? null,
    state: result.state ?? null,
  });
}

/* ── Events from the TA System ──────────────────────────────── */

export const EVENTS_CURSOR = "ta.eventsCursor";
export const EVENTS_READ_AT = "ta.eventsReadAt";

/**
 * One pass of the events reader (15, Part E3).
 *
 * Reads from where we got to, records each event once, and moves the cursor
 * only as far as the events that were handled. In this phase handling means
 * recording which phase will act on it, so the reader is proved now and the
 * handlers can be added later without touching it.
 */
export async function readTaEvents(now = Date.now()): Promise<{ read: number; kept: number; reason: string | null }> {
  const db = await desk();
  const cursor = settingValue(db, EVENTS_CURSOR) ?? "";
  const batch = await eventsAfter(cursor);
  if (!batch.ok) return { read: 0, kept: 0, reason: batch.reason };

  const handled: { taEventId: string; handledAt: number | null }[] = [];
  let kept = 0;
  for (const event of batch.data.events) {
    const row = {
      taEventId: event.id,
      type: event.type,
      data: event.data,
      handledAt: now,
      attempts: 1,
      lastError: null,
      note: whatWeDoWithIt(event.type),
    };
    const added = usingConvex()
      ? await convexMutation<OpsEvent | null>("ops/data:addEvent", row)
      : repo.addEvent(row);
    if (added) kept += 1;
    // Some events are not only recorded: a set TA says is ready becomes a set
    // on our side, with its due date and its clock (15, Phase 4 step 2).
    if (event.type === "client_set.ready") await takeClientSetReady(event.data, now);
    // TA owns the openings, so Ops learns about them here rather than
    // guessing (15, Phase 3 steps 7 and 8).
    if (event.type === "opening.created") await takeOpeningCreated(event.data, now);
    // A candidate moving stage in TA changes how deep the client's shortlist
    // is, which is what the owner's two rules turn on (step 14).
    if (event.type === "application.stage_changed") {
      const opening = String(event.data.openingId ?? "");
      const db2 = await desk();
      const position = opening ? positionForOpening(db2, opening) : null;
      if (position) await evaluateDepth(position.id, now);
    }
    if (
      event.type === "opening.updated" ||
      event.type === "opening.jd_approved" ||
      event.type === "opening.closed" ||
      event.type === "opening.working_stage_changed"
    ) {
      await takeOpeningUpdate(event.type, event.data, now);
    }
    handled.push({ taEventId: event.id, handledAt: now });
  }

  const moved = cursorAfter(handled, cursor);
  if (moved !== cursor) await noteSetting(EVENTS_CURSOR, moved);
  await noteSetting(EVENTS_READ_AT, String(now));
  return { read: batch.data.events.length, kept, reason: null };
}

/** A setting the system keeps for itself. Not audited: it changes every pass. */
async function noteSetting(key: string, value: string): Promise<void> {
  if (!usingConvex()) {
    repo.noteSystemSetting(key, value);
    return;
  }
  await convexMutation("ops/data:noteSystemSetting", { key, value });
}

export function outboxWaiting(db: OpsDatabase): OpsOutboxItem[] {
  return db.outbox.filter((o) => o.state !== "sent").sort((a, b) => a.createdAt - b.createdAt);
}

export function eventsNewestFirst(db: OpsDatabase): OpsEvent[] {
  return [...db.events].sort((a, b) => b.receivedAt - a.receivedAt);
}

export function settingValue(db: OpsDatabase, key: string): string | null {
  const value = db.settings.find((s) => s.key === key)?.value;
  return value === undefined ? null : String(value);
}

/* ── Reading one desk, without asking for it twice ───────────────────────── */

export function numberOf(db: OpsDatabase, key: string, fallback: number): number {
  const value = db.settings.find((s) => s.key === key)?.value;
  return typeof value === "number" ? value : fallback;
}

export function switchedOn(db: OpsDatabase, key: string): boolean {
  return db.settings.find((s) => s.key === key)?.value === true;
}

export function member(db: OpsDatabase, memberId: Id) {
  return db.members.find((m) => m.id === memberId) ?? null;
}

export function activeMembers(db: OpsDatabase) {
  return db.members.filter((m) => m.active);
}

export function draftsWaiting(db: OpsDatabase): OpsMessage[] {
  return db.messages.filter((m) => m.state === "draft").sort((a, b) => a.createdAt - b.createdAt);
}

export function openTasksFor(db: OpsDatabase, memberId: Id): OpsTask[] {
  return db.tasks.filter((t) => t.state === "open" && t.assigneeId === memberId).sort((a, b) => a.dueAt - b.dueAt);
}

export function liveTimersFor(db: OpsDatabase, memberId: Id): OpsTimer[] {
  return db.timers
    .filter((t) => (t.state === "running" || t.state === "warned") && t.ownerId === memberId)
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function liveTimers(db: OpsDatabase): OpsTimer[] {
  return db.timers.filter((t) => t.state === "running" || t.state === "warned");
}
