"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addAgreement,
  addBaseline,
  cancelClocksFor,
  addFile,
  addHolidays,
  addLead,
  addMeeting,
  agreementForLead,
  addPosition,
  addRequirement,
  compileTalentPulse,
  issueIn,
  agreementIn,
  chaseTheAgreement,
  clientFromLead,
  clientIn,
  clientSetIn,
  holdIn,
  patchClientSet,
  patchHold,
  patchIssue,
  patchPosition,
  patchRequirement,
  evaluateDepth,
  positionForSet,
  positionIn,
  requirementForLead,
  startReceiptClocks,
  clientsNewestFirst,
  patchClient,
  draftMessage,
  patchAgreement,
  cancelMeetingClocks,
  createTask,
  desk,
  leadIn,
  meetingIn,
  meetingsForLead,
  patchLead,
  patchMeeting,
  editMessage,
  fileIn,
  logCall,
  pushOutbox,
  queueTaWrite,
  readTaEvents,
  removeHoliday,
  fileInbound,
  markInboundActioned,
  readTheMailboxes,
  takeInbound,
  finishTask as finishTaskWrite,
  numberOf,
  recordReply as recordReplyWrite,
  runClocks,
  setSetting,
  saveTemplate,
  settleMessage,
  templateFor,
  startTimer,
  switchedOn,
} from "@/data/desk";
import { HOUR, colomboDateInWords, nextNineAm } from "@/lib/calendar";
import { can, refusal } from "@/lib/roles";
import { gate, needsApproval } from "@/lib/messages";
import { settingChange } from "@/lib/settingsRules";
import { groupPostIsManual, sendEmail, sendWhatsApp, sendingEnabled, subjectWithReference } from "@/lib/senders";
import { problemWith } from "@/lib/templates";
import { fakeArrival } from "@/lib/graphMail";
import { putBytes, readBytes } from "@/data/fileStore";
import { fillDocx, problemWithFill } from "@/lib/docxFill";
import {
  problemWithIssue,
  problemWithLinkedIn,
  tidyLinkedIn,
} from "@/lib/adverts";
import {
  briefText,
  problemWithHandover,
  problemWithImpractical,
  problemWithRequirement,
} from "@/lib/requirements";
import {
  HOLD_REVIEW_DAYS,
  OWNERSHIP_WORKING_DAYS,
  claimVerdict,
  ownershipWindow,
  problemWithDecision,
  problemWithHold,
  problemWithLift,
} from "@/lib/clientFeedback";
import {
  MIN_CVS,
  type SetState,
  canMoveTo as canMoveSetTo,
  problemWithSending,
} from "@/lib/clientSets";
import { docxToPdf } from "@/lib/docxToPdf";
import {
  type FileKind,
  canBecomePdf,
  isFileKind,
  keyFor,
  mimeFor,
  pdfNameFor,
  problemWithUpload,
  safeName,
  sha256,
} from "@/lib/files";
import { referenceFor } from "@/lib/mailMatch";
import { problemWithCall, tidyPhone } from "@/lib/calls";
import { HOLD_AT, problemWithAnotherSet } from "@/lib/depth";
import { parseHolidayLines } from "@/lib/holidays";
import { MEASURES } from "@/lib/baseline";
import {
  type LeadState,
  duplicateMatch,
  flagIndustry,
  nameKey,
  neverInviteBack,
  problemWithClosing,
  problemWithNewLead,
  routeLead,
} from "@/lib/leads";
import { clients as taClients, preparedCv } from "@/lib/ta";
import {
  type EsaFields,
  type EsaState,
  canMoveTo,
  chaseStep,
  defaultFields,
  expiresAt as esaExpiresAt,
  nextChaseAt,
  ESA_FIELDS,
  problemWithChanges,
  problemWithDraft,
  problemWithSigned,
} from "@/lib/esa";
import {
  type ClientStage,
  STAGE_MEANINGS,
  problemWithBilling,
  problemWithStageMove,
} from "@/lib/clients";
import {
  afterNotHeld,
  agreementDueAt,
  missingFromHeld,
  problemWithBooking,
  problemWithHeld,
  remindersFor,
  warningAboutBooking,
} from "@/lib/meetings";
import { devSignInAllowed } from "@/lib/session";
import { currentMember } from "@/lib/session";

/**
 * What the screens can do. Every one of them checks the role first, and every
 * refusal is a sentence a person can act on rather than a code.
 */

export async function startTestClock(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  await startTimer({
    kind: "test.clock",
    subjectType: "test",
    subjectId: "test",
    startsAt: Date.now(),
    dueAt: Date.now() + 2 * HOUR,
    warnAt: Date.now() + HOUR,
    ownerId: member.id,
    payload: { label: "Test clock, started by " + member.name },
  });
  revalidatePath("/");
}

/** The clocks run on every visit to the inbox; this is the same pass by hand. */
export async function runClocksNow(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const result = await runClocks();
  revalidatePath("/");
  const said =
    result.fired || result.warned || result.escalated
      ? result.fired + " clocks finished, " + result.warned + " are close, " + result.escalated + " tasks passed on."
      : "Nothing was due.";
  redirect("/?msg=" + encodeURIComponent(said));
}

