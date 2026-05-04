import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { apiFetch, auth as authStore, ApiError } from '@/utils/apiClient';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isVerified: boolean;
}

export interface UserStore {
  id: string;
  storeDomain: string;
  accessToken: string;
  name: string | null;
  defaultShippingCompany: string | null;
  defaultSupplier: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;          // initial bootstrap (verifying stored token)
  stores: UserStore[];
  activeStore: UserStore | null;
  /** Sign in with email + password. Returns the user record. */
  login: (email: string, password: string) => Promise<AuthUser>;
  /** Create a new account. Returns the user record. */
  register: (input: { email: string; password: string; firstName?: string; lastName?: string }) => Promise<AuthUser>;
  /** Wipe token + store selection. */
  logout: () => void;
  /** Re-fetch the user's stores. Call after add / remove. */
  refreshStores: () => Promise<UserStore[]>;
  /** Persist + activate a store domain (header + localStorage). */
  setActiveStoreByDomain: (domain: string | null) => void;
  /** Add a new Shopify store under the current user. */
  addStore: (storeDomain: string, accessToken: string, name?: string) => Promise<UserStore>;
  /** Soft-delete a store. */
  removeStore: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const ACTIVE_STORE_KEY = 'active_store_domain';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [stores, setStores] = useState<UserStore[]>([]);
  const [activeStore, setActiveStore] = useState<UserStore | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStores = useCallback(async (): Promise<UserStore[]> => {
    try {
      const r = await apiFetch<{ stores: UserStore[] }>('/api/auth/stores');
      setStores(r.stores);
      // If the persisted active-store domain is still in the list, keep it;
      // otherwise pick the first store as a sensible default.
      const persistedDomain = localStorage.getItem(ACTIVE_STORE_KEY);
      const found = r.stores.find(s => s.storeDomain === persistedDomain) || r.stores[0] || null;
      setActiveStore(found);
      if (found) authStore.setActiveStore(found.storeDomain);
      else authStore.setActiveStore(null);
      return r.stores;
    } catch (e) {
      console.warn('refreshStores failed:', e);
      setStores([]);
      setActiveStore(null);
      return [];
    }
  }, []);

  // Bootstrap on mount — verify any stored token by calling /auth/me, then load stores.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = authStore.getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const me = await apiFetch<{ user: AuthUser }>('/api/auth/me');
        if (cancelled) return;
        setUser(me.user);
        await refreshStores();
      } catch (e) {
        // Token expired / invalid — clear it.
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          authStore.clear();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshStores]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    authStore.setToken(r.token);
    setUser(r.user);
    await refreshStores();
    return r.user;
  }, [refreshStores]);

  const register = useCallback(async (input: { email: string; password: string; firstName?: string; lastName?: string }) => {
    const r = await apiFetch<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    authStore.setToken(r.token);
    setUser(r.user);
    await refreshStores();
    return r.user;
  }, [refreshStores]);

  const logout = useCallback(() => {
    authStore.clear();
    setUser(null);
    setStores([]);
    setActiveStore(null);
  }, []);

  const setActiveStoreByDomain = useCallback((domain: string | null) => {
    if (!domain) {
      authStore.setActiveStore(null);
      setActiveStore(null);
      return;
    }
    const found = stores.find(s => s.storeDomain === domain);
    if (!found) return;
    authStore.setActiveStore(domain);
    setActiveStore(found);
  }, [stores]);

  const addStore = useCallback(async (storeDomain: string, accessToken: string, name?: string) => {
    const r = await apiFetch<{ store: UserStore }>('/api/auth/stores', {
      method: 'POST',
      body: JSON.stringify({ storeDomain, accessToken, name })
    });
    const updated = await refreshStores();
    // Auto-select the just-added store if it now exists in the list
    const fresh = updated.find(s => s.storeDomain === r.store.storeDomain);
    if (fresh) {
      authStore.setActiveStore(fresh.storeDomain);
      setActiveStore(fresh);
    }
    return r.store;
  }, [refreshStores]);

  const removeStore = useCallback(async (id: string) => {
    await apiFetch(`/api/auth/stores/${id}`, { method: 'DELETE' });
    await refreshStores();
  }, [refreshStores]);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      stores,
      activeStore,
      login,
      register,
      logout,
      refreshStores,
      setActiveStoreByDomain,
      addStore,
      removeStore
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
