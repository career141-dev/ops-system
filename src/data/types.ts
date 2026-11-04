/**
 * The Ops records, exactly the foundation tables of the build plan (15, D2).
 *
 * The names match what the Convex schema will hold, so the JSON store used for
 * screens and tests and the real backend are the same shape (2 Nov). Anything
 * that belongs to the TA System — openings, candidates, placements — is NOT
 * here: Ops reads those through the API and never keeps a second copy.
 */

export type Id = string;

/** Who works in Ops, and what they are allowed to do. */
export type OpsRole =
  | "ops_owner"
  | "ops_lead"
  | "accounts"
  | "director_ops"
  | "marketing"
  | "director_ro"
  | "ta_lead_ro";

export interface OpsMember {
  id: Id;
  name: string;
  email: string;
  role: OpsRole;
  active: boolean;
  /** The same person's TA System account, matched by email, when they have one. */
  taUserId: Id | null;
}

/** Every number and switch lives here, never in the code. */
export interface OpsSetting {
  key: string;
  value: string | number | boolean;
  updatedBy: Id | null;
  updatedAt: number | null;
}

export interface OpsHoliday {
  date: string;
  name: string;
}

export type TimerState = "running" | "warned" | "fired" | "done" | "cancelled";

/** One clock. The thing that stops Ops holding deadlines in their heads. */
export interface OpsTimer {
  id: Id;
  kind: string;
  subjectType: string;
  subjectId: Id;
  startsAt: number;
  dueAt: number;
  warnAt: number | null;
  state: TimerState;
  firedAt: number | null;
  ownerId: Id;
  payload: Record<string, string>;
}

export type TaskKind = "approve" | "call" | "record" | "decide" | "remind" | "escalation" | "check";
export type TaskState = "open" | "done" | "dismissed" | "snoozed";

export interface OpsTask {
  id: Id;
  kind: TaskKind;
  title: string;
  body: string;
  assigneeId: Id;
  dueAt: number;
  state: TaskState;
  subjectType: string | null;
  subjectId: Id | null;
  /** Where the task takes you on the screen. */
  link: string | null;
  /** What was decided or said, written when it is done. */
  outcome: string | null;
  doneBy: Id | null;
  doneAt: number | null;
  createdAt: number;
}

export type MessageChannel = "email" | "whatsapp" | "group_post" | "internal";
export type MessageState = "draft" | "approved" | "queued" | "sent" | "failed" | "blocked";

/** One way out. Nothing reaches a client except through a row here. */
export interface OpsMessage {
  id: Id;
  channel: MessageChannel;
  to: string[];
  subject: string;
  body: string;
  templateKey: string | null;
  state: MessageState;
  subjectType: string | null;
  subjectId: Id | null;
  approvedBy: Id | null;
  approvedAt: number | null;
  sentAt: number | null;
  /**
   * The id the mail server gave this message when it actually went (2 Nov).
   * A client's reply carries it in `In-Reply-To`, so it is the only thing that
   * matches a reply to its thread with certainty. Null until a sender fills it
   * in: it cannot be worked out in advance, and guessing it was a bug.
   */
  providerMessageId: string | null;
  /** Why it was blocked or failed, in words a person can act on. */
  note: string | null;
  /**
   * The files that go with it, from the file registry (3 Nov).
   *
   * The agreement is the first message that has to carry something: a cover
   * email with nothing attached is worse than no email.
   */
  attachmentFileIds: Id[];
  createdAt: number;
}

/** One email that arrived. One way in, as `OpsMessage` is the one way out. */
export interface OpsInbound {
  id: Id;
  channel: "email" | "whatsapp";
  /** Which of our mailboxes it arrived in (2 Nov: there are several). */
  mailbox: string;
  from: string;
  fromName: string;
  receivedAt: number;
  subject: string;
  body: string;
  /** The mail server's own id, so the same email is never recorded twice. */
  providerId: string;
  inReplyTo: string | null;
  /** How it was matched, and to what. Null until somebody or something files it. */
  matchedBy: "reference" | "thread" | "house" | "domain" | "manual" | "none";
  subjectType: string | null;
  subjectId: string | null;
  clientId: string | null;
  readState: "new" | "filed" | "actioned";
  note: string;
}

/** Who changed what, before and after, and why. */
export interface OpsAuditEntry {
  id: Id;
  actorId: Id | null;
  action: string;
  subjectType: string;
  subjectId: Id;
  before: string | null;
  after: string | null;
  reason: string | null;
  at: number;
}