/** The client answered, so the chasing stops. */
export async function recordReply(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const subjectType = String(formData.get("subjectType") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  const back = String(formData.get("back") ?? "/");
  const stopped = await recordReplyWrite(subjectType, subjectId, member.id);
  revalidatePath("/");
  redirect(
    back +
      "?msg=" +
      encodeURIComponent(
        stopped ? "Noted. " + stopped + " chase" + (stopped === 1 ? "" : "s") + " stopped." : "Noted. There was no chase running.",
      ),
  );
}

/** Only the ops lead, and never without saying why (owner's standing rule). */
export async function changeSetting(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const key = String(formData.get("key") ?? "");
  const raw = String(formData.get("value") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!can(member, "settings.manage")) {
    redirect("/settings?msg=" + encodeURIComponent(refusal("settings.manage")));
  }
  const current = (await desk()).settings.find((s) => s.key === key);
  if (!current) redirect("/settings?msg=" + encodeURIComponent("There is no setting called " + key + "."));

  const decided = settingChange(key, current.value, raw, reason);
  if (!decided.ok) redirect("/settings?msg=" + encodeURIComponent(decided.message));

  await setSetting(key, decided.value, member.id, reason);
  revalidatePath("/settings");
  redirect("/settings?msg=" + encodeURIComponent(key + " is now " + String(decided.value) + "."));
}

/** Read the Ops mailbox now. Off until the credentials exist, and it says so. */
export async function readMailNow(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const r = await readTheMailboxes(member.id);
  const counted =
    r.read + " new, " + r.filed + " filed, " + r.waiting + " waiting for you, " + r.chasesStopped + " chases stopped" +
    (r.already ? ", " + r.already + " we had already" : "") + ".";
  const said = r.ok ? counted : (r.reason ?? "The mailboxes could not be read.") + " " + counted;
  revalidatePath("/mail");
  redirect("/mail?msg=" + encodeURIComponent(said));
}

/**
 * A pretend arrival, so the screen can be built and shown before the mailbox
 * exists. Refused unless the development sign-in is on.
 */
export async function pretendMailArrives(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  if (!devSignInAllowed()) redirect("/mail?msg=" + encodeURIComponent("Pretend mail is for development only."));

  const kind = String(formData.get("kind") ?? "reply");
  const db = await desk();
  const sent = db.messages.find((m) => m.subjectType && m.subjectId);
  const subject =
    kind === "reply" && sent
      ? "Re: " + sent.subject + " " + referenceFor(sent.subjectType as string, sent.subjectId as string)
      : "A question about our search";

  const r = await takeInbound([fakeArrival({ subject })], member.id);
  revalidatePath("/mail");
  redirect(
    "/mail?msg=" +
      encodeURIComponent(r.filed ? "Filed by its reference. " + r.chasesStopped + " chases stopped." : "It arrived, and is waiting for you to file it."),
  );
}

export async function fileThisMail(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const inboundId = String(formData.get("inboundId") ?? "");
  const pair = String(formData.get("subject") ?? "");
  if (!pair.includes("|")) redirect("/mail?msg=" + encodeURIComponent("Choose what it belongs to first."));
  const [subjectType, subjectId] = pair.split("|");
  const stopped = await fileInbound(inboundId, subjectType, subjectId, member.id);
  revalidatePath("/mail");
  redirect("/mail?msg=" + encodeURIComponent(stopped ? "Filed. " + stopped + " chases stopped." : "Filed."));
}

export async function markMailDone(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  await markInboundActioned(String(formData.get("inboundId") ?? ""), member.id);
  revalidatePath("/mail");
  redirect("/mail?msg=" + encodeURIComponent("Marked as dealt with."));
}

/**
 * Save a template's wording. The ops lead only, and refused outright when the
 * wording could not work — an email with no subject, a blank nobody can fill —
 * because the alternative is finding out when a client gets it.
 */
export async function saveTemplateWording(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const key = String(formData.get("key") ?? "");
  const here = "/templates/" + encodeURIComponent(key);

  if (!can(member, "template.edit")) {
    redirect(here + "?msg=" + encodeURIComponent(refusal("template.edit")));
  }

  const db = await desk();
  const template = templateFor(db, key);
  if (!template) redirect("/templates?msg=" + encodeURIComponent("That wording no longer exists."));

  const patch = {
    name: String(formData.get("name") ?? "").trim(),
    // A channel with nowhere to put a subject keeps the empty one it had.
    subject: template.channel === "email" ? String(formData.get("subject") ?? "").trim() : "",
    body: String(formData.get("body") ?? ""),
    approvedForAuto: template.channel === "internal" ? true : formData.get("approvedForAuto") === "on",
  };

  const problem = problemWith({ ...patch, channel: template.channel });
  if (problem) redirect(here + "?msg=" + encodeURIComponent(problem));

  await saveTemplate(key, patch, member.id);
  revalidatePath(here);
  revalidatePath("/templates");
  redirect(here + "?msg=" + encodeURIComponent("Saved. The next one sent uses this wording."));
}

export async function finishTask(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const taskId = String(formData.get("taskId") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!can(member, "task.do")) redirect("/tasks/" + taskId + "?msg=" + encodeURIComponent(refusal("task.do")));
  // The owner's rule: what happened is written down before it is closed.
  if (!outcome.trim()) {
    redirect("/tasks/" + taskId + "?msg=" + encodeURIComponent("Write one line about what happened first."));
  }
  await finishTaskWrite(taskId, member.id, outcome);
  revalidatePath("/");
  redirect("/");
}

export async function saveDraft(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const messageId = String(formData.get("messageId") ?? "");
  await editMessage(messageId, { subject: String(formData.get("subject") ?? ""), body: String(formData.get("body") ?? "") }, member.id);
  revalidatePath("/messages/" + messageId);
  redirect("/messages/" + messageId + "?msg=" + encodeURIComponent("Saved."));
}

export async function approveAndSend(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const messageId = String(formData.get("messageId") ?? "");
  const here = "/messages/" + messageId;

  if (!can(member, "message.approve")) {
    redirect(here + "?msg=" + encodeURIComponent(refusal("message.approve")));
  }
  const db = await desk();
  const message = db.messages.find((m) => m.id === messageId);
  if (!message) redirect("/?msg=" + encodeURIComponent("That message no longer exists."));
  if (!needsApproval(message)) {
    redirect(here + "?msg=" + encodeURIComponent("That message has already been settled."));
  }

  // Approved first, then the gate decides what really happens to it.
  const verdict = gate(
    { ...message, state: "approved" },
    {
      outreachLive: switchedOn(db, "switch.outreachLive"),
      testRecipient: (process.env.OPS_TEST_EMAIL ?? "").trim() || "test@example.test",
      doNotContact: [],
      sentToClientToday: 0,
      dailyCapPerClient: numberOf(db, "message.dailyCapPerClient", 4),
    },
  );

  if (!verdict.ok) {
    await settleMessage(messageId, member.id, verdict.state, message.to, verdict.note);
    redirect(here + "?msg=" + encodeURIComponent(verdict.note));
  }

  // The gate said yes. Now it actually goes, from this person's own mailbox,
  // and whatever the sender says is recorded as it is - including "we do not
  // know whether it went", which is a real answer and not a failure to hide.
  const subject = subjectWithReference(message.subject, message.subjectType, message.subjectId);
  const outcome =
    message.channel === "group_post"
      ? groupPostIsManual()
      : message.channel === "whatsapp"
        ? await sendWhatsApp({ to: verdict.to[0], body: message.body, templateKey: message.templateKey })
        : await sendEmail({
            from: member.email,
            to: verdict.to,
            subject,
            body: message.body,
            // The agreement, the invoice and the offer letter travel with
            // their message. A file whose bytes are gone stops the send
            // rather than sending the covering note alone.
            attachments: await filesFor(db, message.attachmentFileIds),
          });

  // Test mode's note matters as much as the sender's, so both are kept.
  const said = [verdict.note, outcome.reason].filter(Boolean).join(" ") || null;
  await settleMessage(
    messageId,
    member.id,
    // Switched off on purpose is not the same as a send that went wrong. A
    // preview with no credentials would otherwise report every message as
    // failed, which hides the real failures when they come.
    // A group post is never "sent": nobody sent it. It stops at approved,
    // which is the truth - a person has it to post (3 Nov, in the browser).
    message.channel === "group_post"
      ? "approved"
      : outcome.ok
        ? "sent"
        : sendingEnabled()
          ? "failed"
          : "blocked",
    verdict.to,
    said,
    outcome.providerMessageId,
  );
  revalidatePath("/");
  redirect(here + "?msg=" + encodeURIComponent(said ?? "Sent."));
}

/**
 * Keeps a file (15, Phase 1 step 23).
 *
 * The bytes go to storage first and the registry row second, so a row in the
 * list always leads to a file. The hash is taken as it arrives: it is what
 * answers "is this the document we really sent" a year later.
 */
export async function keepFile(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/files?msg=" + encodeURIComponent(msg));
  if (!can(member, "file.keep")) back(refusal("file.keep"));

  const upload = formData.get("file");
  if (!(upload instanceof File)) back("No file was chosen.");
  const file = upload as File;
  const problem = problemWithUpload({ name: file.name, size: file.size });
  if (problem) back(problem);

  const kindAsked = String(formData.get("kind") ?? "other");
  const kind = isFileKind(kindAsked) ? kindAsked : "other";
  const subjectType = String(formData.get("subjectType") ?? "").trim() || null;
  const subjectId = String(formData.get("subjectId") ?? "").trim() || null;
  // Half a label is no label: a subject needs both parts to find anything.
  if ((subjectType && !subjectId) || (subjectId && !subjectType)) {
    back("A file filed under something needs both what it belongs to and which one.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = keyFor(kind, subjectType, subjectId, file.name);
  const mime = mimeFor(file.name);
  await putBytes(key, bytes, mime);
  await addFile({
    kind,
    key,
    name: safeName(file.name),
    size: bytes.length,
    mime,
    sha256: sha256(bytes),
    subjectType,
    subjectId,
    madeFrom: null,
    uploadedBy: member.id,
  });
  revalidatePath("/files");
  back("Kept " + safeName(file.name) + ".");
}

/**
 * Makes a PDF of a Word document and keeps that too.
 *
 * The Word file is left alone, because it is the template that was filled and
 * the PDF is what goes out. On a machine without LibreOffice this says so
 * plainly instead of failing.
 */
export async function makePdfOfFile(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/files?msg=" + encodeURIComponent(msg));
  if (!can(member, "file.keep")) back(refusal("file.keep"));

  const fileId = String(formData.get("fileId") ?? "");
  const db = await desk();
  const row = fileIn(db, fileId);
  if (!row) back("That file is not in the list any more.");
  const source = row as NonNullable<typeof row>;
  if (!canBecomePdf(source.name)) back("A PDF can only be made from a Word document.");

  const bytes = await readBytes(source.key);
  if (!bytes) back("The file itself is missing from storage, so no PDF can be made.");

  const made = await docxToPdf(bytes as Uint8Array, source.name);
  if (!made.ok || !made.bytes) back(made.reason ?? "The conversion failed.");

  const pdf = made.bytes as Uint8Array;
  const name = pdfNameFor(source.name);
  const key = keyFor(source.kind as FileKind, source.subjectType, source.subjectId, name);
  await putBytes(key, pdf, "application/pdf");
  await addFile({
    kind: source.kind,
    key,
    name,
    size: pdf.length,
    mime: "application/pdf",
    sha256: sha256(pdf),
    subjectType: source.subjectType,
    subjectId: source.subjectId,
    madeFrom: source.id,
    uploadedBy: member.id,
  });
  revalidatePath("/files");
  back("Made " + name + ".");
}

/**
 * Writes down a call somebody made (15, Phase 1 step 24).
 *
 * Nothing here dials anything: the owner decided calls stay human, so this is
 * the record of what a person did. If the call answers a call task, that task
 * is finished with the same words, because writing it twice is how one of the
 * two ends up empty.
 */
export async function recordCall(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/calls?msg=" + encodeURIComponent(msg));
  if (!can(member, "task.do")) back(refusal("task.do"));

  const input = {
    to: String(formData.get("to") ?? "").trim(),
    spokeTo: String(formData.get("spokeTo") ?? "").trim(),
    outcome: String(formData.get("outcome") ?? "").trim(),
  };
  const problem = problemWithCall(input);
  if (problem) back(problem);

  const taskId = String(formData.get("taskId") ?? "").trim() || null;
  const subjectType = String(formData.get("subjectType") ?? "").trim() || null;
  const subjectId = String(formData.get("subjectId") ?? "").trim() || null;

  await logCall({
    taskId,
    to: tidyPhone(input.to) ?? input.to,
    toName: String(formData.get("toName") ?? "").trim(),
    purpose: String(formData.get("purpose") ?? "other"),
    spokeTo: input.spokeTo,
    outcome: input.outcome,
    subjectType,
    subjectId,
    by: member.id,
  });

  if (taskId) await finishTaskWrite(taskId, member.id, "Called " + input.spokeTo + ": " + input.outcome);
  revalidatePath("/calls");
  revalidatePath("/");
  back("Written down." + (taskId ? " The call task is finished." : ""));
}

/** Adds the holidays somebody pasted in (15, Phase 1 step 10). */
export async function addHolidayList(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/holidays?msg=" + encodeURIComponent(msg));
  if (!can(member, "settings.manage")) back(refusal("settings.manage"));

  const { days, problems } = parseHolidayLines(String(formData.get("pasted") ?? ""));
  if (days.length === 0) {
    back("Nothing in that could be read as a date. One line each: 2027-01-15, Thai Pongal.");
  }
  const added = await addHolidays(days, member.id);
  revalidatePath("/holidays");
  back(
    added + " of " + days.length + " added." +
      (problems.length ? " These lines were not dates: " + problems.slice(0, 3).join(" · ") : ""),
  );
}

export async function dropHoliday(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/holidays?msg=" + encodeURIComponent(msg));
  if (!can(member, "settings.manage")) back(refusal("settings.manage"));
  const date = String(formData.get("date") ?? "");
  await removeHoliday(date, member.id);
  revalidatePath("/holidays");
  back(date + " is a working day again.");
}

/**
 * Records one of today's numbers (15, Phase 1 step 0).
 *
 * The owner's instruction was to measure before changing anything, so the
 * weekly report can one day say what changed. These come out of the archive by
 * hand: there is no system to read them from.
 */
export async function recordBaseline(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/baseline?msg=" + encodeURIComponent(msg));
  if (!can(member, "report.read")) back(refusal("report.read"));

  const measure = String(formData.get("measure") ?? "");
  if (!MEASURES[measure]) back("Pick what is being measured.");
  const period = String(formData.get("period") ?? "").trim();
  if (!period) back("Say which months this covers, so a later number can be compared with it.");
  const value = Number(String(formData.get("value") ?? ""));
  if (!Number.isFinite(value) || value < 0) back("That is not a number.");

  await addBaseline({
    measure,
    period,
    value,
    note: String(formData.get("note") ?? "").trim(),
    by: member.id,
  });
  revalidatePath("/baseline");
  back("Recorded. " + MEASURES[measure].name + " for " + period + ": " + value + " " + MEASURES[measure].unit + ".");
}

/** Tries every waiting write now, instead of waiting for the next pass. */
export async function pushOutboxNow(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const result = await pushOutbox();
  revalidatePath("/ta");
  redirect(
    "/ta?msg=" +
      encodeURIComponent(
        result.sent + " went, " + result.waiting + " are waiting, " + result.gaveUp + " given up on.",
      ),
  );
}

/** Reads the TA System's events now, instead of waiting for the next pass. */
export async function readEventsNow(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const result = await readTaEvents();
  revalidatePath("/ta");
  redirect(
    "/ta?msg=" +
      encodeURIComponent(
        result.reason ? result.reason : result.read + " read, " + result.kept + " new.",
      ),
  );
}

/**
 * Queues a harmless write, to prove the outbox end to end.
 *
 * Phase 1 has no business writes yet - the first real one is "create the
 * opening in TA" in Phase 3 - so without this there would be no way to show
 * that queueing, trying, waiting and the key all work. It is a notice to
 * ourselves, and it says so.
 */
export async function queueTestWrite(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  if (!can(member, "settings.manage")) {
    redirect("/ta?msg=" + encodeURIComponent(refusal("settings.manage")));
  }
  const item = await queueTaWrite(
    "/integrations/v1/notify",
    {
      userId: member.taUserId ?? "unknown",
      type: "ops_test",
      title: "Ops is talking to the TA System",
      body: "A test write queued by " + member.name + " while building Phase 1.",
    },
    null,
  );
  revalidatePath("/ta");
  redirect("/ta?msg=" + encodeURIComponent("Queued. Its key is " + item.idempotencyKey + "; queueing it again changes nothing."));
}

/**
 * A new lead (15, Phase 2 step 2).
 *
 * The lead is saved first and routed second, on purpose: a company that rang
 * us exists whether or not we can reach the TA System to check whether they
 * are already a client. The industry flag is proposed here from the words in
 * front of us, and waits for a person - the owner's rule is that banking and
 * finance are declined, not that a keyword declines them.
 */
export async function createLead(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/leads?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const input = {
    company: String(formData.get("company") ?? "").trim(),
    contactName: String(formData.get("contactName") ?? "").trim(),
    contactEmail: String(formData.get("contactEmail") ?? "").trim(),
    contactPhone: String(formData.get("contactPhone") ?? "").trim(),
    source: String(formData.get("source") ?? ""),
  };
  const problem = problemWithNewLead(input);
  if (problem) back(problem);

  const industry = String(formData.get("industry") ?? "").trim();
  const website = String(formData.get("website") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const flag = flagIndustry({ company: input.company, industry, website, notes });

  const lead = await addLead({
    ...input,
    nameKey: nameKey(input.company),
    industry,
    website,
    notes,
    industryFlagged: flag.flagged,
    industryBecause: flag.because,
    industryConfirmedBy: null,
    state: "new",
    reason: null,
    doNotInvite: false,
    clientTaId: null,
    // One ops person owns each client, and the person taking the lead owns it
    // until the ops lead moves it (owner's rule).
    ownerId: member.id,
    createdBy: member.id,
  });

  revalidatePath("/leads");
  redirect("/leads/" + lead.id + "?msg=" + encodeURIComponent("Saved. Now check the two things below."));
}

/**
 * Is this company already ours? (15, Phase 2 step 3.)
 *
 * An exact match is linked; anything that merely looks similar is listed for a
 * person to decide. Two client records for one company is how the same company
 * ends up with two owners and two agreements.
 */
export async function checkLeadDuplicate(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const lead = leadIn(await desk(), leadId);
  if (!lead) back("That lead is gone.");
  const company = (lead as NonNullable<typeof lead>).company;

  const answer = await taClients(company);
  if (!answer.ok) back("Could not ask the TA System: " + answer.reason);

  const found = duplicateMatch(
    company,
    (answer.ok ? answer.data : []).map((c) => ({
      id: c.id,
      name: c.name,
      nameKey: c.nameKey,
      esaSignedAt: c.esaSignedAt,
    })),
  );

  if (found.exact) {
    const routed = routeLead({ industryFlagged: false, industryConfirmed: false, existing: found.exact });
    await patchLead(
      leadId,
      { clientTaId: found.exact.id, state: routed.state },
      member.id,
      "lead.linkedToClient",
      routed.because,
    );
    // They are a company we already have, so the client record starts here
    // rather than waiting for an agreement they may already have signed.
    await clientFromLead(
      await desk(),
      { ...(lead as NonNullable<typeof lead>), clientTaId: found.exact.id },
      found.exact.esaSignedAt ? "active" : "lead",
      member.id,
    );
    revalidatePath(here);
    revalidatePath("/clients");
    back("They are already our client. " + routed.because);
  }

  if (found.near.length) {
    back(
      "No exact match. These look close, so somebody has to decide: " +
        found.near.map((c) => c.name).join(" · "),
    );
  }
  back("Nobody like that in the TA System, so this is a new client.");
}

/**
 * The industry decision (15, Phase 2 step 4).
 *
 * Confirming it declines the lead for good and marks it never to be invited
 * back, which is the owner's standing rule. Saying it is not that industry
 * clears the flag and says who cleared it, because that is a judgement
 * somebody made.
 */
export async function decideLeadIndustry(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const confirmed = String(formData.get("decision") ?? "") === "confirm";
  const lead = leadIn(await desk(), leadId);
  if (!lead) back("That lead is gone.");
  const row = lead as NonNullable<typeof lead>;

  if (!confirmed) {
    await patchLead(
      leadId,
      { industryFlagged: false, industryBecause: null, industryConfirmedBy: member.id },
      member.id,
      "lead.industryCleared",
      "Not banking or finance: " + member.name + " looked.",
    );
    revalidatePath(here);
    back("Cleared. This is not banking or finance.");
  }

  const routed = routeLead({ industryFlagged: true, industryConfirmed: true, existing: null });
  const reason = "Banking and finance are declined, whatever the role" + (row.industryBecause ? " (" + row.industryBecause + ")" : "") + ".";
  await patchLead(
    leadId,
    { state: routed.state, reason, doNotInvite: true, industryConfirmedBy: member.id },
    member.id,
    "lead.declinedIndustry",
    reason,
  );
  revalidatePath(here);
  revalidatePath("/leads");
  back("Declined, and marked never to be invited back. The decline notice is drafted when the templates for it exist.");
}

/** Closes a lead, with a reason. Nothing closes without one (owner's rule). */
export async function closeLead(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const state = String(formData.get("state") ?? "closed_other") as LeadState;
  const reason = String(formData.get("reason") ?? "");
  const problem = problemWithClosing(state, reason);
  if (problem) back(problem);

  await patchLead(
    leadId,
    { state, reason: reason.trim(), doNotInvite: neverInviteBack(state) },
    member.id,
    "lead.closed",
    reason.trim(),
  );
  revalidatePath(here);
  revalidatePath("/leads");
  back("Closed, with the reason written down.");
}

/**
 * Books the intro call (15, Phase 2 step 7).
 *
 * The TA lead is on every intro call, which is the owner's rule, so the
 * booking asks who. Two reminders are started with it - the day before at
 * nine, and an hour before - because a meeting nobody remembers is the
 * commonest way a lead goes quiet.
 */
export async function bookIntroCall(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const lead = leadIn(db, leadId);
  if (!lead) back("That lead is gone.");

  // A datetime-local field gives "2026-11-05T10:30" in the person's own clock,
  // which is Colombo for everyone who uses this.
  const typed = String(formData.get("at") ?? "").trim();
  const at = typed ? Date.parse(typed + ":00+05:30") : 0;
  const taLeadId = String(formData.get("taLeadId") ?? "").trim();
  const now = Date.now();

  const problem = problemWithBooking({ at, taLeadId }, now);
  if (problem) back(problem);

  // The count of attempts belongs to the lead, not to one booking: a new
  // booking carries it forward, or three attempts would never be reached and a
  // client who had gone quiet would be rebooked for ever (found in the
  // browser, 2 Nov).
  const triedBefore = meetingsForLead(db, leadId).reduce((most, m) => Math.max(most, m.rebookCount), 0);

  const meeting = await addMeeting({
    leadId,
    kind: "intro",
    at,
    state: "booked",
    taLeadId,
    rebookCount: triedBefore,
    brief: "",
    role: "",
    packageSaid: "",
    reason: null,
    bookedBy: member.id,
    heldAt: null,
  });

  for (const reminder of remindersFor(at, now)) {
    await startTimer({
      kind: reminder.kind,
      subjectType: "meeting",
      subjectId: meeting.id,
      startsAt: now,
      dueAt: reminder.dueAt,
      warnAt: null,
      ownerId: member.id,
      payload: { label: (lead as NonNullable<typeof lead>).company },
    });
  }

  await patchLead(leadId, { state: "intro_call" }, member.id, "lead.introCallBooked", null);
  revalidatePath(here);
  const warning = warningAboutBooking(at, db.holidays.map((h) => h.date));
  back("Booked, with a reminder the day before and an hour before." + (warning ? " " + warning : ""));
}

/**
 * The call happened (15, Phase 2 step 8).
 *
 * The brief is required. "The requirement was in the TA lead's head" is on the
 * owner's problem list, and a call that can be closed with an empty box is how
 * it stays there. Marking it held starts the agreement clock - two hours, from
 * the settings - because the agreement going out late is the first place the
 * business loses time.
 */
export async function markMeetingHeld(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const meetingId = String(formData.get("meetingId") ?? "");
  const db = await desk();
  const meeting = meetingIn(db, meetingId);
  const here = "/leads/" + (meeting?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!meeting) redirect("/leads?msg=" + encodeURIComponent("That meeting is gone."));

  const notes = {
    brief: String(formData.get("brief") ?? ""),
    role: String(formData.get("role") ?? ""),
    packageSaid: String(formData.get("packageSaid") ?? ""),
  };
  const problem = problemWithHeld(notes);
  if (problem) back(problem);

  const now = Date.now();
  const row = meeting as NonNullable<typeof meeting>;
  await patchMeeting(
    meetingId,
    { ...notes, state: "held", heldAt: now },
    member.id,
    "meeting.held",
    notes.brief.trim().slice(0, 200),
  );
  await cancelMeetingClocks(db, meetingId, member.id);

  const hours = numberOf(db, "esa.sendHours", 2);
  await startTimer({
    kind: "esa.send",
    subjectType: "lead",
    subjectId: row.leadId,
    startsAt: now,
    dueAt: agreementDueAt(now, hours),
    warnAt: null,
    ownerId: member.id,
    payload: { label: leadIn(db, row.leadId)?.company ?? "" },
  });
  await patchLead(row.leadId, { state: "waiting_agreement" }, member.id, "lead.callHeld", null);

  // The TA lead needs the brief, not a summary of it. Two ways, because the TA
  // lead is a person in the TA System and may have no Ops account at all:
  //
  //  * a task here, to whoever of ours is that same person (matched on their
  //    TA account), or else to the lead's owner, who has to pass it on. It was
  //    assigned to the TA System's own id first, which is nobody in Ops - so
  //    the task would have sat where no screen shows it (found in the browser);
  //  * a notice to them in the TA System, queued through the outbox, so it
  //    reaches them where they work.
  const ours = db.members.find((m) => m.taUserId && m.taUserId === row.taLeadId) ?? null;
  await createTask({
    kind: "record",
    title: "The brief from the intro call",
    body:
      notes.brief.trim() +
      (ours ? "" : "\n\nPass this to the TA lead: we have no Ops account matched to them."),
    assigneeId: ours?.id ?? leadIn(db, row.leadId)?.ownerId ?? member.id,
    dueAt: now,
    subjectType: "lead",
    subjectId: row.leadId,
    link: "/leads/" + row.leadId,
  });
  if (row.taLeadId) {
    await queueTaWrite(
      "/integrations/v1/notify",
      {
        userId: row.taLeadId,
        type: "ops_brief",
        title: "Intro call held: " + (leadIn(db, row.leadId)?.company ?? "a client"),
        body: notes.brief.trim(),
      },
      { type: "lead", id: row.leadId },
    );
  }

  revalidatePath(here);
  const missing = missingFromHeld(notes);
  back(
    "Saved. The agreement is due in " + hours + " hours." +
      (missing.length ? " Still not known: " + missing.join(" and ") + "." : ""),
  );
}

/**
 * The call did not happen (15, Phase 2 step 8).
 *
 * Rebooking continues while the client is still answering. Three attempts with
 * no reply closes the lead with a reason - the owner's rule. The reason is
 * always written down, whichever way it goes.
 */
export async function markMeetingNotHeld(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const meetingId = String(formData.get("meetingId") ?? "");
  const db = await desk();
  const meeting = meetingIn(db, meetingId);
  const here = "/leads/" + (meeting?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!meeting) redirect("/leads?msg=" + encodeURIComponent("That meeting is gone."));

  const row = meeting as NonNullable<typeof meeting>;
  const why = String(formData.get("reason") ?? "").trim();
  if (why.length < 4) back("Write one line about why it did not happen.");
  const clientReplied = formData.get("clientReplied") === "on";

  const outcome = afterNotHeld(row.rebookCount, clientReplied);
  const now = Date.now();
  await patchMeeting(
    meetingId,
    { state: "not_held", rebookCount: outcome.rebookCount, reason: why },
    member.id,
    "meeting.notHeld",
    why,
  );
  await cancelMeetingClocks(db, meetingId, member.id);

  if (outcome.action === "close") {
    await patchLead(
      row.leadId,
      { state: "closed_silent", reason: outcome.because + " " + why },
      member.id,
      "lead.closedSilent",
      outcome.because,
    );
    revalidatePath(here);
    revalidatePath("/leads");
    back(outcome.because);
  }

  await createTask({
    kind: "call",
    title: "Book the intro call again",
    body: outcome.because + " What happened last time: " + why,
    assigneeId: member.id,
    dueAt: nextNineAm(now),
    subjectType: "lead",
    subjectId: row.leadId,
    link: "/leads/" + row.leadId,
  });
  revalidatePath(here);
  back(outcome.because);
}

/* \u2500\u2500 The client agreement (15, Phase 2 steps 9 to 18) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 */

/**
 * Starts the agreement for a lead.
 *
 * The numbers come from the settings, not from the code, so a client on a
 * different guarantee is a settings change. What we know about the company
 * from the lead is filled in, and the rest is the ops owner's to complete.
 */
export async function startAgreement(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const lead = leadIn(db, leadId);
  if (!lead) back("That lead is gone.");
  const row = lead as NonNullable<typeof lead>;
  if (agreementForLead(db, leadId)) back("There is already an agreement for this client.");

  const fields: EsaFields = {
    ...defaultFields({
      guaranteeDays: numberOf(db, "guarantee.days", 90),
      paymentDays: numberOf(db, "invoice.dueDays", 30),
      replacementWorkingDays: numberOf(db, "replacement.workingDays", 60),
      refundPct: numberOf(db, "refund.pct", 25),
    }),
    companyName: row.company,
    signatoryName: row.contactName,
    signatoryEmail: row.contactEmail,
  };

  await addAgreement({
    leadId,
    clientTaId: row.clientTaId,
    state: "draft",
    version: 1,
    fields,
    draftFileId: null,
    sentAt: null,
    sentMessageId: null,
    chaseStep: 0,
    expiresAt: null,
    signedAt: null,
    signedFileId: null,
    countersignedAt: null,
    countersignedFileId: null,
    reason: null,
    ownerId: row.ownerId,
  });
  revalidatePath(here);
  back("Started. Fill in what is blank; it cannot be sent until the required fields are in.");
}

/** Saves the fields. Blank required ones are allowed here and block the send. */
export async function saveAgreementFields(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));

  const row = esa as NonNullable<typeof esa>;
  const fields: EsaFields = { ...row.fields };
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("field.")) fields[key.slice("field.".length)] = String(value);
  }

  await patchAgreement(esaId, { fields }, member.id, "esa.fieldsSaved", null);
  revalidatePath(here);
  const problem = problemWithDraft(fields);
  back(problem ? "Saved. " + problem : "Saved. Everything required is in; it can go.");
}

