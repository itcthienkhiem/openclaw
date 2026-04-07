import { useBanners } from "./BannerContext";
import { BannerCarousel } from "./BannerCarousel";
import { SubscriptionBannerSource } from "./SubscriptionBannerSource";
import { LowBalanceBannerSource } from "./LowBalanceBannerSource";

export function AppBanners() {
  const banners = useBanners();

  return (
    <>
      {/* Banner sources (renderless — they only register/unregister banners) */}
      <SubscriptionBannerSource />
      <LowBalanceBannerSource />

      {/* Carousel UI */}
      <BannerCarousel items={banners} />
    </>
  );
}
