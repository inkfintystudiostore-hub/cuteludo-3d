export interface CoinPack {
  id: 'starter' | 'popular' | 'mega';
  coins: number;
  inrPaise: number;
  inrLabel: string;
  badge?: string;
  accent: string;
}

export const COIN_PACKS: readonly CoinPack[] = [
  {
    id: 'starter',
    coins: 2500,
    inrPaise: 7900,
    inrLabel: '₹79',
    accent: '#a9f0ff',
  },
  {
    id: 'popular',
    coins: 15000,
    inrPaise: 39900,
    inrLabel: '₹399',
    badge: 'BEST VALUE',
    accent: '#ffd875',
  },
  {
    id: 'mega',
    coins: 40000,
    inrPaise: 79900,
    inrLabel: '₹799',
    badge: 'MEGA PACK',
    accent: '#80ed99',
  },
] as const;

export function getCoinPack(packId: string | null | undefined): CoinPack | undefined {
  return COIN_PACKS.find((p) => p.id === packId);
}
