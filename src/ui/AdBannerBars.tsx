import { useEffect } from 'react';

interface PromoItem {
  badge: string;
  text: string;
  cta: string;
  href: string;
  bg: string;
}

const TOP_PROMO: PromoItem = {
  badge: 'INKFINITY STUDIO',
  text: 'Turn photos into heirloom 8K 3D printed miniatures — free pan-India shipping',
  cta: 'Shop Now ↗',
  href: 'https://inkfinitystudio.store',
  bg: '#ffe0ea',
};

const BOTTOM_PROMO: PromoItem = {
  badge: 'CUSTOM GIFTS',
  text: 'Anniversary couple figurines & pet miniatures with 5 digital sculpt revisions',
  cta: 'Explore ↗',
  href: 'https://inkfinitystudio.store/shop',
  bg: '#ffd875',
};

interface AdBannerBarProps {
  position: 'top' | 'bottom';
  /** Optional AdSense display ad-slot ID (loaded once on mount, never auto-refreshed). */
  adSlotId?: string;
}

function AdBannerBar({ position, adSlotId }: AdBannerBarProps) {
  useEffect(() => {
    if (!adSlotId) return;
    try {
      const w = window as Window & { adsbygoogle?: unknown[] };
      w.adsbygoogle = w.adsbygoogle || [];
      w.adsbygoogle.push({});
    } catch {
      // Ignore AdSense push errors when ad script is blocked.
    }
  }, [adSlotId]);

  const promo = position === 'top' ? TOP_PROMO : BOTTOM_PROMO;

  return (
    <aside
      aria-label={position === 'top' ? 'Top Banner' : 'Bottom Banner'}
      className={`z-30 flex h-10 w-full shrink-0 items-center justify-center border-ink px-2 sm:h-11 ${
        position === 'top' ? 'border-b-[3px]' : 'border-t-[3px]'
      }`}
      style={{ backgroundColor: promo.bg }}
    >
      {adSlotId ? (
        <ins
          className="adsbygoogle block h-full w-full max-w-[728px]"
          data-ad-client="ca-pub-9649669731732434"
          data-ad-slot={adSlotId}
          data-ad-format="horizontal"
          data-full-width-responsive="true"
        />
      ) : (
        <a
          href={promo.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full max-w-3xl items-center justify-between gap-2 text-ink no-underline"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-full border-2 border-ink bg-white px-2 py-0.5 text-[9px] font-extrabold uppercase">
              {promo.badge}
            </span>
            <span className="truncate text-[11px] font-bold sm:text-xs">{promo.text}</span>
          </div>
          <span className="shrink-0 rounded-full border-2 border-ink bg-white px-2.5 py-0.5 text-[10px] font-extrabold uppercase shadow-ink-sm">
            {promo.cta}
          </span>
        </a>
      )}
    </aside>
  );
}

export function TopAdBanner() {
  return <AdBannerBar position="top" />;
}

export function BottomAdBanner() {
  return <AdBannerBar position="bottom" />;
}
