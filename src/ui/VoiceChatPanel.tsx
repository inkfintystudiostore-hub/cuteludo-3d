import { useEffect, useState } from 'react';
import { TEAM_COLORS, TEAM_LABELS } from '../engine/boardMap';
import { useGameStore } from '../engine/gameStore';
import { isPeerAllowed, useVoiceStore } from '../engine/voiceStore';
import { MicIcon, ShieldIcon } from './Icons';

export function VoiceChatPanel() {
  const room = useGameStore((s) => s.room);
  const enabled = useVoiceStore((s) => s.enabled);
  const connecting = useVoiceStore((s) => s.connecting);
  const error = useVoiceStore((s) => s.error);
  const micMode = useVoiceStore((s) => s.micMode);
  const micMuted = useVoiceStore((s) => s.micMuted);
  const pttActive = useVoiceStore((s) => s.pttActive);
  const privacyMode = useVoiceStore((s) => s.privacyMode);
  const blockedIds = useVoiceStore((s) => s.blockedIds);
  const allowedIds = useVoiceStore((s) => s.allowedIds);
  const blockedByPeerIds = useVoiceStore((s) => s.blockedByPeerIds);
  const localMutedIds = useVoiceStore((s) => s.localMutedIds);
  const peerVolumes = useVoiceStore((s) => s.peerVolumes);
  const peerStates = useVoiceStore((s) => s.peerStates);
  const speakingIds = useVoiceStore((s) => s.speakingIds);
  const myPlayerId = useVoiceStore((s) => s.myPlayerId);

  const enableVoice = useVoiceStore((s) => s.enableVoice);
  const disableVoice = useVoiceStore((s) => s.disableVoice);
  const toggleMicMuted = useVoiceStore((s) => s.toggleMicMuted);
  const setMicMode = useVoiceStore((s) => s.setMicMode);
  const setPttActive = useVoiceStore((s) => s.setPttActive);
  const setPrivacyMode = useVoiceStore((s) => s.setPrivacyMode);
  const setPeerBlocked = useVoiceStore((s) => s.setPeerBlocked);
  const setPeerAllowed = useVoiceStore((s) => s.setPeerAllowed);
  const setPeerLocalMuted = useVoiceStore((s) => s.setPeerLocalMuted);
  const setPeerVolume = useVoiceStore((s) => s.setPeerVolume);

  const [expanded, setExpanded] = useState(false);

  // Push-to-Talk keyboard shortcut: hold V when not typing in an input.
  useEffect(() => {
    if (!enabled || micMode !== 'ptt') return;
    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.code !== 'KeyV' || isTypingTarget(e.target)) return;
      setPttActive(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'KeyV') return;
      setPttActive(false);
    };
    const onBlur = () => setPttActive(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      setPttActive(false);
    };
  }, [enabled, micMode, setPttActive]);

  if (!room?.online) return null;

  const otherHumans = room.seats.filter(
    (s) => s.occupant === 'human' && s.playerId && s.playerId !== myPlayerId,
  );
  const blockedCount = otherHumans.filter(
    (s) => s.playerId && blockedIds.includes(s.playerId),
  ).length;
  const effectiveMuted = !enabled || (micMode === 'ptt' ? !pttActive : micMuted);

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border-2 border-ink/25 bg-[#fff8f5] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => (enabled ? disableVoice() : void enableVoice())}
          disabled={connecting}
          className={`flex cursor-pointer items-center gap-1.5 rounded-xl border-2 border-ink px-2.5 py-1 text-[11px] font-black text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none disabled:opacity-60 ${
            enabled ? 'bg-[#80ed99]' : 'bg-white'
          }`}
        >
          <MicIcon muted={!enabled} className="size-3.5" />
          <span>{connecting ? 'Joining…' : enabled ? 'Voice On' : 'Join Voice'}</span>
        </button>

        {enabled && micMode === 'open' && (
          <button
            type="button"
            onClick={toggleMicMuted}
            aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={`flex cursor-pointer items-center gap-1 rounded-xl border-2 border-ink px-2.5 py-1 text-[11px] font-extrabold text-ink shadow-ink-sm transition-transform active:translate-y-0.5 active:shadow-none ${
              micMuted ? 'bg-[#ffcad4]' : 'bg-[#ffd166]'
            }`}
          >
            <MicIcon muted={micMuted} className="size-3.5" />
            <span>{micMuted ? 'Muted' : 'Mic Live'}</span>
          </button>
        )}

        {enabled && micMode === 'ptt' && (
          <button
            type="button"
            onPointerDown={() => setPttActive(true)}
            onPointerUp={() => setPttActive(false)}
            onPointerLeave={() => setPttActive(false)}
            onPointerCancel={() => setPttActive(false)}
            className={`flex cursor-pointer select-none items-center gap-1 rounded-xl border-2 border-ink px-2.5 py-1 text-[11px] font-extrabold text-ink shadow-ink-sm transition-colors ${
              pttActive ? 'bg-[#80ed99]' : 'bg-[#ffd166]'
            }`}
          >
            <MicIcon muted={!pttActive} className="size-3.5" />
            <span>{pttActive ? 'Talking…' : 'Hold to Talk (V)'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded-xl border-2 border-ink bg-white px-2 py-1 text-[11px] font-extrabold text-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none"
        >
          <ShieldIcon className="size-3.5" />
          <span>
            {privacyMode === 'allow_only' ? 'Allow-Only' : 'Privacy'}
            {blockedCount > 0 ? ` (${blockedCount})` : ''}
          </span>
        </button>
      </div>

      {!effectiveMuted && myPlayerId && speakingIds[myPlayerId] && (
        <p className="text-[10px] font-bold text-[#2b9348]">Transmitting your voice…</p>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-[#d62828]/40 bg-[#ffe5e5] px-2 py-1 text-[11px] font-bold text-[#b51717]">
          {error}
        </p>
      )}

      {expanded && (
        <div className="mt-0.5 flex flex-col gap-2 border-t-2 border-ink/15 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[11px] font-extrabold text-ink">Privacy Mode</span>
            <div className="flex rounded-lg border-2 border-ink bg-white p-0.5 text-[10px] font-black">
              <button
                type="button"
                onClick={() => setPrivacyMode('open')}
                className={`cursor-pointer rounded-md px-2 py-0.5 ${
                  privacyMode === 'open' ? 'bg-[#80ed99] text-ink' : 'text-ink/60'
                }`}
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setPrivacyMode('allow_only')}
                className={`cursor-pointer rounded-md px-2 py-0.5 ${
                  privacyMode === 'allow_only' ? 'bg-[#ffd166] text-ink' : 'text-ink/60'
                }`}
              >
                Allow-Only
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-[11px] font-extrabold text-ink">Mic Mode</span>
            <div className="flex rounded-lg border-2 border-ink bg-white p-0.5 text-[10px] font-black">
              <button
                type="button"
                onClick={() => setMicMode('open')}
                className={`cursor-pointer rounded-md px-2 py-0.5 ${
                  micMode === 'open' ? 'bg-[#80ed99] text-ink' : 'text-ink/60'
                }`}
              >
                Open Mic
              </button>
              <button
                type="button"
                onClick={() => setMicMode('ptt')}
                className={`cursor-pointer rounded-md px-2 py-0.5 ${
                  micMode === 'ptt' ? 'bg-[#ffd166] text-ink' : 'text-ink/60'
                }`}
              >
                Push-to-Talk
              </button>
            </div>
          </div>

          <p className="text-[10px] font-semibold leading-tight text-ink/65">
            {privacyMode === 'allow_only'
              ? 'Allow-Only: nobody hears you and you hear nobody until you click Allow.'
              : 'Open: everyone hears and is heard unless you Block them (2-way).'}
          </p>

          <div className="flex flex-col gap-1.5">
            {otherHumans.length === 0 ? (
              <p className="text-[11px] font-semibold text-ink/55">
                Waiting for other human players to join this room.
              </p>
            ) : (
              otherHumans.map((seat) => {
                const pid = seat.playerId as string;
                const name = seat.playerName || TEAM_LABELS[seat.team];
                const isBlocked = blockedIds.includes(pid);
                const isAllowed = allowedIds.includes(pid);
                const blockedByThem = blockedByPeerIds.includes(pid);
                const canTalk = isPeerAllowed(pid, privacyMode, blockedIds, allowedIds, blockedByPeerIds);
                const locallyMuted = localMutedIds.includes(pid);
                const peerMeta = peerStates[pid];
                const speaking = Boolean(speakingIds[pid]);
                const vol = peerVolumes[pid] ?? 1;

                return (
                  <div
                    key={pid}
                    className="flex flex-col gap-1 rounded-xl border-2 border-ink/20 bg-white p-1.5"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={`size-2.5 shrink-0 rounded-full border border-ink ${
                            speaking ? 'animate-pulse ring-2 ring-[#80ed99]' : ''
                          }`}
                          style={{ backgroundColor: TEAM_COLORS[seat.team] }}
                        />
                        <span className="truncate text-[11px] font-extrabold text-ink">{name}</span>
                        {!seat.connected ? (
                          <span className="text-[9px] font-bold text-ink/45">offline</span>
                        ) : peerMeta?.enabled ? (
                          <span className="text-[9px] font-bold text-[#2b9348]">
                            {peerMeta.muted ? 'muted' : 'voice'}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {privacyMode === 'allow_only' && !isBlocked && (
                          <button
                            type="button"
                            onClick={() => setPeerAllowed(pid, !isAllowed)}
                            className={`cursor-pointer rounded-lg border border-ink px-1.5 py-0.5 text-[10px] font-black text-ink ${
                              isAllowed ? 'bg-[#80ed99]' : 'bg-[#ffd166]'
                            }`}
                          >
                            {isAllowed ? 'Allowed' : 'Allow'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPeerBlocked(pid, !isBlocked)}
                          className={`cursor-pointer rounded-lg border border-ink px-1.5 py-0.5 text-[10px] font-black ${
                            isBlocked ? 'bg-[#ff6b6b] text-white' : 'bg-[#fff0f0] text-ink'
                          }`}
                        >
                          {isBlocked ? 'Unblock' : 'Block'}
                        </button>
                      </div>
                    </div>

                    {blockedByThem && !isBlocked && (
                      <p className="text-[10px] font-bold text-ink/55">
                        This player has voice blocked with you.
                      </p>
                    )}

                    {canTalk && enabled && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <button
                          type="button"
                          onClick={() => setPeerLocalMuted(pid, !locallyMuted)}
                          className="cursor-pointer rounded border border-ink/40 bg-[#f8f9fa] px-1.5 py-0.5 text-[9px] font-bold text-ink"
                        >
                          {locallyMuted ? 'Unmute' : 'Mute'}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(vol * 100)}
                          onChange={(e) => setPeerVolume(pid, Number(e.target.value) / 100)}
                          aria-label={`Volume for ${name}`}
                          className="h-1.5 min-w-0 flex-1 accent-[#80ed99]"
                        />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
