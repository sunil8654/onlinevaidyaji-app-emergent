// DoctorAvatar — doctor photo with gender-based placeholder fallback.
//
// Fallback chain:
//   1. avatar_url / image from the API (real photo)
//   2. on load error (e.g. Hostinger bot-protection 403) OR missing URL →
//      bundled gender placeholder (same illustrations the website serves as
//      /female.webp and /men.webp, bundled locally because the CDN blocks
//      non-browser clients)
import { useEffect, useState } from "react";
import { Image, ImageStyle, StyleProp } from "react-native";

const FEMALE_PLACEHOLDER = require("@/assets/images/doctor-placeholder-female.png");
const MALE_PLACEHOLDER = require("@/assets/images/doctor-placeholder-male.png");

export function DoctorAvatar({
  uri,
  gender,
  style,
}: {
  uri?: string | null;
  gender?: string | null;
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]); // retry when the doctor changes

  if (!uri || failed) {
    return <Image source={gender === "female" ? FEMALE_PLACEHOLDER : MALE_PLACEHOLDER} style={style} />;
  }
  return <Image source={{ uri }} style={style} onError={() => setFailed(true)} />;
}
