import { useEffect, useRef, useState } from 'react';
import { TEAM_COLORS } from '../engine/boardMap';
import { useGameStore } from '../engine/gameStore';
import { SendIcon } from './Icons';

export function RoomChatBox({ compact = false }: { compact?: boolean }) {
  const messages = useGameStore((s) => s.chatMessages);
  const sendChat = useGameStore((s) => s.sendChat);
  const online = useGameStore((s) => Boolean(s.room?.online));
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    if (sendChat(draft)) setDraft('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={listRef}
        aria-live="polite"
        aria-label="Room live chat messages"
        className={`flex flex-col gap-1 overflow-y-auto overscroll-contain rounded-xl border-2 border-ink/25 bg-[#fff8f5] p-2 text-xs ${
          compact ? 'max-h-24 min-h-14' : 'max-h-[34vh] h-40 landscape:h-28'
        }`}
      >
        {messages.length === 0 ? (
          <p className="m-auto text-center text-[11px] font-medium text-ink/50">
            {online ? 'Say hi to your friends!' : 'Live chat connects when friends join online.'}
          </p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex items-start gap-1.5 leading-snug">
              <span
                className="mt-0.5 shrink-0 rounded-md border border-ink px-1.5 py-0.5 text-[10px] font-bold text-ink"
                style={{ backgroundColor: msg.team ? TEAM_COLORS[msg.team] : '#ffffff' }}
              >
                {msg.senderName}
              </span>
              <span className="min-w-0 break-words font-semibold text-ink">{msg.text}</span>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
        <input
          type="text"
          maxLength={160}
          disabled={!online}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={online ? 'Type a quick message…' : 'Offline preview'}
          aria-label="Chat message"
          className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-white px-2.5 py-1 text-[16px] leading-5 sm:text-xs font-bold text-ink placeholder:font-medium placeholder:text-ink/45 focus:outline-none disabled:opacity-55"
        />
        <button
          type="submit"
          disabled={!online || !draft.trim()}
          aria-label="Send message"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-xl border-2 border-ink bg-[#80ed99] text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon className="size-3.5" />
        </button>
      </form>
    </div>
  );
}
