# 13 · Corrections log

Everything corrected while consolidating the plan, with the reason. Newest first.

## 1 Nov 2026 · Deep read of the diagram

**Canvas re-read:** all 59 cards byte-for-byte identical to 28 Oct (every diagram's steps,
arrows and text hash the same). New document [14](14-DIAGRAM-DEEP-WALKTHROUGH.md): all 250
steps of c5237 with owner, arrows, corrected labels and connection points; the 12 end steps
judged; the 27 floating labels placed.

## 28 Oct 2026 · Consolidation pass (this repository)

**Canvas re-read:** all 59 cards present; every diagram has the same steps and arrows as
on 27 Oct (c5237 250/332, c4585 236/324, c3626 60/95, c3002 60/94, c2790 60/93, c719
65/75, c4412 65/93, c4234 28/27, c1061 25/36, c2511 11/10, c1039 10/11, c4381 10/9). Text
cards checked against the stored copies: identical. **Nothing on the canvas changed.**

**TA System re-checked on `main` (a083b14b):** `client.manage` still excludes `ops`;
Place still redirects to `/placements/{id}`, a page that does not exist; the read-only
partner API (`/integrations/v1`) is unchanged; Gajani's TA tracking has been added to TA
(separate project, not part of Ops).

**Repository documents corrected:**

| Document | Was | Now |
|---|---|---|
| 04 flow | A 15-row table copied from the canvas, with its gaps | Full flow in 9 phases with diagrams, the design gaps fixed, combined position status |
| 03 connection | Said TA "keeps" the client and Ops writes it, without the open conflict | Same model, plus the open question: TA leads and directors can still edit clients in TA |
| 01 plan | Technology listed as decided | Order of work: agree the flow → decide technology → update documents → build |
| 06 technology | Read as final | Marked "proposed", decided after the flow is agreed |
| 09 decisions | Pointed to the analysis for the 17 settled conflicts | Lists all 17 with their resolution, and the 10 flow corrections to confirm |
| New | — | 00 context for a new chat, 11 people and roles, 12 glossary, 13 this log |

## 27 Oct 2026 · Corrections to the canvas flow (c5237)

### Design gaps fixed in [04](04-OPS-FLOW.md)

1. A first hire's 90-day clock (n6181) led only to the invoice; the leave / day-75 /
   clean branches hung off the replacement clock (n6201). Now every hire's guarantee has them.
2. "Fee collected" (n6189) was a dead end while the locked flow c3626 closed the position
   at fee collected. Decided 27 Oct: the position closes at guarantee end, refund or write-off.
3. "Escalated to TA" (n6333) was a dead end. Now a call task for the TA.
4. Only Reminder 48h/72h led to "Reply read". A reply at any point stops the reminders.
5. "Director rejection notice" fed "Pipeline pending counted" (client counts). Director
   rejections now only continue the search.
6. Rejection notices back to pipeline depth were only partly drawn. Drawn for client
   rejections.
7. "Set reviewed, none shortlisted" leaked into scheduling (an arrow the canvas tool could
   not delete). Removed.
8. The surcharge invoice has no chase or payment path. Kept as ⚪ open.
9. Single reminders with no escalation (Director countersign, Director chase, client
   report reminder). Kept as ⚪ open.
10. Undecided timeouts: offer silent, silent-hold limit, client deadline for replace or stop,
    day-75 warning, hold exit. Kept as ⚪ open.
11. "Hold lead, chase ESA" for a returning client jumped into ESA email 1. Now: the existing
    agreement is sent again, then chased.
12. The weekly report and Talent Pulse hung off "LinkedIn advert Live". The weekly report is
    one desk-level job; Talent Pulse runs weekly per open role.

### Arrow labels on the wrong arrow

The canvas stores arrow labels as floating text; about 35 sat on a neighbouring arrow. The
full table (shown on → belongs to) is in [`reference/ANALYSIS.md`](reference/ANALYSIS.md),
section 3. The diagrams in [04](04-OPS-FLOW.md) use the corrected labels. Examples:

| Shown on | Says | Belongs to |
|---|---|---|
| ESA clock starts → ESA drafted | "no reply to 3 emails" | Intro call not held → Intro silent, lead closed |
| TA informed of decision → Rejected after round | "selected" | swapped with "not moving" |
| Client asks for reference? → Offer made | "TA wants TopJobs" | should be "no reference requested" |
| Candidate leaves → No guarantee | "refund paid, close" | should be "fee unpaid" |
| Package asked → Placement saved | "candidate declines" | Search stops → Offer declined |

