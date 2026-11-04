import Link from "next/link";
import { notFound } from "next/navigation";
import { redirect } from "next/navigation";

import { desk, fileIn } from "@/data/desk";
import { currentMember } from "@/lib/session";
import { messageInWords } from "@/lib/messages";
import { approveAndSend, recordReply, saveDraft } from "@/app/actions";

/** One message, on its own page. Read it, change it, approve it. */
export default async function MessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string }>;
}) {
  const member = await currentMember();
  if (!member) redirect("/sign-in");
  const { id } = await params;
  const { msg } = await searchParams;
  const db = await desk();
  const message = db.messages.find((m) => m.id === id);
  if (!message) notFound();
  // What it carries, by name: an agreement goes out as its PDF, and a person
  // approving the email has to be able to see that it is there.
  const carries = (message.attachmentFileIds ?? []).map((fileId) => fileIn(db, fileId)).filter((f) => f !== null);

  const input = "w-full rounded-lg border border-rule bg-paper px-3 py-2 text-[13.5px]";

  return (
    <div className="max-w-[760px]">
      <Link href="/" className="text-[12.5px] text-brand hover:underline">
        Back to your day
      </Link>
      <h1 className="mt-2 text-[17px] font-medium">{message.templateKey ?? "Message"}</h1>
      <p className="mt-0.5 text-[13px] text-ink-soft">
        {messageInWords(message)} · {message.state}
      </p>

      {msg && (
        <p className="mt-3 rounded-lg border border-rule bg-surface px-3 py-2 text-[13px]">{msg}</p>
      )}

      {carries.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-soft">
          Attached:{" "}
          {carries.map((file, i) => (
            <span key={file.id}>
              {i > 0 && ", "}
              <Link href={"/api/files/" + file.id} className="text-brand hover:underline">
                {file.name}
              </Link>{" "}
              <span className="text-ink-faint">({Math.max(1, Math.round(file.size / 1024))} KB)</span>
            </span>
          ))}
        </p>
      )}

      {message.state === "draft" ? (
        <form action={saveDraft} className="mt-4 flex flex-col gap-3">
          <input type="hidden" name="messageId" value={message.id} />
          {message.channel !== "group_post" && (
            <label className="block">
              <span className="mb-1 block text-[12px] text-ink-soft">Subject</span>
              <input name="subject" defaultValue={message.subject} className={input} />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-soft">Message</span>
            <textarea name="body" defaultValue={message.body} rows={10} className={input} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-full border border-rule-strong px-3.5 py-1.5 text-[12.5px] hover:bg-paper">
              Save changes
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-4 rounded-2xl border border-rule bg-surface px-5 py-4">
          <p className="text-[13.5px] font-medium">{message.subject}</p>
          <p className="mt-2 whitespace-pre-wrap text-[13.5px] text-ink-soft">{message.body}</p>
          {message.note && <p className="mt-3 text-[12.5px] text-warning">{message.note}</p>}
        </div>
      )}

      {message.subjectType && message.subjectId && (
        <form action={recordReply} className="mt-4 rounded-2xl border border-rule bg-surface px-5 py-4">
          <input type="hidden" name="subjectType" value={message.subjectType} />
          <input type="hidden" name="subjectId" value={message.subjectId} />
          <input type="hidden" name="back" value={"/messages/" + message.id} />
          <p className="text-[13.5px] font-medium">Has the client answered?</p>
          <p className="mt-1 text-[13px] text-ink-soft">
            Saying so stops every chase for this one at once. The reader will do this by itself
            once the Ops mailbox is connected.
          </p>
          <button className="mt-3 rounded-full border border-rule-strong px-3.5 py-1.5 text-[12.5px] hover:bg-paper">
            They answered, stop chasing
          </button>
        </form>
      )}

      {message.state === "draft" && (
        <form action={approveAndSend} className="mt-4 border-t border-rule pt-4">
          <input type="hidden" name="messageId" value={message.id} />
          <p className="text-[13px] text-ink-soft">
            {message.channel === "group_post"
              ? "Nothing can send this: no system can post to a WhatsApp group. Approve it, copy it and post it from your phone - that it is yours to post is written here."
              : "Approving sends it. While the system is in test mode it goes to the test address instead, and the result is written here."}
          </p>
          <button className="mt-3 rounded-full bg-brand px-4 py-1.5 text-[12.5px] font-medium text-white">
            {message.channel === "group_post" ? "Approve it, and post it myself" : "Approve and send"}
          </button>
        </form>
      )}
    </div>
  );
}
