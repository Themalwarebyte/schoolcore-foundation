import { useEffect, useState } from "react";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, GraduationCap, ShieldAlert } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

interface AuthProps {
  redirectAfterAuth?: string;
}

const INVALID_MESSAGE = "Invalid email or password.";
const DISABLED_MESSAGE = "Your account has been disabled. Contact your administrator.";
const GENERIC_MESSAGE = "We couldn't sign you in right now. Please try again.";

function resolveRedirectAfterAuth(returnTo: string | null, fallback = "/dashboard") {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: convexLoading, isAuthenticated } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const checkCredentials = useAction(api.accounts.checkCredentials);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(searchParams.get("returnTo"), redirectAfterAuth);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed-in users land on their destination. The /dashboard fallback is a
  // universal entry point: the school layout immediately forwards platform
  // super admins (no school membership) to the platform dashboard.
  useEffect(() => {
    if (!convexLoading && isAuthenticated) {
      navigate(redirect, { replace: true });
    }
  }, [convexLoading, isAuthenticated, navigate, redirect]);

  // If sign-in succeeds but the account record is missing or disabled, the
  // session is unusable: show the disabled message and clear the session.
  const me = useQuery(api.accounts.myMemberships);
  const unusableSession = !convexLoading && isAuthenticated && me === null;
  useEffect(() => {
    if (unusableSession) {
      void signOut();
    }
  }, [unusableSession, signOut]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();

    // Pre-check credentials server-side so the user gets a precise, friendly
    // message. Convex production masks raw auth:signIn errors, so without this
    // we could not distinguish a wrong password from a disabled account. The
    // check is read-only — no session is created here.
    try {
      const check = await checkCredentials({ email: normalizedEmail, password });
      if (check && !check.ok) {
        setError(check.reason === "disabled" ? DISABLED_MESSAGE : INVALID_MESSAGE);
        setIsLoading(false);
        return;
      }
    } catch {
      // Best-effort only: fall through to the real sign-in flow.
    }

    try {
      await signIn("password", { email: normalizedEmail, password, flow: "signIn" });
      navigate(redirect, { replace: true });
    } catch (err) {
      // Never surface raw backend errors (request IDs, stacks, DB errors).
      // Details stay in the browser/dev console only.
      const raw = err instanceof Error ? err.message : String(err ?? "");
      if (raw.toLowerCase().includes("invalid")) {
        setError(INVALID_MESSAGE);
      } else {
        console.error("Sign-in failed:", err);
        setError(GENERIC_MESSAGE);
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <GraduationCap className="size-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">SchoolCore</h1>
          <p className="text-sm text-muted-foreground">Sign in to your school workspace</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Welcome back</CardTitle>
            <CardDescription>Use your work email and password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@school.ac.ke"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  required
                />
              </div>
      {(error ?? (unusableSession ? DISABLED_MESSAGE : null)) && (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertDescription>{error ?? DISABLED_MESSAGE}</AlertDescription>
        </Alert>
      )}
              <Button type="submit" className="w-full" disabled={isLoading || !email || !password}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-center border-t bg-muted/50 py-3">
            <p className="text-xs text-muted-foreground">
              Accounts are created by your school administrator.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return <Auth {...props} />;
}