/**
 * Sends the agreement (15, Phase 2 step 11).
 *
 * Three things have to be true: every required field is filled, the owner's
 * agreement template exists as a file, and a person approves the cover email.
 * The template is the piece we do not have yet - the real ESA as a Word file
 * with its variable fields - so until it is uploaded this refuses and says so,
 * rather than inventing an agreement of our own.
 *
 * Sending starts two clocks: the first chase, and the two weeks after which an
 * unsigned agreement is given up on.
 */
export async function sendAgreement(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));
  const row = esa as NonNullable<typeof esa>;

  if (!canMoveTo(row.state as EsaState, "sent")) back("An agreement in that state cannot be sent.");
  // A client who wanted changes gets the next version, not the same document
  // again: the version number moves, the chase starts from the beginning, and
  // the clocks of the version before it stop (3 Nov).
  const again = row.state === "negotiating";
  // Worked out before the patch: `row` is the record the patch writes to, so
  // reading row.version after it has moved said "version 3" on a version 2
  // (3 Nov, found by walking it).
  const version = again ? row.version + 1 : row.version;
  const problem = problemWithDraft(row.fields);
  if (problem) back(problem);

  // The owner's template, uploaded on the files screen as kind "Agreement,
  // drafted". Without it there is no document to attach, and a cover email
  // with nothing attached is worse than no email.
  const template = db.files.find((f) => f.kind === "esa_draft" && f.subjectType === null);
  if (!template) {
    back(
      "The agreement template is not here yet. Upload the ESA as a Word file on the Files screen, as \u201cAgreement, drafted\u201d, and this can go.",
    );
  }

  const now = Date.now();

  // The document itself (step 10). The template's holes are filled from the
  // fields, and a hole nothing fills stops the whole thing: the owner's
  // incident is a draft that went to a client with placeholders still in it.
  const templateBytes = await readBytes(template!.key);
  if (!templateBytes) back("The template file is registered but its bytes are gone. Upload it again on the Files screen.");
  const fill = await fillDocx(Buffer.from(templateBytes!), {
    ...row.fields,
    effectiveDate: colomboDateInWords(now),
  });
  const holeProblem = problemWithFill(fill.missing, (key) => ESA_FIELDS.find((f) => f.key === key)?.label ?? key);
  if (holeProblem) back(holeProblem);

  const base = "Agreement - " + safeName(String(row.fields.companyName ?? "client")) + " - v" + (again ? row.version + 1 : row.version);
  const wordKey = keyFor("esa_draft", "esa", esaId, base + ".docx", now);
  await putBytes(wordKey, fill.bytes!, mimeFor(base + ".docx"));
  const wordFile = await addFile({
    kind: "esa_draft",
    key: wordKey,
    name: base + ".docx",
    size: fill.bytes!.byteLength,
    mime: mimeFor(base + ".docx"),
    sha256: sha256(fill.bytes!),
    subjectType: "esa",
    subjectId: esaId,
    madeFrom: template!.id,
    uploadedBy: member.id,
  });

  // A client gets the PDF, never the Word file: a Word file can be edited by
  // whoever receives it. No LibreOffice means no agreement goes out from here,
  // which is the right answer on a laptop.
  const pdf = await docxToPdf(fill.bytes!, base + ".docx");
  if (!pdf.ok) back("The agreement was filled in but no PDF could be made. " + (pdf.reason ?? ""));
  const pdfKey = keyFor("esa_draft", "esa", esaId, base + ".pdf", now);
  await putBytes(pdfKey, pdf.bytes!, "application/pdf");
  const pdfFile = await addFile({
    kind: "esa_draft",
    key: pdfKey,
    name: base + ".pdf",
    size: pdf.bytes!.byteLength,
    mime: "application/pdf",
    sha256: sha256(pdf.bytes!),
    subjectType: "esa",
    subjectId: esaId,
    madeFrom: wordFile.id,
    uploadedBy: member.id,
  });

  const cover = templateFor(db, "esa.cover");
  const to = String(row.fields.signatoryEmail ?? "").trim();
  const message = await draftMessage({
    channel: "email",
    to: [to],
    attachmentFileIds: [pdfFile.id],
    subject: cover?.subject?.replace("{{client}}", row.fields.companyName ?? "") || "Our agreement",
    body:
      (cover?.body ?? "Dear {{contact}},\n\nOur agreement is attached.\n\nKind regards,\nCareer 141")
        .replace("{{contact}}", row.fields.signatoryName ?? "")
        .replace("{{client}}", row.fields.companyName ?? ""),
    templateKey: "esa.cover",
    subjectType: "esa",
    subjectId: esaId,
  });

  const days = numberOf(db, "esa.declineDays", 14);
  if (again) await cancelClocksFor(db, "esa", esaId, member.id, "A new version of the agreement is going out.");
  await patchAgreement(
    esaId,
    {
      state: "sent",
      version,
      draftFileId: pdfFile.id,
      chaseStep: 0,
      sentAt: now,
      sentMessageId: message.id,
      expiresAt: esaExpiresAt(now, days),
    },
    member.id,
    again ? "esa.sentAgain" : "esa.sent",
    again ? "Version " + version : null,
  );

  // The company becomes a record of its own the moment an agreement is out:
  // onboarding, not yet a client we work for.
  const theirLead = leadIn(db, row.leadId);
  if (theirLead) await clientFromLead(db, theirLead, "onboarding", member.id);

  const first = nextChaseAt(0, now);
  if (first) {
    await startTimer({
      kind: "esa.chase",
      subjectType: "esa",
      subjectId: esaId,
      startsAt: now,
      dueAt: first.dueAt,
      warnAt: null,
      ownerId: member.id,
      payload: { label: String(row.fields.companyName ?? ""), step: String(first.step) },
    });
  }
  await startTimer({
    kind: "esa.decline",
    subjectType: "esa",
    subjectId: esaId,
    startsAt: now,
    dueAt: esaExpiresAt(now, days),
    warnAt: null,
    ownerId: member.id,
    payload: { label: String(row.fields.companyName ?? "") },
  });

  revalidatePath(here);
  redirect(
    "/messages/" +
      message.id +
      "?msg=" +
      encodeURIComponent(
        again
          ? "Version " + version + " is drafted, with the two weeks and the chase starting again. Read it, then approve it."
          : "The cover email is drafted. Read it, then approve it to send.",
      ),
  );
}

