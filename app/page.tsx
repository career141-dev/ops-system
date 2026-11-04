import Link from "next/link";
import { redirect } from "next/navigation";

import { messageInWords, messageTitle } from "@/lib/messages";
import { desk, draftsWaiting, liveTimersFor, openTasksFor, runClocks } from "@/data/desk";
import { colomboDate, DAY } from "@/lib/calendar";
import { timeLeft } from "@/lib/timers";
import { currentMember } from "@/lib/session";
import { runClocksNow, startTestClock } from "./actions";

/**
 * Your day: the only screen an Ops person starts on (07, "inbox first").
 *
 * Four parts, in the order the work matters: what needs approving, what is due
 * today, what is late, and which clock is running out. Every row opens its own
 * page; nothing opens over the top of this one.
 */
/**
 * What a clock is, in words.
 *
 * The screens showed the kind as it is written in the code - "esa.send" - and
 * a person reading their own day should not have to translate (2 Nov).
 */
function clockInWords(kind: string): string {
  const words: Record<string, string> = {
    "esa.send": "the agreement has to go out",
    "esa.chase": "chasing the agreement",
    "esa.decline": "two weeks with no signed agreement",
    "esa.countersign": "the Director has to countersign",
    "meeting.reminder.day": "a client meeting tomorrow",
    "meeting.reminder.hour": "a client meeting in an hour",
    "meeting.rebook": "a meeting to book again",
    "feedback.chase": "waiting on client feedback",
    "feedback.call": "a client to ring about feedback",
    "lead.inviteBack": "a client to invite back",
    "talentpulse.compile": "Talent Pulse, on Tuesday",
    "silence.hold": "two weeks of client silence",
    "hold.review": "a hold to look at again",
    "hire.unreported": "a possible unreported hire",
    "set.due": "a set due at the client",
    "set.ownership": "the CV ownership window",
    "invoice.chase": "an unpaid invoice",
    "guarantee.warn": "the guarantee, fifteen days left",
    "guarantee.end": "the guarantee ends",
    "interview.reconfirm": "an interview to reconfirm",
    "test.clock": "a test clock",
  };
  return words[kind] ?? kind;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const { msg } = await searchParams;

  // The clocks run on every visit, so a deadline never waits for someone to
  // press something. A real schedule replaces this when the crons land.
  await runClocks();

  const now = Date.now();
  const db = await desk();
  const drafts = draftsWaiting(db);
  const tasks = openTasksFor(db, member.id);
  const due = tasks.filter((t) => t.dueAt >= now && t.dueAt < now + DAY);
  const late = tasks.filter((t) => t.dueAt < now);
  const clocks = liveTimersFor(db, member.id);

  const card = "rounded-2xl border border-rule bg-surface px-5 py-4";
  const row = "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule py-3 first:border-t-0";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[17px] font-medium">Your day</h1>
          <p className="mt-0.5 text-[13px] text-ink-soft">{colomboDate(now)} · Colombo</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={runClocksNow}>
            <button className="rounded-full border border-rule-strong px-3.5 py-1.5 text-[12.5px] hover:bg-paper">
              Run the clocks now
            </button>
          </form>
          <form action={startTestClock}>
            <button className="rounded-full border border-rule-strong px-3.5 py-1.5 text-[12.5px] hover:bg-paper">
              Start a two-hour test clock
            </button>
          </form>
        </div>
      </div>

      {msg && (
        <p className="rounded-lg border border-rule bg-surface px-3 py-2 text-[13px]">{msg}</p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["To approve", drafts.length, ""],
          ["Due today", due.length, ""],
          ["Late", late.length, late.length ? "text-danger" : ""],
          ["Clocks", clocks.length, clocks.length ? "text-warning" : ""],
        ].map(([label, count, tone]) => (
          <div key={String(label)} className="rounded-xl bg-surface px-4 py-3">
            <p className="text-[12.5px] text-ink-soft">{label}</p>
            <p className={"mt-1 text-[22px] font-medium " + String(tone)}>{count}</p>
          </div>
        ))}
      </div>

      <section className={card}>
        <h2 className="text-[14.5px] font-medium">Waiting for your approval</h2>
        {drafts.length === 0 && <p className="mt-2 text-[13px] text-ink-soft">Nothing is waiting.</p>}
        {drafts.map((message) => (
          <div key={message.id} className={row}>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px]">{messageTitle(message)}</p>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">{messageInWords(message)}</p>
            </div>
            <Link
              href={"/messages/" + message.id}
              className="rounded-full border border-rule-strong px-3 py-1 text-[12.5px] hover:bg-paper"
            >
              Read it
            </Link>
          </div>
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className={card}>
          <h2 className="text-[14.5px] font-medium">Due today</h2>
          {due.length === 0 && <p className="mt-2 text-[13px] text-ink-soft">Nothing due today.</p>}
          {due.map((task) => (
            <div key={task.id} className={row}>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px]">{task.title}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-soft">{timeLeft(task.dueAt, now).text}</p>
              </div>
              <Link href={"/tasks/" + task.id} className="text-[12.5px] text-brand hover:underline">
                Open
              </Link>
            </div>
          ))}
        </section>

        <section className={card}>
          <h2 className="text-[14.5px] font-medium">Late, and clocks</h2>
          {late.length === 0 && clocks.length === 0 && (
            <p className="mt-2 text-[13px] text-ink-soft">Nothing late, nothing running out.</p>
          )}
          {late.map((task) => (
            <div key={task.id} className={row}>
              <span className="rounded-full bg-bg-danger px-2 py-0.5 text-[11.5px] text-danger">
                {timeLeft(task.dueAt, now).text}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px]">{task.title}</p>
              </div>
              <Link href={"/tasks/" + task.id} className="text-[12.5px] text-brand hover:underline">
                Open
              </Link>
            </div>
          ))}
          {clocks.map((timer) => {
            const left = timeLeft(timer.dueAt, now);
            return (
              <div key={timer.id} className={row}>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[11.5px] " +
                    (left.tone === "late"
                      ? "bg-bg-danger text-danger"
                      : left.tone === "soon"
                        ? "bg-bg-warning text-warning"
                        : "bg-bg-ok text-ink-soft")
                  }
                >
                  {left.text}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px]">{timer.payload.label ?? timer.kind}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-soft">{clockInWords(timer.kind)}</p>
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}
