# 15 · Implementation plan: the Ops backend, connected to the TA System

_Version 2.1, 1 Nov 2026 (second pass in Part J). For the owner's questions and approval before any code. Replaces
version 1 of this file. Written from: the owner's planning board (59 cards, re-read 1 Nov,
unchanged since 27 Oct: every flow, every problem card, every note), the TA System's code on
`main`, and the decisions of 20 Oct to 28 Oct. Where this plan says "TA field `x`" it is the
real field name in TA's `convex/schema.ts`._

**How to read it.** Part A is the orientation. Part B lists every problem on the board and
the solution this plan builds for it. Part C is a working day, Ops and TA side by side,
hour by hour, showing what the system does at each hour and what crosses between the two
systems. Part D is the data: every TA table Ops touches, every Ops table, and how they
link. Part E is the connection: the API, the events, the TA changes. Part F is the
integrations, including the decision on calls. Part G is the build: eight phases, each with
20-25 numbered steps. Part H is testing, release and the pilot. Part I is the open
decisions. If you ask "how does an Ops person's day go with this system", Part C answers
it; if you ask "where is X stored", Part D; if you ask "when is X built", Part G.

---

# Part A · Orientation

## A1. The two systems, two teams, one server

| | TA System (recruiter side) | Ops system (client side) |
|---|---|---|
| State | **Live** since 21 Sep 2026, 78,000+ candidates, used daily by the TAs | To be built; nothing exists |
| Team | Binath (TA repo) | Sanjeev (Ops repo); Binath for the TA-side API blocks |
| Repository | `career141-dev/ta-system` | `career141-dev/ops-system` |
| Backend | self-hosted Convex `career141-backend-1`, database `convex_self_hosted` | its own self-hosted Convex, database `convex_ops` in the **same Postgres server** |
| Where | VPS 94.136.189.48, `/root/career141`, `/opt/ta-prod` | same VPS, `/opt/ops-prod`, own ports on 127.0.0.1, own names in the same Caddy |
| Link | adds a few API endpoints and an events table; nothing existing changes | calls TA's API; reads TA's events; never touches TA's database |

**The rule that shapes everything:** the TA System must keep working exactly as it does.
Ops is standalone. The only shared thing is the Postgres server (two separate databases)
and the API.

## A2. The journey, in one line

Client contacts us → Ops owns the client → intro call → ESA signed → requirement meeting →
**the position opens in TA from Ops** → TA finds candidates → **Ops sends the client set**
→ client decides → **Ops books interviews, TA handles the candidate** → offer → **TA
places, Ops is told the same day** → invoice → 90-day guarantee → close. Phases A-I in
[04](04-OPS-FLOW.md), all 250 steps in [14](14-DIAGRAM-DEEP-WALKTHROUGH.md).

## A3. What the board says is wrong today (the problem groups)

From the board's own problem cards: **chasing is late** (ESA, client feedback, candidate
replies, invites); **news passed by hand arrives late** (signed ESA reaching the Director
after months, Asma hearing of a January joining on 30 March, cancelled interviews, TopJobs
status); **the same data retyped** (master, client, job and interview sheets, no client
contact sheet); **reasons and owners missing** (Director and client rejections, DOJ moves
with no owner, reschedules untracked); **no safety net** (no back-up at the final stage,
adverts hanging open, no invoice records, package asked two months after joining).
Part B takes each one.

---

# Part B · Every problem on the board, and the solution this plan builds

Sources: c3620 problems in today's workflow, the 41 per-step incidents on c719, c713 archive
map, c5185 flow problems, c4309 system gaps, c4103 map gaps, c2499 open questions.
"Built in" points to the phase and step in Part G.

## B1. Chasing is late

| # | Problem (board) | Solution | Built in |
|---|---|---|---|
| 1 | ESA follow-ups miss the 5-working-day activation KPI; Rushda chases by hand from a tracker | ESA state machine with a chase plan (email 1, WhatsApp 1, email 2, WhatsApp 2, email 3, call task) driven by timers; each chase drafted for the ops owner's approval; any client reply cancels the chase; decline at 14 days | P2 steps 9-16 |
| 2 | ESA copy came back unsealed and was resent (22 Apr 2025); placeholders left in a draft (Best Pacific) | ESA built from a template with named fields; blank required field blocks sending; version kept with the file | P2 steps 5-8 |
| 3 | Client feedback chased late; 21 positions "pending client feedback" (13 Mar 2026); Damad chased 29 Sep | Feedback timer from the client's receipt date: chase drafted at 1 day, call task next day, stop after 3-4 silent days, hold at 14 days; the inbox shows every pending client | P4 steps 10-15 |
| 4 | Candidates heard nothing (Prima, 13 Mar 2026) | Rejection notices from one approved template, automatic, for Director and client rejections (TA sends them; Ops triggers the client ones through the decision write) | P4 step 17; TA rule T5 |
| 5 | Invites unanswered (Neel, Dilum, 25 Sep 2026) | Day-before reconfirm timer; no reply → call task to the TA; candidate out → client notice 1 day / 3 h before | P5 steps 11-14 |
| 6 | Countersign and Director set have a single reminder and no escalation | Timer with one reminder, then an escalation task to the ops lead (⚪ owner to confirm the escalation target) | P2 step 18; ⚪ |
| 7 | Payment never chased; no late charge | Invoice timer at 30 days; chase with 5% per unpaid month; write-off task at ~60 days | P6 steps 13-17 |

## B2. News passed by hand arrives late

| # | Problem | Solution | Built in |
|---|---|---|---|
| 8 | Signed ESA reached the Director only on 2 Jun 2026 (Fletching) | On "signed": internal notice to ops, TA lead and Director at once; countersign task with a 1-day timer; countersigned copy emailed back automatically | P2 steps 16-19 |
| 9 | Asma learned of a January joining on 30 Mar 2026; package details missing at invoicing | TA's Place requires package, DOJ and offer letter; TA writes event `placement.created`; Ops notifies Asma and the owner the same day; invoice drafted on joining day from the ESA fee rule | P6 steps 1-5; TA rules T1 |
| 10 | Interview cancellations learned late (24-25 Sep 2026) | Client cancel recorded in Ops → TA interview rescheduled/cancelled through the API → bell to the TA at once | P5 step 15 |
| 11 | TopJobs status and post removal relayed through ops by hand | Ad-channel record with live/closed dates and a 2-week timer; TA told through `notify` on each change; close checklist at the end | P3 steps 14-19; P7 step 14 |
| 12 | TA hears client feedback late | Client decision written to TA the moment the owner confirms it; TA bell | P4 steps 16-18 |
| 13 | Ops must always be told to remove posts | Close checklist creates the "close LinkedIn" task for the TA and "close TopJobs" for ops | P7 steps 13-15 |
| 14 | Placement updates posted by hand in a WhatsApp group | The same-day notice replaces the post; the group post text is still drafted if the owner wants to post it | P6 step 4 |

## B3. The same data retyped

| # | Problem | Solution | Built in |
|---|---|---|---|
| 15 | Master, client, job and interview sheets updated by hand; tabs not updated | No sheets: the client record (TA), the opening (TA), the Ops client view, the interview record (TA) and the placement record (Ops) are the single copies; Ops reads TA live and never copies | Part D; P1 steps 20-23 |
| 16 | No master client contact sheet (Sapna, 14 May 2026) | Client contacts live on TA's `clients.contacts`; Ops creates and updates them through the API; the Clients screen is the contact sheet | P2 step 3 |
| 17 | Requirement in the TA lead's head; handover date unclear | Requirement form in Ops; "Create opening in TA" copies it as the opening's brief; TA stamps `assignedAt`; Ops stores the opening ID and the handover time | P3 steps 6-10 |
| 18 | Hunted CVs not always copied to the CV mailbox; Talent Pulse CVs don't reach the job | TopJobs/Talent Pulse CVs filed to the opening through the API with `source`; source tags on every CV | P3 steps 18-22 |
| 19 | Interview schedule kept in a summary sheet; reschedules not tracked | One interview record in TA with history; Ops writes every change through the API | P5 steps 8-16 |

## B4. Reasons and owners missing

| # | Problem | Solution | Built in |
|---|---|---|---|
| 20 | Client rejection reasons not recorded | Decision form requires a reason per rejected candidate; written to TA | P4 step 16; TA rule T2 |
| 21 | Director gives no reason | Accepted: no reason needed (decision) | — |
| 22 | DOJ moved with no owner (15 Jun / 21 May 2026); visa delays | DOJ change form: new date, who, why; written to TA; the ops owner owns DOJ tracking; reminders 7 and 1 days before | P6 steps 6-8 |
| 23 | No ops owner per client; owner set twice on the flow | `opsOwnerId` on the TA client (written by Ops) and on the Ops lead; set once at lead tagging; movable by the ops lead | P1 step 12; P2 step 2 |
| 24 | Handover date unclear | Stamped by "Create opening in TA" (Ops) and `assignedAt` (TA) | P3 step 9 |
| 25 | Nobody owns the 90-day window and the weekly report | Guarantee record owned by the ops owner; weekly report built by the system, reviewed by the TA lead | P7 steps 1-5, 16-19 |

## B5. No safety net

| # | Problem | Solution | Built in |
|---|---|---|---|
| 26 | No back-up candidate at the final stage (AMW 30 Jan 2026) | Pipeline depth rule: hold at 5 shortlisted keeps a pool; TA's back-up tag (`backupForApplicationId`) shown on the Ops set; slot loop falls back to the back-up | P4 steps 19-21; P5 step 6 |
| 27 | Posts hang open with 20-30 CVs; no capacity planner | Under-20-CVs-a-day repost rule is TA's; close checklist; monitor-only closes LinkedIn | P7 step 14; TA |
| 28 | No immediate allocation, no full JD or package on arrival | Lead tagged to an owner at once; package/role/brief captured on the intro call; requirement form before any opening | P2 steps 1-4, P3 step 6 |
| 29 | No invoice records | `opsInvoices` and `opsPayments` with numbering and CSV export | P6 steps 9-18 |
| 30 | Candidate withdrew before joining (Thushara, Sithusha); no-show (Vinuki) | `placement.cancel` / no-show paths: client options message, replace or stop, nothing invoiced; back-up promoted in TA | P6 steps 8-9 |
| 31 | Client changes the brief with the shortlist (age up to 50, budget) | Requirement record keeps versions; a changed brief is a new version sent to TA as an opening update (`openings/{id}` patch) with a bell | P3 step 11 |

## B6. Flow and rule problems from the diagram checks (c5185, c4309, c4103)

| # | Problem | Solution | Built in |
|---|---|---|---|
| 32 | Chase kept going after a reply (ESA, candidate, client) | Every reader cancels the chase timer for its subject | P1 step 17 |
| 33 | Feedback timer waited for the ownership window | Both start at receipt, independently | P4 steps 7, 10 |
| 34 | Weekly report, Talent Pulse, surcharge tied to the wrong events | Weekly report: Monday desk job; Talent Pulse: Tuesday job; surcharge: 3 months from set sent | P3 step 20; P7 step 16; P4 step 22 |
| 35 | Silence rule conflicts (2 weeks / ESA 14 days / 2 working days) | One rule: 14 calendar days from profiles shared; chase at 1 day; call next day; stop at 3-4 silent days | settings seeded in P1 step 9 |
| 36 | 3-pending and 5-total rules overlap | Evaluated in that order after every decision: first "≥5 shortlisted → monitor", else "≤3 pending → add-on", else "follow-up" | P4 step 19 |
| 37 | Replacement billed like a new hire | `isReplacementOf` on the placement: no invoice, new guarantee | P6 step 10; P7 step 6 |
| 38 | Payment logged and fee collected = same event | One `opsPayments` row sets the invoice paid | P6 step 14 |
| 39 | Position closes at fee while the guarantee runs; closed twice | Closes once, at guarantee end / refund / write-off, through the close checklist | P7 steps 12-15 |
| 40 | Two follow-up flows in TA; old day-3/5/7 still runs | TA rule T4 retires it | TA |
| 41 | AI voice calls suspended; calls stay manual | Call tasks with the number and a one-line outcome (Part F4); no AI calling now | P1 step 24 |
| 42 | Alerts only to the main recruiter; no escalation | Ops escalation ladder: owner → ops lead → Director of Operations, per timer kind | P1 step 15 |
| 43 | Client round saved as "held", never emailed | Ops sends it (P4) and marks it sent in TA | P4 steps 3-6; TA change |
| 44 | Mail is the weak link | Ops mail reader with delta sync, batches, a stall alert, matching by reference | P1 steps 18-19 |
| 45 | Staff may keep the sheets alive | Every sheet column has a system home (Part D4); the inbox is the only page a person must open; sheets are frozen at go-live | P8 step 21 |

---

# Part C · A working day with the system: Ops and TA side by side

The same people, two systems, one day. Times are Colombo. **What crosses** is the API
call or event between the systems at that moment. The Ops person is an **ops owner** (say
Rushda); the TA person is a **TA** (say Sameera) on a 100% position; the TA lead, Asma
(accounts), Mr Azeem (Director) and marketing appear where the day needs them.

## C1. Before 9:00 — the system has already worked

| Ops system did overnight | TA System did overnight | Crossed |
|---|---|---|
| Timers fired: an ESA chase is due (draft waiting), one ownership window ends tomorrow (warning), one invoice hit day 30 (chase drafted), a guarantee reaches day 90 today (clean-end task) | The 7-minute follow-up sweep sent candidate reminders; CV reading and scoring ran; the SLA check found a stale role | TA events read every minute: `client_set.ready` for Delmo (TA built set 2 last night), `placement.created` for Silver Bullet (a TA pressed Place at 18:30) |
| Mail reader filed 11 inbound emails: 6 matched by reference, 3 by client domain, 2 left for filing | Mail intake filed 40 CVs to openings from linkedin@ and the per-job mailboxes | — |
| Monday only: the weekly active-positions report was built at 08:00 and a review task sent to the TA lead | — | `GET reports/active-positions` |

## C2. 9:00 — Rushda opens the Ops inbox

Her home page shows, in order: **Approvals waiting (4):** ESA chase email 2 for Fletching;
client set 2 for Delmo; feedback chase for Prima; invoice chase for AMW. **Due today (3):**
intro call with a new client at 11:00; record the outcome of yesterday's call to Carsons;
confirm Silver Bullet's placement details reached Asma (auto-done, shown as done).
**Late (1):** Damad's feedback is 2 days overdue; the call task is red. **Clocks (2):**
Prima's ownership window ends tomorrow; AMW's guarantee ends today.

| She does | System does | Crossed |
|---|---|---|
| Opens Delmo set 2, sees 6 candidates with prepared CVs, approves | Email with 6 PDFs sent from the Ops mailbox with reference `[C141-OPS-…]`; `opsClientSets.state=sent`; receipt date = today; ownership timer (7 working days) and feedback timer (1 day) start; a group-post text appears as a task | `POST client-sets/{id}/sent` → TA marks the round sent; TA bell to Sameera "Set 2 sent to Delmo" |
| Approves Fletching's ESA chase email 2 | Sent; chase step 3 timer starts (WhatsApp 2 in 2 days) | — |
| Approves Prima's feedback chase | Email + WhatsApp template sent; call-task timer starts for tomorrow | — |
| Asks accounts to look at the AMW invoice chase (reassigns) | Task moves to Asma | — |