export interface OpsTemplate {
  /** Dotted and stable, because code asks for a template by key: `esa.chase.1`. */
  key: string;
  channel: MessageChannel;
  /** What a person sees in the list. */
  name: string;
  /** Email only. WhatsApp and group posts have no subject. */
  subject: string;
  body: string;
  /**
   * Whether a routine notice from this template may go without anybody reading
   * it. The owner's rule: only wording approved once, and only for notices —
   * never for anything written to a client about one position.
   */
  approvedForAuto: boolean;
  updatedBy: string | null;
  updatedAt: number | null;
}

/**
 * One kept file. The row is the record; the bytes are in R2, or in a folder on
 * this machine while we build. `sha256` is what proves a year later that the
 * file somebody opens is the file that went out.
 */
export interface OpsFile {
  id: Id;
  kind: string;
  /** Where it lives in the bucket. Never built from the name alone. */
  key: string;
  name: string;
  size: number;
  mime: string;
  sha256: string;
  subjectType: string | null;
  subjectId: Id | null;
  /** The file this one was made from, for a PDF made out of a Word document. */
  madeFrom: Id | null;
  uploadedBy: Id | null;
  uploadedAt: number;
}

/**
 * One call somebody made (15, Phase 1 step 24).
 *
 * Calls stay human by the owner's decision, so this is a record of what a
 * person did, never something the system did: who was rung, who answered, and
 * what was said.
 */
export interface OpsCallLog {
  id: Id;
  /** The call task this answers, when it came from one. */
  taskId: Id | null;
  to: string;
  toName: string;
  purpose: string;
  spokeTo: string;
  outcome: string;
  subjectType: string | null;
  subjectId: Id | null;
  by: Id;
  at: number;
}

/**
 * How bad it is today, measured before we change anything (15, Phase 1 step 0).
 *
 * The owner's instruction was "strategy first: measure today's numbers", so
 * the weekly report can one day say what changed. Entered by hand from the
 * archive, because there is no system to read it out of.
 */
export interface OpsBaseline {
  id: Id;
  /** `esa.returnDays`, `set.clientWaitDays`, `hire.slippedCount`, or another. */
  measure: string;
  /** Which months it covers, in words: "May to October 2026". */
  period: string;
  value: number;
  note: string;
  by: Id;
  at: number;
}

/** Every call to the TA System, so "is the window working" has an answer. */
export interface OpsTaCall {
  id: Id;
  direction: "read" | "write" | "events";
  path: string;
  ok: boolean;
  /** The HTTP status, or null when we never got that far. */
  status: number | null;
  ms: number;
  note: string | null;
  at: number;
}

export type OutboxState = "queued" | "sent" | "failed";

/**
 * A write waiting to reach the TA System (15, Phase 1 step 21).
 *
 * Ops never writes into TA's database; it asks the API. The API can be down,
 * and an opening that was asked for must not be lost because of it, so every
 * write is a row here first and is retried. The key makes a repeat harmless:
 * asking twice must not create two openings.
 */
export interface OpsOutboxItem {
  id: Id;
  path: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  state: OutboxState;
  attempts: number;
  lastError: string | null;
  /** Not tried again before this. Empty while it has never been tried. */
  nextTryAt: number | null;
  subjectType: string | null;
  subjectId: Id | null;
  createdAt: number;
  sentAt: number | null;
}

/**
 * Something that happened in the TA System (15, Part E3).
 *
 * TA writes events; Ops reads them in order and never goes back. The cursor
 * only moves past a batch that was handled, so nothing is skipped — which is
 * the whole reason Asma learned of a January joining in March.
 */
export interface OpsEvent {
  id: Id;
  taEventId: string;
  type: string;
  data: Record<string, unknown>;
  receivedAt: number;
  handledAt: number | null;
  attempts: number;
  lastError: string | null;
  note: string;
}

/**
 * A company that asked us to find somebody (15, Phase 2).
 *
 * The front door. It carries where it came from, who owns it, what we decided
 * about the industry, and - if it is a company we already have - which TA
 * client it is. Nothing about the search lives here; that is TA's.
 */
