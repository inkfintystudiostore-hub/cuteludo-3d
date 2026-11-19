import { LudoCanvas } from './scene/LudoCanvas';
import { AnimeHUD } from './ui/AnimeHUD';
import { BottomAdBanner, TopAdBanner } from './ui/AdBannerBars';
import { RewardedAdOverlay } from './ui/RewardedAdOverlay';

export default function App() {
  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden">
      <TopAdBanner />
      <div className="relative min-h-0 flex-1">
        <AnimeHUD>
          <LudoCanvas />
          <RewardedAdOverlay />
        </AnimeHUD>
      </div>
      <BottomAdBanner />
    </div>
  );
}
