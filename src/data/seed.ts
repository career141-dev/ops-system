/**
 * Invented sample data for the screens and the tests (2 Nov).
 *
 * Nothing here is real. The names are made up on purpose: no real client,
 * candidate or staff detail belongs in the repository, and the preview runs on
 * this data until real sign-in is in place.
 */

import type { OpsDatabase } from "./types";
import { DAY, HOUR } from "@/lib/calendar";

export function seed(now = Date.now()): OpsDatabase {
  const ago = (ms: number) => now - ms;
  const soon = (ms: number) => now + ms;

  return {
    members: [
      { id: "m_owner", name: "Sample Ops owner", email: "owner@example.test", role: "ops_owner", active: true, taUserId: null },
      { id: "m_lead", name: "Sample Ops lead", email: "lead@example.test", role: "ops_lead", active: true, taUserId: null },
      { id: "m_accounts", name: "Sample Accounts", email: "accounts@example.test", role: "accounts", active: true, taUserId: null },
      { id: "m_dirops", name: "Sample Director of Operations", email: "dirops@example.test", role: "director_ops", active: true, taUserId: null },
    ],
    settings: [
      { key: "esa.sendHours", value: 2, updatedBy: null, updatedAt: null },
      { key: "esa.declineDays", value: 14, updatedBy: null, updatedAt: null },
      { key: "set.minCvs", value: 5, updatedBy: null, updatedAt: null },
      { key: "set.ownershipWorkingDays", value: 7, updatedBy: null, updatedAt: null },
      { key: "feedback.chaseDays", value: 1, updatedBy: null, updatedAt: null },
      { key: "feedback.stopAfterSilentDays", value: 4, updatedBy: null, updatedAt: null },
      { key: "feedback.callAfterDays", value: 1, updatedBy: null, updatedAt: null },
      // The owner's two depth rules, as numbers a lead can change (3 Nov).
      { key: "depth.holdAt", value: 5, updatedBy: null, updatedAt: null },
      { key: "depth.searchAgainAt", value: 3, updatedBy: null, updatedAt: null },
      { key: "hold.afterDays", value: 14, updatedBy: null, updatedAt: null },
      { key: "hold.reviewDays", value: 30, updatedBy: null, updatedAt: null },
      { key: "invoice.dueDays", value: 30, updatedBy: null, updatedAt: null },
      // From the agreement itself, which the owner said is the truth (3 Nov):
      // 1% a month, compounded, and nothing on an invoice disputed in good
      // faith. The board had said 5% simple; the document wins.
      { key: "invoice.latePctPerMonth", value: 1, updatedBy: null, updatedAt: null },
      { key: "invoice.lateCompounded", value: true, updatedBy: null, updatedAt: null },
      { key: "guarantee.days", value: 90, updatedBy: null, updatedAt: null },
      { key: "guarantee.warnDay", value: 75, updatedBy: null, updatedAt: null },
      { key: "replacement.workingDays", value: 60, updatedBy: null, updatedAt: null },
      // The agreement says 50% (their reviewer struck 25 and wrote 50, 10 Sep),
      // and the owner said to go with the document (3 Nov).
      { key: "refund.pct", value: 50, updatedBy: null, updatedAt: null },
      { key: "escalation.leadAfterHours", value: 24, updatedBy: null, updatedAt: null },
      { key: "escalation.directorAfterHours", value: 72, updatedBy: null, updatedAt: null },
      { key: "message.dailyCapPerClient", value: 4, updatedBy: null, updatedAt: null },
      { key: "switch.outreachLive", value: false, updatedBy: null, updatedAt: null },
      { key: "switch.timersEnabled", value: true, updatedBy: null, updatedAt: null },
      { key: "switch.taReadsEnabled", value: false, updatedBy: null, updatedAt: null },
      { key: "switch.taWritesEnabled", value: false, updatedBy: null, updatedAt: null },
    ],
    /*
     * The wording we start with. Phase 1 seeds only our own notices and one
     * chase, because the agreement and set wording is the owner’s to write and
     * arrives with the phase that sends it.
     */
    // No sample files: a row with no bytes behind it would be a broken link.
    files: [],
    // Three invented leads, one for each thing a person has to decide about:
    // a new company, a company we already have, and one the industry rule
    // catches. No real company is named anywhere in here.
    // No sample meetings: the sample leads are at the point of deciding,
    // which is where a person starts.
    agreements: [],
    meetings: [],
    // No sample clients: one is made the moment an agreement is countersigned.
    clients: [],
    // No sample sets: one arrives when TA says a round is ready.
    clientSets: [],
    holds: [],
    requirements: [],
    positions: [],
    talentPulse: [],
    leads: [
      {
        id: "ld_new",
        company: "SAMPLE CLIENT B",
        nameKey: "sample client b",
        contactName: "Sample contact",
        contactEmail: "contact@example.test",
        contactPhone: "+94770000001",
        source: "website",
        industry: "Manufacturing",
        website: "www.example.test",
        notes: "Asked for a head of finance through the website form.",
        industryFlagged: false,
        industryBecause: null,
        industryConfirmedBy: null,
        state: "new",
        reason: null,
        doNotInvite: false,
        clientTaId: null,
        ownerId: "m_owner",
        createdBy: null,
        createdAt: ago(2 * HOUR),
        updatedAt: ago(2 * HOUR),
      },
      {
        id: "ld_known",
        company: "SAMPLE CLIENT",
        nameKey: "sample client",
        contactName: "Sample contact",
        contactEmail: "hr@example.test",
        contactPhone: "",
        source: "email",
        industry: "Manufacturing",
        website: "",
        notes: "Came back for a second role.",
        industryFlagged: false,
        industryBecause: null,
        industryConfirmedBy: null,
        state: "new",
        reason: null,
        doNotInvite: false,
        clientTaId: null,
        ownerId: "m_owner",
        createdAt: ago(5 * HOUR),
        createdBy: null,
        updatedAt: ago(5 * HOUR),
      },
      {
        id: "ld_bank",
        company: "SAMPLE LEASING AND FINANCE",
        nameKey: "sample leasing and finance",
        contactName: "Sample contact",
        contactEmail: "careers@example.test",
        contactPhone: "",
        source: "call",
        industry: "Finance",
        website: "",
        notes: "Wants two credit officers.",
        industryFlagged: true,
        industryBecause: "finance",
        industryConfirmedBy: null,
        state: "new",
        reason: null,
        doNotInvite: false,
        clientTaId: null,
        ownerId: "m_lead",
        createdBy: null,
        createdAt: ago(26 * HOUR),
        updatedAt: ago(26 * HOUR),
      },
    ],
    calls: [],
    // Nothing invented here: the baseline is the real last six months, typed
    // in by the Ops team, and a made-up number would be worse than none.
    baseline: [],
    taCalls: [],
    outbox: [],
    events: [],
    templates: [
      {
        key: "task.notice",
        channel: "internal",
        name: "Something needs you",
        subject: "",
        body: "{{taskTitle}} — due {{dueWhen}}.",
        approvedForAuto: true,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.cover",
        channel: "email",
        name: "Agreement, cover email",
        subject: "{{client}} \u00b7 our agreement",
        body: `Dear {{contact}},

Thank you for your time today. Our agreement is attached.

Once it is signed and back with us we will start the search straight away.

Kind regards
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.chase.email.1",
        channel: "email",
        name: "Agreement chase 1, email",
        subject: "{{client}} \u00b7 our agreement",
        body: `Dear {{contact}},

Just a note about the agreement we sent. Could you let us know where it stands?

We can start as soon as it is signed.

Kind regards
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.chase.wa.1",
        channel: "whatsapp",
        name: "Agreement chase 2, WhatsApp",
        subject: "",
        body: "Hello {{contact}}, this is Career 141. Could you let us know where our agreement stands? Happy to answer anything on it.",
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.chase.email.2",
        channel: "email",
        name: "Agreement chase 3, email",
        subject: "{{client}} \u00b7 our agreement",
        body: `Dear {{contact}},

We are holding the search for {{client}} until the agreement is signed. Is there anything in it you would like to go through?

Kind regards
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.chase.wa.2",
        channel: "whatsapp",
        name: "Agreement chase 4, WhatsApp",
        subject: "",
        body: "Hello {{contact}}, following up on our agreement for {{client}}. Shall I send it again, or is there something to discuss?",
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.chase.email.3",
        channel: "email",
        name: "Agreement chase 5, email",
        subject: "{{client}} \u00b7 our agreement",
        body: `Dear {{contact}},

This is our last note about the agreement. If we do not hear from you we will close the file for now, and you are welcome back whenever it suits.

Kind regards
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "esa.chase.1",
        channel: "email",
        name: "Agreement chase 1",
        subject: "{{client}} · {{position}} — our agreement",
        body: `Dear {{contact}},

We sent our agreement for the {{position}} role on {{date}}. Could you let us know where it stands?

We can start the search as soon as it is signed.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "role.impractical.reply",
        channel: "email",
        name: "A role we cannot fill at that package",
        subject: "{{client}} · the role we discussed",
        body: `Dear {{contact}},

Thank you for your time on the {{position}} role.

Having looked at the market for that package, we do not think we can find you somebody who would both suit the role and accept it, and we would rather say so than take the search and disappoint you.

If the package changes, or if the role changes shape, we would be glad to look again - we will come back to you ourselves in a few months in any case.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "feedback.chase",
        channel: "email",
        name: "Asking a client for their feedback",
        subject: "{{client}} > {{position}} > SET {{setNumber}}",
        body: `Dear {{contact}},

Have you had a chance to look at the CVs we sent? Any feedback, even a line each, lets us carry on in the right direction.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "claim.noted",
        channel: "email",
        name: "A claimed CV, inside the window",
        subject: "{{client}} > {{position}} > SET {{setNumber}}",
        body: `Dear {{contact}},

Thank you for letting us know about {{candidate}}. We have taken them out of this set; the rest of it stands.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "claim.refused",
        channel: "email",
        name: "A claimed CV, after the window",
        subject: "{{client}} > {{position}} > SET {{setNumber}}",
        body: `Dear {{contact}},

Thank you for your note about {{candidate}}. Our agreement gives seven working days from receiving a set to tell us a candidate was already yours, and that period closed on {{closedOn}}, so {{candidate}} stays with us for this role.

We are happy to go through it with you.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "inactive.notice",
        channel: "email",
        name: "Putting a position on hold",
        subject: "{{client}} > {{position}} - on hold",
        body: `Dear {{contact}},

We have not heard back about the CVs for {{position}}, so we are putting the search on hold for now rather than keep sending.

Tell us whenever you are ready and we will start again from where we left off; nothing is lost.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "set.group_post",
        channel: "group_post",
        name: "The set, for the client's WhatsApp group",
        subject: "",
        body: `{{client}} > {{position}} > SET {{setNumber}}

{{cvCount}} CVs are in your email. Any feedback on each one helps us carry on in the right direction.`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
      {
        key: "set.cover",
        channel: "email",
        name: "Sending a CV set",
        subject: "{{client}} > {{position}} > SET {{setNumber}}",
        body: `Dear {{contact}},

{{cvCount}} CVs are attached for the {{position}} role.

Kind regards,
{{opsPerson}}
Career 141`,
        approvedForAuto: false,
        updatedBy: null,
        updatedAt: null,
      },
    ],

    holidays: [
      { date: "2026-11-24", name: "Sample holiday" },
      { date: "2026-12-25", name: "Christmas Day" },
    ],
    timers: [
      {
        id: "t_ownership",
        kind: "set.ownership",
        subjectType: "clientSet",
        subjectId: "cs_1",
        startsAt: ago(6 * DAY),
        dueAt: soon(26 * HOUR),
        warnAt: ago(2 * HOUR),
        state: "warned",
        firedAt: null,
        ownerId: "m_owner",
        payload: { label: "Sample Client A, set 2" },
      },
      {
        id: "t_guarantee",
        kind: "guarantee.end",
        subjectType: "placement",
        subjectId: "pl_1",
        startsAt: ago(90 * DAY),
        dueAt: soon(4 * HOUR),
        warnAt: ago(15 * DAY),
        state: "warned",
        firedAt: null,
        ownerId: "m_owner",
        payload: { label: "Sample Client B, Finance manager" },
      },
    ],
    tasks: [
      {
        id: "k_call",
        kind: "call",
        title: "Call Sample Client C about their feedback",
        body: "No feedback on set 1 for two days. Call them, then record what they said.",
        assigneeId: "m_owner",
        dueAt: ago(2 * DAY),
        state: "open",
        subjectType: "clientSet",
        subjectId: "cs_2",
        link: null,
        outcome: null,
        doneBy: null,
        doneAt: null,
        createdAt: ago(2 * DAY),
      },
      {
        id: "k_record",
        title: "Record yesterday's call with Sample Client D",
        kind: "record",
        body: "One line is enough: what they said and what happens next.",
        assigneeId: "m_owner",
        dueAt: soon(6 * HOUR),
        state: "open",
        subjectType: "client",
        subjectId: "cl_4",
        link: null,
        outcome: null,
        doneBy: null,
        doneAt: null,
        createdAt: ago(18 * HOUR),
      },
    ],
    messages: [
      {
        id: "msg_set",
        channel: "email",
        to: ["hr@example.test"],
        subject: "SAMPLE CLIENT A > Head of engineering > set 2",
        body: "Dear Sample contact,\n\nSix CVs are attached for the Head of engineering role.\n\nKind regards,\nCareer 141",
        templateKey: "client.set",
        state: "draft",
        subjectType: "clientSet",
        subjectId: "cs_1",
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        providerMessageId: null,
        note: null,
        attachmentFileIds: [],
        createdAt: ago(1 * HOUR),
      },
      {
        id: "msg_chase",
        channel: "email",
        to: ["md@example.test"],
        subject: "Following up on our agreement",
        body: "Dear Sample contact,\n\nJust a note to follow up on the agreement we sent.\n\nKind regards,\nCareer 141",
        templateKey: "esa.chase2",
        state: "draft",
        subjectType: "esa",
        subjectId: "esa_1",
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        providerMessageId: null,
        note: null,
        attachmentFileIds: [],
        createdAt: ago(3 * HOUR),
      },
    ],
    inbound: [],
    audit: [],
  };
}