export interface OpsLead {
  id: Id;
  company: string;
  /** The company name in the one shape we compare on, as TA does it. */
  nameKey: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  source: string;
  industry: string;
  website: string;
  notes: string;
  /** Proposed by the words in front of us; a person confirms it. */
  industryFlagged: boolean;
  industryBecause: string | null;
  industryConfirmedBy: Id | null;
  state: string;
  /** Why it closed. The owner's rule: nothing closes without one. */
  reason: string | null;
  /** Declined for the industry means never invited back. */
  doNotInvite: boolean;
  /** The TA client this is, once we know it is a company we already have. */
  clientTaId: Id | null;
  ownerId: Id;
  createdBy: Id | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A meeting with a client (15, Phase 2 steps 7 and 8).
 *
 * The intro call and the requirement meeting are the same record. What makes
 * it worth keeping is the two things that go missing today: how many times we
 * have tried to rebook it, and what was actually said - which is the only
 * record of the brief until the opening exists.
 */
export interface OpsMeeting {
  id: Id;
  leadId: Id;
  kind: string;
  at: number;
  state: string;
  /** The TA lead on the call. One is on every intro call (owner's rule). */
  taLeadId: string;
  /** Our own attempts, so the third unanswered one closes the lead. */
  rebookCount: number;
  /** What was said. Required before a meeting can be marked held. */
  brief: string;
  role: string;
  packageSaid: string;
  /** Why it was not held, or why it was cancelled. */
  reason: string | null;
  bookedBy: Id;
  heldAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The client agreement (15, Phase 2 steps 9 to 18).
 *
 * One per client, with its own version number: a client who asks for changes
 * gets a new version of the same agreement, not a second agreement. The
 * fields are what the document is filled from, kept with the version so that
 * "what did they actually sign" has an answer a year later.
 */
export interface OpsEsa {
  id: Id;
  leadId: Id;
  clientTaId: Id | null;
  state: string;
  version: number;
  /** What the document is filled from. Required ones must not be blank. */
  fields: Record<string, string>;
  /** The drafted document, once there is one. */
  draftFileId: Id | null;
  sentAt: number | null;
  sentMessageId: Id | null;
  /** 0 to 6, the owner's chase plan: email, WhatsApp, email, WhatsApp, email, call. */
  chaseStep: number;
  expiresAt: number | null;
  signedAt: number | null;
  signedFileId: Id | null;
  countersignedAt: number | null;
  countersignedFileId: Id | null;
  /** Why it was declined, or what they want changed. */
  reason: string | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

/**
 * A company we work for (15, Phase 2 step 19).
 *
 * Made when they become ours - an exact match against a TA client, or the
 * agreement countersigned - and from then on it carries the things that live
 * in somebody's memory today: the one ops owner, who we invoice, and which
 * WhatsApp group is theirs.
 */
export interface OpsClient {
  id: Id;
  /** The lead they came in as, which keeps the whole history reachable. */
  leadId: Id | null;
  /** The same company in the TA System, once we know which one it is. */
  taClientId: Id | null;
  name: string;
  /** The name reduced the way TA reduces it, so a match is a match. */
  nameKey: string;
  stage: string;
  /** Who we send the invoice to. Often not known while onboarding. */
  billingName: string;
  billingEmail: string;
  /** Their WhatsApp group, by its name: the sets and feedback go there. */
  groupName: string;
  notes: string;
  /** Why they are quiet or closed. */
  reason: string | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

/**
 * One round of CVs sent to a client (15, Phase 4 steps 2 to 4).
 *
 * TA decides what is in it and numbers it; Ops decides when it goes, keeps a
 * copy of exactly what went, and owns everything that happens afterwards.
 */
export interface OpsClientSet {
  id: Id;
  /** TA's own id for the round, and the opening it belongs to. */
  taRoundId: string;
  openingTaId: string;
  setNumber: number;
  /** Our client record, when we have one, and TA's client either way. */
  clientId: Id | null;
  clientTaId: string;
  /** "CLIENT > ROLE > SET n", as the desk already writes it. */
  name: string;
  role: string;
  state: string;
  /** Who it is for, and our copy of each prepared CV. */
  candidates: {
    applicationTaId: string;
    name: string;
    fileId: Id | null;
    problem: string | null;
    /**
     * The client said they already had this one (step 7). Kept on the
     * candidate rather than in a table of its own: there is exactly one claim
     * per candidate per set, and a table would only hold the same row.
     */
    claimedAt?: number | null;
    claimVerdict?: string | null;
    claimReason?: string | null;
    /** What the client decided about them, once they say (step 9). */
    decision?: string | null;
    decisionReason?: string | null;
    decidedAt?: number | null;
  }[];
  /** Due at the client, counted from the day the agreement was signed. */
  dueAt: number | null;
  sentAt: number | null;
  sentMessageId: Id | null;
  sentTo: string[];
  /** When the client got it. The clocks that follow count from this. */
  receivedAt: number | null;
  /** Why it was pulled back. */
  reason: string | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

/**
 * A position held because the client went quiet (15, Phase 4 steps 12 and 13).
 *
 * The owner's decision 6: a hold never closes by itself. It is proposed by a
 * clock, approved by a person with a notice the client actually receives, and
 * reviewed every thirty days until somebody ends it.
 */
export interface OpsHold {
  id: Id;
  /** The opening in TA this hold is about, and the set that went quiet. */
  openingTaId: string;
  setId: Id | null;
  clientId: Id | null;
  state: string;
  /** Why it went on hold, and why it was lifted. */
  reason: string;
  liftedReason: string | null;
  /** The notice the client was sent, once it is approved. */
  noticeMessageId: Id | null;
  proposedAt: number;
  heldAt: number | null;
  liftedAt: number | null;
  /** When the owner is asked about it again. */
  reviewAt: number | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

/**
 * What the client said they want (15, Phase 3 steps 3 to 5).
 *
 * The fault this record exists for is on the owner's board in his own words:
 * "the requirement was in the TA lead's head". The opening in TA is built from
 * these fields and nothing else.
 */
export interface OpsRequirement {
  id: Id;
  leadId: Id;
  clientId: Id | null;
  clientTaId: string;
  /** The meeting it came out of, which is the only other copy. */
  meetingId: Id | null;
  version: number;
  fields: Record<string, string>;
  /** Worth searching for at that package? A no ends in a kind reply. */
  practical: boolean;
  /** Why it is not practical, and when to ask them again. */
  reason: string | null;
  inviteBackAt: number | null;
  /** When it was handed to TA. */
  openedAt: number | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

/**
 * Our side of an opening in the TA System (15, Phase 3 steps 6 to 9).
 *
 * TA owns the opening; this is what Ops needs to know about it: which
 * requirement it came from, who the primary TA is, which day it is the 100%
 * position, and what stage it is at. The TA id is empty until TA confirms it,
 * because a write to TA is queued and may take a while.
 */
export interface OpsPosition {
  id: Id;
  requirementId: Id | null;
  clientId: Id | null;
  clientTaId: string;
  /** TA's own opening id, once TA has told us. */
  openingTaId: string | null;
  title: string;
  stage: string;
  /** The TA who owns the search, and the day it is the 100% position. */
  primaryTaId: string | null;
  hundredPercentDay: string | null;
  /** What TA has told us about it, in words, for the client view. */
  taStatus: string | null;
  jdApprovedAt: number | null;
  /**
   * The LinkedIn post the TA made (15, Phase 3 step 16). Mandatory, and the
   * TA System will not let an opening go Live without it, so Ops holds the
   * link and can answer a client who asks where their role is advertised.
   */
  linkedInUrl: string | null;
  linkedInPostedAt: number | null;
  /**
   * How deep the client's shortlist is (15, Phase 4 steps 14 and 15). Kept on
   * the position rather than in a table of its own: only the latest count
   * decides anything, and every change is already in the audit.
   */
  depthStage: string | null;
  shortlistedTotal: number | null;
  pendingCount: number | null;
  depthCheckedAt: number | null;
  handedOverAt: number;
  closedAt: number | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

/**
 * One week's Talent Pulse (15, Phase 3 steps 14 and 15).
 *
 * Ops compiles the open positions with a line from each TA on a Tuesday;
 * marketing posts it on the Wednesday. Compiled by a clock rather than by
 * somebody remembering, which is why it slipped.
 */
export interface OpsTalentPulseIssue {
  id: Id;
  /** The Tuesday it belongs to, as a readable date. */
  weekOf: string;
  state: string;
  lines: {
    positionId: Id;
    openingTaId: string | null;
    title: string;
    client: string;
    note: string;
    applyAddress: string;
  }[];
  postedAt: number | null;
  postedBy: Id | null;
  ownerId: Id;
  createdAt: number;
  updatedAt: number;
}

export interface OpsDatabase {
  members: OpsMember[];
  settings: OpsSetting[];
  holidays: OpsHoliday[];
  timers: OpsTimer[];
  tasks: OpsTask[];
  messages: OpsMessage[];
  inbound: OpsInbound[];
  templates: OpsTemplate[];
  files: OpsFile[];
  leads: OpsLead[];
  clients: OpsClient[];
  clientSets: OpsClientSet[];
  holds: OpsHold[];
  requirements: OpsRequirement[];
  positions: OpsPosition[];
  talentPulse: OpsTalentPulseIssue[];
  meetings: OpsMeeting[];
  agreements: OpsEsa[];
  calls: OpsCallLog[];
  baseline: OpsBaseline[];
  taCalls: OpsTaCall[];
  outbox: OpsOutboxItem[];
  events: OpsEvent[];
  audit: OpsAuditEntry[];
}