/**
 * They want changes (15, Phase 2 step 16).
 *
 * The chase stops, because a client who is talking to us is not a client who
 * is ignoring us, and a meeting goes on the owner's list so the terms are
 * agreed by a person and written down. The two weeks keep running: they are
 * the outer limit from sending, and if they run out somebody decides.
 */
export async function recordChangesWanted(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));
  const row = esa as NonNullable<typeof esa>;

  const what = String(formData.get("what") ?? "").trim();
  const problem = problemWithChanges(what);
  if (problem) back(problem);
  if (!canMoveTo(row.state as EsaState, "negotiating")) back("An agreement in that state is not being negotiated.");

  await patchAgreement(esaId, { state: "negotiating", reason: what }, member.id, "esa.negotiating", what);
  const stopped = await cancelClocksFor(db, "esa", esaId, member.id, "The client wants changes.", ["esa.chase"]);
  await createTask({
    kind: "record",
    title: "Agree the changes: " + String(row.fields.companyName ?? "a client"),
    body:
      "They want changes before signing: " +
      what +
      "\n\nAgree the terms with them, write them into the fields, then send the next version.",
    assigneeId: row.ownerId,
    dueAt: Date.now(),
    subjectType: "esa",
    subjectId: esaId,
    link: "/leads/" + row.leadId,
  });
  revalidatePath(here);
  back(
    stopped
      ? "Noted, and the chasing has stopped. Change the fields, then send the next version."
      : "Noted. Change the fields, then send the next version.",
  );
}

/**
 * Drafts the next chase (15, Phase 2 step 13).
 *
 * The plan is the owner's: email, WhatsApp, email, WhatsApp, email, then a
 * call by a person. Each one is drafted for approval, never sent on its own,
 * and a reply from the client stops the rest.
 */