## C3. 9:30 — Sameera (TA) starts her workday in the TA System

She picks her 100% position (Delmo Head of Engineering) and her follow-up positions in the
workday screen, as today. In her bell: "Set 2 sent to Delmo", and a bell from Ops: "Client
Prima: feedback chased, call tomorrow". She works the pipeline: new CVs, AI follow-up
replies, shortlists.

| She does | TA does | Crossed |
|---|---|---|
| Shortlists 2 candidates from new CVs | Follow-up starts (WhatsApp + email) | — |
| Sees a TA alert "JD not approved after 1 day" on a new opening (created from Ops yesterday) and approves the JD | Scoring starts; LinkedIn post can go live | event `opening.jd_approved` → Ops shows "JD approved" on the client's position |

## C4. 10:00 — a new lead, and the TA lead

A website enquiry arrived at 09:48. The Ops system created the lead, checked TA for a
client with the same name key (none), flagged nothing (manufacturing), and assigned it to
Rushda (round-robin). Her inbox shows "New lead: Hemas Packaging".

| She does | System does | Crossed |
|---|---|---|
| Books the intro call for Thursday 10:00, adds the TA lead | Meeting invite emailed to the client; `notify` to the TA lead; reminder timer | `GET people` (to pick the TA lead); `POST notify` |
| — | ESA clock will start only when the call is held | — |

## C5. 11:00 — intro call (phone), then the ESA

The call happens on the phone, as today. Afterwards:

| She does | System does | Crossed |
|---|---|---|
| Marks "held", fills package (LKR 350k), role (Head of Finance), brief | ESA clock starts (2 h); ESA drafted from the template with the client's fields; one field (tax number) blank → "cannot send" | — |
| Gets the tax number by WhatsApp, fills it, approves | PDF generated; cover email sent; `opsEsa.state=sent`; chase and 14-day decline timers start | `POST clients` (new client with ops owner) → TA client created; `POST clients/{id}/esa` status `sent` |
| — | TA lead sees the brief in a bell | `POST notify` |

## C6. 13:00 — client replies arrive

The mail reader matched Delmo's reply to set 2 (reference in the subject). The AI proposed:
"shortlisted: 2 (names), rejected: 4 (reasons: salary too high ×2, location, over-qualified)".

| She does | System does | Crossed |
|---|---|---|
| Confirms the proposal, edits one reason | Six decisions saved; feedback timer cancelled; pipeline depth evaluated: 2 shortlisted total, 2 pending → mode stays follow-up | `POST applications/{id}/client-decision` ×6 → TA moves stages, records the reply, sends rejection notices from the template; bell to Sameera |
| — | Sameera sees the two shortlisted at Client Shortlist in TA | — |

Meanwhile Rushda gets a WhatsApp from Prima's HR on the Ops number: "we already had
Nimal's CV from another agency". The webhook filed it under Prima set 1.

| She does | System does | Crossed |
|---|---|---|
| Records a claim on Nimal: within 7 working days → "dropped, client-owned" | Claim saved; reply drafted ("noted, the rest of the set continues") → approved → sent | `POST applications/{id}/client-owned` → TA moves the candidate out of this opening with reason "client-owned" |

## C7. 14:00 — interviews

Delmo asks for interviews for the two shortlisted and gives three slots.

| She does | System does | Crossed |
|---|---|---|
| Chooses "we schedule", records the three slots | Task to Sameera: "check slots with candidates A and B" | `POST notify` |
| (Sameera, in TA, calls both and records "A: slot 2, B: slot 3" on the Ops task from her bell link, or tells Rushda) | Two interviews booked | `POST interviews` ×2 → TA interview records (time, round, mode Teams, interviewers) |
| — | Teams meetings created from the Ops calendar; invites emailed to Delmo's two interviewers; links saved; reconfirm timers set for the day before 09:00 | `POST interviews/{id}` with `teamsLink`; TA bell to Sameera; TA sends the candidates their invites by its own channels |

## C8. 15:00 — a placement reaches Ops

Yesterday evening a TA pressed Place on Silver Bullet Finance Manager with package, DOJ
(1 Dec) and the offer letter (TA now requires them). Ops consumed `placement.created` at
18:31 and sent the same-day notice to Asma and the owner at once.

| Asma does (accounts) | System does | Crossed |
|---|---|---|
| Opens the placement; sees the fee rule from the ESA (1 month gross) and the package; nothing to do until joining day | DOJ reminders set (24 Nov, 30 Nov); 9 AM joining task set for 1 Dec; the invoice will be drafted on joining | `GET placements/{id}` |
| Records AMW's payment (received today) | Invoice paid; "fee collected" notice to the owner; AMW guarantee stays valid | — |

## C9. 16:30 — guarantee and money

AMW's guarantee reached day 90 today with nobody left.

| Rushda does | System does | Crossed |
|---|---|---|
| Ticks "clean end" | Close checklist created: "close LinkedIn" (task to the TA), "close TopJobs" (hers), close the opening, close the lead | `POST openings/{id}/status closed` → TA closes the opening and its posts; bell to the TA |
| Completes "close TopJobs" (she emails TopJobs from the drafted message) | Ad channel closed | — |

## C10. 17:00-17:30 — Sameera's end of day; Rushda's end of day

| Sameera (TA) | Rushda (Ops) | Crossed |
|---|---|---|
| Sends her end-of-day email with the Director set (5 CVs) as today | Her inbox is empty except tomorrow's items; she records the Carsons call outcome in one line ("will send slots Friday") | event `director_round.sent` → Ops shows "Director set out" on the position |
| After 5 PM she phones two candidates about today's interviews and logs feedback in TA | The client-feedback WhatsApp for Delmo is drafted from Sameera's notes; Rushda approves it tomorrow morning | event `interview.feedback` → Ops drafts the client message |

## C11. The other people's days, in short

| Person | Daily | Weekly |
|---|---|---|
| **Ops lead** | Sees every owner's inbox; moves clients; approves when an owner is away; watches the "late" list across the desk | Checks the switches, templates and holiday list |
| **Asma (accounts)** | Payments received; invoice chases to approve; write-off decisions | CSV export of invoices and payments |
| **Mr Azeem (Director)** | Countersign tasks (uploads or ticks); Director review in TA as today | Receives the weekly report by email |
| **TA lead** | Picks TAs and 100% days in TA; joins intro and requirement calls; sees client/requirement details in bells | Reviews and approves the weekly report on Monday |
| **Director of Operations** | — | Refund decisions when a replacement deadline passes |
| **Marketing** | Flyer tasks for TopJobs | Tuesday: Talent Pulse list arrives; Wednesday: posts, ticks "posted" |

## C12. What the two systems exchange in a normal day (counts to size the API)

Reads: ~200 (openings, pipelines, sets, placements for screens, cached 30 s). Writes: ~20
(decisions, sets sent, interviews, status). Events consumed: ~50. Mail read: ~40 inbound.
Messages sent: ~25 (all approved or template). Timers fired: ~30. This is small; batches of
50-200 and one-minute crons are more than enough and cannot load the shared server.

---

# Part D · The data: tables, fields and how they link

## D1. TA tables Ops touches (real names and the fields that matter)

Ops never reads these directly; it reads them through the API. The fields listed are the
ones the API exposes or writes.

