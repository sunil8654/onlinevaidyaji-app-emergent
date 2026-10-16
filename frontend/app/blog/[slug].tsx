// WordPress blog post reader — content comes from the same blog as the website
// (blog.onlinevaidyaji.com) via the backend proxy. The post body is HTML, so we
// render it in a WebView (web: iframe). See app/(tabs)/feed.tsx "Blog" chip.
import { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";
import Feather from "@react-native-vector-icons/feather";
import { COLORS, FONTS, SPACING } from "@/src/theme";
import { api, WordPressPost } from "@/src/api";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildHtml(post: WordPressPost & { content?: string }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"/>
<style>
  body { font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 18px 18px 56px; color: #1A2421; background: #FFFDF3; font-size: 17px; line-height: 1.7; }
  img, video { max-width: 100%; height: auto; border-radius: 12px; }
  iframe { max-width: 100%; border-radius: 12px; }
  h1, h2, h3 { line-height: 1.3; }
  a { color: #E07B00; }
  .meta { color: #E07B00; font-size: 12px; letter-spacing: 2px; font-weight: 700; text-transform: uppercase; }
  .title { font-size: 28px; margin: 8px 0; letter-spacing: -0.5px; }
  .author { color: #5C6B64; font-style: italic; font-size: 13px; margin: 4px 0 12px; }
  blockquote { border-left: 3px solid #E07B00; margin: 16px 0; padding-left: 14px; color: #5C6B64; }
  figure { margin: 16px 0; }
</style></head>
<body>
  <div class="meta">${escapeHtml(post.category || "Blog")}</div>
  <h1 class="title">${escapeHtml(post.title)}</h1>
  ${post.author ? `<div class="author">— ${escapeHtml(post.author)}</div>` : ""}
  ${post.content || ""}
</body></html>`;
}

export default function BlogPost() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [post, setPost] = useState<(WordPressPost & { content: string }) | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      try {
        const p = await api.wpPost(String(slug));
        if (alive) setPost(p);
      } catch {
        if (alive) setErr(true);
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  const html = useMemo(() => (post ? buildHtml(post) : ""), [post]);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => router.back()} style={{ width: 40 }} testID="blog-back">
          <Feather name="arrow-left" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Blog</Text>
      </View>

      {err ? (
        <View style={styles.center}>
          <Text style={styles.err}>Couldn’t load this post. Please try again.</Text>
        </View>
      ) : post ? (
        Platform.OS === "web" ? (
          // @ts-ignore — web-only element
          <iframe srcDoc={html} style={{ flex: 1, border: 0, width: "100%" }} title={post.title} />
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html }}
            style={{ flex: 1, backgroundColor: COLORS.bg }}
            startInLoadingState
          />
        )
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.brand} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  head: {
    paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.md,
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  title: { fontFamily: FONTS.heading, fontSize: 22, color: COLORS.textPrimary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.lg },
  err: { color: COLORS.textSecondary, textAlign: "center" },
});
