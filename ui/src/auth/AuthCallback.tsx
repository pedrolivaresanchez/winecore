import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AccessDeniedError, isAuthEnabled, useSession } from "@/auth/provider";
import { clearTokens } from "@/auth/tokens";
import { copy } from "@/i18n";

export default function AuthCallback() {
  const navigate = useNavigate();
  const { setUserFromCallback } = useSession();
  const [error, setError] = useState<string | null>(null);
  const processed = useRef(false);

  useEffect(() => {
    if (!isAuthEnabled) {
      navigate("/", { replace: true });
      return;
    }
    if (processed.current) return;
    processed.current = true;

    const run = async () => {
      try {
        const hash = window.location.hash;
        if (!hash) throw new Error("missing");
        const params = new URLSearchParams(hash.slice(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (!accessToken || !refreshToken) throw new Error("missing");
        window.history.replaceState(null, "", window.location.pathname);
        await setUserFromCallback(accessToken, refreshToken);
        navigate("/", { replace: true });
      } catch (err: unknown) {
        if (err instanceof AccessDeniedError) {
          clearTokens();
          navigate("/login?error=access_denied", { replace: true });
          return;
        }
        setError(copy.login.callbackFail);
        window.setTimeout(() => navigate("/login", { replace: true }), 2000);
      }
    };

    void run();
  }, [navigate, setUserFromCallback]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6" data-screen="callback">
      <p className={error ? "text-body text-destructive" : "text-body text-muted-foreground"}>
        {error ?? copy.login.callback}
      </p>
    </div>
  );
}
