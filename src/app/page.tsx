"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMetadata } from "@/lib/types";

function getSessionId(): string {
  if (typeof window === "undefined") return "anon";
  let id = localStorage.getItem("ask-adtu-session");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ask-adtu-session", id);
  }
  return id;
}

const QUICK_PROMPTS = [
  "How do I apply for B.Tech CSE?",
  "What scholarships are available?",
  "B.Tech fee structure",
  "Hostel facilities and cost",
  "Is AdtU NAAC accredited?",
];

function SourcesRow({ sources }: { sources: NonNullable<ChatMetadata["sources"]> }) {
  return (
    <div className="mt-4 mb-2 flex flex-wrap gap-2 animate-fade-in">
      {sources.map((s, i) => (
        <a
          key={s.n}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${s.title}\n${s.url}`}
          className="group flex max-w-[220px] items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-2 transition-colors hover:bg-zinc-800 hover:border-zinc-700"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-[11px] font-semibold text-zinc-400 group-hover:text-zinc-200 group-hover:bg-zinc-700 transition-colors">
            {s.n}
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-xs font-medium text-zinc-300 group-hover:text-zinc-100">
              {s.title || new URL(s.url).hostname}
            </span>
            <span className="truncate text-[10px] text-zinc-500">
              {new URL(s.url).hostname}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [sessionId] = useState(() => getSessionId());
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ sessionId }),
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  function submit(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    sendMessage({ text: t });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  return (
    <div className="flex h-screen flex-col bg-[#09090b] font-sans text-zinc-100 selection:bg-zinc-800">
      {/* Minimal Header */}
      <header className="sticky top-0 z-20 flex w-full items-center justify-between bg-[#09090b]/90 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-100 text-[13px] font-bold text-zinc-950">
            A
          </div>
          <span className="text-sm font-medium text-zinc-200">Ask AdtU</span>
        </div>
        <button 
          onClick={() => window.location.reload()} 
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          New chat
        </button>
      </header>

      {/* Main Chat Area */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto scroll-smooth pb-32">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          {messages.length === 0 && (
            <div className="mt-20 flex flex-col items-center justify-center text-center animate-slide-up sm:mt-32">
              <h2 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">
                What do you want to know?
              </h2>
              <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2.5">
                {QUICK_PROMPTS.map((p, i) => (
                  <button
                    key={p}
                    onClick={() => submit(p)}
                    className="rounded-full border border-zinc-800 bg-zinc-900/40 px-4 py-2 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex flex-col gap-6">
            {messages.map((m: UIMessage) => {
              const meta = m.metadata as ChatMetadata | undefined;
              const hasToolOutput = m.parts.some(
                (p) => isToolUIPart(p) && p.state === "output-available",
              );
              const isUser = m.role === "user";

              return (
                <div key={m.id} className="group w-full animate-slide-up">
                  {isUser ? (
                    <div className="flex w-full justify-end">
                      <div className="max-w-[85%] rounded-[24px] bg-[#27272a] px-5 py-3 text-[15px] leading-relaxed text-zinc-100 sm:max-w-[70%]">
                        {textOfParts(m)}
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full gap-4 pt-2">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-[#18181b]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col pb-4">
                        {hasToolOutput && (
                          <div className="mb-4 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin text-zinc-500"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                            <span className="text-xs font-medium text-zinc-400">Searching university database...</span>
                          </div>
                        )}

                        <div className="prose-custom text-[15px] text-zinc-200 break-words">
                          {m.parts
                            .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
                            .map((p, i) => (
                              <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                                {p.text}
                              </ReactMarkdown>
                            ))}
                        </div>

                        {meta?.sources && meta.sources.length > 0 && (
                          <SourcesRow sources={meta.sources} />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {status === "submitted" && (
              <div className="flex w-full gap-4 pt-2 animate-slide-up">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-[#18181b]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <div className="flex items-center gap-1.5 py-2">
                    <span className="dot h-1.5 w-1.5 rounded-full bg-zinc-500" />
                    <span className="dot h-1.5 w-1.5 rounded-full bg-zinc-500" />
                    <span className="dot h-1.5 w-1.5 rounded-full bg-zinc-500" />
                  </div>
                </div>
              </div>
            )}
            
            {error && (
              <div className="mx-auto flex w-full items-center gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-red-200">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-red-400"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <p className="text-sm">{error.message}</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Sticky Input Area */}
      <div className="fixed bottom-0 left-0 w-full bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent pt-10 pb-6">
        <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="relative flex items-end overflow-hidden rounded-[24px] bg-[#27272a] shadow-lg focus-within:ring-1 focus-within:ring-zinc-500 border border-transparent transition-all"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Ask anything..."
              className="max-h-40 min-h-[56px] w-full resize-none bg-transparent py-[17px] pl-5 pr-14 text-[15px] text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
            />
            
            <div className="absolute right-2.5 bottom-2.5">
              {busy ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-zinc-700 text-zinc-100 transition-colors hover:bg-zinc-600"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/></svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition-colors hover:bg-zinc-300 disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
              )}
            </div>
          </form>
          <div className="mt-3 flex justify-center">
            <span className="text-[11px] font-medium text-zinc-500">
              AI answers are grounded in <a href="https://adtu.in" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 hover:underline transition-colors">adtu.in</a>. Verify details.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function textOfParts(m: UIMessage): string {
  return m.parts
    .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}
