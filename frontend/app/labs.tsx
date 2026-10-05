// Lab tests — Coming Soon.
//
// This screen used to list `GET /api/lab-tests` and let a patient pick a slot.
// Both halves were fabricated: the five tests are hardcoded demo rows written by
// `seed()` in backend/server.py (CBC, HbA1c, Thyroid, Vitamin D & B12, a
// "wellness panel"), complete with Pexels stock photos, and the pickup slots
// were invented in the client by `generateSlots()` before being written to the
// database as `status: "confirmed"`.
//
// Nothing was ever dispatched for those bookings, so the patient saw "Booked!"
// and no lab was ever contacted. Worse than useless - it looked authoritative.
//
// The catalogue is gone rather than dressed up. There is deliberately no sample
// test and no "0 results" empty state. This follows the rule already encoded in
// src/components/ComingSoon.tsx: show the real thing when the backend can serve
// it, say plainly "coming soon" when it cannot, and never fake the missing half.
//
// Home sample collection needs a genuine lab partner, a real address book and a
// real availability source. The screen returns with all three.
import { useRouter } from "expo-router";
import { ComingSoonScreen } from "@/src/components/ComingSoon";

export default function Labs() {
  const router = useRouter();
  return (
    <ComingSoonScreen
      title="Lab tests"
      body="Home sample collection needs a real diagnostic partner behind it - real tests, real prices and a real phlebotomist who actually turns up. That is not live yet, so we are not listing tests we cannot honour."
      icon="activity"
      features={[
        "CBC, diabetes, thyroid, lipid and vitamin panels",
        "Home sample collection with a real, confirmed time slot",
        "Reports explained by a VaidyaJi, not just a PDF",
        "Digital report history you can revisit",
        "Live pricing - no invented discounts or fake MRPs",
      ]}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
      backLabel="Back"
      testID="labs-coming-soon"
    />
  );
}