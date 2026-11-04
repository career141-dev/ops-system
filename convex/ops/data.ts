import { v } from "convex/values";

import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { messageChannel, taskKind, timerState } from "../schema";

/**
 * The Ops backend, in one module (15, Phase 1).
 *
 * The app reads the whole desk in a single query and writes through named
 * mutations, which is the shape the data allows: these tables are small — the
 * people, the settings, the holidays, the live clocks, the open tasks and the
 * messages waiting. Reading them together is one round trip instead of seven,
 * and it keeps the app's store a thin thing over either this or the JSON file.
 *
 * Every write records who, what, before, after and why, because the rule the
 * owner set for the screens is the same rule underneath them.
 */

const AUDIT_SHOWN = 50;

function row<T extends { _id: unknown; _creationTime: number }>(doc: T): Omit<T, "_id" | "_creationTime"> & { id: string } {
  const { _id, _creationTime, ...rest } = doc;
  return { ...rest, id: _id as string };
}

async function writeAudit(
  ctx: MutationCtx,
  entry: {
    actorId: string | null;
    action: string;
    subjectType: string;
    subjectId: string;
    before?: string | null;
    after?: string | null;
    reason?: string | null;
  },
): Promise<void> {
  await ctx.db.insert("opsAudit", {
    actorId: entry.actorId,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    at: Date.now(),
  });
}

/** Everything a screen needs, in one read. */
export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [members, settings, templates, holidays, timers, tasks, messages, inbound, files, leads, meetings, agreements, clients, clientSets, holds, requirements, positions, talentPulse, calls, baseline, taCalls, outbox, events, audit] =
      await Promise.all([
      ctx.db.query("opsMembers").collect(),
      ctx.db.query("opsSettings").collect(),
      ctx.db.query("opsTemplates").collect(),
      ctx.db.query("opsHolidays").collect(),
      // Finished clocks are history; the screens only ever show the live ones
      // and the ones that fired today.
      ctx.db.query("opsTimers").collect(),
      ctx.db.query("opsTasks").collect(),
      ctx.db.query("opsMessages").collect(),
      ctx.db.query("opsInbound").withIndex("by_received").order("desc").take(100),
      // The newest 200 files: the registry grows for ever, the screen does not.
      ctx.db.query("opsFiles").withIndex("by_uploaded").order("desc").take(200),
      ctx.db.query("opsLeads").withIndex("by_created").order("desc").take(300),
      ctx.db.query("opsMeetings").withIndex("by_at").order("desc").take(300),
      ctx.db.query("opsEsa").collect(),
      ctx.db.query("opsClients").withIndex("by_created").order("desc").take(300),
      ctx.db.query("opsClientSets").withIndex("by_created").order("desc").take(300),
      ctx.db.query("opsHolds").withIndex("by_created").order("desc").take(300),
      ctx.db.query("opsRequirements").withIndex("by_created").order("desc").take(300),
      ctx.db.query("opsPositions").withIndex("by_created").order("desc").take(300),
      ctx.db.query("opsTalentPulse").withIndex("by_created").order("desc").take(60),
      ctx.db.query("opsCalls").withIndex("by_at").order("desc").take(100),
      ctx.db.query("opsBaseline").collect(),
      ctx.db.query("opsTaCalls").withIndex("by_at").order("desc").take(100),
      ctx.db.query("opsOutbox").collect(),
      ctx.db.query("opsEvents").withIndex("by_received").order("desc").take(200),
      ctx.db.query("opsAudit").withIndex("by_at").order("desc").take(AUDIT_SHOWN),
    ]);

    return {
      members: members.map(row),
      settings: settings.map((s: Doc<"opsSettings">) => ({
        key: s.key,
        value: s.value,
        updatedBy: s.updatedBy,
        updatedAt: s.updatedAt,
      })),
      templates: templates.map(row),
      holidays: holidays.map((h: Doc<"opsHolidays">) => ({ date: h.date, name: h.name })),
      timers: timers.map(row),
      tasks: tasks.map(row),
      messages: messages.map(row),
      inbound: inbound.map(row),
      files: files.map(row),
      leads: leads.map(row),
      meetings: meetings.map(row),
      agreements: agreements.map(row),
      clients: clients.map(row),
      clientSets: clientSets.map(row),
      holds: holds.map(row),
      requirements: requirements.map(row),
      positions: positions.map(row),
      talentPulse: talentPulse.map(row),
      calls: calls.map(row),
      baseline: baseline.map(row),
      taCalls: taCalls.map(row),
      outbox: outbox.map(row),
      events: events.map(row),
      audit: audit.map(row),
    };
  },
});

/** True once the settings are in. Used to decide whether to seed. */
export const isSeeded = internalQuery({
  args: {},
  handler: async (ctx) => {
    const one = await ctx.db.query("opsSettings").first();
    return one !== null;
  },
});

