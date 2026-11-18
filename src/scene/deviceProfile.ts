import { useEffect, useState } from 'react';

function detectMobileGpu(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;
}

/** Reactive mobile/low-power GPU check used to scale DPR, shadow maps, and postprocessing. */
export function useIsMobileGpu(): boolean {
  const [mobile, setMobile] = useState(detectMobileGpu);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const sync = () => setMobile(detectMobileGpu());
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return mobile;
}
