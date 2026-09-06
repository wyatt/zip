import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import Resend from "@auth/core/providers/resend";

const reset = Resend({
  id: "password-reset",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 15 * 60,
  async generateVerificationToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  },
  async sendVerificationRequest({ identifier, token }) {
    if (!process.env.AUTH_RESEND_KEY || !process.env.AUTH_EMAIL_FROM) throw new Error("Password recovery email is not configured. Contact the administrator.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM, to: [identifier], subject: "Reset your iris password", text: `Your password reset code is ${token}. It expires in 15 minutes. If you did not request this, ignore this email.` }),
    });
    if (!response.ok) throw new Error("Could not deliver the recovery email. Try again later.");
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({
    reset,
    profile(params) {
      const email = String(params.email ?? "").normalize("NFKC").trim().toLowerCase();
      if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email)) throw new Error("Enter a valid email address.");
      return { email };
    },
    validatePasswordRequirements(password) {
      if (password.length < 12 || password.length > 128) throw new Error("Use a password between 12 and 128 characters.");
    },
  })],
  session: { totalDurationMs: 7 * 86400000, inactiveDurationMs: 86400000 },
});
