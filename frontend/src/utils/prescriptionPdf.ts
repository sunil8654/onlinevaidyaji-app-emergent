// Cross-platform prescription PDF downloader.
// - Web: fetches with auth header, opens as an in-memory blob URL (new tab).
// - Native: downloads to a temp file with auth headers, then hands it to the
//   OS share sheet so users can save to Files, WhatsApp, mail, etc.
import { Platform, Alert } from "react-native";
// v19 moved the classic mutable API under /legacy. Its behaviour is stable and
// still officially supported; the new Paths/File API doesn't yet provide an
// equivalent one-shot downloadAsync with auth headers.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { storage } from "@/src/utils/storage";
import { TOKEN_KEY } from "@/src/api";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function _authHeaders(): Promise<Record<string, string>> {
  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function openPrescriptionPdf(apptId: string, opts?: { download?: boolean }) {
  if (!apptId) return;
  const url = `${BASE}/api/prescriptions/${apptId}/pdf${opts?.download ? "?download=1" : ""}`;
  const headers = await _authHeaders();

  if (Platform.OS === "web") {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (opts?.download) {
        // Force download via a hidden anchor
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `prescription-${apptId.slice(0, 8)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        window.open(objectUrl, "_blank", "noopener,noreferrer");
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e: any) {
      Alert.alert("Could not open PDF", e?.message || "Please try again.");
    }
    return;
  }

  // Native: download with auth headers, then share/save.
  try {
    const dest = `${FileSystem.cacheDirectory}prescription-${apptId.slice(0, 8)}.pdf`;
    const dl = await FileSystem.downloadAsync(url, dest, { headers });
    if (dl.status >= 400) {
      throw new Error(`HTTP ${dl.status}`);
    }
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(dl.uri, {
        mimeType: "application/pdf",
        dialogTitle: "Your prescription",
        UTI: "com.adobe.pdf",
      });
    } else {
      Alert.alert("PDF saved", `Saved to ${dl.uri}`);
    }
  } catch (e: any) {
    Alert.alert("Could not open PDF", e?.message || "Please try again.");
  }
}
