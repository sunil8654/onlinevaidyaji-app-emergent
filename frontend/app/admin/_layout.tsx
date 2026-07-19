import { Stack, useRouter } from "expo-router";
import { useEffect } from "react";
import { useAuth } from "@/src/auth";

export default function AdminLayout() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user?.is_admin) router.replace("/onboarding");
  }, [user, loading, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