### The plan's claims about the TA System, corrected

| Canvas said | TA code says |
|---|---|
| No interview scheduling in the code | Interview records, schedule/confirm/reschedule/outcome/feedback actions and alerts exist; slots, invites, Teams, automatic reconfirm and client notices are missing |
| No ESA record | An ESA table and status logic exist but no screen uses them (dormant) |
| Weekly report, rejection notices, placement update to Asma "already automatic" | None exist in code; they are planned |
| Guarantee not tied to joining day | The guarantee end is already joining date + guarantee days; missing: ops owner, day-75, full-payment check, replace first |
| (not on canvas) | Place redirects to a page that does not exist (TA bug) |
| (not on canvas) | Ops cannot create clients in TA (`client.manage`) |

## 2 Nov · One ops mailbox was the wrong answer

Decision 11 of 1 Nov read as "a new mailbox `ops@career141.com`", and the first mail
reader was written for that one address. Two things on the canvas say it is not enough.

**The habit already exists.** The as-is ops flow (c719) shows every client email going
from a person’s own Outlook with a shared box copied: the CV set as
"CLIENT > ROLE > SET n" copying cv@, the interview invite from interviews@ copying
opsteam@, the weekly report from joborders@, a website lead arriving at hello@, and the
first client contact reaching joborders@ or opsteam@. So there is no new habit to teach
and no box to force on anyone.

**A copy is not the reply.** Copying a shared box shows the message we sent. The
client’s answer follows the person who sent it, so a reader that watches only the
shared box would see everything we already know and almost nothing we need. The TA
System settled this months ago: its reply reader checks the signed-in person’s own
mailbox, the shortlist inbox and job@ together (`src/app/actions.ts`). That also means
Microsoft already permits this app to read staff mailboxes in this tenant, so there is
no new consent to arrange.

**What changed:** the reader takes a list (`OPS_MAILBOXES`), reads each box in turn, and
every email it records remembers which box it arrived in. One box it is not allowed to
read reports that one address and does not stop the others.

**Still to do:** the house subject "CLIENT > ROLE > SET n" is already a form the TA
System parses, and it would match hand-written set mail from Outlook. It is not built
here yet, because matching by client needs the client contacts that arrive with the TA
API.

## 2 Nov · Two holes in the reply matching, closed

**The sent-message id was invented.** `desk.ts` built it from our own row id as
`<…@ops.career141.com>` — a domain that does not exist, and not what a mail server
calls a message. Microsoft gives the real `internetMessageId` back when it sends, and a
client’s reply quotes that. So the thread rule could never have matched a single real
reply. The message record now keeps `providerMessageId`, null until a sender fills it,
and the thread rule reads only messages whose real id we kept.

**The desk’s own subject was not read.** The matcher looked only for our
`[C141-…]` reference, which appears on mail the system sent — and the desk has typed
"CLIENT > ROLE > SET n" by hand in Outlook for years (c719), which is what almost every
client is replying to today. Both rules now run, reference first: a hybrid, not a swap.

The house rule is the looser one, so it is held to three conditions. It must name a set
number, or "your shortlist, thanks" could be read as a company and a role. It must lead
to exactly one thing we know about, otherwise it is held for a person — the mistake the
TA System made when it matched candidate mail on subject text alone. And names are
compared without case, spacing or punctuation, so "A.B.C. Holdings (Pvt) Ltd" and
"abc holdings pvt ltd" are one company. Reply prefixes, a "REVISED -" marker and our
own reference are stripped before parsing, because a real reply carries all three.

Both forms are read: "CLIENT > ROLE > SET 02" and "SET 2 - CLIENT - ROLE - 5 CVs", the
latter being what the TA app already sends.

## 2 Nov · The working week was already answered

`isWorkingDay` said Monday to Friday with no source, which made it look like a guess
waiting on the owner. It is not. The room's reading of the TA System records the rule as
settled: its alerts "skip weekends and holidays, and one working day counts as 24 hours"
(card c1174). Ops therefore counts the same days as the TA System, which matters because
both sides of the API quote deadlines to the same people.

