import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import AuthCallback from "@/auth/AuthCallback";
import { AuthGuard } from "@/auth/AuthGuard";
import { isAuthEnabled, SessionProvider } from "@/auth/provider";
import { Workspace } from "@/app/Workspace";
import { LoginPage } from "@/pages/Login";

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} storageKey="winecore-theme">
      <TooltipProvider delayDuration={300}>
        <SessionProvider>
          <Toaster position="top-center" duration={4000} />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={isAuthEnabled ? <LoginPage /> : <Navigate to="/" replace />} />
              <Route path="/login/callback" element={<AuthCallback />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/*" element={<Navigate to={isAuthEnabled ? "/login" : "/"} replace />} />
              <Route
                path="/*"
                element={
                  <AuthGuard requireAuth>
                    <Workspace />
                  </AuthGuard>
                }
              />
            </Routes>
          </BrowserRouter>
        </SessionProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
