import { useEffect, useState, useCallback, useRef } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, ScrollView, RefreshControl, ActivityIndicator, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { COLORS, FONTS, RADIUS, SPACING, SPECIALTIES } from "@/src/theme";
import { api, type Doctor } from "@/src/api";
import Feather from "@react-native-vector-icons/feather";
import { useAuth } from "@/src/auth";
import DoctorPatients from "@/app/doctor/patients-list";
import { AvailabilityDot } from "@/src/components/AvailabilityDot";
import DoctorRating, { realRating } from "@/src/components/DoctorRating";
import { formatINR } from "@/src/utils/currency";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ALL = "All";
const ALL_CITIES = "All Cities";
const PAGE_SIZE = 20;
const CACHE_KEY = "consult.directory.v1";
// Short-lived on purpose: this is a "don't stare at a blank screen" cache, not
// an offline mode. A stale directory is worse than a slow one, so it expires.
const CACHE_TTL_MS = 5 * 60 * 1000;

type CachedDirectory = { items: Doctor[]; total: number; fetchedAt: number };

async function readDirectoryCache(): Promise<CachedDirectory | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDirectory;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    if (Date.now() - Number(parsed.fetchedAt) > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDirectoryCache(items: Doctor[], total: number) {
  try {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ items, total, fetchedAt: Date.now() } satisfies CachedDirectory),
    );
  } catch {
    // A failed cache write must never break the list.
  }
}

export default function Consult() {
  const { user } = useAuth();
  // Role-aware: doctors see their Patients list in this slot. Split into its
  // own component so the patient directory's hooks always run in the same
  // order - an early return before them broke hook ordering whenever `user`
  // resolved asynchronously.
  if (user?.role === "doctor") return <DoctorPatients />;
  return <ConsultDirectory />;
}