| TA table | Fields Ops reads | Fields Ops writes (through API) | CP |
|---|---|---|---|
| `users` | `_id`, `fullName`, `email`, `taRole`, `isActive`, `clerkUserId` | — | 01 |
| `clients` | `_id`, `name`, `nameKey`, `industry`, `contacts`, `esaSignedAt`, `status` | `name`, `industry`, `contacts`, **`opsOwnerId` (new)**, `esaSignedAt` | 02 |
| `esaRecords` | `status`, `signedAt`, `feePercent`, `guaranteeDays`, `dueAt`, `clientId` | all of them + **`feeRule` (new: months of gross / basic / nationality rule)**, `declinedAt` (new) | 03 |
| `jobs` (opening) | `_id`, `title`, `clientId`, `status`, `positionStatus`, `jdStatus`, `priorityTier`, `assignedTaIds`, `primaryRecruiterId`, `taLeadId`, `headcount`, `salaryMin/Max`, `location`, `workLocations`, `stageCounts`, `assignedAt`, `requirementReceivedAt`, `closedAt`, `filledAt` | create (title, clientId, country, nationality, workLocations, headcount, brief), `status`/`positionStatus` with reason, `requirementReceivedAt` | 04, 05, 12, 22, 23 |
| `briefs` | — | created with the opening (`kind=management_to_lead`, `notesMarkdown` = requirement) | 04 |
| `jobAssignments` | `userId`, `assignmentRole`, `workingStage`, `isActive` | `workingStage` (add_on / follow_up / 100%) for a TA | 14 |
| `jobPosts` | `channel`, `externalUrl`, `status`, `postedAt`, `cvCountToday` | **`adChannelState` (new: topjobs/talentpulse live/closed, cost)** | 05, 06 |
| `cvUploads` | — | create with `source` (`topjobs`, `talentpulse`), `assignToJob` | 06 |
| `applications` | `_id`, `candidateId`, `candidateName`, `currentStage`, `ownerTaId`, `setNumber`, `isAddOn`, `backupForApplicationId`, `rejectReason`, `placedAt`, `interviewId`, `offerId` | stage moves with reason (client decision), **`clientOwnedAt` (new)** | 07, 10, 11, 13, 14 |
| `pipelineEvents` | read through `events` | — | 07 |
| `reviewRounds` (kind client) | `_id`, `setNumber`, `applicationIds`, `dispatch`, `status`, `sentAt`, `decisions` | `dispatch=sent`, `sentAt`, **`receivedAt` (new)** | 08, 09 |
| `clientReviews` | `decision`, `clientFeedback`, `reviewedAt` | created by the client-decision write | 10 |
| `directorReviews` | `decision`, `reviewedAt` | — | 08 |
| `interviews` | `_id`, `scheduledAt`, `round`, `interviewFormat`, `interviewers`, `outcome`, `taOutcome`, `taFeedback`, `confirmedAt`, `taHistory` | create, reschedule, outcome, client decision, **`teamsLink` (new)**, `coordinatedBy=ops` | 15, 16 |
| `offers` | `status`, `offeredSalary`, `startDateMs`, `declineReason` | — | 18 |
| `placements` | `_id`, `joinDateMs`, `placedSalary`, `salaryBasis`, `feePercent`, `guaranteeDays`, `joinConfirmedAt`, `fellThroughAt/Reason`, `invoice*` | **`package` (new, structured)**, **`offerLetterFileId` (new)**, `joinDateMs` (with history), `joinConfirmedAt`, `fellThroughAt/Reason`, `invoiceSent/At/Number/PaidAt` (Ops keeps TA's checklist in step) | 19, 20, 22 |
| `candidates` | `fullName`, `doNotContact` | — | 09 |
| `notifications` | — | insert (`type=ops_notice`, `title`, `body`, `jobId`, `candidateId`) | 25 |
| `referees` / reference (new) | `reportText`, `reportedAt` | create request | 17 |
| **`contractEvents` (new)** | `type`, `at`, ids, `data`, cursor | — | all |

## D2. The Ops tables (all new, prefix `ops`)

Convex tables in `ops-system/convex/schema.ts`. "Index" lists the lookups the screens and
jobs need. Every table has `createdAt`, `updatedAt`; writes go through one helper that also
writes `opsAudit`.

### Foundation

| Table | Fields | Indexes | Notes |
|---|---|---|---|
| `opsMembers` | `clerkUserId`, `taUserId?`, `name`, `email`, `phone?`, `role` (ops_owner · ops_lead · accounts · director_ops · marketing · director_ro · ta_lead_ro), `active`, `flags[]` (esaCaller, …), `mailboxFrom?` | by_clerk, by_role | the people |
| `opsSettings` | `key`, `value` (json), `updatedBy`, `updatedAt` | by_key | every number and switch (seed list in P1 step 9) |
| `opsHolidays` | `date` (YYYY-MM-DD), `name` | by_date | Sri Lanka |
| `opsTimers` | `kind`, `subjectType`, `subjectId`, `startsAt`, `dueAt`, `warnAt?`, `state` (running · warned · fired · done · cancelled), `firedAt?`, `ownerId`, `payload` | by_due_state, by_subject | one row per clock |
| `opsTasks` | `kind` (approve · call · record · decide · remind · escalation · check), `title`, `body`, `assigneeId`, `clientTaId?`, `openingTaId?`, `subjectType/Id`, `dueAt`, `priority`, `state` (open · done · dismissed · snoozed), `doneBy/At`, `outcome?`, `link`, `source` | by_assignee_state_due, by_subject | the inbox |
| `opsMessages` | `channel` (email · whatsapp · group_post · internal), `direction` (out), `to[]`, `cc[]`, `from`, `subject`, `body`, `attachments[]` (file ids), `templateKey`, `clientTaId?`, `subjectType/Id`, `threadKey`, `state` (draft · approved · queued · sent · failed · blocked), `approvedBy/At`, `sentAt`, `providerMessageId`, `error?`, `testModeRecipients?` | by_state, by_subject, by_thread | one way out |
| `opsInbound` | `channel` (email · whatsapp), `from`, `fromName`, `receivedAt`, `subject`, `body`, `attachments[]`, `threadKey?`, `providerId`, `clientTaId?`, `subjectType/Id?`, `matchedBy` (reference · domain · phone · manual · none), `readState` (new · filed · actioned), `aiSummary?`, `aiProposal?` | by_received, by_client, by_readState | one way in |
| `opsEvents` | `taEventId`, `type`, `at`, `payload`, `consumedAt`, `handledAt?`, `error?`, `attempts` | by_taEventId, by_type | TA events copy + cursor row |
| `opsAudit` | `actorId`, `action`, `subjectType/Id`, `before?`, `after?`, `reason?`, `at` | by_subject, by_actor | everything |
| `opsFiles` | `kind` (esa_draft · esa_signed · esa_countersigned · cv · invoice · offer_letter · flyer · scan · other), `r2Key`, `name`, `size`, `mime`, `sha256`, `subjectType/Id`, `uploadedBy`, `uploadedAt` | by_subject | R2 registry |
| `opsTemplates` | `key`, `channel`, `kind` (message · document), `subject?`, `body`, `placeholders[]`, `metaTemplateName?`, `approvedForAuto`, `version`, `active` | by_key | messages and documents |
| `opsEscalations` | `timerKind`, `ladder[]` (role or member id), `afterHours[]` | by_kind | who is told next |

### Clients side

| Table | Fields | Indexes |
|---|---|---|
| `opsLeads` | `source`, `companyName`, `nameKey`, `contactName`, `contactEmail`, `contactPhone`, `industry?`, `bankingFinanceFlag`, `flagConfirmedBy?`, `notes`, `ownerId`, `clientTaId?`, `state` (new · intro_call · held · esa · requirement · opened · closed), `closedReason?` (industry · silent · esa_declined · impractical · client_stopped), `inviteBackAt?`, `doNotInvite`, `createdBy` | by_owner_state, by_nameKey, by_clientTa |
| `opsClientProfiles` | `clientTaId`, `ownerId`, `billingContact`, `whatsappGroupName?`, `groupCreatedAt?`, `preferredChannel`, `doNotContact`, `notes`, `stage` (lead · onboarding · active · on_hold · closed) | by_clientTa, by_owner |
| `opsMeetings` | `kind` (intro · requirement · negotiation), `leadId?`, `clientTaId?`, `at`, `attendeeMemberIds[]`, `taLeadId?`, `clientAttendees[]`, `link?`, `state` (booked · held · not_held · cancelled), `rebookCount`, `outcomeNotes?`, `packageNotes?`, `roleNotes?`, `briefNotes?`, `termsNotes?`, `heldAt?` | by_lead, by_client, by_at |
| `opsEsa` | `clientTaId`, `leadId?`, `taEsaRecordId?`, `templateVersion`, `fields` {company, address, taxNo, signatoryName, signatoryEmail, feeRule {monthsOfGross, basis: gross|basic, nonSriLankanMonths}, guaranteeDays, paymentDays, replacementWorkingDays, refundPct, inactivityDays}, `state` (draft · sent · chasing · negotiating · signed · countersigned · declined · expired), `draftFileId?`, `sentAt?`, `sentMessageId?`, `chaseStep` (0-6), `signedAt?`, `signedFileId?`, `countersignedAt?`, `countersignedFileId?`, `declinedAt?`, `declineReason?`, `history[]` | by_clientTa, by_state |

### Positions side (Ops's view of a TA opening)

| Table | Fields | Indexes |
|---|---|---|
| `opsRequirements` | `clientTaId`, `leadId?`, `meetingId`, `version`, `title`, `jdNotes`, `keyInsights`, `salaryMin?`, `salaryMax?`, `currency`, `location`, `level`, `headcount`, `nationality`, `workLocations[]`, `practical?`, `impracticalReason?`, `inviteBackAt?`, `openingTaId?`, `openedAt?`, `state` (draft · saved · opened · declined · superseded) | by_clientTa, by_openingTa |
| `opsPositions` | `openingTaId`, `clientTaId`, `requirementId`, `ownerId`, `title`, `stage` (searching · on_hold · interviews · offer · placed · guarantee · closed), `holdReason?`, `tsFromTa` (last event seen), `lastEventAt` | by_openingTa, by_client, by_stage |
| `opsAdChannels` | `openingTaId`, `channel` (topjobs · talentpulse), `state` (requested · flyer_pending · flyer_ready · sent · live · closed), `requestedBy`, `flyerFileId?`, `cost?`, `sentMessageId?`, `liveAt?`, `closeAt?`, `closedAt?`, `trackedLink?`, `cvCount` | by_opening, by_state |
| `opsTalentPulseIssues` | `weekOf`, `rows[]` {openingTaId, brief, link}, `state` (compiled · posted), `postedAt?`, `postedBy?` | by_week |

### Client set and decisions

| Table | Fields | Indexes |
|---|---|---|
| `opsClientSets` | `openingTaId`, `roundTaId`, `setNumber`, `candidates[]` {appTaId, candidateId, name, cvFileId, backupOf?}, `state` (ready · approved · sent · received · closed), `dueAt`, `sentAt?`, `receivedAt?`, `sentMessageId?`, `groupPostTaskId?` | by_opening, by_roundTa, by_state |
| `opsOwnershipClaims` | `setId`, `appTaId`, `claimedAt`, `withinWindow`, `decision` (dropped · refused), `decidedBy`, `replyMessageId?` | by_set |
| `opsClientDecisions` | `setId`, `appTaId`, `decision` (shortlisted · rejected), `reason?`, `source` (email · whatsapp · call · group), `inboundId?`, `confirmedBy`, `confirmedAt`, `sentToTaAt?`, `taResult?` | by_set, by_app |
| `opsDepthChecks` | `openingTaId`, `at`, `pending`, `shortlistedTotal`, `modeSet` (follow_up · add_on · monitor), `taUserId`, `sentToTaAt?` | by_opening |
| `opsHolds` | `openingTaId`, `startedAt`, `reason`, `noticeMessageId?`, `liftedAt?`, `liftedReason?`, `closedAt?` | by_opening |
| `opsUnreportedHires` | `setId`, `flaggedAt`, `confirmedBy?`, `surchargeInvoiceId?`, `state` (flagged · confirmed · dismissed) | by_set |

### Interviews

| Table | Fields | Indexes |
|---|---|---|
| `opsInterviews` | `interviewTaId?`, `openingTaId`, `appTaId`, `clientTaId`, `scheduler` (us · client), `round`, `slotsFromClient[]`, `slotsOffered[]`, `agreedAt?`, `mode` (teams · onsite · phone · zoom · other), `link?`, `calendarEventId?`, `clientInterviewers[]`, `state` (slots · agreed · booked · reconfirmed · held · no_show · cancelled · rescheduled), `cancelReason?`, `attendedMarkedBy?`, `clientFeedbackMessageId?`, `roundDecision?` (next · rejected · selected), `decisionReason?`, `slotLoopCount` | by_opening, by_app, by_state, by_interviewTa |
| `opsReferenceRequests` | `appTaId`, `clientTaId`, `requestedAt`, `requestedBy`, `taReportText?`, `reportedAt?`, `relayedMessageId?`, `clientDecision?` (cleared · dropped) | by_app |

### Placement and money

| Table | Fields | Indexes |
|---|---|---|
| `opsPlacements` | `placementTaId`, `openingTaId`, `appTaId`, `clientTaId`, `candidateName`, `package` {gross, basic?, currency, allowances?}, `doj`, `dojHistory[]` {from, to, by, at, reason}, `offerLetterFileId`, `state` (placed · joined · no_show · cancelled · left), `joinedAt?`, `leftAt?`, `leftReason?`, `isReplacementOf?`, `feeRuleSnapshot`, `guaranteeId?`, `noticeSentAt` | by_placementTa, by_client, by_state, by_doj |
| `opsInvoices` | `number`, `kind` (fee · surcharge · credit_note), `placementId?`, `clientTaId`, `amount`, `currency`, `tax?`, `lines[]`, `issuedAt`, `dueAt`, `state` (draft · approved · sent · partly_paid · paid · written_off · cancelled), `fileId?`, `sentMessageId?`, `lateMonths`, `lateCharge`, `writtenOffAt?`, `history[]` | by_client, by_state, by_number |
| `opsPayments` | `invoiceId`, `amount`, `paidAt`, `method`, `reference?`, `recordedBy`, `note?` | by_invoice |

### Guarantee, reports, close

| Table | Fields | Indexes |
|---|---|---|
| `opsGuarantees` | `placementId`, `clientTaId`, `openingTaId`, `startsAt`, `endsAt`, `state` (running · warned · ended_clean · leaver · replacing · replaced · refund_pending · refunded · void), `feePaidAt?`, `leftAt?`, `replacementDeadlineAt?`, `replacementPlacementId?`, `refundDecision?` {by, at, pct, amount, reason}, `creditNoteId?` | by_placement, by_state, by_endsAt |
| `opsReports` | `kind`, `weekOf`, `rows[]`, `state` (built · reviewed · sent), `reviewedBy?`, `sentAt?`, `fileId?`, `messageId?` | by_kind_week |
| `opsCloseChecklists` | `openingTaId`, `clientTaId`, `trigger` (clean_end · refund · write_off · client_stopped · hold_limit · impractical), `items` {linkedinClosed, topjobsClosed, openingClosed, leadClosed, groupNoticePosted}, `taskIds[]`, `completedAt?` | by_opening |

### Calls

| Table | Fields | Indexes |
|---|---|---|
| `opsCallLogs` | `taskId?`, `clientTaId?`, `appTaId?`, `to`, `toName`, `purpose` (esa_final · feedback · reconfirm · slots · other), `by`, `at`, `durationMin?`, `outcome` (reached · no_answer · busy · wrong_number), `notes`, `nextAction?` | by_client, by_by |

## D3. How the tables link (the ID map)

```
TA users ──────────────── opsMembers.taUserId
TA clients ─┬───────────── opsClientProfiles.clientTaId ── opsLeads.clientTaId ── opsEsa.clientTaId
            └─ (opsOwnerId written by Ops)
TA esaRecords ─────────── opsEsa.taEsaRecordId
TA jobs (opening) ─┬───── opsPositions.openingTaId ── opsRequirements.openingTaId ── opsAdChannels.openingTaId
                   ├───── opsClientSets.openingTaId ── opsInterviews.openingTaId ── opsHolds / opsDepthChecks
                   └───── opsCloseChecklists.openingTaId
TA reviewRounds ───────── opsClientSets.roundTaId
TA applications ───────── opsClientSets.candidates[].appTaId ── opsClientDecisions.appTaId ── opsOwnershipClaims.appTaId
                          opsInterviews.appTaId ── opsReferenceRequests.appTaId ── opsPlacements.appTaId
TA interviews ─────────── opsInterviews.interviewTaId
TA placements ─────────── opsPlacements.placementTaId ── opsInvoices.placementId ── opsGuarantees.placementId
every Ops record ──────── opsTimers.subjectId · opsTasks.subjectId · opsMessages.subjectId · opsAudit.subjectId · opsFiles.subjectId
```

**Rules of the map:** TA IDs are stored as strings in Ops and never invented. An Ops record
that points at TA is created only after TA confirmed the write (the API returns the ID).
Ops screens show TA data live through the client, with Ops data beside it; nothing in TA
is copied except names for display and IDs for linking.

## D4. Where every sheet column goes

**The full plan for retiring the sheets is [20](20-SHEETS-TO-SYSTEM.md)** (2 Nov): the method
the TA System used to kill its Master Sheet, one screen per sheet, what is computed rather
than typed, the first-day import, and the sheet files still needed from the Ops team. The
table below is the summary.

| Sheet today | Column | New home |
|---|---|---|
| Master sheet | client, position, TA, status, dates, values | TA `jobs` + Master Sheet (exists); Ops `opsPositions.stage` |
| Client sheet | client, contacts, ESA, owner | TA `clients` (+ `opsOwnerId`), `opsEsa`, `opsClientProfiles` |
| Job order sheet | handover date, TA, 100% day | TA `jobs.assignedAt`, `jobAssignments.workingStage`; `opsRequirements.openedAt` |
| Interview summary sheet | date, candidate, client, round, outcome | TA `interviews` + `opsInterviews` |
| ESA tracker | sent, chased, signed, countersigned | `opsEsa` + `opsTimers` + `opsMessages` |
| Placement Updates (WhatsApp) | client, role, candidate, DOJ, source | `opsPlacements` + the same-day notice |
| Invoice list (none today) | — | `opsInvoices`, `opsPayments` |

## D5. State machines (the only allowed moves)

- **Lead:** new → intro_call → held → esa → requirement → opened; any → closed (reason).
- **ESA:** draft → sent → chasing ↔ negotiating → signed → countersigned; sent/chasing/negotiating → declined; sent → expired (14 days, confirmed by a person → declined).
- **Client set:** ready → approved → sent → received → closed.
- **Interview:** slots → agreed → booked → reconfirmed → held; booked/reconfirmed → cancelled → (new) slots; booked/reconfirmed → no_show; any → rescheduled → booked.
- **Placement:** placed → joined → (left); placed → cancelled; placed → no_show.
- **Invoice:** draft → approved → sent → partly_paid → paid; sent/partly_paid → written_off; any → cancelled (credit note).
- **Guarantee:** running → warned → ended_clean; running/warned → leaver → replacing → replaced | refund_pending → refunded; leaver → void (fee unpaid).
- **Position (Ops view):** searching ↔ on_hold; searching → interviews → offer → placed → guarantee → closed; any → closed.

Every move is one backend function that checks the current state, writes the audit row,
starts or cancels the timers of that state, and (where the map says) calls TA.

---

# Part E · The connection: how the two systems talk, all day, without stopping each other

## E1. Principles

1. **TA never waits for Ops.** TA writes an event row in the same transaction as its change
   and carries on. Ops reads events every minute.
2. **Ops never guesses TA's state.** Screens read TA live (cached 30 s); writes go through
   TA's own rules and get TA's own answers.
3. **Every write is repeat-safe.** An `idempotencyKey` per write; TA stores it and returns
   the first result on a repeat.
4. **Failure is normal.** If TA is down, Ops queues writes (`opsOutbox`) and retries with
   backoff; the Ops inbox shows "waiting for TA"; nothing is lost. If Ops is down, TA's events
   wait in the table (kept 30 days).
5. **One key, least rights.** `OPS_API_TOKEN`, set in TA only through the release pipeline;
   each endpoint lists which keys it accepts; the Capacity Planner key cannot write.
6. **Two switches.** `OPS_TA_WRITES_ENABLED` (off → writes are logged as "would send") and
   `OPS_TA_READS_ENABLED` (off → screens show "TA link paused"). Both in `opsSettings`.

## E2. The API contract, version 1 (`/integrations/v1/...` on TA)

Transport: HTTPS to `api.career141.com` (TA's Convex HTTP router, where the partner API
already lives), `Authorization: Bearer <OPS_API_TOKEN>`, JSON. Every response: `{ok:true,
data}` or `{ok:false, code, message}`. Pagination: `limit` ≤ 100, `cursor`.

### Reads

| Method and path | Query | Returns (TA fields) |
|---|---|---|
| `GET people` | `role?`, `active?` | `users`: id, fullName, email, taRole, isActive |
| `GET clients` | `nameKey` or `q` | `clients`: id, name, nameKey, industry, contacts, esaSignedAt, status, opsOwnerId |
| `GET clients/{id}` | — | same + `esaRecords` for the client |
| `GET openings` | `status?`, `clientId?`, `taLeadId?` | `jobs`: id, title, clientId, status, positionStatus, jdStatus, priorityTier, assignedTaIds, primaryRecruiterId, taLeadId, headcount, stageCounts, assignedAt, closedAt; `jobPosts` summary (channel, status, externalUrl, cvCountToday) |
| `GET openings/{id}` | — | the opening in full + team (`jobAssignments` with workingStage) + posts + brief text |
| `GET openings/{id}/pipeline` | `stage?` | `applications`: id, candidateId, candidateName, currentStage, ownerTaId, setNumber, isAddOn, backupForApplicationId, shortlistedAt, rejectReason, clientOwnedAt; counts per stage |
| `GET openings/{id}/client-sets` · `.../client-sets/{n}` | — | `reviewRounds` kind client: id, setNumber, applicationIds, dispatch, status, sentAt, receivedAt, decisions; per application: name, prepared-CV availability |
| `GET applications/{id}/prepared-cv` · `GET cv/{cvUploadId}` | — | file stream (`Cache-Control: no-store`) |
| `GET applications/{id}/offer` | — | `offers`: status, offeredSalary, currency, startDateMs, declineReason, madeBy |
| `GET placements/{id}` · `GET placements?openingId=` | — | `placements`: id, applicationId, joinDateMs, placedSalary, salaryBasis, package, offerLetterFileId, feePercent/feeRule, guaranteeDays, joinConfirmedAt, fellThroughAt/Reason, invoice fields |
| `GET interviews` | `openingId` or `applicationId` | `interviews`: id, scheduledAt, round, interviewFormat, interviewers, teamsLink, outcome, taOutcome, taFeedback, confirmedAt, taHistory |
| `GET reports/active-positions` | `weekOf?` | the Reports page rows (client, position, TA, stage counts, days in, status) |
| `GET events` | `after` (cursor), `limit` | `contractEvents` rows oldest first + `nextCursor` |

### Writes

| Method and path | Body (main fields) | TA does | Event raised |
|---|---|---|---|
| `POST clients` | name, industry, contacts[], opsOwnerId, idempotencyKey | upsert by nameKey; restores a binned client (as the UI does) | — |
| `POST clients/{id}/esa` | status, feeRule, guaranteeDays, paymentDays, signedAt?, declinedAt?, documentUrl? | upsert `esaRecords` (client-wide), keep `clients.esaSignedAt` in step | — |
| `POST openings` | clientId, title, country, nationality, workLocations[], headcount, brief, requirementReceivedAt, requestedTaLeadId? | `ta/openings:create` path: jobs + first post + brief; `taLeadId` = requested or first lead | `opening.created` |
| `PATCH openings/{id}` | title?, salary?, location?, headcount?, briefAppend? | update + bell "requirement changed" | `opening.updated` |
| `POST openings/{id}/status` | status (open · on_hold · filled · closed), reason | `setOpeningStatus` (moved into Convex), posts closed on `closed` | `opening.closed` / `updated` |
| `POST openings/{id}/working-stage` | userId, mode (100 · follow_up · add_on · monitor) | `setWorkingStage` (+ `monitor` ⚪ new mode or on_hold) | `opening.working_stage_changed` |
| `POST openings/{id}/ad-channel` | channel, state, cost?, liveAt?, closedAt? | `jobPosts.adChannelState` | `jobpost.live` / `closed` |
| `POST openings/{id}/posts` (J) | channel (portal = TopJobs · email_campaign = Talent Pulse), title | a `jobPosts` row with its own `routingEmailAlias` and `campaignCode`; TA's mail intake files CVs sent to that alias with the source known | `jobpost.live` |
| `POST client-sets/{roundId}/sent` | sentAt, receivedAt, sentTo[] | `reviewRounds.dispatch=sent`, `sentAt`, `receivedAt` | `client_set.sent` |
| `POST applications/{id}/client-decision` | decision, reason, source, reviewedByName | `moveStage` to client_shortlist / rejected with reason; `clientReviews` row; rejection template send (TA) | `application.stage_changed`, `candidate.rejection_notice_sent` |
| `POST applications/{id}/client-owned` | claimedAt, note | `clientOwnedAt`; stage → rejected (reason `client_owned`) | `application.stage_changed` |
| `POST applications/{id}/reference-request` | requestedAt, by | reference record; bell to the TA | `reference.reported` (later, by the TA) |
| `POST interviews` | applicationId, scheduledAt, round, format, interviewers[], teamsLink?, coordinatedBy=ops | `scheduleInterview` (moved into Convex); `applications.interviewId` | `interview.booked` |
| `POST interviews/{id}` | action (reschedule · cancel · outcome · client-decision), fields | the matching write with history | `interview.*` |
| `POST placements/{id}` | action (details · doj · cancel · left), fields (package, offerLetterFileId, joinDateMs+reason, fellThroughReason, leftAt) | `writeCandidateClosing` paths (moved into Convex); `closing` checklist fields | `placement.*` |
| `POST placements/{id}/invoice-state` | invoiceSent/At/Number/PaidAt | keeps TA's placement checklist true | — |
| `POST notify` | userId, type, title, body, jobId?, candidateId?, link? | `notifications` row | — |

### Events (TA → Ops)

| Type | Data | Raised by (TA) |
|---|---|---|
| `opening.created` / `updated` / `closed` | openingId, clientId, status, title | create, update, status writes |
| `opening.jd_approved` | openingId | `approveJd` |
| `opening.working_stage_changed` | openingId, userId, mode | `setWorkingStage` / `recordActiveMode` |
| `jobpost.live` / `jobpost.closed` | openingId, postId, channel, externalUrl | `setPostStatus` |
| `application.stage_changed` | applicationId, candidateId, openingId, from, to, reason, actor | every `executeStageTransition` (mirror of `pipelineEvents`) |
| `director_round.sent` / `decided` | openingId, roundId, setNumber, decisions | `finalizeDailyEmail`, reply reader |
| `client_set.ready` | openingId, roundId, setNumber, applicationIds | client round created |
| `interview.booked` / `confirmed` / `candidate_out` / `outcome` / `feedback` | interviewId, applicationId, fields | interview writes |
| `reference.reported` | applicationId, reportText | reference write |
| `offer.made` / `accepted` / `declined` | applicationId, offerId, salary, reason | `makeOffer`, `respondToOffer`, `declineOffer` |
| `placement.created` / `joined` / `no_show` / `fell_through` | placementId, applicationId, openingId, clientId, package, joinDateMs, offerLetterFileId | Place, join confirm, fall-through |
| `candidate.rejection_notice_sent` | applicationId, channel | template send |
| `notification.for_ops` | title, body, link | TA code that wants an ops owner to know (JD unapproved alert, stale role) |

## E3. The events reader (Ops side)

Cron every minute → `GET events?after=<cursor>&limit=200` → for each: insert `opsEvents`
(unique on `taEventId`), dispatch to the handler by type, mark `handledAt`; the cursor
advances only when the whole batch is handled; a handler error keeps the row with
`attempts++` and the cursor stops; after 3 failed runs an escalation task goes to the ops
lead ("TA events stuck at …"). Handlers are small and idempotent: `client_set.ready` → create
`opsClientSets` if absent; `placement.created` → create `opsPlacements` + notice; and so on
(each phase lists its handlers).

## E4. The TA client (Ops side)

`convex/lib/ta/client.ts`: one typed function per endpoint; token from the environment;
timeout 10 s; retry 3× with backoff on network/5xx, never on 4xx; every call logged in
`opsTaCalls` (path, ms, ok/code) for the health screen; writes go through `opsOutbox`
(`pending · sent · failed`) so a TA outage never loses a decision.

## E5. The TA-side changes, in full (what the TA team builds)

| # | Change | Files (TA) | Size | Needed by |
|---|---|---|---|---|
| T1 | Place requires package, DOJ, offer letter; fix `/placements/{id}` redirect; `package` and `offerLetterFileId` on `placements` | `src/app/actions.ts` (recordPlacement), `src/lib/candidates/closingWrites.ts`, `convex/schema.ts` | S | P6 |
| T2 | Reason required on reject, hold, decline, drop-out (except Director) | stage transition + status writers | S | P4 |
| T3 | `closing.ts`: replace-first rule instead of refund at once | `src/lib/closing.ts` | S | P7 |
| T4 | Follow-up: escalate after 3 unanswered in 24 h; retire day-3/5/7 | `convex/crons.ts`, follow-up helpers | M | P3 |
| T5 | Director and client sets minimum 5; rejection notices from one template for client rejections | sets, `recordShortlistDecision` | S | P4 |
| T6 | Team save keeps working modes; TA lead editable | `src/lib/openings/admin.ts`, `writeOpeningTeam` | S | P3 |
| T7 | `OPS_API_TOKEN` + key-per-endpoint check; `contractEvents` table + writer helper | `convex/http.ts`, `convex/lib/partnerAuth.ts`, `convex/schema.ts`, `convex/lib/contractEvents.ts` | M | P1 |
| T8 | Read endpoints of E2 | `convex/integrations/opsRead.ts` | M | P1 |
| T9 | Move `saveEsa`, `setOpeningStatus`, `writeCandidateInterview`, `writeCandidateClosing` from the web app (`src/data/store.ts` + `commit:apply`) into Convex mutations, keeping the web app calling them; API create sets `assignedAt` and `requirementReceivedAt` (J8) | `convex/ta/esa.ts`, `openings.ts`, `interviews.ts`, `placements.ts` | **L** (the critical path) | P2-P6 |
| T10 | Write endpoints of E2 on top of T9 | `convex/integrations/opsWrite.ts` | M | P2-P7 |
| T11a (J) | Change detector in `ta/commit:apply`: row ops on interviews, offers, placements, esaRecords, client reviewRounds, jobs status/jdStatus/team, jobPosts status → `contractEvents` in the same transaction | `convex/ta/commit.ts` | S | P1 |
| T11b | Event writers in the new mutations (T9) and the stage machine (reads `pipelineEvents`) | T9 mutations, `pipelineStateMachine.ts` | M | P2-P7 |
| T15 (J) | `shortlists@` and `interviews@` readers skip mail carrying `[C141-OPS-…]` | `convex/mailIntake/aiReader.ts`, `interviews.ts` | S | P4, P5 |
| T16 (J) | System actor: a `users` row `ops-system@career141.com`, role `ops`, not sign-in-able; API writes run as it | `convex/lib/partnerAuth.ts` | S | P1 |
| T17 (J) | `notifications` type `ops_notice` declared and rendered in the bell | `src/lib/alertKinds.ts`, NotificationBell | S | P1 |
| T18 (J) | Clerk satellite domain `ops.career141.com` on the production instance; Ops people provisioned on TA's People page | Clerk dashboard, `/people` | S | P1 |
| T19 (J) | Prepared-CV read endpoint on the Next app with the Ops token (reuse the EOD attachment when present) | `src/app/api/integrations/v1/...` | S | P4 |
| T12 | New fields: `clients.opsOwnerId`, `esaRecords.feeRule/declinedAt`, `jobPosts.adChannelState`, `applications.clientOwnedAt`, `interviews.teamsLink/coordinatedBy`, `reviewRounds.receivedAt`; optional `monitor` working stage | `convex/schema.ts` + `convex/ta/model/tables.ts` | S | per phase |
| T13 | `opsForTa` read on the TA side (later): show ESA status, ops owner, set state, guarantee state on the opening page by calling Ops's read endpoint | TA opening page | S | after pilot |
| T14 | Feature skills updated in the same PRs (`/openings`, `/sets-shortlist`, `/follow-up`, `/workday`, `/eod-email`) and `skill-sync` stamped | `.claude/skills/*` | S | each PR |

Order on the TA side: T7 → T8 → T12 → T9 → T10 + T11 (per phase) → T1-T6 as each phase
needs them → T13 → T14 throughout.

## E6. Security of the link

- Token only in TA's `.env.production` and Ops's `.env`, never in code or chat.
- Ops calls only over HTTPS to the public API name; the VPS firewall keeps 3210/3211 closed
  to the internet, so Ops on the same box could call 127.0.0.1:3210 directly (⚪ decide:
  public name through Caddy, or loopback; loopback is faster and never leaves the box).
- File streams are short-lived and never public.
- Every write is audited on both sides (TA `activityLog`, Ops `opsAudit`).

---

# Part F · Integrations and the decisions behind them

## F1. Email (Microsoft 365, Graph)

- **Mailboxes:** `ops@career141.com` (shared, all ESA/set/invoice mail), optional per-owner
  mailboxes later. ⚪ one or several.
- **Permissions:** the existing Graph application gets `Mail.Send` and `Mail.ReadWrite`,
  limited by an **application access policy** to the Ops mailboxes only (so the app cannot
  read TA's or anyone else's mail).
- **Send:** `sendMail` with attachments (ESA PDF, prepared CVs, invoice PDF); the reference
  `[C141-OPS-<clientShort>-<subject>-<n>]` in every subject; `internetMessageId` stored.
- **Read:** delta query per mailbox every 2 minutes, batches of 25, checkpoint per mailbox
  (TA's `mailboxCheckpoints` idea), stall alert at 15 minutes without a successful run.
- **Matching:** reference in subject or `In-Reply-To` → exact; sender domain → client; else
  "unfiled" task.

## F2. WhatsApp (Meta Cloud API)

- **Number:** a dedicated Ops number (or one of the 8 existing WABAs, ⚪). Clients write to
  it; the webhook files the message by phone → client contact.
- **Templates** to submit (Meta approval 1-2 days each): `ops_esa_chase_1`, `ops_esa_chase_2`,
  `ops_feedback_chase`, `ops_inactive_notice`, `ops_interview_notice`, `ops_dropout_notice`,
  `ops_payment_chase`, `ops_set_sent`. Inside a 24-hour window free text is allowed.
- **Groups:** Meta's API cannot post to groups. The system drafts the group text and a task;
  the ops person posts from their phone and ticks it. Replies in groups are **not** read by
  the system; the owner records them (one-line "record what the client said").
- **Safety:** same gate as email; test numbers until live.

## F3. Meetings (Teams first, Zoom optional, manual always)

- **Teams:** Graph `calendar/events` with `isOnlineMeeting=true` from the Ops mailbox's
  calendar; attendees = client interviewers (+ owner); the join link saved on the TA
  interview. Needs `Calendars.ReadWrite` + `OnlineMeetings.ReadWrite.All` with **admin
  consent** and an access policy. **Start the request in week 1.**
- **Zoom:** only if Teams is refused; a server-to-server OAuth app, `POST /users/{id}/meetings`.
- **Manual:** always available: the owner pastes any link (Teams/Zoom/Google Meet) and the
  invite email still goes through the pipeline. Phase 5 works without consent.
- **Onsite:** address and contact on the record; invite email the same.

## F4. Calls: the decision

The board names calls at: ESA final call (Rushda), owner's feedback call, candidate
reconfirm call, dropped-out calls, joining-day call, referee call. AI voice calling exists
in TA (LiveKit/ElevenLabs) but is **suspended**, costs per minute, and clients and referees
are not the people to put an AI on.

**Decision proposed:** no AI calls, no telephony integration now.

- The system creates the **call task** with the number, the purpose, the suggested script
  line, and a one-line outcome form (`opsCallLogs`: reached / no answer / notes / next action).
- **Click-to-dial** on a phone: the number is a `tel:` link; on a laptop it opens the
  softphone if one exists. Zero cost.
- **Reconsider later:** if the team wants recorded calls or click-to-dial from the laptop,
  a Twilio/3CX-style number costs money per minute and needs consent rules; put it on the
  list for after the pilot. WhatsApp calls stay outside the system (logged by hand).

## F5. Documents (ESA, invoice, offer letter)

- Templates as DOCX in `opsTemplates` (file in R2) with `{{placeholders}}`; filled by the
  backend (docx library) → PDF through LibreOffice headless (present in TA's Docker image;
  the Ops image gets the same) → `opsFiles`.
- Signed ESA: scan/PDF uploaded by the owner; countersign: the Director's scan uploaded by
  whoever has it; e-signature ⚪ later (DocuSign/Adobe Sign would be a month's work and a
  subscription).
- Invoice numbering `C141-OPS-YYYY-NNNN`; tax lines and bank details from settings ⚪.

## F6. Files (Cloudflare R2)

Bucket `c141-ops`; keys `esa/<clientId>/...`, `invoice/<number>.pdf`, `cv/<appTaId>.pdf`
(copy of TA's prepared CV at send time, so the set email is reproducible), `scan/...`;
signed GET links with 10-minute expiry; `sha256` kept.

## F7. AI (Claude first, DeepSeek second)

Used only to **propose**, never to act: classify an inbound (signed / changes / declined;
shortlisted / rejected with reasons; slots; cancel), draft a chase in the client's tone,
flag banking/finance, summarise a thread for the inbox. Every proposal is shown with
"confirm" and can be edited. Keys in the Ops `.env`; the routing idea copied from TA
(`aiRouter`).

## F8. Website leads

⚪ Webhook `POST /api/leads/website` with a shared secret (preferred: structured fields) or
the hello@ mailbox read by the mail reader with an AI parse. Both create `opsLeads`.

## F9. Sign-in (Clerk) and people

The TA Clerk instance; the Ops app is a second allowed origin; `opsMembers` maps the Clerk
user to an Ops role; TA's `users` row (via `GET people`) links to the same person for bells.

## F10. Working days and holidays

One helper: Colombo time, Monday-Friday, `opsHolidays`; "working days" everywhere the board
says working days (ownership 7, replacement 60), calendar days elsewhere (ESA 14, silence 14,
guarantee 90, invoice 30).

---

# Part G · The build, phase by phase

Eight phases. Each step is one unit of work that ends in a test. Steps marked **TA** are
built by the TA team in `ta-system`. Each phase ends with a demo against a local TA.

**Changed 2 Nov, by the owner: every feature ships with its screen.** The earlier rule was
backend first and the UI later. It is now one piece of work: when a backend step lands, the
screen that uses it lands with it, and the owner can click it. The rules for those screens
are in [07](07-SCREENS.md) section "How the screens are built". The build also starts with a
thin end-to-end skeleton (sign in, the inbox, one clock, one drafted message, one read from
TA) so the shape is visible in days rather than weeks, and the rest of Phase 1 fills it in.

## Phase 1 · Foundation (nothing business-specific yet)

0. Baseline (J13): a one-off form for the Ops team to enter the last 6 months' ESA return
   times, client waits on sets and slipped joinings from the archive into `opsReports`
   kind `baseline`, so the weekly KPIs (P7 step 16) can show the change.
1. Create the repo structure: `convex/` (backend), `app/` (empty Next.js shell with Clerk
   only), `deploy/local/`, `deploy/production/`, `docs/`, `tests/`.
2. Local run script `deploy/local/start.sh`: Ops Convex on `127.0.0.1:3310`, dashboard on
   `6891`, `.env.local` from `.env.example` (no secrets committed).
3. Local TA: document how to run TA's `deploy/local/start-app.sh` beside it and seed a test
   `OPS_API_TOKEN`; a `fakeTa` server (recorded JSON responses) for tests that must not
   need TA.
4. CI: GitHub Actions on every PR: `npm test`, `tsc` app and backend, lint; branch protection
   on `main`.
5. `convex/schema.ts` with the foundation tables (D2: members, settings, holidays, timers,
   tasks, messages, inbound, events, audit, files, templates, escalations, callLogs, outbox).
6. `lib/audit.ts`: one `writeWithAudit(table, id, patch, actor, reason)` helper used by every
   mutation.
7. `lib/calendar.ts`: Colombo now, add calendar days, add working days with holidays, "is
   working day", "next 09:00".
8. `opsSettings` module: get/set with types, cache, change audit; `settings.seed` mutation.
9. Seed the settings (all numbers from D/04 §13): esa.sendHours 2; esa.chaseDays [2,2,3,2,3];
   esa.declineDays 14; esa.countersignDays 1; meeting.maxRebooks 3; set.minCvs 5;
   set.dueDays [7,14]; set.ownershipWorkingDays 7; feedback.chaseDays 1;
   feedback.callAfterDays 1; feedback.stopAfterSilentDays 4; silence.holdDays 14;
   depth.addOnAtPending 3; depth.holdAtShortlisted 5; interview.dropoutNoticeHours [24,3];
   interview.reportReminderDays 2; hire.unreportedMonths 3; hire.surchargePct 50;
   invoice.dueDays 30; invoice.latePctPerMonth 5; invoice.compounded ⚪false;
   invoice.writeOffDays 60; guarantee.days 90; guarantee.warnDay ⚪75;
   replacement.workingDays 60; refund.pct 25; topjobs.closeDays 14; linkedin.minCvsPerDay 20;
   talentpulse.listDay Tue; talentpulse.postDay Wed; report.day Mon 08:00; switches
   OPS_OUTREACH_LIVE off, OPS_TIMERS_ENABLED on, OPS_TA_WRITES_ENABLED off,
   OPS_TA_READS_ENABLED on; testRecipients; pilotClientIds [].
10. `opsHolidays` import from a CSV; a query for the calendar helper.
11. `opsMembers`: people are provisioned on TA's People page first (Clerk invitation +
    `users` row, J10); Ops syncs from Clerk on first sign-in on the satellite domain
    (`clerkUserId`, name, email); `members.setRole` (ops_lead only); `taUserId` linked by
    email through `GET people`.
12. Roles: `lib/access.ts` with `can(member, capability, subject)` per D2 roles table; every
    mutation calls it; "own clients only" is a setting (⚪ default all).
13. Timers engine: `timers.start / cancel / reschedule`; cron `timers.tick` every minute,
    batch 50, cursor, `OPS_TIMERS_ENABLED`; handler registry by `kind`; `warned` state.
14. Tasks: `tasks.create / done / snooze / reassign / recordOutcome`; inbox queries
    `inbox.forMe`, `inbox.approvals`, `inbox.late`, `inbox.timers`, `inbox.forClient`.
15. Escalation ladder: `opsEscalations` seeded (owner → ops_lead after 24 h → director_ops
    after 72 h for money/guarantee kinds); `tasks.escalate` run by the tick.
16. Message pipeline: `messages.draft(templateKey, data, subject)`, `messages.approve`,
    `messages.edit`, `messages.send` (queue), sender workers for `email` (Graph) and
    `whatsapp` (Meta), `group_post` (→ task), `internal` (→ task and/or TA `notify`); the
    safety gate (`OPS_OUTREACH_LIVE`, test recipients, do-not-contact, per-client daily cap);
    the subject reference; `state` moves audited.
17. Chase cancellation: `messages.onInboundMatched(subject)` cancels every running chase
    timer for that subject (used by the readers in 18-19 and the webhook).
18. Mail reader: Graph delta per mailbox every 2 minutes, batches of 25, checkpoints, stall
    alert; `opsInbound` rows; attachments to R2.
19. Inbound matching: by reference → by `In-Reply-To` → by sender domain (client contacts
    from TA) → unfiled task; `inbound.file` (manual), `inbound.markActioned`.
20. TA client (`lib/ta/client.ts`) with every read of E2, logging to `opsTaCalls`, the two
    switches, and a `fakeTa` mode. **TA: T7, T8 land here.**
21. `opsOutbox`: writes queued and retried; a health query (`ta.health`: last read, last
    write, events cursor age).
22. Events reader (E3) with the cursor row and the handler registry (empty handlers in this
    phase). **TA: T11 base writer lands here.**
23. Files: R2 client, `files.put/get/sign`, `opsFiles` registry, SHA-256; LibreOffice
    conversion worker (`docx → pdf`) behind a job.
24. Call tasks: `tasks.createCall(to, purpose, script)` and `calls.log` (`opsCallLogs`);
    `tel:` link data.
25. Templates: `opsTemplates` CRUD (ops_lead), placeholder validation, `approvedForAuto`
    flag; seed the internal templates (task notices).
26. Phase test: a demo flow on the laptop: a timer fires → task → a drafted email → approve →
    blocked in test mode → shown sent to test recipients; a reply to the test mailbox is
    read, matched by reference and cancels a chase timer; `GET people` works against local TA.

## Phase 2 · Client onboarding (leads, intro call, ESA)

1. Tables `opsLeads`, `opsClientProfiles`, `opsMeetings`, `opsEsa` (D2) and their indexes.
2. `leads.create` (manual form fields; `nameKey` computed like TA's), owner assignment
   (round-robin among `ops_owner` with `active`, or chosen), task "new lead" to the owner,
   `internal` notice.
3. `leads.checkDuplicate`: `GET clients?nameKey=`; exact → `clientTaId` linked and
   `opsClientProfiles` created; near matches returned for the owner to decide.
4. `leads.flagIndustry`: AI proposal from name/website/notes; owner confirms; decline path:
   template `lead.decline.industry` drafted → approved → sent; lead closed `industry`,
   `doNotInvite`.
5. `leads.esaLookup`: `GET clients/{id}` → `esaSignedAt` and `esaRecords` → route: signed →
   state `requirement`; returning without ESA → `esa.resendExisting` (step 12); new → intro call.
6. Website lead intake: `POST /api/leads/website` (secret) → `leads.create(source=website)`;
   hello@ path through the mail reader with an AI parse (⚪ which one).
7. `meetings.book(kind=intro, at, taLeadId)`: invite email drafted from `meeting.invite`
   (approved or auto ⚪), `notify` to the TA lead, reminder timer (day before 09:00, and 1 h).
8. `meetings.markNotHeld` → rebook task + timer; `rebookCount`; 3 with no client reply →
   `leads.close(silent)` with reason; `meetings.markHeld(outcome, package, role, brief)` →
   `internal` notice with the brief to the TA lead; timer `esa.send` (2 h).
9. ESA fields model and validation (`opsEsa.fields`), defaults from settings (fee rule,
   guarantee 90, payment 30, replacement 60, refund 25, inactivity 14).
10. `esa.draft`: fill the DOCX template → PDF → `opsFiles`; blank required field → error
    listing the fields; version++.
11. `esa.approveAndSend`: cover email `esa.cover` with the PDF; state `sent`; timers
    `esa.chase.1` and `esa.decline`; **TA:** `POST clients` (create/update with opsOwnerId)
    and `POST clients/{id}/esa` status `sent`. **TA: T9 (saveEsa into Convex), T10 for these
    two, T12 fields.**
12. `esa.resendExisting` for a returning client: the last signed fields → new draft → same
    send path (no intro call).
13. Chase handlers: `esa.chase.n` → draft `esa.chase.email.1/2/3` or `esa.chase.wa.1/2`
    (Meta template) → approval task; after step 5 → `tasks.createCall(Rushda-flag member,
    purpose esa_final)`.
14. Inbound on the ESA thread: AI classification (signed attachment / wants changes /
    declined / other) → proposal task to the owner; any inbound cancels the chase timers
    (P1 step 17).
15. `esa.recordSigned(fileId)`: state `signed`; internal notice to ops, TA lead, Director
    (`notify` + email `esa.signed.notice`); timer `esa.countersign`; task to the Director
    (`director_ro`); **TA:** `POST clients/{id}/esa` status `signed`, signedAt, feeRule,
    guaranteeDays (TA copies these at Place).
16. `esa.negotiate(meeting, termsNotes)`: state `negotiating`; `meetings.book(kind=negotiation)`;
    `esa.agreeAndResend` → fields edited → back to step 10-11 with version++.
17. `esa.decline(reason)` (from AI proposal, the Director's/owner's decision, or the
    `esa.decline` timer confirmed by a person): state `declined`; **TA:** ESA status
    `declined` (TA refuses `POST openings` for the client); lead closed; internal notice
    "search blocked".
18. Countersign: timer fires → reminder (`esa.countersign.reminder`) once → escalation to
    the ops lead after 24 h more (⚪); `esa.recordCountersigned(fileId)` → email
    `esa.countersigned.cover` to the client with the PDF; state `countersigned`; lead →
    `requirement`.
19. `opsClientProfiles`: stage changes (lead → onboarding → active); billing contact; group
    name; `profiles.moveOwner` (ops_lead) updating TA `opsOwnerId` too.
20. Inbox views for this phase: "ESAs awaiting signature with chase step", "intro calls this
    week", "leads by state".
21. Phase test: new lead → duplicate check against local TA → intro call booked → held →
    ESA drafted with a blank field (blocked) → filled → sent (test mode) → chase 1 drafted at
    +2 days (clock advanced) → reply read → signed → Director task → countersigned → lead at
    `requirement`; and the decline path at day 14; the returning-client path.

## Phase 3 · Hand-over to TA, and adverts

1. Tables `opsRequirements`, `opsPositions`, `opsAdChannels`, `opsTalentPulseIssues`.
2. `meetings.book(kind=requirement)` with the TA lead; reminder; not held → daily rebook
   timer; 3 silent → `leads.close(silent)`, no opening.
3. `requirements.save(fields)` from the held meeting; version 1; `practical` tick.
4. Impractical path: reason; `role.impractical.reply` drafted → approved → sent;
   `inviteBackAt` → timer `lead.inviteBack` → task "invite back" → `leads.create` copy with
   source `invite_back`.
5. Requirement → brief text builder (jdNotes + insights + salary + level + locations +
   headcount) in the format TA's `extractFromText` understands (so TA's JD draft and
   requirement extraction work from it).
6. `requirements.createOpeningInTa`: validates ESA state is `signed`/`countersigned` (else
   refused); **TA:** `POST openings` → `openingTaId`; `opsPositions` row (stage `searching`);
   `openedAt` stamped; `requirementReceivedAt` sent to TA. **TA: T9 opening create path, T10.**
7. Handler `opening.created` (if TA creates an opening by hand for a client Ops knows):
   `opsPositions` row created with `requirementId` empty and a task "link requirement".
8. Handlers `opening.updated / jd_approved / working_stage_changed / closed`, `jobpost.*`:
   update `opsPositions` and the client view; JD unapproved alert forwarded from
   `notification.for_ops`.
9. Handover stamp: `opsRequirements.openedAt` + TA `assignedAt` shown together as "handed
   over on …"; ⚪ 100% rule shown as TA's choice.
10. `requirements.newVersion` when the client changes the brief: **TA:** `PATCH openings/{id}`
    with `briefAppend` → TA bell "requirement changed".
11. **TA: T6** (team save keeps modes; TA lead editable) and **T4** (follow-up escalation,
    retire old flow) land in this phase.
12. TopJobs: `ads.request(openingTaId)` (TA or owner) → task to marketing (flyer) →
    `ads.flyerReady(fileId)` → `ads.send` (email `topjobs.order` to TopJobs drafted →
    approved → sent, cost recorded) → `ads.markLive(date)` → timer `ad.close` 14 days →
    `ads.markClosed` → **TA:** `POST openings/{id}/ad-channel` at live and closed; `notify`
    the TA at each change.
13. TopJobs CV intake (J4): `ads.request` first calls **TA** `POST openings/{id}/posts`
    (channel `portal`) and puts the returned routing alias on the TopJobs order; CVs mailed
    to that alias are filed by TA's own mail intake with the source known. Ops reads
    `cvCountToday` per post for the ad's CV count. No CV passes through Ops.
14. Talent Pulse: Tuesday 09:00 job → `GET openings?status=open` → rows with the TA's
    one-line brief (task to each TA via `notify`, default = title + location) →
    `opsTalentPulseIssues` compiled → task to marketing → `tp.markPosted`.
15. Talent Pulse links: ⚪ one tracked apply link per role (`/apply/<token>` on the Ops
    app, redirecting to a mailbox alias per opening that TA already routes, with
    the post's routing alias from `POST openings/{id}/posts` channel `email_campaign`, J4)
    — or the alias printed plainly in the newsletter.
16. LinkedIn repost prompt: handler on `jobpost.*` + TA's low-volume alert forwarded;
    monitor-only closes LinkedIn → task to the TA.
17. Position view queries: `positions.forClient`, `positions.byStage`, each joining live TA
    opening data (team, JD, posts, stage counts).
18. Weekly desk report builder (used in P7): `reports.buildActivePositions` from `GET
    reports/active-positions` + `opsPositions`; stored; not yet emailed.
19. Inbox views: "requirements to open", "ads in progress", "Talent Pulse this week".
20. Phase test: requirement saved → opening created in local TA (fields checked in TA) →
    TA approves JD → event updates Ops → TopJobs request → flyer → sent (test) → live →
    closed at +14 days → ad-channel recorded in TA; a TopJobs CV mail → filed in TA with
    source; Tuesday job builds a Talent Pulse issue.

## Phase 4 · The client side of the search

1. Tables `opsClientSets`, `opsOwnershipClaims`, `opsClientDecisions`, `opsDepthChecks`,
   `opsHolds`, `opsUnreportedHires`.
2. Handler `client_set.ready` → `opsClientSets` (state `ready`) with candidates and
   prepared-CV ids (`GET openings/{id}/client-sets/{n}`); `dueAt` from the ESA (timer
   `set.due` from ESA signed, 7/14 days; overdue alert).
3. `sets.review`: fetch each prepared CV (`GET applications/{id}/prepared-cv`) once into R2
   (`cv/<appTaId>.pdf`) so the email is reproducible; minimum 5 shown (TA enforces, **T5**).
4. `sets.approveAndSend`: email `set.cover` with PDFs attached, to the client's contacts
   (TA `clients.contacts` role hr), cc the owner; state `sent`; `receivedAt` default = sent
   (editable); **TA:** `POST client-sets/{id}/sent`; `notify` the TA.
5. First set for a client with no `whatsappGroupName`: task "create client group" +
   drafted group post (`set.group_post`) → owner ticks posted → `groupCreatedAt`.
   **Built 3 Nov**: the post is drafted with every set, and settles at *approved*,
   because nothing can send it and "sent" would be untrue.
6. Timers at receipt: `set.ownership` (7 working days, warn at 5) and `feedback.chase` (1 day).
7. `claims.record(setId, appTaId)`: within window → `dropped`: **TA:** `POST client-owned`;
   reply `claim.noted` drafted; after window → `refused`: reply `claim.refused` drafted.
8. `set.ownership` fired → "window closed" note on the set; warn → owner task.
9. Decisions: inbound matched to a set → AI proposal (per candidate shortlisted/rejected +
   reason) → task "confirm decisions" → `decisions.confirm(list)`; from a group/call the
   owner enters them by hand; each → **TA:** `POST client-decision` (TA moves the stage,
   records the review, sends the rejection notice itself); `taResult` stored; `notify` the TA.
10. Feedback chase handler: `feedback.chase` → `feedback.chase.email` + `feedback.chase.wa`
    drafted → approved → sent → timer `feedback.call` (1 day) → call task to the owner;
    `calls.log` outcome; silent days counted from receipt.
11. Stop rule: after `feedback.stopAfterSilentDays` silent days no more chases are drafted
    (only the hold clock runs); any inbound resets the silent count and cancels chase timers.
12. `silence.hold` (14 days from `receivedAt`) → `hold.propose` task → owner approves the
    inactive notice (`inactive.notice`) → sent → `opsHolds` + **TA:** `POST openings/{id}/status
    on_hold` reason "client inactive"; position stage `on_hold`.
13. `hold.lift` on any client inbound or by the owner → **TA:** status `open`; feedback timer
    restarts. ⚪ `hold.limit` timer → close checklist (P7).
14. Depth evaluation `depth.evaluate(openingTaId)` after every decision and every
    `application.stage_changed` event: `GET openings/{id}/pipeline` → `shortlistedTotal`
    (stages client_shortlist + interview + offer) and `pending` (client_shortlist not yet
    interviewed); order: `≥5 → on hold, reason "five shortlisted"` (J9: **TA** `POST
    openings/{id}/status on_hold`), else `≤3 pending → add_on` (**TA** `POST working-stage`
    for the primary TA), else `follow_up`; below five again → status `open`; `notify` the TA
    on every change; `opsDepthChecks` row. **Built 3 Nov**, with one change: the
    count lives on the position (`depthStage`, `shortlistedTotal`, `pendingCount`,
    `depthCheckedAt`) instead of a table of its own - there is one live count per
    position and the audit already keeps every change of it.
15. "Hold at five" also sets a position flag so the set sender refuses to send a new set
    until the count drops (with an override for the ops lead). **Built 3 Nov.**
16. Back-up visibility: `backupForApplicationId` shown on the set and interviews; the slot
    loop (P5) uses it.
17. **TA: T2** (reasons required) and **T5** (min 5, client rejection template) land here.
18. Unreported hire: timer `hire.unreported` (3 months from `sentAt`) → task "confirm unreported
    hire?" → `unreported.confirm` → surcharge invoice draft (P6 engine, `kind=surcharge`, 50%).
19. Inbox and client views: "sets to send", "waiting for client feedback (days silent)",
    "claims", "holds", "decisions to confirm".
20. Group replies: a one-line "record what the client said" action on the set that creates
    an `opsInbound` row with `channel=group`, so decisions and claims can start from it.
21. Phase test: set ready event → review → send (test) → TA round marked sent → claim within
    window → TA candidate dropped → reply (simulated) with decisions → confirm → TA stages
    moved and rejection notice event seen → depth evaluated → add-on mode set in TA; silence
    path: clock to 14 days → hold → TA on_hold → inbound → lift.

## Phase 5 · Interviews and reference

1. Tables `opsInterviews`, `opsReferenceRequests`.
2. `interviews.start(appTaId, scheduler)`: `us` or `client`; a row in state `slots`.
3. We schedule: `interviews.requestSlots` → email `interview.slots_request` drafted → sent;
   inbound slots → AI extracts dates → owner confirms `slotsFromClient`.
4. `interviews.askCandidate`: task to the TA (`notify` with the slots) → the TA records the
   candidate's pick (through a link that calls `interviews.candidatePick`, or the owner
   records it); `agreedAt`.
5. No fit → `interviews.newSlots` → `slotLoopCount++` → email drafted; 3 unanswered →
   TA alerted (`notify`) → `interviews.backup(appTaId2)` from `backupForApplicationId`.
6. Client books: `interviews.clientBooks` → timer `interview.report` (2 days) → reminder
   `interview.report_reminder` drafted; the owner records the date from the client.
7. `interviews.book`: **TA:** `POST interviews` (time, round, format, interviewers,
   `coordinatedBy=ops`) → `interviewTaId`; state `booked`. **TA: T9 interview writes into
   Convex, T10, T12 `teamsLink`.**
8. Teams: Graph calendar event with online meeting from the Ops mailbox (attendees = client
   interviewers + owner) → `link`, `calendarEventId`; **TA:** `POST interviews/{id}` with
   `teamsLink`; fallback `interviews.setLink(manual)`; onsite → address.
9. Invite: email `interview.invite` to the client interviewers (auto-approved template,
   decision 15) with the link; `notify` the TA ("booked; invite the candidate"); TA invites
   the candidate through its own channels (never Ops).
10. Timers: `interview.reconfirm` (day before 09:00) → client reminder `interview.reminder`
    (auto) + `notify` the TA to reconfirm the candidate; `interview.day` (at time) → task
    "mark attendance" to the owner.
11. Handlers `interview.confirmed` (TA) → state `reconfirmed`; `interview.candidate_out` →
    `interviews.candidateOut` → drop-out notice drafted (`interview.dropout_notice`) with the
    1-day / 3-hour check → approved → sent; `notify` the TA for a back-up → step 5.
12. No candidate reply to reconfirm (TA event or timer) → call task to the TA (`notify`).
13. `interviews.clientCancel(reason)` from an inbound or the owner → **TA:** `POST
    interviews/{id}` cancel/reschedule → `notify` the TA → state `cancelled` → back to step 3
    with `round` kept.
14. `interviews.markAttendance(attended | no_show)` → **TA:** outcome; no-show → step 11 path.
15. Handler `interview.feedback` (TA logged the candidate's feedback after 5 PM) → client
    feedback message drafted (`interview.client_feedback`, WhatsApp template or email) →
    owner approves next morning → sent.
16. `interviews.roundDecision(next | rejected(reason) | selected)` from the client's reply →
    **TA:** `POST interviews/{id}` client-decision; `next` → step 3 with `round+1`; `rejected`
    → TA rejects with reason (rejection notice by TA) → `depth.evaluate`; `selected` → the
    reference question.
17. Reference: `references.request(appTaId)` only when the client asks → **TA:** `POST
    reference-request` → `notify` the TA; handler `reference.reported` → relay message
    drafted (`reference.relay`) → approved → sent; `references.clientDecision(cleared |
    dropped)`; dropped → `depth.evaluate`; cleared → TA's offer flow (nothing to do in Ops).
18. Interview views: "this week's interviews", "awaiting slots", "awaiting feedback",
    per client and per TA; calendar export (ICS) for the owner.
19. Loop limits in settings: `interview.maxSlotLoops 3`, `interview.reportReminderDays 2`.
20. Phase test: slots requested → reply → candidate pick → booked in local TA with a manual
    link → invite (test) → reconfirm timer → candidate out event → notice drafted → back-up
    booked → attendance → TA feedback event → client message drafted → round decision
    `selected` → reference requested → reported → relayed → cleared.

## Phase 6 · Placement to money

1. Tables `opsPlacements`, `opsInvoices`, `opsPayments`.
2. Handlers `offer.made` → position stage `offer` (search stops is TA's); `offer.declined` →
   note; `offer.accepted` → wait for the placement.
3. Handler `placement.created` → `opsPlacements` (package, DOJ, offer letter ref from TA's
   required fields, **T1**) → `feeRuleSnapshot` from `opsEsa` → **same-day notice**: internal
   task to the owner and accounts + email `placement.notice` to Asma (auto, internal
   recipient) + `notify` the TA lead; the group post text drafted as a task.
4. Missing fields (TA refused Place without them, but an old placement may lack them) →
   task "get package / offer letter" to the owner (**B9**).
5. DOJ tracking: timers `doj.remind` at -7 and -1 days to the owner and the TA (`notify`);
   `placements.changeDoj(newDate, reason)` → history + **TA:** `POST placements/{id}` doj →
   timers rescheduled.
6. `placements.cancel(reason)` (candidate lost before joining) → **TA:** cancel (TA reopens
   its offer path; back-up promoted in TA) → position stage back to `searching` or `offer`.
7. Joining day: timer `doj.join` at 09:00 → task to the TA ("call to confirm", `notify`) and
   the owner; handler `placement.joined` (TA) or `placements.markJoined` (owner) → state
   `joined` → P7 guarantee start → invoice (step 9) if not a replacement.
8. No-show: `placements.markNoShow` → **TA:** no_show → options message `placement.noshow_options`
   (replace or stop; no refund, nothing invoiced) drafted → approved → sent → owner records
   the client's choice: replace → position `searching` (TA reopens), stop → close checklist.
9. Invoice engine: `invoices.draftFee(placementId)`: amount = fee rule × package (months of
   gross or basic; non-Sri-Lankan months) + tax lines (⚪); number from the series; PDF from
   the invoice template; `dueAt` = joined + 30 days; task to accounts.
10. `invoices.approveAndSend` (accounts): email `invoice.cover` with the PDF to the billing
    contact; state `sent`; timer `invoice.due`; **TA:** `POST placements/{id}/invoice-state`
    (keeps TA's closing checklist true).
11. `isReplacementOf` set (from P7) → no invoice; note on the placement.
12. Payments: `payments.record(invoiceId, amount, paidAt, method)` (accounts) → `partly_paid`
    or `paid`; `paid` → "fee collected" notice to the owner and Asma; guarantee `feePaidAt`.
13. Late charge: `invoice.due` fired and unpaid → `lateMonths++`, `lateCharge` recomputed
    (simple or compounded per settings) → chase drafted (`invoice.chase`, email + WhatsApp
    template) → accounts approves → sent → timer `invoice.chase` (30 days) → repeat.
14. Write-off: at `invoice.writeOffDays` unpaid → task "write off?" to accounts (escalates
    to director_ops) → `invoices.writeOff(reason)` → guarantee `void` → close checklist (P7)
    → **TA:** status `closed`.
15. Surcharge invoices (from P4 unreported hire): `invoices.draftSurcharge(setId)`; same
    approve/send; ⚪ chase path (default: same as a fee invoice).
16. Credit notes: `invoices.creditNote(invoiceId, amount, reason)` for refunds (P7) and
    corrections.
17. Exports: `invoices.exportCsv(range)`, `payments.exportCsv(range)` to R2 with a signed
    link (no accounting tool yet).
18. Views: "placements this month", "joining this week", "invoices due / late / unpaid by
    client", "payments received".
19. Reconciliation query: Ops invoice state vs TA `placements.invoice*` fields; a nightly
    check flags differences.
20. Phase test: placement event → notice to Asma (test) → DOJ reminders → joined → invoice
    drafted → approved → sent (test) → clock to day 30 → chase with 5% → payment recorded →
    paid; the no-show path; the cancel path; a replacement produces no invoice.

## Phase 7 · Guarantee, reports and close

1. Tables `opsGuarantees`, `opsReports`, `opsCloseChecklists`.
2. `guarantees.start(placementId)` on `joined` for every hire: `endsAt` = +90 calendar days;
   timers `guarantee.end`, ⚪ `guarantee.warn` (75).
3. Clean end: `guarantee.end` fired and state `running/warned` → `ended_clean` → close
   checklist (step 11) → notice to the owner and Asma.
4. Leaver: `guarantees.markLeaver(leftAt, reason)` (owner, or handler `placement.fell_through`)
   → **TA:** `POST placements/{id}` left → if `feePaidAt` empty → `void` → close checklist;
   else `replacing`: **TA:** `POST openings/{id}/status open` reason `replacement` → `notify`
   the TA and TA lead → timer `replacement.deadline` (60 working days). **TA: T3 (replace
   first in `closing.ts`).**
5. Replacement placement: handler `placement.created` with the same opening while a
   guarantee is `replacing` → `isReplacementOf` set → no invoice → `guarantees.replaced` →
   new guarantee for the new placement (step 2).
6. Deadline passes with no replacement: `replacement.deadline` → task to `director_ops`
   (escalates) → `guarantees.decideRefund(pct=25, reason)` → `refund_pending` → credit note
   (P6 step 16) drafted → accounts sends → `refunded` → close checklist; `doNotContact` flag
   on the client profile if chosen.
7. ⚪ client deadline to choose replace or stop after a no-show (P6 step 8) → timer
   `noshow.clientChoice` → reminder.
8. `guarantees.view`: per client and per placement with days left; "ending this month".
9. Weekly report: Monday 08:00 job (`report.day`) → `reports.buildActivePositions`
   (P3 step 18) + Ops rows (ESA state, sets sent, days waiting on client, interviews this
   week, placements, guarantees running, invoices unpaid) → `opsReports` built → task to the
   TA lead "review" → `reports.approve` → email `report.weekly` to Mr Azeem (auto after
   approval) with the PDF → `sent`.
10. Report settings: recipients, day/time, which columns; the Director's reply (if any) is
    filed by the mail reader.
11. Close checklist: `close.open(openingTaId, trigger)` creates the tasks: "close LinkedIn"
    (TA, `notify`), "close TopJobs" (owner, with the drafted email if an ad is live), "close
    opening" (**TA:** `POST openings/{id}/status closed` run by Ops when the first two are
    done, or at once if nothing is live), "close lead" (Ops), "group notice" (optional post).
12. Triggers wired: clean end, refund, write-off, client stops (no-show), hold limit (⚪),
    impractical role (lead only).
13. `close.complete` when all items are done → position stage `closed`; client profile
    stage back to `active` (if other positions) or `closed`.
14. Handler `opening.closed` raised by TA on its own (a TA closes by hand) → Ops close
    checklist opened in "TA closed first" mode (remaining Ops items only).
15. Lead closure mirror: a closed position with no other open positions for the client →
    the client profile shows "no active work"; nothing else.
16. Analytics queries (no UI): ESA return time (sent → signed), client wait on sets (set
    sent → first decision), slipped hires (DOJ moves), time to fill (opened → placed), by
    client and by owner; stored weekly in `opsReports` kind `kpis` for the owner's
    "measure today's numbers" wish.
17. Archive rules: closed positions keep everything; nothing is deleted; R2 files keep.
18. Views: "guarantees running / ending", "replacements in progress", "refund decisions",
    "weekly report status", "close checklists open".
19. Phase test: joined → guarantee running → clock to day 90 → clean end → checklist → TA
    closed; leaver at day 40 with fee paid → TA reopened → replacement placed → no invoice,
    new guarantee; leaver with fee unpaid → void; deadline passed → refund decision → credit
    note; Monday job builds and sends (test) the report.

## Phase 8 · Hardening, staging, pilot

1. End-to-end flow tests: one test per branch of the diagram ([14](14-DIAGRAM-DEEP-WALKTHROUGH.md))
   against the fake TA, with the clock advanced; every end step reached.
2. Contract tests: one shared JSON of request/response examples run by both repos (Ops
   client ↔ TA endpoints) so a change on either side fails a test.
3. Idempotency tests: every write replayed twice gives one effect.
4. Outage tests: TA down → writes queue and screens degrade; Ops down 1 hour → events
   catch up in order.
5. Safety tests: `OPS_OUTREACH_LIVE=off` → no external address ever receives a message
   (asserted on the provider mocks); do-not-contact respected; daily cap.
6. Load check: 10× a normal day (Part C12) on the laptop; cron batches hold; no query
   without an index (Convex warns).
7. Backups: nightly `pg_dump` of `convex_ops` added to the server backup; a restore
   rehearsal on the laptop.
8. Kill switches rehearsed: timers off, TA writes off, outreach off, mail reader off; each
   leaves the system consistent.
9. Runbooks in `docs/runbooks/`: wrong recipient, mail reader stalled, TA link down, events
   stuck, pause Ops, restore, rotate the Ops key.
10. Health screen queries: last mail run per mailbox, events cursor age, outbox size, timers
    due vs fired, sender errors; alerts to the ops lead.
11. Data import migrations (dry-run first, as TA does): `opsClientProfiles` for every TA
    client with `opsOwnerId` from Asma's list; `opsEsa` from `esaRecords` + the signed files
    the team uploads; `opsPlacements` + `opsGuarantees` for placements joined within 90 days;
    `opsHolidays` from the CSV; `opsMembers` from the role list.
12. Sheet freeze plan: which sheet stops on which day; the "record what happened" path
    covers anything in flight.
13. Docker image for Ops (Node, LibreOffice), `deploy/production/docker-compose.yml`,
    `.env.production.example`; the release workflow (`main` → `production` with approval)
    copied from TA's pattern.
14. Server plan approved by the owner: `/opt/ops-prod`, ports 3310/3311/6891 on
    127.0.0.1, database `convex_ops` created in the shared Postgres (one `CREATE DATABASE`,
    no change to TA's), Caddy blocks `ops.career141.com` and `ops-api.career141.com`, DNS,
    firewall script lines, memory check before and after.
15. Staging: the same compose with staging names (`ops-staging.*`) and a copy of TA's
    staging if the owner rebuilds it; otherwise Ops staging alone against the fake TA with
    recorded live-shaped data.
16. Ops team walkthrough on staging: Asma, Rushda, one more owner, the TA lead: the whole
    flow with test clients; every "I would do X here" noted; fixes.
17. Live deploy with all switches off (`OPS_OUTREACH_LIVE off`, `OPS_TA_WRITES_ENABLED off`,
    `pilotClientIds []`); import migrations run for real after their dry runs; nothing
    sends, nothing writes to TA.
18. Pilot: one client in `pilotClientIds`; writes and outreach enabled **for that client
    only**; two weeks; every message still approved; daily check of the health screen and
    the audit log.
19. Pilot review with the owner: what was sent, what TA received, what the team bypassed;
    fixes; then `pilotClientIds` → all.
20. Hand the UI team the final query/action list per screen ([07](07-SCREENS.md)) with
    examples from staging; Ops keeps running from the `/dev` pages and the inbox until the
    real screens land.
21. Go-live note to the team: the sheets are frozen; the inbox is the day; where to report
    problems (the TA feedback desk pattern, an `opsFeedback` table).
22. Retire the fake TA from the production path; keep it for tests.
23. Post-launch backlog opened: T13 (`opsForTa` on the TA opening page), e-signature,
    click-to-dial/recorded calls, per-owner mailboxes, accounting export format, Talent
    Pulse analytics, hold-limit and other ⚪ items once decided.

## Phase 9 · The AI productivity layer (added 3 Nov)

Added at the owner's request. It is **one layer across the finished system**, not a
chatbot bolted on, and it comes after the pilot because the desk has to run on rules
before anything starts proposing. Two pieces are cheap and may ride earlier: see the
priorities at the end.

The register of every opportunity, module by module, with what already exists and what
is refused, is [21](21-AI-OPPORTUNITIES.md).

**Five principles, which every step below obeys.**

- **AI proposes; a person decides.** Nothing a model writes reaches a client, a
  candidate, the TA System or a money field without the approval this system already
  demands (F7, and the owner's standing rule).
- **Voice means dictation into our own fields** — not a bot talking to anybody. AI phone
  calls stay refused: the owner's decision 7, and TA's voice worker is suspended.
- **Nothing is rebuilt that TA already has.** CV reading, scoring, matching, search
  ranking, the JD draft, Research and Suggestions, and the candidate reply reader stay in
  TA; Ops asks through the API (Part E).
- **Every run is recorded**: task, model, cost, what it read, what it proposed, and what
  the person did with it. Accuracy and spend are read off that, not guessed.
- **Cheap by default, and budgeted.** DeepSeek v4 flash first, the Claude subscription
  only where judgment is needed — that subscription is a limited pool, as 3 Nov showed,
  so no AI work runs while a page renders or inside a loop.

1. Tables `opsAiRuns` (task, model, tokens, cost, ms, what it read, what it proposed,
   what the person did, by, at) and `opsAiFeedback` (the edit a person made to a
   proposal); settings `ai.<task>` on or off, `ai.dailyBudget`, `ai.modelFor.<task>`.
2. The router `src/lib/ai.ts`: `modelFor(task)` in the house order, a hard timeout, one
   retry, and a budget guard that switches the layer off for the day at the cap. Called
   only from an action a person pressed or from the clock pass — never while a screen
   renders.
3. **Structured output or nothing.** Every task has a schema; output is validated before
   it reaches a screen. A failed parse records the run and proposes nothing, which is a
   normal answer and not an error to hide.
4. One **proposal** shape for the whole system: what it suggests, which records it read,
   how sure it is, and two buttons — use it, or ignore it. No AI text enters a record
   without one of those presses.
5. Dictation, the first piece: `POST /api/ai/dictate` takes a clip of at most sixty
   seconds and gives back text with punctuation. The clip is kept against the record, so
   what was written can be checked against what was said. English first; Sinhala and
   Tamil next, each proved before it is offered.
6. Dictation where the desk types most, in this order: the intro-call brief, the
   requirement meeting, a call outcome, the client's feedback on a candidate, and the
   reason on any decline, hold or drop. One microphone beside the field; the text lands
   in the field, editable, and nothing saves itself.
7. Dictation into **fields**: a spoken brief becomes the meeting's role, package and
   brief, or the requirement's fields, as a proposal with every field shown. What was not
   said is asked for in one line ("no salary was said") and never invented.
8. The **inbound reader**, which Phase 2 step 14 and Phase 4 step 9 already need: an
   email matched to a subject is classified — agreement signed / changes wanted /
   declined; per candidate shortlisted or rejected, with the client's own words as the
   reason; a slot offered; a CV claimed; a cancellation — into a task "confirm what the
   client said" carrying the proposal per candidate. The reason the owner requires is the
   client's wording, not ours.
9. **Draft and improve, on the one way out.** Every drafted message gains rewrite,
   shorter, warmer, more formal, regenerate; each makes a new draft version, and the
   approved text is what sends. The template stays the first draft, so nothing is written
   from nothing.
10. Reply drafting: a client's email plus the record gives a drafted reply — subject and
    body — with the facts it used listed beside it.
11. Summaries where a person reads a lot: a client's whole history, one thread, an
    agreement's negotiation, a set's feedback. Every summary names and links the records
    it read.
12. "What first" on the day screen: the desk's own tasks, clocks and drafts put in order
    **by the rules**, with AI writing only the one-line reason. A broken model must never
    change what is urgent.
13. The **ask box**, not a chatbot-first screen: one box on every page, read-only to
    begin with, answering from the desk's own data inside the person's permissions, every
    answer linking the rows it used.
14. Then **doing**: the box may run only actions that already exist, one at a time, each
    through the same confirmation a person would have seen. It never writes to TA, never
    sends, never closes anything, and never touches money.
15. The weekly report (Phase 7 step 16): the numbers from the data, the prose from AI,
    and the TA lead approves it before the Director sees it.
16. **Accuracy, not impressions.** A weekly sample of each task compares the proposal
    with what the person did; a task whose proposals are changed more than half the time
    switches off until its prompt is fixed. The switch is a setting, not a deploy.
17. **Cost.** A daily budget in the settings, every run costed, and the health screen
    showing today's spend by task. At the cap the layer stops rather than quietly
    spending.
18. **Privacy by task.** The layer reads only what the person could read, and each task
    is given the least it needs: a score needs the CV, a reply does not. A client's
    agreement text goes to no model unless the owner says so.
19. **Audit.** Every proposal, acceptance and edit goes in the audit trail with the model
    and the prompt version, so a year later we can say why a record says what it says.
20. What Ops **does not** build here, because TA has it: CV reading and scoring,
    candidate matching and search ranking, the JD draft, Research and Suggestions, the
    candidate reply reader. An improvement to any of them is a TA pull request under
    Track A rules.
21. What is **refused**, with the reason: AI phone calls to anybody (decision 7); AI
    deciding a reject, a hold or a decline; AI sending anything to a client or a
    candidate; AI writing to the TA System; AI setting any money figure; and a chatbot as
    the only way to do something that has a screen.
22. Phase test: dictate a brief, fields proposed, corrected, saved; an inbound
    classified, decisions confirmed, the TA write queued; a set email improved twice and
    approved; the ask box answering from data, then running one action with its
    confirmation; the budget cap reached, the layer off, and the desk still working.

**Priorities, and what may ride earlier.**

| Priority | What | When |
|---|---|---|
| 1 | Dictation on the five fields (5 to 7) and draft-improve on the one way out (9), with 1 to 4 beneath them | May ride with Phase 5 if the owner wants it sooner: no new decision, nothing client-facing changes |
| 2 | The inbound reader (8), summaries (11), reply drafting (10), "what first" (12); 16 to 19 land with these at the latest | After the pilot |
| 3 | The ask box read-only (13), then doing (14), the weekly report's prose (15) | Last, because it is the only part that can act |

---

# Part H · Testing, release and operations (summary of what the phases contain)

| Area | What |
|---|---|
| Unit | calendar; every timer kind; every state machine move; fee and late-charge maths; template filling; inbound matching |
| Flow | every branch of the diagram, clock-advanced, against the fake TA |
| Contract | shared examples run on both sides; idempotency; failure codes |
| Safety | test mode never leaks; do-not-contact; caps; audit on every write |
| Load | 10× a day on the laptop; indexes on every query |
| Release | CI on PRs; `main` → `production` with the owner's approval; Docker image; compose |
| Live | own containers, database, names, firewall, backups; switches off; migrations dry-run then real |
| Pilot | one client, two weeks, every message approved, daily health check |
| Operate | health screen, alerts to the ops lead, runbooks, kill switches |

**Who does what:** Sanjeev: Ops backend (P1-P8). Binath: TA blocks T1-T14 in the order of
E5, reviewed with `merge-teammate`, released through TA's pipeline with the owner's
go-ahead. Owner: decisions in Part I, outside requests (Microsoft consent, Meta templates,
mailboxes, number), approvals of every release and of switching the pilot on. Ops team:
templates' wording, the walkthrough, the sheet freeze. UI team: screens after P1 queries
exist, against staging.

---

# Part I · Decisions to make before or during the build

_12 decided by the owner on 1 Nov (marked). Still open: 1, 5, 7, 10, 12, 18-23._

| # | Decision | Default in this plan | Needed by |
|---|---|---|---|
| 1 | Same Clerk accounts as TA | Yes | P1 |
| 2 | Who holds which Ops role; own clients or all | **Decided 1 Nov:** all visible, own in the inbox | P1 |
| 3 | Ops mailbox(es) | **Decided 1 Nov:** one **new** `ops@` | P1 |
| 4 | Website leads: webhook or hello@ | **Decided 1 Nov:** webhook | P2 |
| 5 | Meeting invites auto or approved | auto (template) | P2, P5 |
| 6 | Escalation targets after single reminders (countersign, Director chase, client report) | **Decided 1 Nov:** ops lead after 24 h | P2 |
| 7 | ESA signing: scan now, e-signature later | yes | P2 |
| 8 | One or five 100% positions per TA per day | **Decided 1 Nov:** TA's current rule (five) | P3 |
| 9 | Talent Pulse tracked links | **Decided 1 Nov:** routing address only | P3 |
| 10 | TA "monitor" mode: new working stage or on_hold | **on hold** with reason "five shortlisted" (J9) | P4 |
| 11 | Hold limit before closing a held position | **Decided 1 Nov:** never automatically; owner task every 30 days | P4, P7 |
| 12 | Teams (consent), Zoom, or manual links to start | manual links until consent | P5 |
| 13 | Calls: tasks + logs only, no telephony now | **Decided 1 Nov:** yes | P1 |
| 14 | WhatsApp: new Ops number or an existing WABA; templates | **Decided 1 Nov:** new number | P1 |
| 15 | Invoice numbering, tax, currency, bank details; simple vs compounded 5%; surcharge basis | **Decided 1 Nov:** series `C141-OPS-YYYY-NNNN`, no tax line, LKR, **simple** (numbering, tax, bank details still ⚪) | P6 |
| 16 | Offer-silent timeout | **Decided 1 Nov:** none (TA's) | P6 |
| 17 | Day-75 warning; client deadline after no-show | **Decided 1 Nov:** 75 on; 5 working days | P7 |
| 18 | TA client editing stays in TA or moves to Ops | stays; Ops reads before writing | P2 |
| 19 | API over the public name or the Docker network on the VPS | Docker network `career141_default` (J15) | P8 |
| 20 | Import the sheets or start clean | start clean + the three migrations | P8 |
| 21 | Rebuild TA staging or pilot only | Ops staging + pilot | P8 |
| 22 | What "DLA" is | ⚪ | P2 |
| 23 (J) | Pipeline depth per opening or per work location | per opening | P4 |

---

# Part J · Second pass: what the TA System's real workings change in this plan

_Corrections 2 Nov (from [19](19-TA-SYSTEM-IMPROVEMENT-PLAN.md) §13): **J4** — `jobPosts.routingEmailAlias` is written but no router reads it today; routing is LinkedIn job number → project number → `campaignCode` → exact headline. The Ops plan therefore uses the post's `campaignCode` in the TopJobs/Talent Pulse subject until TA adds the alias branch (19 §7.5). **E5 T15** — the `shortlists@` and `interviews@` readers run only with `C141_MAIL_INTAKE=on`; the Ops plan must not assume them._

_Added 1 Nov after reading the plan against the full TA System knowledge (`/ta-system-full-flow`
and the 12 feature skills) and the full Ops board (`/ops`). Each item says what was found,
why it matters, and what the plan now does. Where it changes an earlier part, that part is
amended in place and marked "(J)"._

## J1. How TA writes really happen, and why the events must be raised in `commit:apply`

**Found.** Most TA writes do not go through dedicated Convex mutations. The web app loads an
in-memory store (`primeStore()` → `src/data/store.ts`), a server action changes it,
`diffTables` turns the change into row operations, and one Convex mutation,
`ta/commit:apply`, writes them (with a "someone else changed this record" conflict check).
Interviews, offers, placements, ESA records, client rounds and opening status all reach the
database this way today.

**Why it matters.** If events are only raised inside new mutations, nothing the TA does
from the web app (booking an interview, pressing Place, building a client set) raises an
event. Ops would never hear of it.

**Plan.** T11 becomes two things: (a) a small **change detector inside `commit:apply`**: for
every row operation on `interviews`, `offers`, `placements`, `esaRecords`, `reviewRounds`
(kind client), `jobs` (status, jdStatus, assignedTaIds) and `jobPosts` (status), insert the
matching `contractEvents` row in the same transaction; (b) the dedicated mutations for Ops
writes (T9) raise the same events through the same helper. (a) is small and lands in Phase 1;
it makes every TA-originated change visible to Ops at once, before any logic moves.
`application.stage_changed` needs no new row: TA already writes `pipelineEvents` on every
stage move; the events endpoint reads both tables merged by time.

## J2. Two writers on the same record: the conflict check

**Found.** `commit:apply` refuses a web write when a field it is changing was changed by
someone else since the page loaded.

**Why it matters.** Ops writing `clients.opsOwnerId` or `placements.joinDateMs` through the
API while a TA has that record open can make the TA's next save fail with "Someone else
changed this record".

**Plan.** API writes touch **only Ops-owned fields** on shared rows (`opsOwnerId`,
`clientOwnedAt`, `teamsLink`, `receivedAt`, `adChannelState`, `package`, invoice fields) or
go through dedicated mutations that the web app also uses (status, interviews, placements
after T9). The TA client-editor conflict is listed as decision 18; the default stays "TA keeps
editing clients", and Ops reads before every write, so the collision window is seconds.

## J3. The workday gate and the collision lock

**Found.** A TA's writes on an opening are refused unless that TA has a started workday
(`assertWorkdayScope`), and the first TA to shortlist a candidate owns it (collision lock).
Desk-wide roles (admin, director, ta_lead, ops) are exempt from both.

**Plan.** Every Ops API write runs as a **system actor with the `ops` desk-wide role** (a
dedicated `users` row `ops-system@career141.com`, inactive for sign-in), so the workday gate
and the lock never block a client decision, and TA's audit shows "Ops system" as the actor.
Bells still name the ops owner in the body.

## J4. Adverts: reuse TA's own routing instead of a new CV endpoint

**Found.** `jobPosts` already has `channel` (linkedin · portal · whatsapp · facebook ·
email_campaign · other), `campaignCode` and `routingEmailAlias`; TA's mail intake routes a CV
to the post by that alias and counts `cvCountToday` per post.

**Plan (replaces E2 `POST cvs` and P3 step 13).** `POST openings/{id}/posts` with
`channel=portal` (TopJobs) or `email_campaign` (Talent Pulse) creates a job post and returns
its `routingEmailAlias`. Ops puts that alias on the TopJobs order and on the Talent Pulse
entry (or behind the tracked link, decision 9). CVs arrive by mail, TA files them to the
right post with the source already known, scoring runs as for LinkedIn, and "CVs per
source" is `cvCountToday` per post. Ops's own mail reader does not touch CVs at all.
`POST openings/{id}/ad-channel` stays for live/closed dates and cost on that post.

## J5. Mailboxes that already read client and interview mail

**Found.** `shortlists@` is read by TA's AI reader: Director replies apply decisions, and
**client replies move candidates to Client Shortlist**. `interviews@` (24 Oct) reads
invitation mail and moves candidates to Interview. `opsteam@` is Cc on every EOD email.

**Why it matters.** Two readers acting on the same client reply would double-move a
candidate; an Ops interview invite copied to `interviews@` would be read as a client's.

**Plan.** (1) Ops uses a **new `ops@` mailbox**, not `opsteam@` (decision 3 default
changed), so EOD traffic never enters the Ops reader. (2) Client sets go out from `ops@`
only; the client's reply lands in Ops; TA's `shortlists@` reader keeps Director replies and
is told (T-change) to **skip any mail carrying the `[C141-OPS-…]` reference**. (3) The
`interviews@` reader likewise skips Ops-referenced mail; Ops bookings reach TA only through
the API. (4) During the pilot, both readers log "skipped Ops mail" so the overlap is visible.

## J6. Prepared CVs are made in the Next app, not in Convex

**Found.** Prepared-CV PDFs are generated by the Next app (`src/lib/preparedCvFile.ts`) and
attached to EOD emails (`dailyEmailAttachments`); Convex's HTTP router serves raw CVs only.

**Plan.** The read endpoint for prepared CVs lives on the **Next app**
(`ta-system.career141.com/api/integrations/v1/applications/{id}/prepared-cv`, same Ops
token), reusing the EOD attachment when one exists for that candidate, else generating it.
Raw CVs stay on the Convex endpoint. The TA client in Ops has two base URLs.

## J7. TA alerts are computed in the web layer, not stored

**Found.** `src/lib/sla.ts` computes alerts on request; nothing is written, so there is no
TA event for "JD unapproved after 1 day" or "stale role".

**Plan.** Ops computes the few alerts it needs from reads (`jdStatus` + `createdAt`;
`assignedAt` + priority target) in its own tick, instead of the `notification.for_ops` event
for those. `notification.for_ops` stays only for things TA code explicitly wants an ops owner
to know.

## J8. Opening creation details that TA does not set today

**Found.** `ta/openings:create` never writes `assignedAt` or `requirementReceivedAt`; the
Master Sheet corrects `assignedAt` later; "day N of target" starts from `createdAt`.

**Plan.** `POST openings` sets `requirementReceivedAt` (the requirement meeting date) and
`assignedAt` when the TA lead's assignment is given; the hand-over date in B4 row 24 is
therefore exact. Priority tier can be passed (`priorityTier`, default P3).

## J9. "Monitor" mode: use On hold, not a new mode

**Found.** On hold already stops the follow-up sweep and SLA alerts, keeps the opening
readable, still accepts CVs through the post's own link, and lets a TA keep it in a workday.
That is what "hold at five, monitor only, LinkedIn closes" asks for.

**Plan (changes decision 10 default).** Hold-at-five sets the opening **on hold with reason
"five shortlisted"** through the existing status write, and the TA keeps interviews moving
on it; "below five again" sets it open. No new working stage in TA.

## J10. Sign-in across two domains

**Found.** TA's Clerk production instance is bound to `clerk.ta-system.career141.com`;
Clerk users are provisioned by an admin on TA's People page (invitation + `users` row).

**Plan.** Ops is a **Clerk satellite domain** (`ops.career141.com`) of the same instance,
so one session works on both; the Ops backend's Convex auth config lists the same issuer.
Ops people are first provisioned in TA's People page (so bells and `GET people` work), then
given an Ops role in `opsMembers`. Phase 1 step 11 is amended.

## J11. Positions with several work locations and headcount

**Found.** An opening can have several work locations, each with its own L-sheets, sets and
EOD emails (`reviewRounds.workLocationId`), and `headcount` can be more than one.

**Plan.** `opsClientSets` carries `workLocationId`; the client email names the location; a
placement is invoiced **per hire** (the board's "first hire only" means "not for a
replacement", not "only one per position"); the guarantee is per placement, as planned.
Pipeline depth is evaluated per opening (all locations together) unless the owner wants per
location (decision 23).

## J12. The ESA holds more than fee and guarantee

**Found (board, ESA draft c2505 / terms c2511).** A 3-year term with 14 days' written
notice; interview-room charges (LKR 50,000 a day, 2,000 an extra hour); 12-month and 4-month
candidate rules; response in 7-14 days and 5-10 profiles per set promised to the client.

**Plan.** `opsEsa.fields` gains `termYears`, `noticeDays`, `termEndsAt` (timer `esa.renewal`
60 days before), `interviewRoomDayRate`, `interviewRoomHourRate`, `candidateRules` (text,
⚪ to interpret); `opsInvoices.kind` gains `other_charges` for interview-room use; the KPIs in
P7 step 16 include "sets within 14 days of ESA" and "profiles per set".

## J13. Measure today's numbers before building (the owner's "strategy first")

**Found.** The board's brief says: measure ESA return time, client wait on sets and slipped
hires first, so the system's effect can be shown.

**Plan.** Phase 1 gains step 0: a one-off baseline from the archive (Outlook, the ESA tracker,
Placement Updates) for the last 6 months, entered into `opsReports` kind `baseline` by the
Ops team with a simple form; the same KPIs are then produced weekly by P7 step 16.

## J14. The Ops system is not reactive to TA

**Found.** Convex screens update live inside one backend; across two backends they do not.

**Plan.** Ops screens poll TA reads every 30 s while open and refresh on consumed events;
the UI team is told so. The inbox itself is live (Ops data).

## J15. Networking on the one server

**Found.** The firewall closes 3210/3211 to the internet; containers on the
`career141_default` Docker network reach the TA backend by name.

**Plan (decision 19 default).** The Ops backend joins `career141_default` and calls TA at
`http://career141-backend-1:3210/integrations/v1/...` for Convex endpoints and
`http://ta-prod-app:3110/api/integrations/v1/...` for the Next ones; nothing leaves the box.
The public names stay for people only.

## J16. Where the Ops dashboard in TA goes

**Found.** TA has an `OpsDashboard` for the `ops` role (clients, alerts to chase, interviews).

**Plan.** After the pilot, that page links to the Ops system and shows the `opsForTa` reads
(ESA status, ops owner, set state, guarantee state); nothing is removed from TA.

## J17. Amended lists

- **E2 writes:** add `POST openings/{id}/posts` (J4); remove `POST cvs`.
- **E5 TA changes:** T11 split as in J1; add T15 "`shortlists@` and `interviews@` readers skip
  Ops-referenced mail"; add T16 "system actor `ops-system` user"; add T17 "`notifications`
  type `ops_notice` declared and rendered"; add T18 "Clerk satellite domain for `ops.career141.com`";
  add T19 "prepared-CV endpoint on the Next app"; T9 note: `assignedAt`/`requirementReceivedAt`
  set on API create.
- **Phase 1:** step 0 (baseline), step 11 amended (provisioning through TA People + satellite).
- **Phase 3:** step 13 replaced by the posts endpoint (J4); step 15 uses the post alias.
- **Phase 4:** step 14 sets on hold with reason instead of a monitor mode (J9).
- **Part I:** decision 3 default `ops@` new mailbox; decision 10 default "on hold"; decision 19
  default "Docker network, not public name"; new decision 23 "depth per opening or per
  location".

---

# Part K · Third pass: gaps found by checking every card on the board

_Added 1 Nov after the card-by-card check in [17](17-BOARD-COVERAGE.md). Each item amends the
part it names._

**K1. The ops lead assigns the owner; the owner is on the position's team** (23 Oct note).
P2 step 2 changes: a new lead creates a task "assign an owner" for the **ops lead**
(round-robin only as the suggested name); `POST openings` carries `opsOwnerId` and TA stores
it on the job (new field `jobs.opsOwnerId`, T12) so the owner is listed with the team and
included in bells about that opening.

**K2. The client's duty to send placement details** (ESA clause 2.12). P6 gains a step after
`offer.accepted`: Ops drafts `placement.details_request` to the client HR asking for package,
joining date, billing address and the signed offer letter, with a 3-working-day timer and a
reminder; what comes back is recorded on `opsPlacements` (and `opsClientProfiles.billingAddress`,
new field) and, if the TA's Place has not yet happened, passed to the TA as a bell so Place is
filled correctly. TA's Place stays the record; this closes the gap when the client, not the
TA, holds the details.

**K3. Requirement meeting recording.** `opsMeetings` can hold a recording (R2) with consent
noted; `POST openings` passes `briefRecordingKey` and TA creates the brief with
`method=recording` (TA's `briefs` already has `recordingKey`, `transcript`, consent fields),
so the TA hears the requirement meeting instead of reading notes about it. P3 steps 3 and 6
amended.

**K4. Replacement profiles within 14 days.** P7 step 4 gains timer `replacement.profiles`
(14 calendar days from the leaver date): a task to the TA (`notify`) and the owner; the
weekly KPIs include "replacement profiles on time".

**K5. Suggest the TA by load (optional).** P3 step 6: before "Create opening in TA", Ops
shows the TA lead each active TA's open positions and 100% count (`GET openings?status=open`
grouped by `assignedTaIds`) as a suggestion. The lead still decides in TA.

**K6. Team approval before building.** P1 gains step 0b: a walkthrough of [04](04-OPS-FLOW.md)
with Asma, Rushda, two TAs and the TA lead, recorded in [09](09-DECISIONS-AND-QUESTIONS.md);
building Phase 2 onward starts only after it. (Phase 1 foundation can start in parallel; it
holds no business rule.)

**K7. Fix the ESA template first.** Outside approvals (Part H / 01 step 12) gain: "ESA
template proofread and corrected: fill NAME/DESIGNATION/ADDRESS placeholders as fields,
decide clause 1.1 'working calendar days', remove the duplicated 8.5/8.6, correct the file
name." P2 step 9 refuses a template version that still contains unmapped placeholders.

**K8. KPIs.** "Profiles per set" is dropped from P7 step 16 (owner: do not track 5-10
profiles); "set within 14 days of ESA" and "ESA response time" stay.

**K9. The One Desk risks (c3777) and their handling.**

| Risk on the board | Handling |
|---|---|
| Building all at once delays use; one fault blocks the whole flow | Eight phases behind flags, released together, switched on per client (pilot); each phase demoable alone |
| Clients keep replying in WhatsApp groups outside the system | "Record what the client said" on every set and interview; group posts drafted; direct WhatsApp read by the webhook |
| Live sending needs the outbound lock and test mode | Safety gate with `OPS_OUTREACH_LIVE` off, test recipients, do-not-contact, caps (P1 16) |
| In-memory store vs Convex: two data paths | T9 moves the shared writes into Convex; J1 raises events from `commit:apply` meanwhile |
| 400-CV scoring cap and 60-per-run sweep may lag | TA-side capacity; Ops never adds CV load (J4); noted for the TA work plan |
| Staff habits keep two copies alive | Sheet freeze plan with dates (P8 12); the inbox is the only page to open; every sheet column has a system home (D4) |
---

_End of the plan. Questions, then approval, then Phase 1 step 1._
