import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppContextProvider } from "@/context/AppContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { RegisterPage } from "@/pages/RegisterPage";
import { ConnectPage } from "@/pages/ConnectPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { TrackingPage } from "@/pages/TrackingPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { CogsPage } from "@/pages/CogsPage";
import { FacebookPage } from "@/pages/FacebookPage";
import { ContentAnalyticsPage } from "@/pages/ContentAnalyticsPage";
import { ProfitPage } from "@/pages/ProfitPage";
import { AdminPage } from "@/pages/AdminPage";
import { PrivacyPolicyPage } from "@/pages/PrivacyPolicyPage";
import { TermsOfServicePage } from "@/pages/TermsOfServicePage";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

/**
 * Gate routes on real auth. Sends unauthenticated users to /login and
 * preserves the originally-requested URL so we can return them after sign-in.
 * Once logged in, also nudges the user to /connect if they haven't added a
 * Shopify store yet — the rest of the app is meaningless without one.
 */
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, stores, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (stores.length === 0 && location.pathname !== '/connect') {
    return <Navigate to="/connect" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/terms" element={<TermsOfServicePage />} />

      <Route path="/connect" element={
        <ProtectedRoute>
          <ConnectPage />
        </ProtectedRoute>
      } />

      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/orders" replace />} />

        <Route path="/orders" element={
          <ProtectedRoute>
            <OrdersPage />
          </ProtectedRoute>
        } />

        <Route path="/tracking" element={
          <ProtectedRoute>
            <TrackingPage />
          </ProtectedRoute>
        } />

        <Route path="/analytics" element={
          <ProtectedRoute>
            <AnalyticsPage />
          </ProtectedRoute>
        } />

        <Route path="/cogs" element={
          <ProtectedRoute>
            <CogsPage />
          </ProtectedRoute>
        } />

        <Route path="/facebook" element={
          <ProtectedRoute>
            <FacebookPage />
          </ProtectedRoute>
        } />

        <Route path="/content" element={
          <ProtectedRoute>
            <ContentAnalyticsPage />
          </ProtectedRoute>
        } />

        <Route path="/profit" element={
          <ProtectedRoute>
            <ProfitPage />
          </ProtectedRoute>
        } />

        <Route path="/admin" element={
          <ProtectedRoute>
            <AdminPage />
          </ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppContextProvider>
            <AppRoutes />
          </AppContextProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