export async function draftNextChase(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));

  // The drafting itself is in `chaseTheAgreement`, because the clock does
  // exactly the same thing when it fires (3 Nov). This is only the door.
  const answer = await chaseTheAgreement(esaId, member.id);
  revalidatePath(here);
  if (!answer.ok || !answer.messageId) back(answer.what);
  redirect("/messages/" + answer.messageId + "?msg=" + encodeURIComponent(answer.what));
}

/**
 * The signed copy came back (15, Phase 2 step 15).
 *
 * A copy came back unsealed once and had to be resent, so this asks for the
 * file and for somebody to say they looked at it. Everyone who needs to know
 * is told the same day - that is the fix for a signed agreement reaching the
 * Director months later - and the countersign clock starts.
 */
export async function recordAgreementSigned(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));
  const row = esa as NonNullable<typeof esa>;

  const fileId = String(formData.get("fileId") ?? "").trim() || null;
  const problem = problemWithSigned({ fileId, checked: formData.get("checked") === "on" });
  if (problem) back(problem);
  if (!canMoveTo(row.state as EsaState, "signed")) back("An agreement in that state cannot be marked signed.");

  const now = Date.now();
  await patchAgreement(esaId, { state: "signed", signedAt: now, signedFileId: fileId }, member.id, "esa.signed", null);
  // Every clock on it stops, not only the chases: the two-week "nobody has
  // signed" clock kept running and would have fired on a signed agreement.
  await cancelClocksFor(db, "esa", esaId, member.id, "The agreement is signed.");

  const company = String(row.fields.companyName ?? "a client");
  for (const person of db.members.filter((m) => m.active && ["ops_lead", "director_ops", "ta_lead_ro"].includes(m.role))) {
    await createTask({
      kind: "check",
      title: "Agreement signed: " + company,
      body: "The client has signed. The Director countersigns next, and the search can be set up.",
      assigneeId: person.id,
      dueAt: now,
      subjectType: "esa",
      subjectId: esaId,
      link: "/leads/" + row.leadId,
    });
  }

  await startTimer({
    kind: "esa.countersign",
    subjectType: "esa",
    subjectId: esaId,
    startsAt: now,
    dueAt: now + numberOf(db, "esa.countersignDays", 1) * 24 * HOUR,
    warnAt: null,
    ownerId: member.id,
    payload: { label: company },
  });

  revalidatePath(here);
  back("Signed. Everyone has been told, and the Director has a day to countersign.");
}

/** The Director countersigned; the client gets their copy back (step 18). */
export async function recordAgreementCountersigned(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));
  const row = esa as NonNullable<typeof esa>;

  const fileId = String(formData.get("fileId") ?? "").trim() || null;
  if (!fileId) back("Upload the countersigned copy first, on the Files screen.");
  if (!canMoveTo(row.state as EsaState, "countersigned")) back("That agreement is not waiting to be countersigned.");

  const now = Date.now();
  await patchAgreement(
    esaId,
    { state: "countersigned", countersignedAt: now, countersignedFileId: fileId },
    member.id,
    "esa.countersigned",
    null,
  );
  await cancelClocksFor(db, "esa", esaId, member.id, "The agreement is countersigned.");
  await patchLead(row.leadId, { state: "requirement" }, member.id, "lead.agreementDone", null);
  // Signed by both: they are a client we work for, and everything from the
  // requirement meeting on hangs off this record.
  const signedLead = leadIn(db, row.leadId);
  if (signedLead) {
    await clientFromLead(db, { ...signedLead, clientTaId: row.clientTaId ?? signedLead.clientTaId }, "active", member.id);
    revalidatePath("/clients");
  }

  const message = await draftMessage({
    channel: "email",
    to: [String(row.fields.signatoryEmail ?? "").trim()],
    subject: "Our countersigned agreement",
    body:
      "Dear " +
      String(row.fields.signatoryName ?? "") +
      ",\n\nOur countersigned agreement is attached. We will come back to you to arrange the requirement meeting.\n\nKind regards\nCareer 141",
    templateKey: "esa.countersigned.cover",
    subjectType: "esa",
    subjectId: esaId,
  });

  revalidatePath(here);
  redirect(
    "/messages/" + message.id + "?msg=" + encodeURIComponent("Countersigned. Their copy is drafted — approve it to send it back."),
  );
}

/** Declined, by them or by us. The search is blocked and everyone is told (step 17). */
export async function declineAgreement(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const esaId = String(formData.get("esaId") ?? "");
  const db = await desk();
  const esa = agreementIn(db, esaId);
  const here = "/leads/" + (esa?.leadId ?? "");
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  if (!esa) redirect("/leads?msg=" + encodeURIComponent("That agreement is gone."));
  const row = esa as NonNullable<typeof esa>;

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 4) back("Write why it is declined. Nothing closes without a reason.");

  await patchAgreement(esaId, { state: "declined", reason }, member.id, "esa.declined", reason);
  await cancelClocksFor(db, "esa", esaId, member.id, "The agreement is declined.");
  await patchLead(
    row.leadId,
    { state: "closed_other", reason: "No signed agreement: " + reason },
    member.id,
    "lead.closedNoAgreement",
    reason,
  );
  for (const person of db.members.filter((m) => m.active && ["ops_lead", "ta_lead_ro"].includes(m.role))) {
    await createTask({
      kind: "check",
      title: "No agreement: " + String(row.fields.companyName ?? "a client"),
      body: "The agreement is declined, so no work starts for this client. " + reason,
      assigneeId: person.id,
      dueAt: Date.now(),
      subjectType: "esa",
      subjectId: esaId,
      link: "/leads/" + row.leadId,
    });
  }
  revalidatePath(here);
  revalidatePath("/leads");
  back("Declined, and the team has been told the search is blocked.");
}

/** The bytes of the files a message carries, in the order they were added. */
async function filesFor(
  db: Awaited<ReturnType<typeof desk>>,
  fileIds: string[],
): Promise<{ name: string; mime: string; bytes: Uint8Array }[]> {
  const out: { name: string; mime: string; bytes: Uint8Array }[] = [];
  for (const fileId of fileIds ?? []) {
    const file = fileIn(db, fileId);
    if (!file) continue;
    const bytes = await readBytes(file.key);
    if (!bytes) continue;
    out.push({ name: file.name, mime: file.mime, bytes });
  }
  return out;
}

/* ── The client record (15, Phase 2 step 19) ─────────────────── */

/**
 * Who we invoice, and which WhatsApp group is theirs.
 *
 * Both of these live in somebody's inbox today, which is why an invoice has
 * gone to the wrong person and a set has been posted in the wrong group.
 */
export async function saveClientDetails(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const clientId = String(formData.get("clientId") ?? "");
  const here = "/clients/" + clientId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  if (!clientIn(db, clientId)) redirect("/clients?msg=" + encodeURIComponent("That client is gone."));

  const details = {
    billingName: String(formData.get("billingName") ?? "").trim(),
    billingEmail: String(formData.get("billingEmail") ?? "").trim(),
    groupName: String(formData.get("groupName") ?? "").trim(),
  };
  const problem = problemWithBilling(details);
  if (problem) back(problem);

  await patchClient(
    clientId,
    { ...details, notes: String(formData.get("notes") ?? "").trim() },
    member.id,
    "client.detailsSaved",
    null,
  );
  revalidatePath(here);
  back("Saved.");
}

/** Live, quiet or finished. Going quiet needs a reason, like closing does. */
export async function moveClientStage(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const clientId = String(formData.get("clientId") ?? "");
  const here = "/clients/" + clientId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const client = clientIn(db, clientId);
  if (!client) redirect("/clients?msg=" + encodeURIComponent("That client is gone."));
  const row = client as NonNullable<typeof client>;

  const to = String(formData.get("stage") ?? "") as ClientStage;
  const reason = String(formData.get("reason") ?? "").trim();
  const problem = problemWithStageMove(row.stage as ClientStage, to, reason);
  if (problem) back(problem);

  await patchClient(clientId, { stage: to, reason: reason || null }, member.id, "client.stageMoved", reason || null);
  revalidatePath(here);
  revalidatePath("/clients");
  back("Moved. " + STAGE_MEANINGS[to] + ".");
}

/**
 * One ops person owns each client, and only the ops lead moves them.
 *
 * The TA System has to be told, because it shows the ops owner beside the
 * client: it goes in the outbox, so a TA System that is down does not stop the
 * move here.
 */
export async function moveClientOwner(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const clientId = String(formData.get("clientId") ?? "");
  const here = "/clients/" + clientId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "task.reassign")) back("Only the ops lead moves a client to another owner.");
  const db = await desk();
  const client = clientIn(db, clientId);
  if (!client) redirect("/clients?msg=" + encodeURIComponent("That client is gone."));
  const row = client as NonNullable<typeof client>;

  const toId = String(formData.get("ownerId") ?? "");
  const to = db.members.find((m) => m.id === toId && m.active);
  if (!to) back("Pick somebody who is here.");
  if (toId === row.ownerId) back("They already own this client.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 4) back("Write why it is moving. The last owner will want to know.");

  await patchClient(clientId, { ownerId: toId }, member.id, "client.ownerMoved", reason);
  await createTask({
    kind: "check",
    title: "You now own " + row.name,
    body: "Moved to you by " + member.name + ": " + reason,
    assigneeId: toId,
    dueAt: Date.now(),
    subjectType: "client",
    subjectId: clientId,
    link: here,
  });
  if (row.taClientId) {
    await queueTaWrite(
      "/integrations/v1/clients/" + row.taClientId,
      { opsOwnerEmail: to?.email ?? "", opsOwnerName: to?.name ?? "" },
      { type: "client", id: clientId },
    );
  }
  revalidatePath(here);
  revalidatePath("/clients");
  back("Moved to " + (to?.name ?? "them") + ", and the TA System will be told.");
}

/* ── The CVs that go to the client (15, Phase 4 steps 3 and 4) ── */

/**
 * Read the set before it goes (step 3).
 *
 * Every prepared CV is fetched from TA once and kept as our own file. The
 * email the client gets has to be reproducible a year later: TA can replace a
 * prepared CV, and what the client actually received must not change with it.
 *
 * A CV already kept is not fetched again. A candidate TA has no prepared CV
 * for is named on the screen rather than quietly dropped.
 */
