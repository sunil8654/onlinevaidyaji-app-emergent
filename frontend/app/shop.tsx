// AYUSH Pharmacy — Coming Soon.
//
// This screen used to list `GET /api/medicines`, but every row in that
// catalogue is hardcoded demo seed data written by `seed()` in backend/server.py
// (brands, prices, "MRP" discounts) - none of it is real stock. Showing it meant
// a patient could add a fake product to a cart and try to pay for something the
// pharmacy does not actually sell.
//
// So the catalogue is gone rather than dressed up. There is deliberately no
// "0 results" empty state and no sample product: an honest notice is better
// than a plausible-looking fake. This follows the rule already encoded in
// src/components/ComingSoon.tsx - show the real thing when the backend can serve
// it, say plainly "coming soon" when it cannot, and never fake the missing half.
//
// The catalogue comes back when a real inventory source, live pricing and a
// fulfilment partner exist.
import { useRouter } from "expo-router";
import { ComingSoonScreen } from "@/src/components/ComingSoon";

export default function Shop() {
  const router = useRouter();
  return (
    <ComingSoonScreen
      title="Pharmacy"
      body="Our AYUSH pharmacy is being stocked with real products and real prices. Ordering, delivery and prescription refills open here once our dispensary goes live."
      icon="shopping-cart"
      features={[
        "Genuine AYUSH medicines, oils and herbal powders",
        "Live MRP and honest discount pricing - no invented offers",
        "Prescription upload so a VaidyaJi can authorise a refill",
        "Delivery across your city, with a real slot you can choose",
        "Order history and re-order from one place",
      ]}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      backLabel="Back"
      testID="shop-coming-soon"
    />
  );
}