/**
 * First run only: the people, the settings, the holidays. It refuses to run
 * twice, so it can never quietly overwrite a desk that is already working.
 */
export const seed = internalMutation({
  args: {
    members: v.array(
      v.object({
        name: v.string(),
        email: v.string(),
        role: v.union(
          v.literal("ops_owner"),
          v.literal("ops_lead"),
          v.literal("accounts"),
          v.literal("director_ops"),
          v.literal("marketing"),
          v.literal("director_ro"),
          v.literal("ta_lead_ro"),
        ),
        active: v.boolean(),
        taUserId: v.union(v.string(), v.null()),
      }),
    ),
    settings: v.array(v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()) })),
    holidays: v.array(v.object({ date: v.string(), name: v.string() })),
    templates: v.array(
      v.object({
        key: v.string(),
        channel: messageChannel,
        name: v.string(),
        subject: v.string(),
        body: v.string(),
        approvedForAuto: v.boolean(),
      }),
    ),
    timers: v.array(
      v.object({
        kind: v.string(),
        subjectType: v.string(),
        subjectId: v.string(),
        startsAt: v.number(),
        dueAt: v.number(),
        warnAt: v.union(v.number(), v.null()),
        state: timerState,
        firedAt: v.union(v.number(), v.null()),
        ownerRole: v.string(),
        payload: v.record(v.string(), v.string()),
      }),
    ),
    tasks: v.array(
      v.object({
        kind: taskKind,
        title: v.string(),
        body: v.string(),
        ownerRole: v.string(),
        dueAt: v.number(),
        subjectType: v.union(v.string(), v.null()),
        subjectId: v.union(v.string(), v.null()),
        createdAt: v.number(),
      }),
    ),
    messages: v.array(
      v.object({
        channel: messageChannel,
        to: v.array(v.string()),
        subject: v.string(),
        body: v.string(),
        templateKey: v.union(v.string(), v.null()),
        subjectType: v.union(v.string(), v.null()),
        subjectId: v.union(v.string(), v.null()),
        createdAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const already = await ctx.db.query("opsSettings").first();
    if (already) return { seeded: false, reason: "This desk already has its settings." };

    // Members first: the sample clocks and tasks belong to a role, and the
    // real member id only exists once they are in.
    const idByRole = new Map<string, string>();
    for (const member of args.members) {
      const id = await ctx.db.insert("opsMembers", member);
      if (!idByRole.has(member.role)) idByRole.set(member.role, id as string);
    }
    const owner = (role: string) => idByRole.get(role) ?? idByRole.get("ops_owner") ?? "";

    for (const setting of args.settings) {
      await ctx.db.insert("opsSettings", { ...setting, updatedBy: null, updatedAt: null });
    }
    for (const holiday of args.holidays) await ctx.db.insert("opsHolidays", holiday);
    for (const timer of args.timers) {
      await ctx.db.insert("opsTimers", {
        kind: timer.kind,
        subjectType: timer.subjectType,
        subjectId: timer.subjectId,
        startsAt: timer.startsAt,
        dueAt: timer.dueAt,
        warnAt: timer.warnAt,
        state: timer.state,
        firedAt: timer.firedAt,
        ownerId: owner(timer.ownerRole),
        payload: timer.payload,
      });
    }
    for (const task of args.tasks) {
      await ctx.db.insert("opsTasks", {
        kind: task.kind,
        title: task.title,
        body: task.body,
        assigneeId: owner(task.ownerRole),
        dueAt: task.dueAt,
        state: "open",
        subjectType: task.subjectType,
        subjectId: task.subjectId,
        link: null,
        outcome: null,
        doneBy: null,
        doneAt: null,
        createdAt: task.createdAt,
      });
    }
    for (const template of args.templates) {
      await ctx.db.insert("opsTemplates", { ...template, updatedBy: null, updatedAt: null });
    }
    for (const message of args.messages) {
      await ctx.db.insert("opsMessages", {
        channel: message.channel,
        to: message.to,
        subject: message.subject,
        body: message.body,
        templateKey: message.templateKey,
        state: "draft",
        subjectType: message.subjectType,
        subjectId: message.subjectId,
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        providerMessageId: null,
        note: null,
        createdAt: message.createdAt,
      });
    }
    await writeAudit(ctx, { actorId: null, action: "desk.seeded", subjectType: "desk", subjectId: "desk" });
    return { seeded: true, reason: null };
  },
});

/**
 * Records a file already written to R2 (15, Phase 1 step 23).
 *
 * The row comes second, after the bytes, so a link in the registry always
 * leads somewhere.
 */
