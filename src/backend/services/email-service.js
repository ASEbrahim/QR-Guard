import { Resend } from 'resend';

/**
 * Email service abstraction. Three modes:
 * - 'console' (dev): prints the full URL to server console for one-click testing
 * - 'resend': uses Resend API
 * - 'smtp': placeholder for Nodemailer fallback
 */

const provider = process.env.EMAIL_PROVIDER || 'console';
let resend;
if (provider === 'resend') {
  resend = new Resend(process.env.RESEND_API_KEY);
}

/**
 * Sends an email. In console mode, logs the full content to stdout.
 * @param {{ to: string, subject: string, text: string, html?: string }} options
 */
export async function sendEmail({ to, subject, text, html }) {
  if (provider === 'console') {
    console.log('\n========== EMAIL ==========');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${text}`);
    console.log('===========================\n');
    return;
  }

  if (provider === 'resend') {
    await resend.emails.send({
      from: 'QR-Guard <noreply@mail.strat-os.net>',
      to,
      subject,
      text,
      html,
    });
    return;
  }

  // SMTP fallback — not implemented for class project
  console.warn(`[email-service] Unknown provider "${provider}", falling back to console`);
  console.log(`[EMAIL] To: ${to} | Subject: ${subject}\n${text}`);
}

/**
 * Sends a verification email with a clickable link.
 * @param {string} email
 * @param {string} token
 * @param {'email_verify'|'password_reset'|'device_rebind'} purpose
 */
export async function sendTokenEmail(email, token, purpose) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const paths = {
    email_verify: '/verify-email.html',
    password_reset: '/reset-password.html',
    device_rebind: '/verify-email.html', // Reuses the same landing with a different message
  };
  const subjects = {
    email_verify: 'Verify your QR-Guard email',
    password_reset: 'Reset your QR-Guard password',
    device_rebind: 'QR-Guard device rebind request',
  };
  const url = `${baseUrl}${paths[purpose]}?token=${token}&purpose=${purpose}`;

  await sendEmail({
    to: email,
    subject: subjects[purpose],
    text: `Click this link to proceed: ${url}\n\nThis link expires in ${purpose === 'email_verify' ? '24 hours' : '1 hour'}.`,
  });
}