What is genuinely open is the **holiday list**, which is empty in both systems — so every
"7 working days" clock currently ignores poya and public holidays and can come due on a
day the office is shut. The dates are public; which ones Career 141 closes for is the
owner’s call, and it belongs on the holidays screen rather than in code.

## 2 Nov · The senders, and why a draft is sent twice over

Email goes out as a **draft that is then sent**, not through Graph's one-step `sendMail`.
`sendMail` returns nothing at all, so there would be no way to learn what the message was
called — and without that a reply can never be matched to its thread. Creating the draft
hands back the whole message including `internetMessageId`, which is exactly what the
client's reply quotes. That is what closed the invented-id hole above.

It sends **from the ops person's own mailbox**, with the common box copied, which is the
mailbox decision of the same day: the client sees Rushda and replies to Rushda, and the
thread is not hers alone.

Three switches sit under each other on purpose, because any one of them can be wrong:
`OPS_SEND` (off everywhere until somebody says otherwise), the outreach switch in Settings
(test mode sends to the test address instead), and `OPS_OUTBOUND_LOCK` (even with sending
on, only named addresses and numbers can be written to). The last one is what makes the
preview safe to click around in once the database holds real client contacts.

**Switched off is recorded as blocked, not failed.** A preview with no credentials would
otherwise report every message as failed, which hides the real failures when they come.

**A send is never retried.** A send that timed out may well have gone, and the record says
exactly that — "we do not know whether it went" — rather than guessing. Retrying is how a
client gets the same email twice (TA, 2 Oct).

**WhatsApp groups are not sent by anybody.** Meta's API cannot write to a group, so the
text is drafted and a person posts it from their phone and ticks it off. The sender says so
in those words rather than appearing to do nothing.

## 2 Nov 2026 - two faults the Phase 1 run-through found

The run-through (15, Phase 1 step 26) is the first test that drives the whole
foundation in one go, and it found two things that every other test missed
because each piece was right on its own.

**A client who replied was chased anyway.** The list of "things we have written
about", which a reply is matched against, lower-cased the kind of thing:
`clientSet` became `clientset`. The match then came back naming `clientset`,
and cancelling the chase looked for a clock on `clientset` - there was none, so
the clock kept running and the client would have been chased after answering.
The list now keeps the real case; the matcher already compared without case.

**The mail screen counted emails it had already seen.** A pass reported every
email handed to it as "read", including the ones it recognised and skipped.
Since each pass deliberately overlaps the last, a screen could say "25 read"
when nothing had arrived. A pass now reports what was new, and says separately
how many it had already.

Both are the same kind of fault: a piece that is correct alone and wrong when
joined to the next one. Worth remembering when Phases 2 to 7 add handlers to
this foundation.

## The agreement, read at last (3 November)

Three things in the plan were my own guesses, and the real document corrected
them.

**The fee fields.** The field list asked for a tax number as a required field
and never asked for the company registration number or the client's line of
business. The agreement is the other way round: the registration number and
the business are named in its first clauses, and a tax number appears nowhere
in it.

**The refund.** The plan said 25%, from the owner's canvas. The agreement, as
reviewed on 10 September, says 50%. The owner settled it on 3 November: the
document is the truth.

**The late payment charge.** The plan said 5% per unpaid month, simple. The
agreement says 1% a month, compounded, with nothing charged on an invoice
disputed in good faith. Same decision: the document.

The lesson is the ordinary one and it cost nothing this time, because the
numbers all live in the settings: a rule read off a card is a guess until the
document that a client signs has been read.

## 3 November 2026 - the group post looked like a failure

Walking the last of phase 4 in the browser found three faults that the tests
and the types had both passed.

**A group post read as "group_post to ".** The day's list and the message page
printed the channel name and the address, and a group post has neither a
subject nor an address. It now says what it is: "To post by hand in the
client's WhatsApp group, which is not made yet."

**Approving a group post failed it.** The gate refuses a message with nobody
to send it to, which is right for an email and wrong for a post a person makes
from their phone. A group post now passes the gate with no address, and
settles at *approved* rather than *sent*: nothing sent it, and saying "sent"
about a post nobody has made yet is the kind of small lie a system should not
tell.

**The depth count read itself after writing itself.** The store hands back the
same row a patch writes to, so "was it held before?" was asked of a record
that already said the new answer, and the hold never lifted in TA. The same
trap as the set that said "short of 5" about a set of exactly five: read the
old value into a variable before the patch. Both are pinned by tests now.
