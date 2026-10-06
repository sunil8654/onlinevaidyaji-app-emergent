// Turns files the OS file picker returns into base64 payloads the backend can
// store in `doctor_verifications`.
//
// Why this exists: the app has no multipart/form-data stack, so credentials
// travel base64-encoded. The previous onboarding screen faked this entirely -
// it sent a hardcoded `["degree_certificate.pdf", "reg_certificate.pdf"]` list
// and toggled a boolean, so no file was ever uploaded and the website's admin
// review queue stayed permanently empty.
//
// `expo-document-picker`'s `base64` option is documented as web-only, so on
// native we read the cached copy ourselves via the legacy filesystem API, which
// is the same import style the rest of the app uses (see prescriptionPdf.ts).
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { DoctorDocumentPayload } from "@/src/api";

/** Must match the website's multer allowlist: jpeg|jpg|png|pdf|doc|docx. */
const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Mirrors the backend's 10 MB `DOCTOR_DOC_MAX_BYTES`. */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const DOC_TYPES = [
  { value: "degree_certificate", label: "Degree certificate" },
  { value: "registration_certificate", label: "Council registration" },
  { value: "identity_proof", label: "Government ID" },
  { value: "experience_certificate", label: "Experience / employment proof" },
  { value: "other", label: "Other supporting document" },
] as const;

export const CREDENTIAL_TYPES = DOC_TYPES;

export function labelForDocType(value: string): string {
  return DOC_TYPES.find((t) => t.value === value)?.label ?? value;
}

async function readAsBase64(uri: string): Promise<string> {
  // Web: DocumentPicker already handed us base64 via a File/data URL.
  if (Platform.OS === "web") {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the file"));
      reader.onload = () => {
        const out = String(reader.result ?? "");
        // Strip any `data:...;base64,` prefix; the backend re-adds the type.
        resolve(out.includes(",") ? out.slice(out.indexOf(",") + 1) : out);
      };
      reader.readAsDataURL(blob);
    });
  }
  return await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

export type PickResult =
  | { ok: true; files: DoctorDocumentPayload[] }
  | { ok: false; reason: "cancelled" | "error"; message: string };

/**
 * Opens the OS document picker and returns ready-to-upload credential payloads.
 *
 * Never throws: returns a discriminated result so the screen can show a message
 * or silently ignore a cancel.
 */
export async function pickCredentialFiles(): Promise<PickResult> {
  let picked: DocumentPicker.DocumentPickerAsset[];
  try {
    const res = await DocumentPicker.getDocumentAsync({
      multiple: true,
      // Needed because the URI from a content:// provider is not readable via
      // the filesystem API on Android without a cache copy.
      copyToCacheDirectory: true,
      // This option is `type`, not `mimeTypes` - expo-document-picker renamed it
      // and only accepts wildcards for categories.
      type: ["image/*", "application/pdf", ...ALLOWED_MIME],
    });
    if (res.canceled) return { ok: false, reason: "cancelled", message: "" };
    picked = res.assets ?? [];
  } catch (e: any) {
    return { ok: false, reason: "error", message: e?.message || "Could not open the file picker" };
  }

  if (!picked.length) return { ok: false, reason: "error", message: "No file selected" };

  const files: DoctorDocumentPayload[] = [];
  for (const asset of picked) {
    if (typeof asset.size === "number" && asset.size > MAX_DOC_BYTES) {
      return {
        ok: false,
        reason: "error",
        message: `${asset.name ?? "That file"} is larger than 10 MB. Please upload a smaller file.`,
      };
    }

    const ext = (asset.name?.split(".").pop() ?? "").toLowerCase();
    const contentType =
      asset.mimeType && ALLOWED_MIME.includes(asset.mimeType)
        ? asset.mimeType
        : MIME_BY_EXT[ext];
    if (!contentType) {
      return {
        ok: false,
        reason: "error",
        message: `${asset.name ?? "That file"} is not a supported format. Use JPG, PNG, PDF, DOC or DOCX.`,
      };
    }

    try {
      const base64 = await readAsBase64(asset.uri);
      if (!base64) {
        return { ok: false, reason: "error", message: `Could not read ${asset.name ?? "the file"}` };
      }
      files.push({
        documentType: "other",
        fileName: asset.name ?? "document",
        contentType,
        base64,
      });
    } catch (e: any) {
      return {
        ok: false,
        reason: "error",
        message: e?.message || `Could not read ${asset.name ?? "the file"}`,
      };
    }
  }

  return { ok: true, files };
}