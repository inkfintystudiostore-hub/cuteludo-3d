import { useState } from 'react';
import { IS_POKI_BUILD } from '../engine/portalConfig';

const INK_BOX = 'border-[3px] border-ink shadow-ink';
const INK_BTN =
  'cursor-pointer border-[3px] border-ink shadow-ink-sm transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ink';

export type LegalTab = 'rules' | 'privacy' | 'terms';

interface LegalInfoModalProps {
  initialTab?: LegalTab;
  onClose: () => void;
}

export function LegalInfoModal({ initialTab = 'privacy', onClose }: LegalInfoModalProps) {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-3 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        className={`flex max-h-[92dvh] w-full max-w-xl flex-col gap-3 overflow-hidden rounded-3xl bg-[#fff8f5] p-4 motion-safe:animate-[pop-in_0.3s_ease-out] sm:p-5 ${INK_BOX}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-ink/15 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">📜</span>
            <h2 id="legal-modal-title" className="text-lg font-extrabold tracking-wide uppercase text-ink">
              Game Information &amp; Policies
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-full bg-white px-3 py-1 text-xs font-bold uppercase ${INK_BTN}`}
          >
            Close ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div role="tablist" className="grid grid-cols-3 gap-1.5 rounded-2xl border-2 border-ink bg-white p-1 shadow-ink-sm">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'rules'}
            onClick={() => setActiveTab('rules')}
            className={`rounded-xl py-1.5 text-xs font-extrabold transition-colors ${
              activeTab === 'rules' ? 'bg-ink text-white' : 'text-ink hover:bg-[#ffe0ea]'
            }`}
          >
            🎲 How to Play
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'privacy'}
            onClick={() => setActiveTab('privacy')}
            className={`rounded-xl py-1.5 text-xs font-extrabold transition-colors ${
              activeTab === 'privacy' ? 'bg-ink text-white' : 'text-ink hover:bg-[#ffe0ea]'
            }`}
          >
            🛡️ Privacy Policy
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'terms'}
            onClick={() => setActiveTab('terms')}
            className={`rounded-xl py-1.5 text-xs font-extrabold transition-colors ${
              activeTab === 'terms' ? 'bg-ink text-white' : 'text-ink hover:bg-[#ffe0ea]'
            }`}
          >
            ⚖️ Terms of Play
          </button>
        </div>

        {/* Scrollable Body Content */}
        <div className="max-h-[60dvh] overflow-y-auto rounded-2xl border-2 border-ink/20 bg-white/95 p-3.5 text-xs leading-relaxed text-ink/85 sm:p-4">
          {activeTab === 'rules' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-extrabold text-ink">Objective of Chibi Ludo</h3>
                <p>
                  Chibi Ludo 3D is a classic cross-and-circle strategy board game where 2 to 4 players race their 4 cute animal tokens from their starting Yard to their Home triangle in the center.
                </p>
              </div>

              <div className="rounded-xl border border-ink/20 bg-[#fff9db] p-2.5">
                <h4 className="font-bold text-ink">Core Game Rules:</h4>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li><strong>Spawning Tokens:</strong> You must roll a <strong>6</strong> on the 3D dice to move a token out of your starting yard onto the track.</li>
                  <li><strong>Bonus Rolls:</strong> Rolling a <strong>6</strong> awards an immediate extra roll! Rolling three consecutive sixes forfeits the turn for fairness.</li>
                  <li><strong>Capturing Opponents:</strong> Landing exactly on a square occupied by an opponent&apos;s token captures it, returning it to their yard and granting you a bonus roll!</li>
                  <li><strong>Safe Stars:</strong> Squares marked with a Star (★) are safe zones. Tokens resting on star squares cannot be captured.</li>
                  <li><strong>Home Column &amp; Win:</strong> After completing a full circuit of the board, tokens enter their colored home column. An exact roll is required to enter the center Home triangle. The first player (or team) to bring all tokens home wins!</li>
                </ul>
              </div>

              <div>
                <h3 className="text-sm font-extrabold text-ink">Game Modes</h3>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li><strong>2P Couples:</strong> Pink Bunny vs Yellow Duck head-to-head match.</li>
                  <li><strong>3P Friends:</strong> 3-player Free-For-All with Bunny, Duck, and Frog.</li>
                  <li><strong>4P FFA:</strong> Classic 4-player board with all animal squads.</li>
                  <li><strong>2v2 Team Battle:</strong> Diagonal partners collaborate — the first team to escort all 8 tokens home takes the crown!</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-extrabold text-ink">Privacy Policy for Chibi Ludo 3D</h3>
                <p className="text-[11px] text-ink/65">Last updated: November 2026</p>
                <p className="mt-1">
                  Chibi Ludo 3D is operated by <strong>Inkfinity Studio</strong>
                  {!IS_POKI_BUILD && (
                    <>
                      {' '}(<a href="https://inkfinitystudio.store" target="_blank" rel="noopener noreferrer" className="font-bold underline text-ink">inkfinitystudio.store</a>)
                    </>
                  )}
                  . We respect your privacy and are committed to transparency regarding how data is used when playing our game.
                </p>
              </div>

              {!IS_POKI_BUILD && (
              <div className="rounded-xl border-2 border-ink/25 bg-[#ffe0ea] p-2.5">
                <h4 className="font-extrabold text-ink">Google AdSense &amp; Advertising Cookies</h4>
                <p className="mt-1">
                  We use Google AdSense to serve advertisements when you visit and play our game. Please review Google&apos;s advertising disclosures:
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>Third-party vendors, including Google, use cookies to serve ads based on a user&apos;s prior visits to this website or other websites.</li>
                  <li>Google&apos;s use of advertising cookies enables it and its partners to serve ads to our users based on their visit to our sites and/or other sites on the Internet.</li>
                  <li>
                    Users may opt out of personalized advertising by visiting{' '}
                    <a
                      href="https://www.google.com/settings/ads"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold underline"
                    >
                      Google Ads Settings
                    </a>{' '}
                    or by visiting{' '}
                    <a
                      href="https://www.aboutads.info/choices/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold underline"
                    >
                      aboutads.info
                    </a>.
                  </li>
                  <li>
                    For details on how Google uses information from sites or apps that use its services, visit{' '}
                    <a
                      href="https://policies.google.com/technologies/partner-sites"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold underline"
                    >
                      Google Partner Sites Policy
                    </a>.
                  </li>
                </ul>
              </div>
              )}

              <div>
                <h4 className="font-bold text-ink">Local Device Storage</h4>
                <p>
                  We store game state locally on your device using browser LocalStorage. This includes sound/music volume settings, display nicknames, local match preferences, voice privacy preferences, and daily spin streak timers. No sensitive personal data is stored in LocalStorage.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink">Authentication &amp; Multiplayer</h4>
                <p>
                  You can play Chibi Ludo as a guest without signing in. If you choose to sign in with Google via Firebase Authentication, we store only your public account ID, chosen username, and game wallet coin balance on our Cloudflare Durable Objects server to synchronize your progress across devices. We never access your contacts or private Google data.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink">In-Game Purchases</h4>
                <p>
                  Coin purchases are processed via certified payment gateways (such as Razorpay). We do not collect, process, or store credit card numbers or UPI PINs on our servers.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink">Contact Us</h4>
                <p>
                  If you have questions about this Privacy Policy or data requests, contact us at:{' '}
                  {IS_POKI_BUILD ? (
                    <span className="font-bold">support@inkfinitystudio.store</span>
                  ) : (
                    <>
                      <a href="mailto:support@inkfinitystudio.store" className="font-bold underline">
                        support@inkfinitystudio.store
                      </a>{' '}
                      or visit{' '}
                      <a href="https://inkfinitystudio.store" target="_blank" rel="noopener noreferrer" className="font-bold underline">
                        inkfinitystudio.store
                      </a>
                    </>
                  )}
                  .
                </p>
              </div>
            </div>
          )}

          {activeTab === 'terms' && (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-extrabold text-ink">Terms of Play &amp; Fair Game Rules</h3>
                <p className="mt-1">
                  By accessing or playing Chibi Ludo 3D, you agree to these Terms of Play:
                </p>
              </div>

              <div className="rounded-xl border border-ink/20 bg-[#e7f5ff] p-2.5">
                <h4 className="font-bold text-ink">1. Virtual Currency &amp; Entertainment Use</h4>
                <p className="mt-1">
                  In-game coins (🪙) are virtual entertainment items used solely for table stakes, cosmetic reactions, and wheel spins in Chibi Ludo 3D. Coins have no real-world monetary value, cannot be redeemed for legal tender, and do not constitute real-money gambling.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink">2. Community Conduct &amp; Voice Chat</h4>
                <p>
                  Multiplayer rooms and peer-to-peer voice chat are provided for friendly fun. Harassment, abuse, hate speech, or disruptive behavior is strictly prohibited. Players can mute, block peers, or switch Voice Privacy to &quot;Allow-Only&quot; at any time.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink">3. Fair Play &amp; Anti-Cheating</h4>
                <p>
                  Dice rolls and move validation are verified authoritatively. Exploitation of software bugs, automated bots for multiplayer rank manipulation, or tampering with network packets is grounds for account suspension.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-ink">4. Intellectual Property &amp; Disclaimer</h4>
                <p>
                  Chibi Ludo 3D game assets, character models, audio, and code are owned by Inkfinity Studio. The game is provided on an &quot;as-is&quot; basis for recreational entertainment.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-ink/15 pt-2 text-[11px] font-semibold text-ink/70">
          <span>&copy; {new Date().getFullYear()} Inkfinity Studio. All rights reserved.</span>
          {!IS_POKI_BUILD && (
            <div className="flex items-center gap-3">
              <a
                href={
                  activeTab === 'rules'
                    ? '/how-to-play.html'
                    : activeTab === 'privacy'
                      ? '/privacy.html'
                      : '/terms.html'
                }
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-ink underline"
              >
                Open full page ↗
              </a>
              <a
                href="https://inkfinitystudio.store"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-ink underline"
              >
                inkfinitystudio.store ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
