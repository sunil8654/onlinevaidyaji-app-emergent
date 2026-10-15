// Platform fee — mirrors the website (OnlineVaidhyaJi.com PLATFORM_FEE).
//
// The doctor enters their own consultation fee; the patient pays that fee plus
// this platform fee. The shared MySQL `doctors.consultation_fee` column stores
// the PATIENT TOTAL (doctor fee + PLATFORM_FEE), exactly like the website, so
// the database means the same thing no matter which surface wrote it.
//
// Therefore: add PLATFORM_FEE when saving a doctor-administered fee, and
// subtract it when showing that stored value back as the doctor's own fee.
export const PLATFORM_FEE = 100;

/** Doctor's own fee from the stored (patient-total) value. */
export function doctorBaseFee(stored: number | string | null | undefined): number {
  const n = Number(stored);
  if (stored === null || stored === undefined || stored === "" || Number.isNaN(n)) return 0;
  return Math.max(0, n - PLATFORM_FEE);
}
