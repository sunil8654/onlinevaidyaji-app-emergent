// Icon font loader for Expo apps.
//
// Native dev/prod builds link the icon .ttf files via autolinking, so this
// hook returns instantly with an empty font map. Under **Expo Go** on
// Android, Metro's asset resolver has historically returned 0 bytes for
// vector-icons .ttf files — so we side-load the Feather font from the npm
// CDN there. Web has no need for the .ttf (react-native-vector-icons ships
// web stubs).
//
// After the Expo SDK 57 upgrade (Iter 43) we migrated from `@expo/vector-icons`
// to `@react-native-vector-icons/feather`, so the CDN URL points at that
// package's font asset.
//
// If we add more icon families later, extend `ICON_FAMILIES` below.
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

// Match `@react-native-vector-icons/feather` version in package.json.
const FEATHER_VERSION = "13.1.4";

// short internal fontName (what the library queries) -> [pkg, ttf file name]
const ICON_FAMILIES: Record<string, [string, string, string]> = {
  // key: family name used at runtime; value: [npm pkg, version, ttf file]
  feather: ["@react-native-vector-icons/feather", FEATHER_VERSION, "Feather"],
};

const cdnUrl = (pkg: string, version: string, file: string): string =>
  `https://cdn.jsdelivr.net/npm/${pkg}@${version}/fonts/${file}.ttf`;

const iconFontMap = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(ICON_FAMILIES).map(([key, [pkg, version, file]]) => [
      key, cdnUrl(pkg, version, file),
    ]),
  );

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts(
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient
      ? iconFontMap()
      : {},
  );
