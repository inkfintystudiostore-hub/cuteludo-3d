import { LudoCanvas } from './scene/LudoCanvas';
import { AnimeHUD } from './ui/AnimeHUD';

export default function App() {
  return (
    <AnimeHUD>
      <LudoCanvas />
    </AnimeHUD>
  );
}
