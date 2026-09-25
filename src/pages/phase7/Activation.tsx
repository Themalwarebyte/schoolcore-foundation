import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSearchParams, Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, KeyRound } from "lucide-react";

/**
 * Public one-time-token page for two flows:
 *  - /activate?invitation=<id>&token=<raw>  → set password, activate account
 *  - /reset-password?token=<raw>            → set a new password
 * No temporary passwords are ever issued — the user chooses their own here.
 */
export default function Activation() {
  const [params] = useSearchParams();
  const invitationId = params.get("invitation");
  const inviteToken = params.get("token");
  const resetToken = params.get("token");
  const isReset = !invitationId;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [done, setDone] = useState(false);

  const preview = useQuery(
    api.phase7.invitations.invitationPreview,
    invitationId && inviteToken ? { invitationId: invitationId as never, token: inviteToken } : "skip",
  );
  const resetPreview = useQuery(
    api.phase7.invitations.resetTokenPreview,
    isReset && resetToken ? { token: resetToken } : "skip",
  );

  const acceptInvitation = useAction(api.phase7.invitations.acceptInvitation);
  const completePasswordReset = useAction(api.phase7.invitations.completePasswordReset);

  useEffect(() => {
    if (preview && !preview.valid && preview.reason !== undefined) {
      // rendered inline below; no toast spam
    }
  }, [preview]);

  const invalidInvite = invitationId && inviteToken && preview && !preview.valid;
  const invalidReset = isReset && resetToken && resetPreview && !resetPreview.valid;

  const submit = async () => {
    if (password.length < 8) { toast.error("Password must be at least 8 characters."); return; }
    if (password !== confirm) { toast.error("Passwords do not match."); return; }
    try {
      if (isReset) {
        await completePasswordReset({ token: resetToken!, newPassword: password });
      } else {
        await acceptInvitation({
          invitationId: invitationId as never,
          token: inviteToken!,
          password,
          fullName: fullName || undefined,
        });
      }
      setDone(true);
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md card-soft">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="size-5 text-primary" />
          </div>
          <CardTitle>{isReset ? "Set a new password" : "Activate your account"}</CardTitle>
          <CardDescription>
            {isReset
              ? "Choose a new password for your SchoolCore account."
              : preview?.valid
                ? `Welcome${preview.name ? `, ${preview.name}` : ""} — set your own password to activate your ${preview.role.replace(/_/g, " ")} account for ${preview.email}.`
                : "One-time account activation link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {done ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto size-10 text-green-600" />
              <p className="text-sm font-medium">
                {isReset ? "Password updated." : "Account activated."}
              </p>
              <Button asChild className="w-full">
                <Link to="/auth">Continue to sign in</Link>
              </Button>
            </div>
          ) : invalidInvite ? (
            <div className="space-y-4 text-center">
              <XCircle className="mx-auto size-10 text-red-600" />
              <p className="text-sm text-muted-foreground">
                This activation link is {preview?.reason === "expired" ? "expired" : "invalid or already used"}.
                Ask your administrator to send a new invitation.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </div>
          ) : invalidReset ? (
            <div className="space-y-4 text-center">
              <XCircle className="mx-auto size-10 text-red-600" />
              <p className="text-sm text-muted-foreground">
                This reset link is invalid, expired or already used. Request a new one from your administrator.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              {!isReset && (
                <div className="space-y-1.5">
                  <Label>Your full name (optional)</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={preview?.name ?? ""} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>New password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div className="space-y-1.5">
                <Label>Confirm password</Label>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
              </div>
              <Button className="w-full" disabled={!password || !confirm} onClick={submit}>
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
