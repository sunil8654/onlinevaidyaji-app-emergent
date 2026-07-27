// Explore — search doctors/hashtags + browse by specialty grid.
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Image, ActivityIndicator, Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "@/src/theme";
import { api } from "@/src/api";

const { width } = Dimensions.get("window");
const CELL = Math.floor((width - 32 - 4) / 3);
const SPECIALTIES = ["All", "Ayurveda", "Homoeopathy", "Yoga", "Naturopathy", "Unani", "Siddha", "General"];

export default function Explore() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [searchResult, setSearchResult] = useState<any | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [specialty, setSpecialty] = useState<string>("All");
  const [grid, setGrid] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const items = await api.docComExplore(specialty === "All" ? undefined : specialty);
      setGrid(items);
    } catch {}
    finally { setLoading(false); }
  }, [specialty]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!q.trim() || q.trim().length < 2) {
        setSearchResult(null);
        return;
      }
      setSearchBusy(true);
      try {
        const r = await api.docComSearch(q.trim());
        setSearchResult(r);
      } catch { }
      finally { setSearchBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bg }} contentContainerStyle={{ paddingBottom: 80 }}>
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={COLORS.textMuted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search doctors, specialties or #hashtags"
          placeholderTextColor={COLORS.textMuted}
          style={styles.searchInput}
          autoCapitalize="none"
          testID="dcom-search"
        />
        {q.length > 0 && (
          <TouchableOpacity onPress={() => setQ("")} testID="dcom-search-clear">
            <Feather name="x-circle" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {q.trim().length >= 2 ? (
        // SEARCH VIEW
        <View>
          {searchBusy && <ActivityIndicator color={COLORS.brand} style={{ marginTop: SPACING.md }} />}
          {searchResult?.doctors?.length > 0 && (
            <>
              <Text style={styles.section}>Doctors</Text>
              {searchResult.doctors.map((d: any) => (
                <TouchableOpacity
                  key={d.id}
                  style={styles.doctorRow}
                  onPress={() => router.push({ pathname: "/doctor/community/profile/[id]", params: { id: d.id } })}
                  testID={`dcom-sd-${d.id}`}
                >
                  {d.avatar_url ? (
                    <Image source={{ uri: d.avatar_url }} style={styles.dAvatar} />
                  ) : (
                    <View style={[styles.dAvatar, styles.dAvatarFB]}>
                      <Text style={styles.dInitial}>{(d.name || "D").slice(0, 1).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={styles.dName}>{d.name}</Text>
                      {d.verified && <Feather name="check-circle" size={11} color={COLORS.brand} />}
                    </View>
                    <Text style={styles.dSpec}>{d.specialty || "AYUSH Doctor"}{d.clinic_name ? ` · ${d.clinic_name}` : ""}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
          {searchResult?.hashtags?.length > 0 && (
            <>
              <Text style={styles.section}>Hashtags</Text>
              <View style={styles.hashRow}>
                {searchResult.hashtags.map((h: any) => (
                  <TouchableOpacity
                    key={h.tag}
                    style={styles.hashChip}
                    onPress={() => router.push({ pathname: "/doctor/community/hashtag/[tag]", params: { tag: h.tag } })}
                    testID={`dcom-tag-${h.tag}`}
                  >
                    <Text style={styles.hashText}>#{h.tag}</Text>
                    <Text style={styles.hashCount}>{h.count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {searchResult?.posts?.length > 0 && (
            <>
              <Text style={styles.section}>Posts</Text>
              <View style={styles.grid}>
                {searchResult.posts.map((p: any) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.cell}
                    onPress={() => router.push({ pathname: "/doctor/community/post/[id]", params: { id: p.id } })}
                    testID={`dcom-sp-${p.id}`}
                  >
                    {p.images?.length ? (
                      <Image source={{ uri: p.images[0] }} style={styles.cellImg} />
                    ) : (
                      <View style={[styles.cellImg, styles.cellText]}>
                        <Text style={styles.cellCaption} numberOfLines={5}>{p.caption}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {searchResult && !searchResult.doctors.length && !searchResult.hashtags.length && !searchResult.posts.length && !searchBusy && (
            <Text style={styles.emptyText}>No results for &quot;{q.trim()}&quot;.</Text>
          )}
        </View>
      ) : (
        // DISCOVER VIEW
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.specRow}>
            {SPECIALTIES.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.specChip, specialty === s && styles.specChipActive]}
                onPress={() => { setLoading(true); setSpecialty(s); }}
                testID={`dcom-spec-${s}`}
              >
                <Text style={[styles.specText, specialty === s && { color: COLORS.surface }]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {loading ? (
            <ActivityIndicator color={COLORS.brand} style={{ marginTop: SPACING.lg }} />
          ) : grid.length === 0 ? (
            <Text style={styles.emptyText}>No posts yet in {specialty}.</Text>
          ) : (
            <View style={styles.grid}>
              {grid.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.cell}
                  onPress={() => router.push({ pathname: "/doctor/community/post/[id]", params: { id: p.id } })}
                  testID={`dcom-e-${p.id}`}
                >
                  {p.images?.length ? (
                    <Image source={{ uri: p.images[0] }} style={styles.cellImg} />
                  ) : (
                    <View style={[styles.cellImg, styles.cellText]}>
                      <Text style={styles.cellCaption} numberOfLines={5}>{p.caption}</Text>
                    </View>
                  )}
                  {p.images?.length > 1 && (
                    <View style={styles.cellChip}>
                      <Feather name="copy" size={10} color={COLORS.surface} />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: SPACING.lg, marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, paddingVertical: 12, color: COLORS.textPrimary },
  section: {
    marginTop: SPACING.lg, marginBottom: SPACING.sm, paddingHorizontal: SPACING.lg,
    textTransform: "uppercase", letterSpacing: 2, fontSize: 11, color: COLORS.accent, fontWeight: "700",
  },
  doctorRow: {
    flexDirection: "row", gap: SPACING.md, alignItems: "center",
    marginHorizontal: SPACING.lg, marginBottom: SPACING.sm,
    padding: SPACING.md, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  dAvatar: { width: 44, height: 44, borderRadius: 22 },
  dAvatarFB: { backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  dInitial: { color: COLORS.surface, fontWeight: "700", fontSize: 16 },
  dName: { fontWeight: "700", color: COLORS.textPrimary, fontSize: 14 },
  dSpec: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  hashRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: SPACING.lg },
  hashChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.surface, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  hashText: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  hashCount: { color: COLORS.textMuted, fontSize: 10, fontWeight: "700" },
  specRow: { gap: 8, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  specChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    marginRight: 8,
  },
  specChipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  specText: { color: COLORS.textPrimary, fontWeight: "700", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, paddingHorizontal: SPACING.md },
  cell: { width: CELL, height: CELL, position: "relative", backgroundColor: COLORS.surfaceAlt },
  cellImg: { width: "100%", height: "100%" },
  cellText: { padding: SPACING.sm, backgroundColor: COLORS.brand, justifyContent: "center" },
  cellCaption: { color: COLORS.surface, fontSize: 11, lineHeight: 14 },
  cellChip: {
    position: "absolute", top: 4, right: 4,
    width: 18, height: 18, borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  emptyText: { color: COLORS.textMuted, textAlign: "center", padding: SPACING.xl, fontStyle: "italic" },
});
