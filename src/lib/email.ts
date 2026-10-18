// Sending email over SMTP with Nodemailer.
//
// In development SMTP_URL points at Mailpit, which catches every message (see
// http://localhost:8025). Without an SMTP_URL (e.g. production with no email
// provider set up) emails are skipped instead of failing.

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: EmailMessage): Promise<"sent" | "skipped">;
}

export function createMailer(smtpUrl: string | undefined, from: string): Mailer {
  // Created on first use and reused: one connection setup, many emails.
  let transport: Transporter | undefined;
  return {
    async send(message) {
      if (!smtpUrl) return "skipped";
      transport ??= nodemailer.createTransport(smtpUrl);
      await transport.sendMail({ from, ...message });
      return "sent";
    },
  };
}

export const mailer = createMailer(env.smtpUrl, env.emailFrom);