export async function reviewClientSet(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const setId = String(formData.get("setId") ?? "");
  const here = "/sets/" + setId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) redirect("/sets?msg=" + encodeURIComponent("That set is gone."));
  const row = set as NonNullable<typeof set>;
  if (row.state === "sent") back("That set has gone already.");

  const now = Date.now();
  let fetched = 0;
  const candidates = [];
  for (const who of row.candidates) {
    if (who.fileId && fileIn(db, who.fileId)) {
      candidates.push(who);
      continue;
    }
    const answer = await preparedCv(who.applicationTaId);
    if (!answer.ok) {
      candidates.push({ ...who, fileId: null, problem: answer.reason });
      continue;
    }
    const name = safeName(who.name) + " - Career 141.pdf";
    const key = keyFor("cv", "clientSet", setId, name, now);
    await putBytes(key, answer.data.bytes, answer.data.mime);
    const kept = await addFile({
      kind: "cv",
      key,
      name,
      size: answer.data.bytes.byteLength,
      mime: answer.data.mime,
      sha256: sha256(answer.data.bytes),
      subjectType: "clientSet",
      subjectId: setId,
      madeFrom: null,
      uploadedBy: member.id,
    });
    fetched += 1;
    candidates.push({ ...who, fileId: kept.id, problem: null });
  }

  await patchClientSet(
    setId,
    { candidates, state: row.state === "ready" ? "reviewing" : row.state },
    member.id,
    "clientSet.reviewed",
    null,
  );
  revalidatePath(here);
  const missing = candidates.filter((c) => !c.fileId).length;
  back(
    (fetched ? fetched + (fetched === 1 ? " CV" : " CVs") + " kept. " : "Nothing new to fetch. ") +
      (missing ? missing + " still has no CV; see below." : "Every CV is here."),
  );
}

/**
 * Send the set to the client (step 4).
 *
 * It goes to the client's own people - whoever TA has marked "hr" - with the
 * ops owner copied, as a drafted email a person approves. The CVs travel with
 * it. The clock the client's seven working days run on starts from the day
 * they received it, which defaults to today and can be corrected.
 *
 * TA is told the round has gone, through the outbox, so a TA System that is
 * down does not stop the client being served.
 */
export async function sendClientSet(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const setId = String(formData.get("setId") ?? "");
  const here = "/sets/" + setId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) redirect("/sets?msg=" + encodeURIComponent("That set is gone."));
  const row = set as NonNullable<typeof set>;
  if (!canMoveSetTo(row.state as SetState, "sent")) back("A set in that state cannot be sent.");

  const answer = await taClients(row.clientTaId ? row.name.split(" > ")[0] : "");
  const theirs = answer.ok ? answer.data.find((c) => c.id === row.clientTaId) : undefined;
  const to = (theirs?.contacts ?? [])
    .filter((c) => (c.role ?? "").toLowerCase() === "hr" && c.email.trim())
    .map((c) => c.email.trim());

  const problem = problemWithSending(row.candidates, to, numberOf(db, "set.minCvs", MIN_CVS));
  if (problem) back(problem);

  // The owner's hold at five (step 15): a client already sitting on five
  // shortlisted gets no sixth CV, because that is how a client stops reading
  // them. The ops lead can override it, and the override goes to the audit.
  const held = problemWithAnotherSet(
    positionForSet(db, row)?.depthStage ?? null,
    numberOf(db, "depth.holdAt", HOLD_AT),
  );
  if (held && !can(member, "task.reassign")) back(held);

  const wording = templateFor(db, "set.cover");
  const fill = (text: string) =>
    text
      .replace(/\{\{client\}\}/g, theirs?.name ?? row.name.split(" > ")[0])
      .replace(/\{\{position\}\}/g, row.role)
      .replace(/\{\{setNumber\}\}/g, String(row.setNumber))
      .replace(/\{\{cvCount\}\}/g, String(row.candidates.length))
      .replace(/\{\{contact\}\}/g, (theirs?.contacts ?? []).find((c) => (c.role ?? "") === "hr")?.name ?? "all")
      .replace(/\{\{opsPerson\}\}/g, member.name);

  const message = await draftMessage({
    channel: "email",
    to,
    subject: fill(wording?.subject ?? "{{client}} > {{position}} > SET {{setNumber}}"),
    body: fill(wording?.body ?? "Dear {{contact}},\n\n{{cvCount}} CVs are attached.\n\nKind regards\nCareer 141"),
    templateKey: "set.cover",
    subjectType: "clientSet",
    subjectId: setId,
    attachmentFileIds: row.candidates.map((c) => c.fileId).filter((id): id is string => id !== null),
  });

  const now = Date.now();
  await patchClientSet(
    setId,
    { state: "sent", sentAt: now, sentMessageId: message.id, sentTo: to, receivedAt: now },
    member.id,
    "clientSet.sent",
    held ? "The ops lead sent it anyway: " + held : null,
  );
  await cancelClocksFor(db, "clientSet", setId, member.id, "The set has gone.", ["set.due"]);
  // Everything after a set counts from the day the client received it (step 6):
  // seven working days of CV ownership, the feedback chase, the two weeks before
  // a hold, and the three months before an unreported hire is asked about.
  await startReceiptClocks(db, { ...row, state: "sent", receivedAt: now }, now);

  // The client's WhatsApp group (step 13). Nothing can post to a WhatsApp
  // group - Meta's API cannot write to one - so the text is drafted and a
  // person posts it from their phone. If the group does not exist yet, making
  // it is the task the first set leaves behind.
  const client = db.clients.find((c) => c.taClientId === row.clientTaId) ?? null;
  const groupWording = templateFor(db, "set.group_post");
  const post = await draftMessage({
    channel: "group_post",
    to: client?.groupName.trim() ? [client.groupName.trim()] : [],
    subject: "",
    body: fill(
      groupWording?.body ?? "{{client}} > {{position}} > SET {{setNumber}}\n\n{{cvCount}} CVs are in your email.",
    ),
    templateKey: "set.group_post",
    subjectType: "clientSet",
    subjectId: setId,
  });
  if (!client?.groupName.trim()) {
    await createTask({
      kind: "check",
      title: "Make the WhatsApp group: " + (client?.name ?? theirs?.name ?? row.name.split(" > ")[0]),
      body:
        "The first set has gone, so the group is made now and the set posted in it. The post is already drafted and waiting.\n\n" +
        "Then write the group's name on the client's page, so the next set's post knows where it goes.",
      assigneeId: row.ownerId,
      dueAt: now,
      subjectType: "clientSet",
      subjectId: setId,
      link: "/messages/" + post.id,
    });
  }

  await queueTaWrite(
    "/integrations/v1/client-sets/" + row.taRoundId + "/sent",
    { sentAt: now, receivedAt: now, sentTo: to },
    { type: "clientSet", id: setId },
  );
  revalidatePath(here);
  revalidatePath("/sets");
  redirect(
    "/messages/" +
      message.id +
      "?msg=" +
      encodeURIComponent(
        "The set is drafted with " +
          row.candidates.length +
          " CVs attached. Read it, then approve it. The group post is drafted too." +
          (held ? " The hold at five was overridden." : ""),
      ),
  );
}

/** The client got it on a different day; the clocks after it count from this. */
export async function recordSetReceived(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const setId = String(formData.get("setId") ?? "");
  const here = "/sets/" + setId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) redirect("/sets?msg=" + encodeURIComponent("That set is gone."));
  const row = set as NonNullable<typeof set>;

  const when = Date.parse(String(formData.get("receivedAt") ?? "") + ":00+05:30");
  if (!Number.isFinite(when)) back("Give the day and time they received it.");
  if (when > Date.now() + HOUR) back("That is in the future.");
  if (row.sentAt && when < row.sentAt - HOUR) back("They cannot have received it before it was sent.");

  await patchClientSet(setId, { receivedAt: when }, member.id, "clientSet.received", null);
  revalidatePath(here);
  back("Noted. Everything after this counts from then.");
}

/**
 * Take a candidate out of the set (15, Phase 4 step 3).
 *
 * The usual reason is that TA has no prepared CV for them, and the set must
 * not wait for one. Taking them out needs a reason, like everything else that
 * drops somebody, and the set still has to hold the minimum afterwards.
 */
export async function dropFromClientSet(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const setId = String(formData.get("setId") ?? "");
  const who = String(formData.get("applicationTaId") ?? "");
  const here = "/sets/" + setId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) redirect("/sets?msg=" + encodeURIComponent("That set is gone."));
  const row = set as NonNullable<typeof set>;
  if (row.state === "sent") back("That set has gone already; this one is history.");

  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 4) back("Write why they are coming out of the set.");
  const taken = row.candidates.find((c) => c.applicationTaId === who);
  if (!taken) back("Nobody in this set by that id.");

  // Worked out before the patch: the store hands back the same record the
  // patch writes to, so counting afterwards counts the new list and the
  // message said "short of 5" about a set of exactly five (3 Nov).
  const left = row.candidates.filter((c) => c.applicationTaId !== who);
  const minimum = numberOf(db, "set.minCvs", MIN_CVS);
  await patchClientSet(
    setId,
    { candidates: left },
    member.id,
    "clientSet.candidateDropped",
    (taken?.name ?? who) + ": " + reason,
  );
  revalidatePath(here);
  back(
    (taken?.name ?? "They") +
      " is out of this set. " +
      (left.length < minimum
        ? "It is now short of " + minimum + ", so it cannot go until TA adds somebody."
        : "The set can still go: " + left.length + " CVs."),
  );
}

/* ── After the set has gone (15, Phase 4 steps 7 to 13) ──────── */

/**
 * The client says they already had this candidate (step 7).
 *
 * Inside the seven working days we take their word and the candidate comes out
 * of the set — their record against ours, and arguing costs more than the fee.
 * After the window it is refused, which is the whole point of counting it. The
 * reply is drafted either way, and TA is told when a candidate becomes theirs.
 */
export async function recordCvClaim(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const setId = String(formData.get("setId") ?? "");
  const who = String(formData.get("applicationTaId") ?? "");
  const here = "/sets/" + setId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) redirect("/sets?msg=" + encodeURIComponent("That set is gone."));
  const row = set as NonNullable<typeof set>;
  if (row.receivedAt === null) back("We do not know when they received this set, so the window cannot be counted.");

  const taken = row.candidates.find((c) => c.applicationTaId === who);
  if (!taken) back("Nobody in this set by that id.");
  if (taken?.claimedAt) back("That claim is already recorded.");

  const now = Date.now();
  const window = ownershipWindow(
    row.receivedAt as number,
    db.holidays.map((h) => h.date),
    numberOf(db, "set.ownershipWorkingDays", OWNERSHIP_WORKING_DAYS),
  );
  const answer = claimVerdict(window.closesAt, now);
  const client = row.clientId ? clientIn(db, row.clientId) : null;

  const candidates = row.candidates.map((c) =>
    c.applicationTaId === who
      ? { ...c, claimedAt: now, claimVerdict: answer.verdict, claimReason: answer.because }
      : c,
  );
  await patchClientSet(setId, { candidates }, member.id, "clientSet.claim." + answer.verdict, answer.because);

  // Their candidate now, so TA must know: the search must not keep working on
  // somebody the client owns.
  if (answer.verdict === "dropped") {
    await queueTaWrite(
      "/integrations/v1/applications/" + who + "/client-owned",
      { claimedAt: now, setId, because: answer.because },
      { type: "clientSet", id: setId },
    );
  }

  const wording = templateFor(db, answer.templateKey);
  const fill = (text: string) =>
    text
      .replace(/\{\{client\}\}/g, client?.name ?? row.name.split(" > ")[0])
      .replace(/\{\{position\}\}/g, row.role)
      .replace(/\{\{setNumber\}\}/g, String(row.setNumber))
      .replace(/\{\{candidate\}\}/g, taken?.name ?? "the candidate")
      .replace(/\{\{closedOn\}\}/g, colomboDateInWords(window.closesAt))
      .replace(/\{\{contact\}\}/g, "all")
      .replace(/\{\{opsPerson\}\}/g, member.name);

  const message = await draftMessage({
    channel: "email",
    to: row.sentTo,
    subject: fill(wording?.subject ?? "{{client}} > {{position}} > SET {{setNumber}}"),
    body: fill(wording?.body ?? "Dear all,"),
    templateKey: answer.templateKey,
    subjectType: "clientSet",
    subjectId: setId,
  });
  revalidatePath(here);
  redirect(
    "/messages/" +
      message.id +
      "?msg=" +
      encodeURIComponent(
        answer.verdict === "dropped"
          ? "Recorded as theirs, and the TA System will be told. The reply is drafted - read it, then approve it."
          : "Recorded as refused: the window had closed. The reply is drafted - read it before it goes.",
      ),
  );
}

