import { useEffect } from 'react';
import { useGameStore } from './engine/gameStore';
import { initPokiSdk, notifyPokiLoadingFinished, setPokiGameplayActive } from './engine/pokiSdk';
import { IS_POKI_BUILD } from './engine/portalConfig';
import { LudoCanvas } from './scene/LudoCanvas';
import { AnimeHUD } from './ui/AnimeHUD';
import { BottomAdBanner, TopAdBanner } from './ui/AdBannerBars';
import { RewardedAdOverlay } from './ui/RewardedAdOverlay';

export default function App() {
  const screen = useGameStore((s) => s.screen);
  const paused = useGameStore((s) => s.paused);
  const phase = useGameStore((s) => s.game.phase);

  useEffect(() => {
    let active = true;
    void initPokiSdk().then(() => {
      if (active) notifyPokiLoadingFinished();
    });
    return () => {
      active = false;
      setPokiGameplayActive(false);
    };
  }, []);

  useEffect(() => {
    setPokiGameplayActive(screen === 'playing' && !paused && phase !== 'GAME_OVER');
  }, [screen, paused, phase]);

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      {!IS_POKI_BUILD && <TopAdBanner />}
      <div className="relative min-h-0 flex-1">
        <AnimeHUD>
          <LudoCanvas />
          <RewardedAdOverlay />
        </AnimeHUD>
      </div>
      {!IS_POKI_BUILD && <BottomAdBanner />}
    </div>
  );
}