export const addFile = internalMutation({
  args: {
    kind: v.string(),
    key: v.string(),
    name: v.string(),
    size: v.number(),
    mime: v.string(),
    sha256: v.string(),
    subjectType: v.union(v.string(), v.null()),
    subjectId: v.union(v.string(), v.null()),
    madeFrom: v.union(v.string(), v.null()),
    uploadedBy: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const uploadedAt = Date.now();
    const id = await ctx.db.insert("opsFiles", { ...args, uploadedAt });
    await writeAudit(ctx, {
      actorId: args.uploadedBy,
      action: args.madeFrom ? "file.converted" : "file.kept",
      subjectType: "file",
      subjectId: id as string,
      after: args.kind + " · " + args.name,
    });
    return { ...args, id: id as string, uploadedAt };
  },
});

/** A meeting with a client (15, Phase 2 step 7). */
export const addMeeting = internalMutation({
  args: {
    leadId: v.string(),
    kind: v.string(),
    at: v.number(),
    state: v.string(),
    taLeadId: v.string(),
    rebookCount: v.number(),
    brief: v.string(),
    role: v.string(),
    packageSaid: v.string(),
    reason: v.union(v.string(), v.null()),
    bookedBy: v.string(),
    heldAt: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsMeetings", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.bookedBy,
      action: "meeting.booked",
      subjectType: "meeting",
      subjectId: id as string,
      after: new Date(args.at).toISOString().slice(0, 16),
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

export const patchMeeting = internalMutation({
  args: {
    meetingId: v.string(),
    patch: v.any(),
    by: v.string(),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const meeting = await ctx.db.get(args.meetingId as Id<"opsMeetings">);
    if (!meeting) return { ok: false };
    await ctx.db.patch(meeting._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(meeting._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "meeting",
      subjectId: meeting._id as string,
      before: meeting.state,
      after: after?.state ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

/** The client agreement (15, Phase 2 step 9). */
export const addAgreement = internalMutation({
  args: {
    leadId: v.string(),
    clientTaId: v.union(v.string(), v.null()),
    state: v.string(),
    version: v.number(),
    fields: v.any(),
    draftFileId: v.union(v.string(), v.null()),
    sentAt: v.union(v.number(), v.null()),
    sentMessageId: v.union(v.string(), v.null()),
    chaseStep: v.number(),
    expiresAt: v.union(v.number(), v.null()),
    signedAt: v.union(v.number(), v.null()),
    signedFileId: v.union(v.string(), v.null()),
    countersignedAt: v.union(v.number(), v.null()),
    countersignedFileId: v.union(v.string(), v.null()),
    reason: v.union(v.string(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsEsa", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "esa.started",
      subjectType: "esa",
      subjectId: id as string,
      after: "version " + String(args.version),
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** A company we work for (15, Phase 2 step 19). */
export const addClient = internalMutation({
  args: {
    leadId: v.union(v.string(), v.null()),
    taClientId: v.union(v.string(), v.null()),
    name: v.string(),
    nameKey: v.string(),
    stage: v.string(),
    billingName: v.string(),
    billingEmail: v.string(),
    groupName: v.string(),
    notes: v.string(),
    reason: v.union(v.string(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsClients", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "client.created",
      subjectType: "client",
      subjectId: id as string,
      after: args.name + " · " + args.stage,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** One round of CVs for a client (15, Phase 4 step 2). */
export const addClientSet = internalMutation({
  args: {
    taRoundId: v.string(),
    openingTaId: v.string(),
    setNumber: v.number(),
    clientId: v.union(v.string(), v.null()),
    clientTaId: v.string(),
    name: v.string(),
    role: v.string(),
    state: v.string(),
    candidates: v.any(),
    dueAt: v.union(v.number(), v.null()),
    sentAt: v.union(v.number(), v.null()),
    sentMessageId: v.union(v.string(), v.null()),
    sentTo: v.array(v.string()),
    receivedAt: v.union(v.number(), v.null()),
    reason: v.union(v.string(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsClientSets", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: null,
      action: "clientSet.ready",
      subjectType: "clientSet",
      subjectId: id as string,
      after: args.name,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** A position held because the client went quiet (15, Phase 4 step 12). */
export const addHold = internalMutation({
  args: {
    openingTaId: v.string(),
    setId: v.union(v.string(), v.null()),
    clientId: v.union(v.string(), v.null()),
    state: v.string(),
    reason: v.string(),
    liftedReason: v.union(v.string(), v.null()),
    noticeMessageId: v.union(v.string(), v.null()),
    proposedAt: v.number(),
    heldAt: v.union(v.number(), v.null()),
    liftedAt: v.union(v.number(), v.null()),
    reviewAt: v.union(v.number(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsHolds", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: null,
      action: "hold.proposed",
      subjectType: "hold",
      subjectId: id as string,
      after: args.openingTaId,
      reason: args.reason,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** What the client said they want (15, Phase 3 step 3). */
export const addRequirement = internalMutation({
  args: {
    leadId: v.string(),
    clientId: v.union(v.string(), v.null()),
    clientTaId: v.string(),
    meetingId: v.union(v.string(), v.null()),
    version: v.number(),
    fields: v.any(),
    practical: v.boolean(),
    reason: v.union(v.string(), v.null()),
    inviteBackAt: v.union(v.number(), v.null()),
    openedAt: v.union(v.number(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsRequirements", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "requirement.saved",
      subjectType: "requirement",
      subjectId: id as string,
      after: "version " + String(args.version),
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

export const patchRequirement = internalMutation({
  args: {
    requirementId: v.string(),
    patch: v.any(),
    by: v.union(v.string(), v.null()),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.requirementId as Id<"opsRequirements">);
    if (!found) return { ok: false };
    await ctx.db.patch(found._id, { ...args.patch, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "requirement",
      subjectId: found._id as string,
      reason: args.reason,
    });
    return { ok: true };
  },
});

/** Our side of an opening in the TA System (15, Phase 3 step 6). */
export const addPosition = internalMutation({
  args: {
    requirementId: v.union(v.string(), v.null()),
    clientId: v.union(v.string(), v.null()),
    clientTaId: v.string(),
    openingTaId: v.union(v.string(), v.null()),
    title: v.string(),
    stage: v.string(),
    primaryTaId: v.union(v.string(), v.null()),
    hundredPercentDay: v.union(v.string(), v.null()),
    taStatus: v.union(v.string(), v.null()),
    jdApprovedAt: v.union(v.number(), v.null()),
    linkedInUrl: v.union(v.string(), v.null()),
    linkedInPostedAt: v.union(v.number(), v.null()),
    depthStage: v.union(v.string(), v.null()),
    shortlistedTotal: v.union(v.number(), v.null()),
    pendingCount: v.union(v.number(), v.null()),
    depthCheckedAt: v.union(v.number(), v.null()),
    handedOverAt: v.number(),
    closedAt: v.union(v.number(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsPositions", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "position.handedOver",
      subjectType: "position",
      subjectId: id as string,
      after: args.title,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** One week's Talent Pulse (15, Phase 3 step 14). */
export const addIssue = internalMutation({
  args: {
    weekOf: v.string(),
    state: v.string(),
    lines: v.any(),
    postedAt: v.union(v.number(), v.null()),
    postedBy: v.union(v.string(), v.null()),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsTalentPulse", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "talentPulse.compiled",
      subjectType: "talentPulse",
      subjectId: id as string,
      after: args.weekOf,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

export const patchIssue = internalMutation({
  args: {
    issueId: v.string(),
    patch: v.any(),
    by: v.union(v.string(), v.null()),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.issueId as Id<"opsTalentPulse">);
    if (!found) return { ok: false };
    await ctx.db.patch(found._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(found._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "talentPulse",
      subjectId: found._id as string,
      before: found.state,
      after: after?.state ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const patchPosition = internalMutation({
  args: {
    positionId: v.string(),
    patch: v.any(),
    by: v.union(v.string(), v.null()),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.positionId as Id<"opsPositions">);
    if (!found) return { ok: false };
    await ctx.db.patch(found._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(found._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "position",
      subjectId: found._id as string,
      before: found.stage,
      after: after?.stage ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const patchHold = internalMutation({
  args: {
    holdId: v.string(),
    patch: v.any(),
    by: v.union(v.string(), v.null()),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const hold = await ctx.db.get(args.holdId as Id<"opsHolds">);
    if (!hold) return { ok: false };
    await ctx.db.patch(hold._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(hold._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "hold",
      subjectId: hold._id as string,
      before: hold.state,
      after: after?.state ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const patchClientSet = internalMutation({
  args: {
    setId: v.string(),
    patch: v.any(),
    by: v.union(v.string(), v.null()),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const set = await ctx.db.get(args.setId as Id<"opsClientSets">);
    if (!set) return { ok: false };
    await ctx.db.patch(set._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(set._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "clientSet",
      subjectId: set._id as string,
      before: set.state,
      after: after?.state ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const patchClient = internalMutation({
  args: {
    clientId: v.string(),
    patch: v.any(),
    by: v.string(),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId as Id<"opsClients">);
    if (!client) return { ok: false };
    await ctx.db.patch(client._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(client._id);
    // An owner move is the one change where the stage is not the story.
    const movingOwner = typeof args.patch?.ownerId === "string";
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "client",
      subjectId: client._id as string,
      before: movingOwner ? client.ownerId : client.stage,
      after: (movingOwner ? after?.ownerId : after?.stage) ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const patchAgreement = internalMutation({
  args: {
    esaId: v.string(),
    patch: v.any(),
    by: v.string(),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const esa = await ctx.db.get(args.esaId as Id<"opsEsa">);
    if (!esa) return { ok: false };
    await ctx.db.patch(esa._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(esa._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "esa",
      subjectId: esa._id as string,
      before: esa.state,
      after: after?.state ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

/** A message written as a draft for somebody to approve. */
export const draftMessage = internalMutation({
  args: {
    channel: messageChannel,
    to: v.array(v.string()),
    subject: v.string(),
    body: v.string(),
    templateKey: v.union(v.string(), v.null()),
    subjectType: v.union(v.string(), v.null()),
    subjectId: v.union(v.string(), v.null()),
    attachmentFileIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("opsMessages", {
      ...args,
      state: "draft" as const,
      approvedBy: null,
      approvedAt: null,
      sentAt: null,
      providerMessageId: null,
      note: null,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: null,
      action: "message.drafted",
      subjectType: "message",
      subjectId: id as string,
      after: args.channel + " to " + args.to.join(", "),
      reason: args.templateKey,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** A new lead (15, Phase 2 step 2). */
export const addLead = internalMutation({
  args: {
    company: v.string(),
    nameKey: v.string(),
    contactName: v.string(),
    contactEmail: v.string(),
    contactPhone: v.string(),
    source: v.string(),
    industry: v.string(),
    website: v.string(),
    notes: v.string(),
    industryFlagged: v.boolean(),
    industryBecause: v.union(v.string(), v.null()),
    industryConfirmedBy: v.union(v.string(), v.null()),
    state: v.string(),
    reason: v.union(v.string(), v.null()),
    doNotInvite: v.boolean(),
    clientTaId: v.union(v.string(), v.null()),
    ownerId: v.string(),
    createdBy: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("opsLeads", { ...args, createdAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: args.createdBy,
      action: "lead.created",
      subjectType: "lead",
      subjectId: id as string,
      after: args.company + " · " + args.source,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** One change to a lead, with what changed and why. */
export const patchLead = internalMutation({
  args: {
    leadId: v.string(),
    patch: v.any(),
    by: v.string(),
    what: v.string(),
    reason: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const lead = await ctx.db.get(args.leadId as Id<"opsLeads">);
    if (!lead) return { ok: false };
    await ctx.db.patch(lead._id, { ...args.patch, updatedAt: Date.now() });
    const after = await ctx.db.get(lead._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: args.what,
      subjectType: "lead",
      subjectId: lead._id as string,
      before: lead.state,
      after: after?.state ?? null,
      reason: args.reason,
    });
    return { ok: true };
  },
});

/** A call a person made (15, Phase 1 step 24). */
export const logCall = internalMutation({
  args: {
    taskId: v.union(v.string(), v.null()),
    to: v.string(),
    toName: v.string(),
    purpose: v.string(),
    spokeTo: v.string(),
    outcome: v.string(),
    subjectType: v.union(v.string(), v.null()),
    subjectId: v.union(v.string(), v.null()),
    by: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("opsCalls", { ...args, at: Date.now() });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "call.logged",
      subjectType: "call",
      subjectId: id as string,
      after: args.to,
      reason: args.outcome,
    });
    return { ok: true };
  },
});

/** Days the office is shut. Skips any already on the list; returns how many were new. */
export const addHolidays = internalMutation({
  args: { days: v.array(v.object({ date: v.string(), name: v.string() })), by: v.string() },
  handler: async (ctx, args) => {
    const have = await ctx.db.query("opsHolidays").collect();
    let added = 0;
    for (const day of args.days) {
      if (have.some((h) => h.date === day.date)) continue;
      await ctx.db.insert("opsHolidays", day);
      added += 1;
    }
    if (added) {
      await writeAudit(ctx, {
        actorId: args.by,
        action: "holidays.added",
        subjectType: "holidays",
        subjectId: "list",
        after: String(added),
      });
    }
    return added;
  },
});

export const removeHoliday = internalMutation({
  args: { date: v.string(), by: v.string() },
  handler: async (ctx, args) => {
    const row = (await ctx.db.query("opsHolidays").collect()).find((h) => h.date === args.date);
    if (!row) return { ok: false };
    await ctx.db.delete(row._id);
    await writeAudit(ctx, {
      actorId: args.by,
      action: "holiday.removed",
      subjectType: "holidays",
      subjectId: args.date,
      before: args.date,
    });
    return { ok: true };
  },
});

/** Today's numbers, typed in from the archive before we change anything. */
export const addBaseline = internalMutation({
  args: {
    measure: v.string(),
    period: v.string(),
    value: v.number(),
    note: v.string(),
    by: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("opsBaseline", { ...args, at: Date.now() });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "baseline.recorded",
      subjectType: "baseline",
      subjectId: id as string,
      after: args.measure + " = " + String(args.value),
      reason: args.note || null,
    });
    return { ok: true };
  },
});

/** One call to the TA System. Not audited, and only the last hundred are kept. */
export const logTaCall = internalMutation({
  args: {
    direction: v.string(),
    path: v.string(),
    ok: v.boolean(),
    status: v.union(v.number(), v.null()),
    ms: v.number(),
    note: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("opsTaCalls", { ...args, at: Date.now() });
    const old = await ctx.db.query("opsTaCalls").withIndex("by_at").order("desc").collect();
    for (const row of old.slice(100)) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

/** Queues a write to the TA System. The same key twice is the same intention. */
export const queueWrite = internalMutation({
  args: {
    path: v.string(),
    body: v.any(),
    idempotencyKey: v.string(),
    subjectType: v.union(v.string(), v.null()),
    subjectId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("opsOutbox")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (already) return row(already);
    const createdAt = Date.now();
    const id = await ctx.db.insert("opsOutbox", {
      ...args,
      state: "queued" as const,
      attempts: 0,
      lastError: null,
      nextTryAt: null,
      createdAt,
      sentAt: null,
    });
    await writeAudit(ctx, {
      actorId: null,
      action: "outbox.queued",
      subjectType: "outbox",
      subjectId: id as string,
      after: args.path,
    });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** The result of one attempt. A write that is only waiting is not a failure. */
export const recordOutboxTry = internalMutation({
  args: {
    itemId: v.string(),
    ok: v.boolean(),
    error: v.union(v.string(), v.null()),
    nextTryAt: v.union(v.number(), v.null()),
    state: v.union(v.literal("queued"), v.literal("failed"), v.null()),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId as Id<"opsOutbox">);
    if (!item) return { ok: false };
    const attempts = item.attempts + 1;
    const patch = args.ok
      ? { state: "sent" as const, attempts, sentAt: Date.now(), lastError: null, nextTryAt: null }
      : {
          state: args.state ?? ("queued" as const),
          attempts,
          lastError: args.error ?? "The TA System could not be reached.",
          nextTryAt: args.nextTryAt,
        };
    await ctx.db.patch(item._id, patch);
    await writeAudit(ctx, {
      actorId: null,
      action: args.ok ? "outbox.sent" : patch.state === "failed" ? "outbox.givenUp" : "outbox.waiting",
      subjectType: "outbox",
      subjectId: item._id as string,
      before: item.path,
      after: String(attempts) + " tries",
      reason: args.error,
    });
    return { ok: true };
  },
});

/** Records a TA event once. The same event twice is kept once. */
export const addEvent = internalMutation({
  args: {
    taEventId: v.string(),
    type: v.string(),
    data: v.any(),
    handledAt: v.union(v.number(), v.null()),
    attempts: v.number(),
    lastError: v.union(v.string(), v.null()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const already = await ctx.db
      .query("opsEvents")
      .withIndex("by_taEventId", (q) => q.eq("taEventId", args.taEventId))
      .first();
    if (already) return null;
    const receivedAt = Date.now();
    const id = await ctx.db.insert("opsEvents", { ...args, receivedAt });
    const written = await ctx.db.get(id);
    return written ? row(written) : null;
  },
});

/** A setting the system keeps for itself. Not audited: it changes every pass. */
export const noteSystemSetting = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("opsSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) await ctx.db.patch(existing._id, { value: args.value, updatedAt: Date.now() });
    else await ctx.db.insert("opsSettings", { key: args.key, value: args.value, updatedBy: null, updatedAt: Date.now() });
    return { ok: true };
  },
});

/** The last scheduled clock pass. Not audited: it happens every five minutes. */
export const noteClockPass = internalMutation({
  args: { value: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("opsSettings")
      .withIndex("by_key", (q) => q.eq("key", "clock.lastPass"))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { value: args.value, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("opsSettings", { key: "clock.lastPass", value: args.value, updatedBy: null, updatedAt: Date.now() });
    }
    return { ok: true };
  },
});

export const setSetting = internalMutation({
  args: {
    key: v.string(),
    value: v.union(v.string(), v.number(), v.boolean()),
    by: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("opsSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    const before = row ? String(row.value) : null;
    if (row) {
      await ctx.db.patch(row._id, { value: args.value, updatedBy: args.by, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("opsSettings", { key: args.key, value: args.value, updatedBy: args.by, updatedAt: Date.now() });
    }
    await writeAudit(ctx, {
      actorId: args.by,
      action: "setting.changed",
      subjectType: "setting",
      subjectId: args.key,
      before,
      after: String(args.value),
      reason: args.reason,
    });
    return { ok: true };
  },
});

export const startTimer = internalMutation({
  args: {
    kind: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    startsAt: v.number(),
    dueAt: v.number(),
    warnAt: v.union(v.number(), v.null()),
    ownerId: v.string(),
    payload: v.record(v.string(), v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("opsTimers", { ...args, state: "running", firedAt: null });
    await writeAudit(ctx, {
      actorId: args.ownerId,
      action: "timer.started",
      subjectType: "timer",
      subjectId: id as string,
      after: args.kind,
    });
    return { id: id as string };
  },
});

export const createTask = internalMutation({
  args: {
    kind: v.union(
      v.literal("approve"),
      v.literal("call"),
      v.literal("record"),
      v.literal("decide"),
      v.literal("remind"),
      v.literal("escalation"),
      v.literal("check"),
    ),
    title: v.string(),
    body: v.string(),
    assigneeId: v.string(),
    dueAt: v.number(),
    subjectType: v.union(v.string(), v.null()),
    subjectId: v.union(v.string(), v.null()),
    link: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("opsTasks", {
      ...args,
      state: "open",
      outcome: null,
      doneBy: null,
      doneAt: null,
      createdAt: Date.now(),
    });
    await writeAudit(ctx, { actorId: null, action: "task.created", subjectType: "task", subjectId: id as string, after: args.title });
    return { id: id as string };
  },
});

export const finishTask = internalMutation({
  args: { taskId: v.string(), by: v.string(), outcome: v.string() },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId as never);
    if (!task) return { ok: false };
    await ctx.db.patch(args.taskId as never, {
      state: "done",
      outcome: args.outcome.trim() || null,
      doneBy: args.by,
      doneAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "task.done",
      subjectType: "task",
      subjectId: args.taskId,
      before: "open",
      after: "done",
      reason: args.outcome.trim() || null,
    });
    return { ok: true };
  },
});

export const editMessage = internalMutation({
  args: { messageId: v.string(), subject: v.string(), body: v.string(), by: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId as never);
    if (!message) return { ok: false };
    const row = message as unknown as Doc<"opsMessages">;
    // A message that has already gone is a record of what was sent, not a draft.
    if (row.state !== "draft") return { ok: false };
    await ctx.db.patch(args.messageId as never, { subject: args.subject, body: args.body });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "message.edited",
      subjectType: "message",
      subjectId: args.messageId,
      before: row.subject,
      after: args.subject,
    });
    return { ok: true };
  },
});

/** Approval and what the gate decided, in one write, so neither happens alone. */
export const settleMessage = internalMutation({
  args: {
    messageId: v.string(),
    by: v.string(),
    // "approved" is where a group post stops: a person posts it (3 Nov).
    state: v.union(v.literal("sent"), v.literal("failed"), v.literal("blocked"), v.literal("queued"), v.literal("approved")),
    to: v.array(v.string()),
    note: v.union(v.string(), v.null()),
    /** What the mail server called it, once a sender knows. */
    providerMessageId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId as never);
    if (!message) return { ok: false };
    const row = message as unknown as Doc<"opsMessages">;
    await ctx.db.patch(args.messageId as never, {
      approvedBy: args.by,
      approvedAt: Date.now(),
      state: args.state,
      note: args.note,
      to: args.to,
      ...(args.state === "sent" ? { sentAt: Date.now() } : {}),
      ...(args.providerMessageId === undefined ? {} : { providerMessageId: args.providerMessageId }),
    });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "message." + args.state,
      subjectType: "message",
      subjectId: args.messageId,
      before: row.state,
      after: args.state,
      reason: args.note,
    });
    return { ok: true };
  },
});

/** The ops lead changes the wording; the old wording stays in the audit trail. */
export const saveTemplate = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    subject: v.string(),
    body: v.string(),
    approvedForAuto: v.boolean(),
    by: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("opsTemplates")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!row) return { ok: false };
    await ctx.db.patch(row._id, {
      name: args.name,
      subject: args.subject,
      body: args.body,
      approvedForAuto: args.approvedForAuto,
      updatedBy: args.by,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "template.saved",
      subjectType: "template",
      subjectId: args.key,
      before: row.subject + " / " + row.body.slice(0, 120),
      after: args.subject + " / " + args.body.slice(0, 120),
      reason: null,
    });
    return { ok: true };
  },
});

/** One pass of the clocks, decided by the app and applied here in one go. */
export const applyTick = internalMutation({
  args: {
    warned: v.array(v.string()),
    fired: v.array(v.string()),
    firedAt: v.number(),
    tasks: v.array(
      v.object({
        kind: v.union(
          v.literal("approve"),
          v.literal("call"),
          v.literal("record"),
          v.literal("decide"),
          v.literal("remind"),
          v.literal("escalation"),
          v.literal("check"),
        ),
        title: v.string(),
        body: v.string(),
        assigneeId: v.string(),
        dueAt: v.number(),
        subjectType: v.union(v.string(), v.null()),
        subjectId: v.union(v.string(), v.null()),
        link: v.union(v.string(), v.null()),
      }),
    ),
    escalations: v.array(v.object({ taskId: v.string(), toMemberId: v.string(), note: v.string() })),
  },
  handler: async (ctx, args) => {
    for (const id of args.warned) await ctx.db.patch(id as never, { state: "warned" });
    for (const id of args.fired) {
      await ctx.db.patch(id as never, { state: "fired", firedAt: args.firedAt });
      await writeAudit(ctx, { actorId: null, action: "timer.fired", subjectType: "timer", subjectId: id, before: "running", after: "fired" });
    }
    for (const task of args.tasks) {
      await ctx.db.insert("opsTasks", {
        ...task,
        state: "open",
        outcome: null,
        doneBy: null,
        doneAt: null,
        createdAt: args.firedAt,
      });
    }
    for (const move of args.escalations) {
      const task = await ctx.db.get(move.taskId as never);
      if (!task) continue;
      const row = task as unknown as Doc<"opsTasks">;
      await ctx.db.patch(move.taskId as never, {
        assigneeId: move.toMemberId,
        body: row.body + "\n\nPassed on: " + move.note,
      });
      await writeAudit(ctx, {
        actorId: null,
        action: "task.escalated",
        subjectType: "task",
        subjectId: move.taskId,
        before: row.assigneeId,
        after: move.toMemberId,
        reason: move.note,
      });
    }
    return { warned: args.warned.length, fired: args.fired.length, escalated: args.escalations.length };
  },
});

/** One arrival, recorded once. The mail server's id is the key. */
export const recordInbound = internalMutation({
  args: {
    channel: v.union(v.literal("email"), v.literal("whatsapp")),
    mailbox: v.string(),
    from: v.string(),
    fromName: v.string(),
    receivedAt: v.number(),
    subject: v.string(),
    body: v.string(),
    providerId: v.string(),
    inReplyTo: v.union(v.string(), v.null()),
    matchedBy: v.union(
      v.literal("reference"),
      v.literal("thread"),
      v.literal("house"),
      v.literal("domain"),
      v.literal("manual"),
      v.literal("none"),
    ),
    subjectType: v.union(v.string(), v.null()),
    subjectId: v.union(v.string(), v.null()),
    clientId: v.union(v.string(), v.null()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("opsInbound")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .first();
    if (seen) return { id: seen._id as string, already: true };

    const id = await ctx.db.insert("opsInbound", {
      ...args,
      readState: args.subjectId ? ("filed" as const) : ("new" as const),
    });
    await writeAudit(ctx, {
      actorId: null,
      action: "inbound.recorded",
      subjectType: "inbound",
      subjectId: id as string,
      after: args.matchedBy,
      reason: args.note,
    });
    return { id: id as string, already: false };
  },
});

export const fileInbound = internalMutation({
  args: { inboundId: v.string(), subjectType: v.string(), subjectId: v.string(), by: v.string() },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.inboundId as never);
    if (!found) return { ok: false };
    const row = found as unknown as Doc<"opsInbound">;
    await ctx.db.patch(args.inboundId as never, {
      subjectType: args.subjectType,
      subjectId: args.subjectId,
      matchedBy: "manual",
      readState: "filed",
      note: "Filed by hand.",
    });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "inbound.filed",
      subjectType: "inbound",
      subjectId: args.inboundId,
      before: row.subjectId,
      after: args.subjectId,
    });
    return { ok: true };
  },
});

export const markInboundActioned = internalMutation({
  args: { inboundId: v.string(), by: v.string() },
  handler: async (ctx, args) => {
    const found = await ctx.db.get(args.inboundId as never);
    if (!found) return { ok: false };
    await ctx.db.patch(args.inboundId as never, { readState: "actioned" });
    await writeAudit(ctx, {
      actorId: args.by,
      action: "inbound.actioned",
      subjectType: "inbound",
      subjectId: args.inboundId,
      before: "filed",
      after: "actioned",
    });
    return { ok: true };
  },
});

/** The client answered: every chase for that subject stops at once. */
export const cancelTimers = internalMutation({
  args: { timerIds: v.array(v.string()), by: v.string() },
  handler: async (ctx, args) => {
    for (const id of args.timerIds) {
      await ctx.db.patch(id as never, { state: "cancelled" });
      await writeAudit(ctx, {
        actorId: args.by,
        action: "timer.cancelled",
        subjectType: "timer",
        subjectId: id,
        before: "running",
        after: "cancelled",
        reason: "The client replied.",
      });
    }
    return { cancelled: args.timerIds.length };
  },
});