/**
 * What the client decided about one candidate (step 9).
 *
 * Typed in by a person for now, from a group message, a call or an email. The
 * reason is the client's own words, which is what the owner's rule means, and
 * TA is told so it can move the stage and send its own rejection notice.
 */
export async function recordClientDecision(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const setId = String(formData.get("setId") ?? "");
  const who = String(formData.get("applicationTaId") ?? "");
  const here = "/sets/" + setId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const set = clientSetIn(db, setId);
  if (!set) redirect("/sets?msg=" + encodeURIComponent("That set is gone."));
  const row = set as NonNullable<typeof set>;

  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const problem = problemWithDecision(decision, reason);
  if (problem) back(problem);
  if (!row.candidates.some((c) => c.applicationTaId === who)) back("Nobody in this set by that id.");

  const now = Date.now();
  const candidates = row.candidates.map((c) =>
    c.applicationTaId === who ? { ...c, decision, decisionReason: reason, decidedAt: now } : c,
  );
  await patchClientSet(setId, { candidates }, member.id, "clientSet.decision." + decision, reason);

  // The client has spoken, so nothing about this set is chased any more.
  const stopped = await cancelClocksFor(db, "clientSet", setId, member.id, "The client has answered.", [
    "feedback.chase",
    "feedback.call",
    "silence.hold",
  ]);

  await queueTaWrite(
    "/integrations/v1/applications/" + who + "/client-decision",
    { decision, reason, decidedAt: now, setId, roundId: row.taRoundId },
    { type: "clientSet", id: setId },
  );

  // Every decision changes how deep the client's shortlist is, which is what
  // the owner's two rules turn on (steps 14 and 15). It is counted here, from
  // TA's own pipeline, rather than remembered by anybody.
  const position = positionForSet(db, row);
  const depth = position ? await evaluateDepth(position.id, now) : null;

  revalidatePath(here);
  revalidatePath("/positions");
  back(
    "Recorded in their words, and the TA System will be told." +
      (depth?.ok ? " " + depth.what : "") +
      (stopped ? " " + stopped + (stopped === 1 ? " clock" : " clocks") + " stopped: they have answered." : ""),
  );
}

/**
 * Approve the hold, which is what puts it on (step 12).
 *
 * The notice to the client is drafted here, and the position only counts as
 * held once a person has approved it. The thirty-day review starts at the same
 * time, because the owner's rule is that a hold never closes by itself.
 */
export async function approveTheHold(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const holdId = String(formData.get("holdId") ?? "");
  const here = "/holds/" + holdId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const hold = holdIn(db, holdId);
  if (!hold) redirect("/holds?msg=" + encodeURIComponent("That hold is gone."));
  const row = hold as NonNullable<typeof hold>;
  if (row.state !== "proposed") back("That hold is not waiting to be approved.");

  const reason = String(formData.get("reason") ?? "").trim() || row.reason;
  const problem = problemWithHold(reason);
  if (problem) back(problem);

  const set = row.setId ? clientSetIn(db, row.setId) : null;
  const client = row.clientId ? clientIn(db, row.clientId) : null;
  const wording = templateFor(db, "inactive.notice");
  const fill = (text: string) =>
    text
      .replace(/\{\{client\}\}/g, client?.name ?? "")
      .replace(/\{\{position\}\}/g, set?.role ?? "the role")
      .replace(/\{\{contact\}\}/g, "all")
      .replace(/\{\{opsPerson\}\}/g, member.name);

  const message = await draftMessage({
    channel: "email",
    to: set?.sentTo ?? [],
    subject: fill(wording?.subject ?? "{{client}} > {{position}} - on hold"),
    body: fill(wording?.body ?? "Dear all,"),
    templateKey: "inactive.notice",
    subjectType: "hold",
    subjectId: holdId,
  });

  const now = Date.now();
  await patchHold(
    holdId,
    {
      state: "on_hold",
      reason,
      heldAt: now,
      noticeMessageId: message.id,
      reviewAt: now + numberOf(db, "hold.reviewDays", HOLD_REVIEW_DAYS) * 86_400_000,
    },
    member.id,
    "hold.held",
    reason,
  );
  // TA stops working the opening, and is told why.
  await queueTaWrite(
    "/integrations/v1/openings/" + row.openingTaId + "/status",
    { status: "on_hold", reason: "client inactive: " + reason },
    { type: "hold", id: holdId },
  );
  await startTimer({
    kind: "hold.review",
    subjectType: "hold",
    subjectId: holdId,
    startsAt: now,
    dueAt: now + numberOf(db, "hold.reviewDays", HOLD_REVIEW_DAYS) * 86_400_000,
    warnAt: null,
    ownerId: row.ownerId,
    payload: { label: set?.name ?? row.openingTaId },
  });
  revalidatePath(here);
  revalidatePath("/holds");
  redirect(
    "/messages/" +
      message.id +
      "?msg=" +
      encodeURIComponent("On hold, and the TA System will be told. The notice is drafted - read it, then approve it."),
  );
}

/** The client came back, or somebody decided: the search is on again (step 13). */
export async function liftTheHold(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const holdId = String(formData.get("holdId") ?? "");
  const here = "/holds/" + holdId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));
  const db = await desk();
  const hold = holdIn(db, holdId);
  if (!hold) redirect("/holds?msg=" + encodeURIComponent("That hold is gone."));
  const row = hold as NonNullable<typeof hold>;
  if (row.state === "lifted") back("That hold is already lifted.");

  const reason = String(formData.get("reason") ?? "").trim();
  const problem = problemWithLift(reason);
  if (problem) back(problem);

  const now = Date.now();
  await patchHold(
    holdId,
    { state: "lifted", liftedReason: reason, liftedAt: now, reviewAt: null },
    member.id,
    "hold.lifted",
    reason,
  );
  await cancelClocksFor(db, "hold", holdId, member.id, "The hold is lifted.");
  await queueTaWrite(
    "/integrations/v1/openings/" + row.openingTaId + "/status",
    { status: "open", reason: "hold lifted: " + reason },
    { type: "hold", id: holdId },
  );
  // The feedback chase starts again from today, as it would after a new set.
  const set = row.setId ? clientSetIn(db, row.setId) : null;
  if (set) {
    await startTimer({
      kind: "feedback.chase",
      subjectType: "clientSet",
      subjectId: set.id,
      startsAt: now,
      dueAt: now + numberOf(db, "feedback.chaseDays", 1) * 86_400_000,
      warnAt: null,
      ownerId: set.ownerId,
      payload: { label: set.name },
    });
  }
  revalidatePath(here);
  revalidatePath("/holds");
  back("Lifted. The TA System will be told, and the feedback chase starts again from today.");
}

/* ── The requirement, and handing it to TA (15, Phase 3) ─────── */

/**
 * Book the requirement meeting (step 2).
 *
 * The same machinery as the intro call - a TA lead on it, two reminders, three
 * unanswered attempts closing the lead - because it is the same kind of
 * meeting with a different purpose. The owner's rule: no work starts on a
 * position until this has actually happened.
 */
export async function bookRequirementMeeting(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const lead = leadIn(db, leadId);
  if (!lead) back("That lead is gone.");
  const row = lead as NonNullable<typeof lead>;

  const esa = agreementForLead(db, leadId);
  if (esa?.state !== "signed" && esa?.state !== "countersigned") {
    back("No requirement meeting until the agreement is signed: that is where the search begins.");
  }

  const at = Date.parse(String(formData.get("at") ?? "") + ":00+05:30");
  const taLeadId = String(formData.get("taLeadId") ?? "");
  const problem = problemWithBooking({ at, taLeadId }, Date.now());
  if (problem) back(problem);

  const meeting = await addMeeting({
    leadId,
    kind: "requirement",
    at,
    state: "booked",
    taLeadId,
    rebookCount: 0,
    brief: "",
    role: "",
    packageSaid: "",
    reason: null,
    bookedBy: member.id,
    heldAt: null,
  });

  for (const reminder of remindersFor(at, Date.now())) {
    await startTimer({
      kind: reminder.kind,
      subjectType: "meeting",
      subjectId: meeting.id,
      startsAt: Date.now(),
      dueAt: reminder.dueAt,
      warnAt: null,
      ownerId: row.ownerId,
      payload: { label: row.company + ", the requirement meeting" },
    });
  }
  await queueTaWrite(
    "/integrations/v1/notify",
    {
      toUserId: taLeadId,
      title: "Requirement meeting booked: " + row.company,
      body: "The client has signed. The requirement meeting is on " + colomboDateInWords(at) + ".",
    },
    { type: "meeting", id: meeting.id },
  );

  const warning = warningAboutBooking(at, db.holidays.map((h) => h.date));
  revalidatePath(here);
  back("Booked, with a reminder the day before and an hour before." + (warning ? " " + warning : ""));
}

/**
 * Write down what the client asked for (step 3).
 *
 * Saved whether or not it is complete, because a half-written requirement is
 * still better than a remembered one - but it cannot be handed to TA until
 * every required field is in, and the screen names what is missing.
 */
export async function saveRequirement(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const lead = leadIn(db, leadId);
  if (!lead) back("That lead is gone.");
  const row = lead as NonNullable<typeof lead>;

  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("field.")) fields[key.slice("field.".length)] = String(value).trim();
  }

  const already = requirementForLead(db, leadId);
  const client = db.clients.find((c) => c.leadId === leadId) ?? null;
  const held = meetingsForLead(db, leadId).find((m) => m.kind === "requirement" && m.state === "held") ?? null;

  if (already) {
    await patchRequirement(already.id, { fields }, member.id, "requirement.saved", null);
  } else {
    await addRequirement({
      leadId,
      clientId: client?.id ?? null,
      clientTaId: row.clientTaId ?? client?.taClientId ?? "",
      meetingId: held?.id ?? null,
      version: 1,
      fields,
      practical: true,
      reason: null,
      inviteBackAt: null,
      openedAt: null,
      ownerId: row.ownerId,
    });
  }
  revalidatePath(here);
  const problem = problemWithRequirement(fields);
  back(problem ? "Saved. " + problem : "Saved. It can go to the TA System now.");
}

/**
 * The role cannot be filled at that package (step 4).
 *
 * A polite reply is drafted, the lead closes with its reason, and a date is
 * set to ask them again - because a salary that is wrong today is often right
 * next year, and the board's complaint is that we simply never went back.
 */