function ConsultDirectory() {
  const router = useRouter();
  const [system, setSystem] = useState<string>(ALL);
  const [city, setCity] = useState<string>(ALL_CITIES);
  const [cityQuery, setCityQuery] = useState<string>("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [systems, setSystems] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  // True when the list on screen came from cache and the network has since
  // failed, so the footer can say so instead of pretending it is live.
  const [staleNotice, setStaleNotice] = useState(false);

  // Guards against a slow first request overwriting a newer filter's results.
  const reqId = useRef(0);
  // Lets the mount-time cache read stand down once real data has landed.
  const gotFreshData = useRef(false);
  // Mirrors "are there doctors on screen right now". A ref, not state: `load`
  // must keep a stable identity or the filter effect below would refetch forever.
  const hasVisible = useRef(false);

  // Filter values come from the database, so the chips never drift from the
  // doctors that are actually visible. SPECIALTIES stays as the offline
  // fallback while this loads.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const f = await api.listDoctorFilters();
        if (!alive) return;
        setSystems(f.systems || []);
        setCities(f.cities || []);
      } catch {
        // Keep the static fallback lists; the directory still works.
      }
    })();
    return () => { alive = false; };
  }, []);

  const systemOptions = useCallback(() => {
    const fromDb = systems.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    const merged = fromDb.length ? fromDb : SPECIALTIES.filter((s) => s !== ALL);
    return [ALL, ...merged.filter((s, i, a) => a.indexOf(s) === i)];
  }, [systems]);

  // Deliberately touches no state before its first await: the tap handlers
  // raise the spinners themselves, so the effect-driven refetch stays free of
  // synchronous setState.
  const load = useCallback(async (
    s: string,
    c: string,
    nextPage: number,
    append: boolean,
  ) => {
    const id = ++reqId.current;
    try {
      const res = await api.listDoctors({ system: s, city: c, page: nextPage, page_size: PAGE_SIZE });
      if (id !== reqId.current) return; // a newer filter won
      gotFreshData.current = true;
      if (!append) hasVisible.current = res.items.length > 0;
      setDoctors((prev) => (append ? [...prev, ...res.items] : res.items));
      setTotal(res.total);
      setPage(res.page);
      setHasMore(res.has_more);
      setStaleNotice(false);
      setError(null);
      if (!append) writeDirectoryCache(res.items, res.total);
    } catch (e: any) {
      if (id !== reqId.current) return;
      setError(e?.message ? `Couldn't load doctors. ${e.message}` : "Couldn't load doctors.");
      if (!append) {
        // Only blank the list when there is genuinely nothing on screen (no
        // cache, and the filter matched nothing before). Otherwise keep showing
        // real doctors and let the footer flag them as not-freshly-verified.
        if (!hasVisible.current) { setDoctors([]); setTotal(0); setHasMore(false); }
      }
    } finally {
      if (id === reqId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, []);

  // Paint the last known directory immediately, then let the network refresh it.
  // The directory endpoint costs several sequential round trips to a remote
  // host, so without this the tab showed an empty screen for seconds on every
  // visit even though the data was already on the device.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readDirectoryCache();
      if (!alive || !cached) return;
      if (gotFreshData.current) return; // the network already answered
      hasVisible.current = cached.items.length > 0;
      setDoctors(cached.items);
      setTotal(cached.total);
      setStaleNotice(true);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  // Any filter change refetches page 1 from the server.
  useEffect(() => { load(system, city, 1, false); }, [system, city, load]);

  const pickSystem = useCallback((next: string) => {
    setLoading(true);
    setError(null);
    setSystem(next);
  }, []);

  const pickCity = useCallback((next: string) => {
    setLoading(true);
    setError(null);
    setCity(next);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(system, city, 1, false);
    setRefreshing(false);
  }, [load, system, city]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    load(system, city, page + 1, true);
  }, [load, system, city, page, hasMore, loading, loadingMore]);

  const retry = useCallback(() => {
    setLoading(true);
    load(system, city, 1, false);
  }, [load, system, city]);

  const visibleCities = cityQuery.trim()
    ? cities.filter((c) => c.toLowerCase().includes(cityQuery.trim().toLowerCase()))
    : cities;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.head}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={styles.eyebrow}>Consultation</Text>
            <Text style={styles.title}>Find your Vaidya</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <View style={styles.countPill} testID="consult-count">
              <Text style={styles.countPillText}>{total}</Text>
              <Text style={styles.countPillLabel}>Vaidya{total === 1 ? "" : "s"}</Text>
            </View>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.push("/appointments")} testID="consult-my-appointments">
              <Feather name="calendar" size={18} color={COLORS.brand} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsWrap} contentContainerStyle={styles.chipsRow}>
        {systemOptions().map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => pickSystem(s)}
            style={[styles.chip, system === s && styles.chipActive]}
            testID={`consult-chip-${s.toLowerCase()}`}
          >
            <Text style={[styles.chipText, system === s && styles.chipTextActive]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.cityBar}>
        <View style={styles.searchWrap}>
          <Feather name="search" size={15} color={COLORS.textMuted} style={{ marginRight: 6 }} />
          <TextInput
            value={cityQuery}
            onChangeText={setCityQuery}
            placeholder="Search city"
            placeholderTextColor={COLORS.textMuted}
            style={styles.searchInput}
            autoCorrect={false}
            testID="consult-city-search"
          />
          {!!cityQuery && (
            <TouchableOpacity onPress={() => setCityQuery("")} testID="consult-city-clear" style={{ padding: 2 }}>
              <Feather name="x" size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsWrap} contentContainerStyle={styles.chipsRow}>
        <TouchableOpacity
          onPress={() => pickCity(ALL_CITIES)}
          style={[styles.chip, city === ALL_CITIES && { backgroundColor: COLORS.accent, borderColor: COLORS.accent }]}
          testID="consult-city-all"
        >
          <Text style={[styles.chipText, city === ALL_CITIES && { color: COLORS.surface }]}>{ALL_CITIES}</Text>
        </TouchableOpacity>
        {visibleCities.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => pickCity(c)}
            style={[styles.chip, city === c && { backgroundColor: COLORS.accent, borderColor: COLORS.accent }]}
            testID={`consult-city-${c}`}
          >
            <Feather name="map-pin" size={11} color={city === c ? COLORS.surface : COLORS.textSecondary} style={{ marginRight: 4 }} />
            <Text style={[styles.chipText, city === c && { color: COLORS.surface }]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={doctors}
        keyExtractor={(d) => d.id}
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.brand} />}
        ItemSeparatorComponent={() => <View style={{ height: SPACING.md }} />}
        // Lazy-load the next page as the patient scrolls, instead of
        // downloading every doctor up front.
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loading ? (
            <View testID="consult-loading">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
            </View>
          ) : error ? (
            <View style={styles.stateBox} testID="consult-error">
              <Feather name="wifi-off" size={20} color={COLORS.textMuted} />
              <Text style={styles.stateText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={retry} testID="consult-retry">
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.stateBox} testID="consult-empty">
              <Feather name="search" size={20} color={COLORS.textMuted} />
              <Text style={styles.stateText}>
                No verified doctors match these filters yet.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          <>
            {staleNotice ? (
              <View style={styles.staleBar} testID="consult-stale">
                <Feather name="wifi-off" size={12} color={COLORS.textSecondary} />
                <Text style={styles.staleText}>
                  Showing the last list we loaded. Pull down to refresh.
                </Text>
              </View>
            ) : null}
            {loadingMore ? (
              <View style={{ paddingVertical: SPACING.lg }} testID="consult-loading-more">
                <ActivityIndicator color={COLORS.brand} />
              </View>
            ) : doctors.length > 0 && !hasMore ? (
              <Text style={styles.endText}>You&apos;ve seen all {total} available Vaidya{total === 1 ? "" : "s"}</Text>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push({ pathname: "/doctor/[id]", params: { id: item.id } })}
            activeOpacity={0.9}
            testID={`doctor-card-${item.id}`}
          >
            <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            {/* Live-availability green dot in the top-right of the avatar */}
            {item.is_online ? (
              <View style={styles.dotWrap} pointerEvents="none">
                <AvailabilityDot online size={12} />
              </View>
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.docName}>{item.name}</Text>
              <Text style={styles.docQual}>{item.qualification}</Text>
              <View style={styles.tagRow}>
                <View style={styles.tag}>
                  <Text style={styles.tagText}>{item.specialty}</Text>
                </View>
                {!!item.city && (
                  <View style={styles.tagLight}>
                    <Feather name="map-pin" size={10} color={COLORS.accent} />
                    <Text style={styles.tagLightText}>{item.city}</Text>
                  </View>
                )}
                {realRating(item.rating, item.review_count) !== null ? (
                  <View style={styles.tagLight}>
                    <DoctorRating rating={item.rating} reviewCount={item.review_count} />
                  </View>
                ) : null}
                <Text style={styles.exp}>{item.experience_years} yrs</Text>
                {item.is_online ? <AvailabilityDot online compact={false} /> : null}
              </View>
              <Text style={styles.fee}>{formatINR(item.consultation_fee) || "Free"}</Text>
            </View>
            <View style={styles.arrow}>
              <Feather name="chevron-right" size={18} color={COLORS.surface} />
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

function SkeletonCard() {
  // Mirrors the real card's geometry so the list does not jump when data lands.
  return (
    <View style={styles.card} testID="consult-skeleton">
      <View style={[styles.avatar, styles.skelBlock]} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[styles.skelLine, { width: "62%", height: 15 }]} />
        <View style={[styles.skelLine, { width: "42%", height: 10 }]} />
        <View style={[styles.skelLine, { width: "34%", height: 10 }]} />
      </View>
      <View style={[styles.arrow, styles.skelBlock]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  eyebrow: { textTransform: "uppercase", letterSpacing: 3, fontSize: 11, color: COLORS.accent, fontWeight: "700" },
  title: { fontFamily: FONTS.heading, fontSize: 32, color: COLORS.textPrimary, marginTop: 4, letterSpacing: -1 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center",
  },
  chipsWrap: { maxHeight: 56, marginTop: SPACING.md },
  chipsRow: { paddingHorizontal: SPACING.lg, gap: 8, alignItems: "center", height: 56 },
  chip: { flexShrink: 0, flexDirection: "row", alignItems: "center", height: 36, paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, justifyContent: "center" },
  chipActive: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipText: { color: COLORS.textPrimary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: COLORS.surface },
  card: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.lg, padding: SPACING.md,
  },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: COLORS.surfaceAlt },
  dotWrap: { position: "absolute", left: 62, top: 12 },
  docName: { fontFamily: FONTS.heading, fontSize: 20, color: COLORS.textPrimary, lineHeight: 22 },
  docQual: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  tag: { backgroundColor: COLORS.brand, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  tagText: { color: COLORS.surface, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  tagLight: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: COLORS.accentSoft, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  tagLightText: { color: COLORS.accent, fontSize: 10, fontWeight: "700" },
  exp: { color: COLORS.textMuted, fontSize: 11 },
  fee: { fontFamily: FONTS.money, color: COLORS.brand, marginTop: 6, fontWeight: "700", fontSize: 13 },
  arrow: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center" },
  empty: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.xl },
  cityBar: { paddingHorizontal: SPACING.lg, marginTop: SPACING.sm },
  searchWrap: {
    flexDirection: "row", alignItems: "center", height: 42, paddingHorizontal: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
  },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: 14, padding: 0 },
  countPill: {
    flexDirection: "row", gap: 4, height: 44, paddingHorizontal: 12,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  countPillText: { fontFamily: FONTS.heading, fontSize: 18, color: COLORS.brand },
  countPillLabel: { color: COLORS.textSecondary, fontSize: 11, fontWeight: "600" },
  stateBox: { alignItems: "center", justifyContent: "center", gap: SPACING.sm, marginTop: SPACING.xl, paddingHorizontal: SPACING.lg },
  stateText: { color: COLORS.textSecondary, textAlign: "center", fontSize: 13, lineHeight: 19 },
  retryBtn: { marginTop: 4, paddingHorizontal: 18, paddingVertical: 9, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  retryText: { color: COLORS.surface, fontWeight: "700", fontSize: 13 },
  endText: { color: COLORS.textMuted, textAlign: "center", fontSize: 12, paddingVertical: SPACING.lg },
  skelBlock: { backgroundColor: COLORS.surfaceAlt },
  skelLine: { backgroundColor: COLORS.surfaceAlt, borderRadius: 4 },
  staleBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    marginTop: SPACING.lg, paddingVertical: 8, paddingHorizontal: 12,
    backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.md,
  },
  staleText: { color: COLORS.textSecondary, fontSize: 11, textAlign: "center", flexShrink: 1 },
});
