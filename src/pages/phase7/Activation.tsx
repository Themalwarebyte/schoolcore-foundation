import { useCallback, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSearchParams, Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, KeyRound } from "lucide-react";

type TokenCheck = {
  valid: boolean;
  reason?: string;
  kind?: string;
  email?: string;
  name?: string | null;
};

/**
 * Public one-time-token page for two flows:
 *  - /activate?token=<raw>       → set password, activate an invited account
 *  - /reset-password?token=<raw> → set a new password
 * The raw token is validated (server marks expired tokens) and redeemed once.
 * No temporary passwords are ever issued — the user chooses their own here.
 */
export default function Activation() {
  const [params] = useSearchParams();
  const urlToken = params.get("token") ?? "";
  const [code, setCode] = useState(urlToken);
  const [checked, setChecked] = useState<TokenCheck | null>(null);
  const [checking, setChecking] = useState(false);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const validateToken = useMutation(api.phase7.invitations.validateToken);
  const redeemToken = useAction(api.phase7.invitations.redeemToken);

  const runCheck = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        setChecked(null);
        return;
      }
      setChecking(true);
      try {
        const res = await validateToken({ token: trimmed });
        setChecked(res as TokenCheck);
      } catch {
        setChecked({ valid: false, reason: "invalid_or_used" });
      } finally {
        setChecking(false);
      }
    },
    [validateToken],
  );

  useEffect(() => {
    if (urlToken) void runCheck(urlToken);
  }, [urlToken, runCheck]);

  const isReset = checked?.kind === "password_reset";
  const invalidToken = checked !== null && !checked.valid;

  const submit = async () => {
    if (password.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (password !== confirm) { toast.error("Passwords do not match."); return; }
    try {
      await redeemToken({ token: code.trim(), newPassword: password });
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Activation failed.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md card-soft">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="size-5 text-primary" />
          </div>
          <CardTitle>
            {done ? "All set" : isReset ? "Set a new password" : "Activate your account"}
          </CardTitle>
          <CardDescription>
            {done
              ? "Your password has been saved. Sign in with it from now on."
              : checked?.valid
                ? `Welcome${checked.name ? `, ${checked.name}` : ""} — choose your own password${checked.email ? ` for ${checked.email}` : ""}.`
                : "Paste your one-time activation code and choose a password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-green-600" />
              <Button asChild className="w-full">
                <Link to="/auth">Continue to sign in</Link>
              </Button>
            </div>
          ) : invalidToken ? (
            <div className="space-y-4 text-center">
              <XCircle className="mx-auto size-10 text-red-600" />
              <p className="text-sm text-muted-foreground">
                This code is {checked?.reason === "expired" ? "expired" : "invalid or already used"}.
                Ask your administrator to issue a new one.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Activation code</Label>
                <Input
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setChecked(null); }}
                  onBlur={() => void runCheck(code)}
                  placeholder="Paste the code from your invitation"
                />
                {checking && <p className="text-xs text-muted-foreground">Checking code…</p>}
              </div>
              <div className="space-y-1.5">
                <Label>New password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm password</Label>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
              </div>
              <Button className="w-full" disabled={!code.trim() || !password || !confirm || checking || (checked !== null && !checked.valid)} onClick={submit}>
                {isReset ? "Update password" : "Activate account"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Link to="/auth" className="underline-offset-2 hover:underline">Back to sign in</Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
