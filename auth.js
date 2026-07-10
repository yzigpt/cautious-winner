import { getSupabase } from "./supabase-client.js?v=20260710-account";

export async function getCurrentSession() {
  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

export async function signUp({ name, email }) {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("account-register", {
    body: { name, email },
  });
  if (error || !data?.ok) throw new Error(data?.error || error?.message || "Could not start registration.");
  return data;
}

export async function signIn({ email, password }) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  try {
    await checkAccountAccess();
  } catch (accessError) {
    await supabase.auth.signOut();
    throw accessError;
  }
  return data;
}

export async function checkAccountAccess() {
  const { data, error } = await getSupabase().functions.invoke("account-access", { body: {} });
  if (error || !data?.ok) throw new Error(data?.error || error?.message || "Account access is restricted.");
  return data;
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}