export async function markRoleImpractical(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const lead = leadIn(db, leadId);
  if (!lead) back("That lead is gone.");
  const row = lead as NonNullable<typeof lead>;

  const reason = String(formData.get("reason") ?? "").trim();
  const inviteBackAt = Date.parse(String(formData.get("inviteBackAt") ?? "") + "T09:00:00+05:30");
  const now = Date.now();
  const problem = problemWithImpractical(reason, Number.isFinite(inviteBackAt) ? inviteBackAt : null, now);
  if (problem) back(problem);

  const requirement = requirementForLead(db, leadId);
  if (requirement) {
    await patchRequirement(
      requirement.id,
      { practical: false, reason, inviteBackAt },
      member.id,
      "requirement.impractical",
      reason,
    );
  }

  const wording = templateFor(db, "role.impractical.reply");
  const message = await draftMessage({
    channel: "email",
    to: [row.contactEmail].filter(Boolean),
    subject: (wording?.subject ?? "{{client}} · the role we discussed").replace(/\{\{client\}\}/g, row.company),
    body: (wording?.body ?? ["Dear {{contact}},", "", "Thank you for your time.", "", "Kind regards", "Career 141"].join("\n"))
      .replace(/\{\{contact\}\}/g, row.contactName)
      .replace(/\{\{client\}\}/g, row.company),
    templateKey: "role.impractical.reply",
    subjectType: "lead",
    subjectId: leadId,
  });

  await patchLead(leadId, { state: "closed_other", reason: "Role not practical: " + reason }, member.id, "lead.closedImpractical", reason);
  await startTimer({
    kind: "lead.inviteBack",
    subjectType: "lead",
    subjectId: leadId,
    startsAt: now,
    dueAt: inviteBackAt,
    warnAt: null,
    ownerId: row.ownerId,
    payload: { label: row.company },
  });
  revalidatePath(here);
  revalidatePath("/leads");
  redirect(
    "/messages/" +
      message.id +
      "?msg=" +
      encodeURIComponent(
        "Closed with its reason, and we will be asked to invite them back on " + colomboDateInWords(inviteBackAt) + ". The reply is drafted - read it before it goes.",
      ),
  );
}

/**
 * Hand the requirement to the TA System (step 6).
 *
 * Two refusals first, and they are the point of the whole phase: no opening
 * before the agreement is signed, and no opening from a half-written
 * requirement. Then the write is **queued** - Ops never creates an opening
 * itself and never invents TA's id for it. TA's own `opening.created` event
 * fills the id in, which is also how a TA creating one by hand is noticed.
 */
export async function handOverToTa(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const leadId = String(formData.get("leadId") ?? "");
  const here = "/leads/" + leadId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const lead = leadIn(db, leadId);
  if (!lead) back("That lead is gone.");
  const row = lead as NonNullable<typeof lead>;
  const requirement = requirementForLead(db, leadId);
  if (!requirement) back("Write the requirement down first.");
  const req = requirement as NonNullable<typeof requirement>;
  if (req.openedAt) back("This requirement has already gone to the TA System.");

  const esa = agreementForLead(db, leadId);
  const problem = problemWithHandover(esa?.state ?? null, req.fields);
  if (problem) back(problem);

  const client = db.clients.find((c) => c.leadId === leadId) ?? null;
  const now = Date.now();
  const title = (req.fields.title ?? "").trim();

  // Our side of the opening, with no TA id yet: TA answers with that, through
  // its event, and the screen says so plainly in the meantime.
  const position = await addPosition({
    requirementId: req.id,
    clientId: client?.id ?? null,
    clientTaId: req.clientTaId || client?.taClientId || "",
    openingTaId: null,
    title,
    stage: "handed_over",
    primaryTaId: String(formData.get("primaryTaId") ?? "") || null,
    hundredPercentDay: String(formData.get("hundredPercentDay") ?? "") || null,
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
    ownerId: row.ownerId,
  });

  await queueTaWrite(
    "/integrations/v1/openings",
    {
      clientId: req.clientTaId || client?.taClientId || "",
      title,
      brief: briefText(req.fields),
      headcount: Number(req.fields.headcount ?? 1) || 1,
      level: req.fields.level ?? "",
      locations: req.fields.locations ?? "",
      package: req.fields.salary ?? "",
      primaryRecruiterId: position.primaryTaId,
      hundredPercentDay: position.hundredPercentDay,
      requirementReceivedAt: req.createdAt,
      opsPositionId: position.id,
    },
    { type: "position", id: position.id },
  );

  await patchRequirement(req.id, { openedAt: now }, member.id, "requirement.handedOver", null);
  await patchLead(leadId, { state: "handed_over" }, member.id, "lead.handedOver", null);
  revalidatePath(here);
  revalidatePath("/positions");
  back(
    "Handed over. The opening is queued for the TA System; it appears on the position the moment TA confirms it, and the brief goes exactly as written.",
  );
}

/** The TA lead picks the primary TA and the 100% day; Ops records it (step 5). */
export async function setPositionTeam(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const positionId = String(formData.get("positionId") ?? "");
  const here = "/positions/" + positionId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "client.manage")) back(refusal("client.manage"));

  const db = await desk();
  const position = positionIn(db, positionId);
  if (!position) redirect("/positions?msg=" + encodeURIComponent("That position is gone."));
  const row = position as NonNullable<typeof position>;

  const primaryTaId = String(formData.get("primaryTaId") ?? "").trim() || null;
  const hundredPercentDay = String(formData.get("hundredPercentDay") ?? "").trim() || null;
  if (!primaryTaId && !hundredPercentDay) back("Nothing to change.");

  await patchPosition(
    positionId,
    { primaryTaId: primaryTaId ?? row.primaryTaId, hundredPercentDay: hundredPercentDay ?? row.hundredPercentDay },
    member.id,
    "position.teamSet",
    null,
  );
  // The TA lead's decision belongs in TA, which is where the TAs read it.
  if (row.openingTaId) {
    await queueTaWrite(
      "/integrations/v1/openings/" + row.openingTaId + "/team",
      { primaryRecruiterId: primaryTaId, hundredPercentDay },
      { type: "position", id: positionId },
    );
  }
  revalidatePath(here);
  back(
    row.openingTaId
      ? "Recorded, and the TA System will be told."
      : "Recorded. It goes to the TA System with the opening once TA confirms it.",
  );
}

/* ── Where the job is advertised (15, Phase 3 steps 14 to 16) ── */

/**
 * The LinkedIn post the TA made (step 16).
 *
 * The TA posts it; Ops holds the link, because the TA System will not let an
 * opening go Live without one and because a client asking "where is my role
 * advertised?" is answered from somebody's memory today. A wrong link is worse
 * than none - it looks done - so only a real LinkedIn post address is taken.
 */
export async function recordLinkedInPost(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const positionId = String(formData.get("positionId") ?? "");
  const here = "/positions/" + positionId;
  const back = (msg: string) => redirect(here + "?msg=" + encodeURIComponent(msg));
  if (!can(member, "advert.manage")) back("Recording an advert is for ops or marketing.");
  const db = await desk();
  const position = positionIn(db, positionId);
  if (!position) redirect("/positions?msg=" + encodeURIComponent("That position is gone."));
  const row = position as NonNullable<typeof position>;

  const url = String(formData.get("url") ?? "");
  const problem = problemWithLinkedIn(url);
  if (problem) back(problem);

  const tidy = tidyLinkedIn(url);
  const now = Date.now();
  await patchPosition(
    positionId,
    { linkedInUrl: tidy, linkedInPostedAt: now },
    member.id,
    "position.linkedInRecorded",
    tidy,
  );
  // TA needs it on the opening: that is what unlocks Live on their side.
  if (row.openingTaId) {
    await queueTaWrite(
      "/integrations/v1/openings/" + row.openingTaId + "/posts",
      { channel: "linkedin", url: tidy, postedAt: now },
      { type: "position", id: positionId },
    );
  }
  revalidatePath(here);
  back(
    row.openingTaId
      ? "Recorded, and the TA System will be told - that is what lets the opening go Live."
      : "Recorded. It goes to the TA System with the opening once TA confirms it.",
  );
}

/** Compile this week's Talent Pulse now, rather than waiting for Tuesday. */
export async function compileTalentPulseNow(): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const back = (msg: string) => redirect("/talent-pulse?msg=" + encodeURIComponent(msg));
  if (!can(member, "advert.manage")) back("Talent Pulse is for ops or marketing.");

  const issue = await compileTalentPulse(member.id);
  revalidatePath("/talent-pulse");
  back(
    issue
      ? "This week's issue is ready to fill in: " +
          issue.lines.length +
          (issue.lines.length === 1 ? " position" : " positions") +
          ". Next Tuesday it compiles itself."
      : "Nothing to compile.",
  );
}

/** The TA's line about one role, and where applications for it go. */
export async function saveTalentPulseLine(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const issueId = String(formData.get("issueId") ?? "");
  const positionId = String(formData.get("positionId") ?? "");
  const back = (msg: string) => redirect("/talent-pulse?msg=" + encodeURIComponent(msg));
  if (!can(member, "advert.manage")) back("Talent Pulse is for ops or marketing.");
  const db = await desk();
  const issue = issueIn(db, issueId);
  if (!issue) back("That issue is gone.");
  const row = issue as NonNullable<typeof issue>;
  if (row.state === "posted") back("That issue has been posted; this one is history.");

  const note = String(formData.get("note") ?? "").trim();
  const applyAddress = String(formData.get("applyAddress") ?? "").trim();
  const lines = row.lines.map((l) => (l.positionId === positionId ? { ...l, note, applyAddress } : l));
  if (lines.every((l, i) => l.note === row.lines[i].note && l.applyAddress === row.lines[i].applyAddress)) {
    back("Nothing changed.");
  }

  await patchIssue(issueId, { lines }, member.id, "talentPulse.lineSaved", null);
  revalidatePath("/talent-pulse");
  const left = lines.filter((l) => !l.note).length;
  back(left ? "Saved. " + left + " still with no line." : "Saved. Every role has its line; it can go to marketing.");
}

/** It has gone out. Marketing posts it; Ops records the day it happened. */
export async function markTalentPulsePosted(formData: FormData): Promise<void> {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const issueId = String(formData.get("issueId") ?? "");
  const back = (msg: string) => redirect("/talent-pulse?msg=" + encodeURIComponent(msg));
  if (!can(member, "advert.manage")) back("Talent Pulse is for ops or marketing.");
  const db = await desk();
  const issue = issueIn(db, issueId);
  if (!issue) back("That issue is gone.");
  const row = issue as NonNullable<typeof issue>;
  if (row.state === "posted") back("Already recorded as posted.");

  const problem = problemWithIssue(row.lines);
  if (problem) back(problem);

  await patchIssue(
    issueId,
    { state: "posted", postedAt: Date.now(), postedBy: member.id },
    member.id,
    "talentPulse.posted",
    null,
  );
  revalidatePath("/talent-pulse");
  back("Recorded as posted. Next Tuesday's issue compiles itself.");
}
