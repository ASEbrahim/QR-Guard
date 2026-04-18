import { Resend } from 'resend';

/**
 * Email service abstraction. Two modes:
 * - 'console' (default / dev): prints the full URL + body to server console
 *   for one-click testing. Any unrecognized EMAIL_PROVIDER falls through
 *   to this mode (used to be documented as a third 'smtp' placeholder but
 *   no SMTP branch was ever implemented).
 * - 'resend' (production): uses Resend API with AUK-branded HTML templates.
 *   Requires RESEND_API_KEY.
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

  console.warn(`[email-service] Unknown provider "${provider}", falling back to console`);
  console.log(`[EMAIL] To: ${to} | Subject: ${subject}\n${text}`);
}

/**
 * Builds a styled HTML email wrapper.
 */
function buildHtmlEmail(heading, bodyHtml) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#9a182b;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#D4A037;font-size:24px;font-weight:800;letter-spacing:-0.02em;">QR-Guard</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px;">American University of Kuwait</p>
    </div>
    <div style="padding:32px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;font-weight:700;">${heading}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:16px 32px;background:#f8f9fa;text-align:center;border-top:1px solid #e2e8f0;">
      <p style="margin:0;color:#94a3b8;font-size:12px;">American University of Kuwait — QR-Guard Attendance System</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Sends a verification/reset/rebind email with a styled HTML template.
 * @param {string} email
 * @param {string} token
 * @param {'email_verify'|'password_reset'|'device_rebind'} purpose
 */
export async function sendTokenEmail(email, token, purpose) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const paths = {
    email_verify: '/verify-email',
    password_reset: '/reset-password',
    device_rebind: '/verify-email',
  };
  const url = `${baseUrl}${paths[purpose]}?token=${token}&purpose=${purpose}`;
  const expiry = purpose === 'email_verify' ? '24 hours' : '1 hour';

  const configs = {
    email_verify: {
      subject: 'Verify your QR-Guard email',
      heading: 'Verify Your Email',
      message: 'Thanks for registering with QR-Guard. Click the button below to verify your email address and activate your account.',
      buttonText: 'Verify Email',
    },
    password_reset: {
      subject: 'Reset your QR-Guard password',
      heading: 'Reset Your Password',
      message: 'We received a request to reset your password. Click the button below to choose a new password.',
      buttonText: 'Reset Password',
    },
    device_rebind: {
      subject: 'QR-Guard device rebind request',
      heading: 'Device Rebind',
      message: 'A device rebind was requested for your account. Click the button below to unbind your current device. You can then log in from your new device to bind it.',
      buttonText: 'Rebind Device',
    },
  };

  const config = configs[purpose];

  const html = buildHtmlEmail(config.heading, `
      <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">${config.message}</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${url}" style="display:inline-block;background:#9a182b;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">${config.buttonText}</a>
      </div>
      <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">This link expires in ${expiry}. If you didn't request this, you can ignore this email.</p>
      <p style="margin:12px 0 0;color:#cbd5e1;font-size:11px;word-break:break-all;">${url}</p>
  `);

  const text = `${config.heading}\n\n${config.message}\n\nClick here: ${url}\n\nThis link expires in ${expiry}.`;

  await sendEmail({ to: email, subject: config.subject, text, html });
}

/**
 * Sends a 6-digit verification code email (for registration).
 * @param {string} email
 * @param {string} code — 6-digit numeric code
 */
export async function sendVerificationCode(email, code) {
  const html = buildHtmlEmail('Verify Your Email', `
      <p style="margin:0 0 8px;color:#475569;font-size:15px;line-height:1.6;">Enter this code on the registration page to verify your email:</p>
      <div style="text-align:center;margin:24px 0;">
        <div style="display:inline-block;background:#f1f4f8;border:2px dashed #d4a037;border-radius:12px;padding:16px 40px;">
          <span style="font-size:36px;font-weight:800;letter-spacing:0.3em;color:#1e293b;font-family:'SF Mono','Fira Code',monospace;">${code}</span>
        </div>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:13px;">This code expires in 24 hours. If you didn't create an account, ignore this email.</p>
  `);

  const text = `Your QR-Guard verification code is: ${code}\n\nEnter this code on the registration page. It expires in 24 hours.`;

  await sendEmail({ to: email, subject: `${code} — QR-Guard verification code`, text, html });
}
